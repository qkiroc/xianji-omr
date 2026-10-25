import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {categoriesFor} from '../server/src/annotation.ts';
// Exercise production route handlers while replacing only unavailable transport/storage dependencies.
const sourceURL=new URL('../server/src/training.ts',import.meta.url);
let source=await readFile(sourceURL,'utf8');
source=source.replace("import express from 'express';","const express={raw:()=> (_req,_res,next)=>next()};")
 .replace("import sharp from 'sharp';","const sharp=()=>{throw Error('Image normalization is covered in deployment integration');};")
 .replace("import {transaction} from './datasets.ts';","const transaction=(pool,fn)=>pool.transaction(fn);")
 .replace(/from '(\.\/[^']+)'/g,(_,path)=>"from '"+new URL(path,sourceURL).href+"'");
const {registerTraining}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const sha=data=>createHash('sha256').update(data).digest('hex');
class MemoryPool {
 runs=new Map();events=new Map();artifacts=new Map();
 async transaction(fn){const snapshot=structuredClone({runs:this.runs,events:this.events,artifacts:this.artifacts});try{return await fn(this);}catch(e){Object.assign(this,snapshot);throw e;}}
 async query(sql,p=[]){let rows=[];
  if(sql.startsWith('INSERT INTO omr_training_runs')){if(!this.runs.has(p[0]))this.runs.set(p[0],{id:p[0],name:p[1],owner_grant:p[2],fingerprint:p[3],categories:JSON.parse(p[4]),config:JSON.parse(p[5]),dataset_summary:JSON.parse(p[6]),status:'created',last_seq:0,last_epoch:0,metrics:{}});}
  else if(sql.startsWith('SELECT * FROM omr_training_runs')){const r=this.runs.get(p[0]);if(r)rows=[structuredClone(r)];}
  else if(sql.startsWith('SELECT kind,payload FROM omr_training_events')){const e=this.events.get(p[0]+':'+p[1]);if(e)rows=[structuredClone(e)];}
  else if(sql.startsWith('INSERT INTO omr_training_events')){this.events.set(p[0]+':'+p[1],{kind:p[2],payload:JSON.parse(p[3])});}
  else if(sql.startsWith('UPDATE omr_training_runs')){const r=this.runs.get(p[0]);if(sql.includes("SET status='completed'"))r.status='completed';else Object.assign(r,{status:p[1],last_seq:p[2],last_epoch:p[3],metrics:JSON.parse(p[4]),error:p[5]});}
  else if(sql.startsWith('SELECT')&&sql.includes('FROM omr_training_artifacts')){rows=[...this.artifacts.values()].filter(a=>a.run_id===p[0]&&(!p[1]||a.kind===p[1])).map(a=>structuredClone(a));}
  else if(sql.startsWith('INSERT INTO omr_training_artifacts')){const key=p[0]+':'+p[1];if(this.artifacts.has(key))throw Error('unique constraint');this.artifacts.set(key,{run_id:p[0],kind:p[1],object_key:p[2],checksum:p[3],bytes:p[4],mime:p[5]});}
  else throw Error('Unexpected SQL in route test: '+sql);
  return {rows,rowCount:rows.length};
 }
}
function setup(){
 const routes=new Map(),pool=new MemoryPool(),objects=new Map(),owner=randomUUID();
 const router={get:(p,...h)=>routes.set('get '+p,h),post:(p,...h)=>routes.set('post '+p,h)};
 const storage={async putStream(key,stream){const chunks=[];for await(const b of stream)chunks.push(b);objects.set(key,Buffer.concat(chunks));},async delete(key){objects.delete(key);}};
 registerTraining(router,{pool,storage,config:{oss:{prefix:'omr/'}}});
 const invoke=async(method,path,{params={},body={},identity={kind:'bearer',id:owner},headers={},bytes}={})=>{
  const req=bytes?Readable.from([bytes]):{};Object.assign(req,{params,body,identity,headers});
  const res={code:200,value:undefined,status(c){this.code=c;return this;},json(v){this.value=v;return this;}};
  const handlers=routes.get(method+' '+path);assert.ok(handlers);for(const handler of handlers)await handler(req,res,e=>{if(e)throw e;});return res;
 };
 const id=randomUUID(),input={id,name:'baseline',fingerprint:'a'.repeat(64),categories:categoriesFor('layout-v2').map(({id,key})=>({id,key})),config:{model:'yolo11s.pt',epochs:3,imgsz:1280,batch:4},datasetSummary:{}};
 return {invoke,pool,objects,owner,id,input};
}
const start={seq:1,kind:'state',payload:{status:'running'}};
const epoch={seq:2,kind:'epoch',payload:{epoch:1,metrics:{'metrics/mAP50(B)':0.75}}};
test('training API creates idempotent runs, accepts ordered events and safely replays duplicates',async()=>{
 const f=setup();const a=await f.invoke('post','/training/runs',{body:f.input});assert.equal(a.code,201);
 await f.invoke('post','/training/runs',{body:f.input});assert.equal(f.pool.runs.size,1);
 for(let i=0;i<2;i++)await f.invoke('post','/training/runs/:id/events',{params:{id:f.id},body:{events:[start,epoch]}});
 assert.equal(f.pool.events.size,2);assert.equal(f.pool.runs.get(f.id).last_seq,2);
 await assert.rejects(f.invoke('post','/training/runs/:id/events',{params:{id:f.id},body:{events:[{...epoch,payload:{epoch:1,metrics:{'metrics/mAP50(B)':0.8}}}]}}),e=>e.status===409);
});
test('event batch failure rolls back all events, other CLI grants cannot mutate a run',async()=>{
 const f=setup();await f.invoke('post','/training/runs',{body:f.input});
 await assert.rejects(f.invoke('post','/training/runs/:id/events',{params:{id:f.id},body:{events:[start,{seq:3,kind:'heartbeat',payload:{}}]}}),e=>e.status===409);
 assert.equal(f.pool.events.size,0);assert.equal(f.pool.runs.get(f.id).status,'created');
 await assert.rejects(f.invoke('post','/training/runs/:id/events',{identity:{kind:'bearer',id:randomUUID()},params:{id:f.id},body:{events:[start]}}),e=>e.status===403);
});
test('model publication requires trained epochs and verified ONNX/weights/report, corrupt upload is not published',async()=>{
 const f=setup();await f.invoke('post','/training/runs',{body:f.input});
 await f.invoke('post','/training/runs/:id/events',{params:{id:f.id},body:{events:[start,epoch,{seq:3,kind:'state',payload:{status:'exporting'}}]}});
 await assert.rejects(f.invoke('post','/training/runs/:id/complete',{params:{id:f.id}}),e=>e.status===409);
 const bad=Buffer.from('corrupt');await assert.rejects(f.invoke('post','/training/runs/:id/artifacts/:kind',{params:{id:f.id,kind:'onnx'},headers:{'content-length':String(bad.length),'x-checksum-sha256':'c'.repeat(64)},bytes:bad}),e=>e.status===400);
 assert.equal(f.objects.size,0);assert.equal(f.pool.artifacts.size,0);
 for(const kind of ['onnx','weights','report']){
  const bytes=Buffer.from(kind==='report'?JSON.stringify({fingerprint:f.input.fingerprint}):'fixture '+kind);
  const options={params:{id:f.id,kind},headers:{'content-length':String(bytes.length),'x-checksum-sha256':sha(bytes)},bytes};
  await f.invoke('post','/training/runs/:id/artifacts/:kind',options);await f.invoke('post','/training/runs/:id/artifacts/:kind',options);
 }
 assert.equal(f.pool.artifacts.size,3);assert.equal(f.objects.size,3);
 await f.invoke('post','/training/runs/:id/complete',{params:{id:f.id}});assert.equal(f.pool.runs.get(f.id).status,'completed');
 await f.invoke('post','/training/runs/:id/complete',{params:{id:f.id}});
});
