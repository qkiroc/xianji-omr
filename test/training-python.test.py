import sys,unittest,tempfile,json,hashlib,copy,io,warnings
from pathlib import Path
from PIL import Image
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/training'))
from prepare_dataset import prepare,save_json
from platform_client import Reporter
from inference import nms,Detector
from image_rgb import rgb_on_white,needs_rgb_normalization

TESTROOT=Path(__file__).resolve().parents[1]/'.test-data/training-python'
TESTROOT.mkdir(parents=True,exist_ok=True)

class TrainingTests(unittest.TestCase):
 def sample(self,root,number,group,split='train',color=None,image=None):
  data=io.BytesIO();(image if image is not None else Image.new('RGB',(100,60),color or (number*20,number*15,number*10))).save(data,format='PNG');b=data.getvalue();sha=hashlib.sha256(b).hexdigest()
  path=root/'assets'/(sha+'.png');path.parent.mkdir(exist_ok=True);path.write_bytes(b)
  asset={'checksum':sha,'bytes':len(b),'width':100,'height':60,'mime':'image/png'}
  return {'image':{'id':str(number),'status':'confirmed','pageType':'music','width':100,'height':60,'coordinate':{'original':asset,'working':asset}},'boxes':[{'classKey':'guitar','x':10,'y':10,'width':70,'height':40}],'workingPath':'assets/'+sha+'.png','originalPath':'assets/'+sha+'.png','songGroupKey':group,'split':split,'sourceKind':'confirmed_other'}
 def manifest(self,root,samples):
  m={'complete':True,'task':'layout-detection','fingerprint':'a'*64,'taxonomy':[{'id':0,'key':'system'},{'id':1,'key':'guitar'}],'samples':samples};p=root/'manifest.json';save_json(p,m);return p
 def test_prepare_group_holdouts_and_yolo(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);samples=[self.sample(root,i,'song-'+str(i)) for i in range(1,7)]
   samples.append(self.sample(root,7,'song-1'))
   out,audit=prepare(root,self.manifest(root,samples));index=json.loads((out/'index.json').read_text())
   self.assertGreater(audit['splits']['train']['pages'],0);self.assertGreater(audit['splits']['val']['pages'],0);self.assertGreater(audit['splits']['test']['pages'],0)
   self.assertEqual(len({s['split'] for s in index if s['songGroupKey']=='song-1'}),1)
   row=index[0];label=(out/'labels'/row['split']/(row['pageId']+'.txt')).read_text().strip().split()
   self.assertEqual(label[0],'1');self.assertAlmostEqual(float(label[1]),0.45)
   out2,audit2=prepare(root,root/'manifest.json');self.assertEqual(out,out2);self.assertEqual(audit['fingerprint'],audit2['fingerprint'])
 def test_reject_song_leakage(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);samples=[self.sample(root,1,'song','train'),self.sample(root,2,'song','val')]
   with self.assertRaisesRegex(ValueError,'Song crosses'):prepare(root,self.manifest(root,samples))
 def test_reject_same_pixels_in_different_splits(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);samples=[self.sample(root,1,'a','train',(0,0,0)),self.sample(root,2,'b','val',(0,0,0))]
   with self.assertRaisesRegex(ValueError,'Identical image crosses'):prepare(root,self.manifest(root,samples))
 def test_reject_conflicting_labels_and_corrupt_download(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);a=self.sample(root,1,'a',color=(0,0,0));b=copy.deepcopy(a);b['image']['id']='2';b['boxes'][0]['x']=11
   with self.assertRaisesRegex(ValueError,'conflicting labels'):prepare(root,self.manifest(root,[a,b]))
   (root/a['workingPath']).write_bytes(b'broken')
   with self.assertRaisesRegex(ValueError,'mismatch'):prepare(root,self.manifest(root,[a]))
 def test_deduplicates_without_losing_aliases(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);a=self.sample(root,1,'a');b=copy.deepcopy(a);b['image']['id']='2'
   out,audit=prepare(root,self.manifest(root,[a,b,self.sample(root,3,'c'),self.sample(root,4,'d')]))
   self.assertEqual(audit['duplicatesRemoved'],1);idx=json.loads((out/'index.json').read_text());self.assertEqual(next(s for s in idx if s['pageId']=='1')['aliases'],['1','2'])
 def test_class_aware_nms_preserves_nested_different_categories(self):
  boxes=np.array([[0,0,10,10],[0,0,10,10],[1,1,9,9]],dtype=float);scores=np.array([0.9,0.8,0.7]);classes=np.array([0,1,0])
  self.assertEqual(nms(boxes,scores,classes,0.45),[0,1])
 def test_letterbox_inverse_and_empty_detections(self):
  class Session:
   def run(self,*args):return [self.output]
  detector=object.__new__(Detector);detector.w=detector.h=640;detector.input='images';detector.categories=[{'id':0,'key':'guitar'}];detector.session=Session()
  detector.session.output=np.array([[[320],[320],[320],[160],[0.9]]],dtype=np.float32)
  image=io.BytesIO();Image.new('RGB',(200,100)).save(image,format='PNG')
  result,_=detector.predict(image.getvalue());self.assertEqual({k:result[0][k] for k in ['x','y','width','height']},{'x':50,'y':25,'width':100,'height':50})
  result,_=detector.predict(image.getvalue(),confidence=0.95);self.assertEqual(result,[])
 def test_durable_reporter_replays_unacknowledged_events_in_order(self):
  class API:
   def __init__(self):self.seen=[];self.fail=True
   def request(self,path,body,**kwargs):
    if self.fail:raise OSError('offline')
    self.seen+=body['events'];return {'last_seq':body['events'][-1]['seq']}
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   api=API();r=Reporter(api,'id',d);r.emit('state',{'status':'running'});r.emit('epoch',{'epoch':1,'metrics':{}})
   r.stop_event.set();r.thread.join();self.assertEqual(len(r.events),2)
   r2=Reporter(api,'id',d);api.fail=False;r2.close();self.assertEqual([e['seq'] for e in api.seen],[1,2])
   r3=Reporter(api,'id',d);r3.close();self.assertEqual(len(api.seen),2)

 def test_transparent_ink_is_compared_and_trained_on_white_not_black(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d)
   a=Image.new('RGBA',(100,60),(0,0,0,0));a.paste((0,0,0,255),(10,10,80,50))
   b=Image.new('RGBA',(100,60),(0,0,0,0));b.paste((0,0,0,255),(20,10,90,50))
   self.assertEqual(a.convert('RGB').tobytes(),b.convert('RGB').tobytes())
   samples=[self.sample(root,1,'a',image=a),self.sample(root,2,'b',image=b),self.sample(root,3,'c')]
   samples[1]['boxes'][0]['x']=20
   manifest=self.manifest(root,samples)
   out,audit=prepare(root,manifest);self.assertEqual(audit['normalizedPages'],2);self.assertEqual(audit['duplicatesRemoved'],0)
   self.assertEqual(audit['imageNormalization'],'rgb-on-white-v1')
   index=json.loads((out/'index.json').read_text())
   row=next(s for s in index if s['pageId']=='1')
   with Image.open(out/row['path']) as trained:
    self.assertEqual(trained.mode,'RGB');self.assertEqual(trained.getpixel((0,0)),(255,255,255));self.assertEqual(trained.getpixel((20,20)),(0,0,0))
    expected=np.asarray(trained,dtype=np.float32).transpose(2,0,1)[None]/255
   with Image.open(root/samples[0]['workingPath']) as original:self.assertEqual(original.mode,'RGBA')
   again,_=prepare(root,manifest);self.assertEqual(out,again)
   class Session:
    def run(self,outputs,feed):
     self.tensor=feed['images'].copy()
     return [np.zeros((1,5,1),dtype=np.float32)]
   detector=object.__new__(Detector);detector.w=100;detector.h=60;detector.input='images';detector.categories=[{'id':0,'key':'guitar'}];detector.session=Session()
   data=io.BytesIO();a.save(data,format='PNG');boxes,_=detector.predict(data.getvalue())
   self.assertEqual(boxes,[]);np.testing.assert_array_equal(detector.session.tensor,expected)
   Image.new('RGB',(100,60),'black').save(out/row['path'])
   with self.assertRaisesRegex(ValueError,'Prepared image was modified'):prepare(root,manifest)

 def test_palette_transparency_and_grayscale_alpha_render_without_warning(self):
  image=Image.new('P',(10,10),0);image.putpalette([0,0,0]*256);image.putpixel((5,5),1)
  image.info['transparency']=bytes([0,255]+[255]*254)
  with warnings.catch_warnings(record=True) as observed:
   warnings.simplefilter('always');rgb=rgb_on_white(image)
  self.assertEqual(observed,[]);self.assertTrue(needs_rgb_normalization(image))
  self.assertEqual(rgb.getpixel((0,0)),(255,255,255));self.assertEqual(rgb.getpixel((5,5)),(0,0,0))
  gray=Image.new('LA',(2,1),(0,0));gray.putpixel((1,0),(0,128))
  self.assertEqual([rgb_on_white(gray).getpixel((x,0)) for x in range(2)],[(255,255,255),(127,127,127)])
  self.assertFalse(needs_rgb_normalization(Image.new('RGB',(1,1))))

 def test_opaque_and_alpha_encoded_copies_deduplicate_by_visible_pixels(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);alpha=Image.new('RGBA',(100,60),(0,0,0,0));alpha.paste((0,0,0,255),(10,10,80,50))
   samples=[self.sample(root,1,'a',image=alpha),self.sample(root,2,'a',image=rgb_on_white(alpha)),self.sample(root,3,'c'),self.sample(root,4,'d')]
   out,audit=prepare(root,self.manifest(root,samples))
   self.assertEqual(audit['duplicatesRemoved'],1);index=json.loads((out/'index.json').read_text())
   self.assertEqual(next(s for s in index if s['pageId']=='1')['aliases'],['1','2'])

 def test_explicit_conflict_exclusion_removes_every_copy_and_preserves_sources(self):
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);a=self.sample(root,1,'a');b=copy.deepcopy(a);b['image']['id']='2';b['boxes'][0]['x']=11
   c=copy.deepcopy(a);c['image']['id']='3'
   samples=[a,b,c,self.sample(root,4,'d'),self.sample(root,5,'e'),self.sample(root,6,'f')]
   manifest=self.manifest(root,samples)
   with self.assertRaisesRegex(ValueError,'conflicting labels'):prepare(root,manifest)
   report=json.loads((root/'conflicts'/('a'*64+'.json')).read_text());self.assertEqual(report['excludedPageIds'],[])
   out,audit=prepare(root,manifest,exclude_conflicts=True)
   self.assertEqual(audit['sourcePages'],6);self.assertEqual(audit['excludedConflictingPages'],3);self.assertEqual(audit['duplicatesRemoved'],0)
   report=json.loads(Path(audit['conflictReport']).read_text());self.assertEqual(report['excludedPageIds'],['1','2','3'])
   self.assertEqual({s['pageId'] for s in json.loads((out/'index.json').read_text())},{'4','5','6'})
   self.assertEqual(hashlib.sha256((root/a['workingPath']).read_bytes()).hexdigest(),a['image']['coordinate']['working']['checksum'])
   self.assertEqual(len(json.loads(manifest.read_text())['samples']),6)

class ExportTests(unittest.TestCase):
 def test_export_uses_frozen_data_and_validates_onnx_before_publication(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  import train
  with tempfile.TemporaryDirectory(dir=TESTROOT) as d:
   root=Path(d);prepared=root/'prepared';prepared.mkdir();(prepared/'holdout.png').write_bytes(b'holdout')
   save_json(prepared/'index.json',[{'split':'val','path':'holdout.png'}]);save_json(prepared/'data.yaml',{})
   (root/'fit/weights').mkdir(parents=True);(root/'fit/weights/best.pt').write_bytes(b'checkpoint')
   (root/'events.jsonl').write_text(json.dumps({'kind':'epoch','payload':{'epoch':2}})+'\n');save_json(root/'environment.json',{})
   exported=root/'fit/weights/best.onnx';calls=[]
   class Model:
    def __init__(self,path):self.path=path
    def val(self,**kwargs):calls.append(kwargs);return SimpleNamespace(results_dict={'metrics/mAP50(B)':0.8})
    def export(self,**kwargs):exported.write_bytes(b'onnx');return str(exported)
   class Report:
    def __init__(self,*a,**k):pass
    def emit(self,*a):pass
    def close(self):pass
   class FakeDetector:
    def __init__(self,path,categories):self.path=path
    def predict(self,data,*a):self_test.assertEqual(data,b'holdout');return [],1
   self_test=self
   meta={'id':'run','origin':'http://test','prepared':str(prepared),'fingerprint':'a'*64,'categories':[{'id':0,'key':'guitar'}],'config':{'imgsz':1280,'batch':4}}
   modules={'torch':SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False)),'ultralytics':SimpleNamespace(YOLO=Model),'onnx':SimpleNamespace(checker=SimpleNamespace(check_model=lambda path:self.assertTrue(Path(path).exists())))}
   with patch.dict(sys.modules,modules),patch.object(train,'Platform',lambda *a:None),patch.object(train,'Reporter',Report),patch('inference.Detector',FakeDetector):
    train.export_artifacts(root,meta,{'splits':{'test':{'pages':1}}})
   self.assertEqual([c['split'] for c in calls],['val','test']);self.assertTrue(all(c['data']==str(prepared/'data.yaml') for c in calls))
   report=json.loads((root/'report.json').read_text());self.assertEqual(report['epochsCompleted'],2);self.assertEqual(report['evaluation']['test']['metrics/mAP50(B)'],0.8)
   self.assertTrue((root/'publication.json').exists())

if __name__=='__main__':unittest.main()
