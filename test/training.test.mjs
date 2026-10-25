import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cleanEvent,reduceEvent,runInput,predictionBoxes} from '../server/src/training-domain.ts';
import {categoriesFor} from '../server/src/annotation.ts';
import {files,SCHEMA} from '../server/src/migrate.ts';
import {catalogue,validatePage,downloadAsset,digest,makeAPI} from '../tools/training/sync-confirmed.mjs';
const categories=categoriesFor('layout-v2').map(({id,key})=>({id,key}));
const config={model:'yolo11s.pt',epochs:100,imgsz:1280,batch:4,seed:42};
const asset={checksum:'a'.repeat(64),bytes:20,mime:'image/png',width:200,height:100};
const listed={id:randomUUID(),datasetId:randomUUID(),version:3,split:'train',songGroupKey:'same-song'};
const page=()=>({image:{id:listed.id,datasetId:listed.datasetId,version:3,status:'confirmed',pageType:'music',annotationFormat:'layout-v2',width:200,height:100,coordinate:{original:asset,working:asset}},boxes:[{id:'r',classKey:'guitar',x:1,y:2,width:190,height:90}]});
test('confirmed data gate rejects AI/draft/deleted/changed pages and empty music, accepts explicit negatives',()=>{
 assert.doesNotThrow(()=>validatePage(page(),listed,categories));
 for(const patch of [{status:'ai_reviewed'},{status:'draft'},{deletedAt:'now'},{version:4},{annotationFormat:'legacy'}]) {
  const p=page();Object.assign(p.image,patch);assert.throws(()=>validatePage(p,listed,categories));
 }
 const negative=page();negative.boxes=[];assert.throws(()=>validatePage(negative,listed,categories));negative.image.pageType='negative';assert.doesNotThrow(()=>validatePage(negative,listed,categories));
 const outside=page();outside.boxes[0].width=999;assert.throws(()=>validatePage(outside,listed,categories));
});
test('catalogue downloads all pages and rejects changing pagination',async()=>{
 const dataset=randomUUID(),rows=Array.from({length:101},()=>({id:randomUUID(),status:'confirmed'}));
 const paths=[];const api=async path=>{paths.push(path);if(path==='/api/v2/datasets')return Response.json([{id:dataset,name:'test'}]);const p=Number(new URL('http://test'+path).searchParams.get('page'));return Response.json({items:rows.slice((p-1)*100,p*100),total:101});};
 assert.equal((await catalogue(api,[])).length,101);assert.equal(paths.length,3);assert.ok(paths.slice(1).every(p=>p.includes('status=confirmed')));
 await assert.rejects(catalogue(async path=>path==='/api/v2/datasets'?Response.json([{id:dataset}]):Response.json({items:[],total:2}),[]),/unexpected count/);
});
test('download publishes only a complete SHA-verified file and resumes verified cache',async()=>{
 const testRoot=new URL('../.test-data/training-node/',import.meta.url);await mkdir(testRoot,{recursive:true});const dir=await mkdtemp(new URL('case-',testRoot));const path=join(dir,'image.png'),data=Buffer.from('fixture image bytes');
 const meta={bytes:data.length,checksum:digest(data)};let calls=0;
 const api=async()=>{calls++;return new Response(data,{headers:{'x-checksum-sha256':meta.checksum}});};
 assert.equal(await downloadAsset(api,'/api/v2/pages/x/content',meta,path),true);
 assert.deepEqual(await readFile(path),data);assert.equal(await downloadAsset(api,'/x',meta,path),false);assert.equal(calls,1);
 const broken=join(dir,'broken.png');await assert.rejects(downloadAsset(async()=>new Response(data.subarray(1)),'/x',meta,broken),/mismatch/);
 assert.deepEqual((await readdir(dir)).sort(),['image.png']);
});
test('API client never follows redirects or exposes tokens on access denial',async()=>{
 let observed;const api=makeAPI('http://platform','secret',async(url,options)=>{observed=options;return Response.json([]);});await api('/api/v2/datasets');
 assert.equal(observed.method,'GET');assert.equal(observed.redirect,'error');assert.equal(observed.headers.Authorization,'Bearer secret');
 await assert.rejects(api('https://elsewhere'),/Invalid API/);
 const denied=makeAPI('http://platform','secret',async()=>{throw Object.assign(Error('secret'),{cause:{code:'EACCES'}});});
 await assert.rejects(denied('/api/v2/datasets'),error=>error.message==='NETWORK: EACCES');
});
test('run contract pins taxonomy and detector config',()=>{
 const v={id:randomUUID(),name:'first',fingerprint:'a'.repeat(64),categories,config,datasetSummary:{}};
 assert.deepEqual(runInput(v).categories,categories);
 assert.throws(()=>runInput({...v,categories:[...categories].reverse()}));
 assert.throws(()=>runInput({...v,config:{...config,epochs:0}}));
});
test('ordered metrics state machine rejects gaps, terminal mutation, NaN, unknown metrics and epoch regression',()=>{
 let run={status:'created',last_seq:0,last_epoch:0,metrics:{},config};
 const state=cleanEvent({seq:1,kind:'state',payload:{status:'running'}});run=reduceEvent(run,state);
 const epoch=cleanEvent({seq:2,kind:'epoch',payload:{epoch:1,metrics:{'metrics/mAP50(B)':0.8,'train/box_loss':2}}});run=reduceEvent(run,epoch);
 assert.equal(run.last_epoch,1);assert.equal(run.metrics['metrics/mAP50(B)'],0.8);
 assert.throws(()=>reduceEvent(run,{...epoch,seq:4}));assert.throws(()=>reduceEvent(run,{...epoch,seq:3}));
 for(const metrics of [{'wrong':1},{'train/box_loss':NaN},{'metrics/mAP50(B)':1.1}])assert.throws(()=>cleanEvent({seq:3,kind:'epoch',payload:{epoch:2,metrics}}));
 run=reduceEvent(run,cleanEvent({seq:3,kind:'state',payload:{status:'exporting'}}));assert.equal(run.status,'exporting');
 assert.throws(()=>reduceEvent({...run,status:'completed'},cleanEvent({seq:4,kind:'heartbeat',payload:{}})));
 assert.throws(()=>cleanEvent({seq:4,kind:'state',payload:{status:'completed'}}));
});
test('prediction result contract checks class, scores and original image bounds',()=>{
 const boxes=[{classId:1,score:0.9,x:10,y:20,width:50,height:30}];
 assert.equal(predictionBoxes(boxes,200,100,categories)[0].classKey,'guitar');
 for(const patch of [{classId:999},{score:NaN},{x:-1},{width:300},{y:1.2}])assert.throws(()=>predictionBoxes([{...boxes[0],...patch}],200,100,categories));
 assert.deepEqual(predictionBoxes([],200,100,categories),[]);
});
test('schema10 migration is expand-only and retains old migration history',async()=>{
 const migrations=await files();assert.equal(SCHEMA,10);assert.equal(migrations.length,10);
 assert.match(migrations.at(-1).sql,/CREATE TABLE omr_predictions/);assert.match(migrations.at(-1).sql,/PRIMARY KEY\(run_id,seq\)/);
});
