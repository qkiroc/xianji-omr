"""Train the layout detector locally, publish metrics/artifacts, optionally serve inference."""
import argparse,gc,json,math,os,socket,subprocess,sys,time,uuid
from pathlib import Path
from prepare_dataset import prepare,save_json
from platform_client import Platform,Reporter
ROOT=Path(__file__).resolve().parents[2]
METRICS={'train/box_loss','train/cls_loss','train/dfl_loss','val/box_loss','val/cls_loss','val/dfl_loss',
 'metrics/precision(B)','metrics/recall(B)','metrics/mAP50(B)','metrics/mAP50-95(B)','lr/pg0','lr/pg1','lr/pg2'}

def export_artifacts(directory,meta,summary):
    prepared=Path(meta['prepared'])
    import torch
    from ultralytics import YOLO
    reporter=Reporter(Platform(meta['origin'],ROOT),meta['id'],directory,heartbeat=True)
    try:
        reporter.emit('log',{'message':'Evaluating best checkpoint and exporting ONNX'})
        events=[json.loads(line) for line in (directory/'events.jsonl').read_text(encoding='utf-8').splitlines()]
        best=directory/'fit/weights/best.pt'
        if not best.exists():raise RuntimeError('Training did not produce best.pt')
        model=YOLO(str(best))
        evaluation={}
        # Always evaluate the actual best checkpoint; reserve test for final evaluation.
        for split in ['val']+(['test'] if summary['splits']['test']['pages'] else []):
            metrics=model.val(data=str(prepared/'data.yaml'),split=split,imgsz=meta['config']['imgsz'],batch=meta['config']['batch'],device=0 if torch.cuda.is_available() else 'cpu',
                              project=str(directory),name='evaluate-'+split,plots=True,workers=0,exist_ok=True)
            evaluation[split]={k:float(v) for k,v in metrics.results_dict.items() if math.isfinite(float(v))}
        onnx_path=Path(model.export(format='onnx',imgsz=meta['config']['imgsz'],batch=1,dynamic=False,simplify=False,opset=17,nms=False,device='cpu'))
        import onnx
        onnx.checker.check_model(str(onnx_path))
        # Validate the exported graph on a real holdout image before publication.
        from inference import Detector
        index=json.loads((prepared/'index.json').read_text(encoding='utf-8'))
        sample=next(s for s in index if s['split']=='val')
        detector=Detector(onnx_path,meta['categories']);detector.predict((prepared/sample['path']).read_bytes(),0.25,0.45)
        report={'fingerprint':meta['fingerprint'],'runId':meta['id'],'config':meta['config'],'datasetSummary':summary,
                'evaluation':evaluation,'epochsCompleted':max([e['payload']['epoch'] for e in events if e['kind']=='epoch'] or [0]),'environment':json.loads((directory/'environment.json').read_text()),
                'modelFormat':'YOLO11 raw ONNX, batch=1, RGB NCHW float32, class-aware NMS in worker'}
        save_json(directory/'report.json',report)
        artifacts={'onnx':str(onnx_path),'weights':str(best),'report':str(directory/'report.json')}
        for kind,path in [('results',directory/'fit/results.png'),('confusion',directory/'evaluate-val/confusion_matrix_normalized.png')]:
            if path.exists():artifacts[kind]=str(path)
        previews=sorted((directory/'evaluate-val').glob('val_batch*_pred.jpg'))
        if previews:artifacts['preview']=str(previews[0])
        save_json(directory/'publication.json',{'artifacts':artifacts})
    finally:reporter.close()

def publish(directory):
    directory=Path(directory).resolve();meta=json.loads((directory/'run.json').read_text(encoding='utf-8'))
    api=Platform(meta['origin'],ROOT);rid=meta['id']
    current=api.request('/api/v2/training/runs/'+rid)
    if current['status']=='completed':return rid
    if current['status'] not in ('running','exporting'):raise RuntimeError('Run is not publishable: '+current['status'])
    if current['status']=='running':
        state_reporter=Reporter(api,rid,directory);state_reporter.emit('state',{'status':'exporting'});state_reporter.close()
    if not (directory/'publication.json').exists():
        summary=json.loads((Path(meta['prepared'])/'audit.json').read_text(encoding='utf-8'))
        export_artifacts(directory,meta,summary)
    publication=json.loads((directory/'publication.json').read_text(encoding='utf-8'))
    reporter=Reporter(api,rid,directory,heartbeat=True)
    try:
        for kind,path in publication['artifacts'].items():
            for attempt in range(3):
                try:api.upload(rid,kind,path);break
                except Exception:
                    if attempt==2:raise
                    time.sleep(3)
            print(json.dumps({'event':'artifact-uploaded','kind':kind}),flush=True)
    finally:reporter.close()
    api.request('/api/v2/training/runs/'+rid+'/complete',{})
    save_json(directory/'status.json',{'status':'completed','runId':rid,'platform':meta['origin']+'/training/'+rid})
    return rid

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--origin',default='http://116.62.12.100:8790');p.add_argument('--data-root',default=str(ROOT/'.artifacts/training/data'))
    p.add_argument('--runs-root',default=str(ROOT/'.artifacts/training/runs'));p.add_argument('--dataset',action='append',default=[])
    p.add_argument('--epochs',type=int,default=100);p.add_argument('--imgsz',type=int,choices=[640,960,1280,1536],default=1280)
    p.add_argument('--batch',type=int,default=4);p.add_argument('--workers',type=int,default=2)
    p.add_argument('--skip-sync',action='store_true');p.add_argument('--prepare-only',action='store_true');p.add_argument('--serve',action='store_true')
    p.add_argument('--publish',metavar='RUN_DIRECTORY');p.add_argument('--resume',metavar='RUN_DIRECTORY')
    args=p.parse_args()
    if args.publish:
        rid=publish(args.publish);print(json.dumps({'event':'published','id':rid}));return
    if not 1<=args.epochs<=1000 or not 1<=args.batch<=64 or not 0<=args.workers<=8:p.error('Invalid epochs/batch/workers')
    if args.resume:
        directory=Path(args.resume).resolve();meta=json.loads((directory/'run.json').read_text(encoding='utf-8'))
        args.origin=meta['origin'];args.epochs=meta['config']['epochs'];args.imgsz=meta['config']['imgsz'];args.batch=meta['config']['batch']
        prepared=Path(meta['prepared']);summary=json.loads((prepared/'audit.json').read_text(encoding='utf-8'))
        if summary['fingerprint']!=meta['fingerprint']:raise RuntimeError('Resume dataset fingerprint mismatch')
    else:
        if not args.skip_sync:
            proxy_flag=subprocess.check_output(['node','-p',"process.allowedNodeEnvironmentFlags.has('--use-env-proxy') ? '--use-env-proxy' : ''"],text=True).strip()
            command=['node']+([proxy_flag] if proxy_flag else [])+[str(ROOT/'tools/training/sync-confirmed.mjs'),'--origin',args.origin,'--output',args.data_root]
            for dataset in args.dataset:command+=['--dataset',dataset]
            subprocess.run(command,check=True,cwd=ROOT)
        prepared,summary=prepare(args.data_root)
        if args.prepare_only:print(json.dumps({'directory':str(prepared),**summary},ensure_ascii=False));return
        directory=Path(args.runs_root).resolve()/str(uuid.uuid4());directory.mkdir(parents=True,exist_ok=True)
        meta={'id':directory.name,'name':'Layout '+time.strftime('%Y-%m-%d %H:%M'),'origin':args.origin,'prepared':str(prepared),'fingerprint':summary['fingerprint'],
              'categories':summary['categories'],'config':{'model':'yolo11s.pt','epochs':args.epochs,'imgsz':args.imgsz,'batch':args.batch,'seed':42},'datasetSummary':summary}
        save_json(directory/'run.json',meta)
    os.environ.setdefault('YOLO_CONFIG_DIR',str(Path(args.runs_root).resolve()/'settings'))
    import torch
    from ultralytics import YOLO
    if not torch.cuda.is_available():raise RuntimeError('CUDA GPU unavailable. Install the CUDA 12.8 PyTorch build before training.')
    # Exercise an actual GPU operation, not only driver detection.
    (torch.ones((16,16),device='cuda')@torch.ones((16,16),device='cuda')).sum().item()
    api=Platform(args.origin,ROOT);rid=meta['id']
    current=api.request('/api/v2/training/runs',{'id':rid,'name':meta['name'],'fingerprint':meta['fingerprint'],'categories':meta['categories'],'config':meta['config'],'datasetSummary':summary})
    if current['status'] not in ('created','running'):raise RuntimeError('Run cannot be resumed in state '+current['status'])
    reporter=Reporter(api,rid,directory,heartbeat=True)
    last_epoch=max([e['payload']['epoch'] for e in reporter.events if e['kind']=='epoch'] or [0])
    if not reporter.events:reporter.emit('state',{'status':'running'})
    save_json(directory/'environment.json',{'python':sys.version,'torch':torch.__version__,'cuda':torch.version.cuda,'gpu':torch.cuda.get_device_name(0),'host':socket.gethostname()})
    (directory/'requirements-lock.txt').write_bytes(subprocess.check_output([sys.executable,'-m','pip','freeze']))
    heartbeat=[time.monotonic()]
    def batch_callback(trainer):
        if time.monotonic()-heartbeat[0]>15:
            reporter.emit('heartbeat',{});heartbeat[0]=time.monotonic()
    def epoch_callback(trainer):
        nonlocal last_epoch
        epoch=trainer.epoch+1
        if epoch<=last_epoch:return
        values=dict(trainer.metrics or {})
        for key,value in trainer.label_loss_items(trainer.tloss,prefix='train').items():values[key]=value
        values.update(trainer.lr or {})
        metrics={k:float(v) for k,v in values.items() if k in METRICS and math.isfinite(float(v)) and float(v)>=0}
        reporter.emit('epoch',{'epoch':epoch,'metrics':metrics});last_epoch=epoch
        save_json(directory/'status.json',{'status':'running','epoch':epoch,'epochs':args.epochs,'metrics':metrics,'runId':rid})
    checkpoint=directory/'fit/weights/last.pt'
    if args.resume and not checkpoint.exists():raise RuntimeError('last.pt is missing; cannot resume')
    pretrained=Path(args.runs_root).resolve()/'pretrained/yolo11s.pt';pretrained.parent.mkdir(parents=True,exist_ok=True)
    model=YOLO(str(checkpoint) if args.resume else str(pretrained))
    model.add_callback('on_train_batch_end',batch_callback);model.add_callback('on_fit_epoch_end',epoch_callback)
    try:
        if args.resume:model.train(resume=True,device=0,workers=args.workers)
        else:model.train(data=str(prepared/'data.yaml'),epochs=args.epochs,imgsz=args.imgsz,batch=args.batch,device=0,
            workers=args.workers,project=str(directory),name='fit',exist_ok=False,seed=42,patience=25,
            cache=False,save=True,plots=True,amp=True,mosaic=0.0,mixup=0.0,copy_paste=0.0,
            fliplr=0.0,flipud=0.0,degrees=1.0,translate=0.03,scale=0.15,perspective=0.0)
    except KeyboardInterrupt:
        reporter.emit('log',{'message':'Local process interrupted; checkpoint retained. Resume with --resume.'})
        reporter.close();raise
    except Exception as error:
        reporter.emit('state',{'status':'failed','message':str(error)[:1900] or type(error).__name__})
        reporter.close();raise
    reporter.emit('state',{'status':'exporting'});reporter.close()
    try:
        del model;gc.collect();torch.cuda.empty_cache()
        export_artifacts(directory,meta,summary)
        publish(directory)
    except Exception:
        save_json(directory/'status.json',{'status':'publication_pending','runId':rid,'retry':'python tools/training/train.py --publish '+str(directory)})
        raise
    print(json.dumps({'event':'training-complete','url':args.origin+'/training/'+rid,'directory':str(directory)}),flush=True)
    if args.serve:
        print('Starting inference worker; keep this terminal open.',flush=True)
        gc.collect();torch.cuda.empty_cache()
        subprocess.run([sys.executable,str(ROOT/'tools/training/worker.py'),'--origin',args.origin,'--cache',str(Path(args.runs_root).resolve()/'inference-cache')],check=True)

if __name__=='__main__':main()
