"""Poll platform inference jobs. Requires no inbound port or public IP on the PC."""
import argparse,hashlib,json,socket,threading,time,uuid
from pathlib import Path
from platform_client import Platform
from prepare_dataset import save_json,sha_file
from inference import Detector
ROOT=Path(__file__).resolve().parents[2]

def main():
    p=argparse.ArgumentParser();p.add_argument('--origin',default='http://116.62.12.100:8790')
    p.add_argument('--cache',default=str(ROOT/'.artifacts/training/inference-cache'));args=p.parse_args()
    cache=Path(args.cache).resolve();cache.mkdir(parents=True,exist_ok=True)
    identity=cache/'worker-id.json'
    if not identity.exists():save_json(identity,{'id':str(uuid.uuid4())})
    wid=json.loads(identity.read_text())['id'];api=Platform(args.origin,ROOT)
    detector=None;loaded_sha=None;last_heartbeat=0
    print(json.dumps({'event':'worker-started','id':wid}),flush=True)
    while True:
        try:
            if time.monotonic()-last_heartbeat>15:
                api.request('/api/v2/training/workers/'+wid+'/heartbeat',{'name':socket.gethostname(),'device':'ONNX Runtime CPU'})
                last_heartbeat=time.monotonic()
            job=api.request('/api/v2/training/predictions/claim',{'workerId':wid})
            if job is None:time.sleep(2);continue
            stop=threading.Event();lease_lost=threading.Event()
            lease={'workerId':wid,'claimToken':job['claimToken']}
            def heartbeat(job_id=job['id'],claim=lease,stop_event=stop,lost=lease_lost):
                while not stop_event.wait(15):
                    try:
                        api.request('/api/v2/training/predictions/'+job_id+'/heartbeat',claim,timeout=10)
                        api.request('/api/v2/training/workers/'+wid+'/heartbeat',{'name':socket.gethostname(),'device':'ONNX Runtime CPU'},timeout=10)
                    except Exception:lost.set();return
            thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
            try:
                model=api.request('/api/v2/training/runs/'+job['runId'])
                artifact=next(a for a in model['artifacts'] if a['kind']=='onnx');checksum=artifact['checksum']
                path=cache/(checksum+'.onnx')
                if not path.exists():
                    data,headers=api.request('/api/v2/training/runs/'+job['runId']+'/artifacts/onnx',binary=True,timeout=300)
                    if len(data)!=int(artifact['bytes']) or hashlib.sha256(data).hexdigest()!=checksum:raise ValueError('ONNX checksum mismatch')
                    part=path.with_suffix('.partial');part.write_bytes(data);part.replace(path)
                elif sha_file(path)!=checksum:raise ValueError('Cached ONNX checksum mismatch')
                if checksum!=loaded_sha:
                    detector=None  # Release the preceding ONNX session before loading another model.
                    detector=Detector(path,job['categories']);loaded_sha=checksum
                data,_=api.request('/api/v2/training/predictions/'+job['id']+'/image',binary=True)
                if len(data)!=job['imageBytes'] or hashlib.sha256(data).hexdigest()!=job['imageChecksum']:raise ValueError('Image checksum mismatch')
                boxes,elapsed=detector.predict(data,job['confidence'],job['iou'])
                result={**lease,'boxes':boxes,'elapsedMs':elapsed}
            except Exception as e:result={**lease,'error':str(e)[:1900] or type(e).__name__}
            finally:stop.set();thread.join(timeout=25)
            if lease_lost.is_set():print(json.dumps({'event':'lease-lost','id':job['id']}),flush=True);continue
            api.request('/api/v2/training/predictions/'+job['id']+'/result',result)
            print(json.dumps({'event':'prediction-finished','id':job['id'],'boxes':len(result.get('boxes',[])),'error':result.get('error')}),flush=True)
        except KeyboardInterrupt:break
        except Exception as e:print(json.dumps({'event':'worker-retry','error':str(e)}),flush=True);time.sleep(5)

if __name__=='__main__':main()
