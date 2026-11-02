import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {PassThrough} from 'node:stream';
import {inflateRawSync} from 'node:zlib';
import {registerLocalization} from '../server/src/localization/api.ts';
import {sha256} from '../server/src/localization/crop-assets.ts';

test('save and confirm handlers replace complete JSON, preserve timing and reject stale or invalid edits atomically',async()=>{
  const id='00000000-0000-4000-8000-000000000001',datasetId='00000000-0000-4000-8000-000000000002';
  const bytes=await sharp({create:{width:200,height:40,channels:3,background:'#fff'}}).png().toBuffer(),checksum=sha256(bytes);
  const page={localPageId:id,sourcePageId:id,sourceSha:checksum,pixelSha:null,width:200,height:40,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
  const measure={id:'m',pageId:id,regionId:'r',systemId:null,track:'guitar',voice:'1',barNumber:1,bbox:[0,0,200,40],staffLines:null,geometryConfirmed:false,completenessConfirmed:false,reviewNote:'',
    events:[{id:'e',voice:'1',centerX:30,bbox:[10,0,50,40],contextBBox:null,status:'accepted',evidence:{},annotationSource:{},confidence:null,rhythm:{duration:8}}]};
  let remote={id,dataset_id:datasetId,version:1,status:'confirmed',confirmed_at:new Date().toISOString(),crop_image:{checksum,width:200,height:40},group_key:'song',split:'train',original:{},geometry:{schemaVersion:'omr-rhythm-v1',pages:[page],regions:[{id:'r',pageId:id,systemId:null,track:'guitar',bbox:[0,0,200,40]}],measures:[measure]}};
  const rows=data=>({rows:data,rowCount:data.length}),queries=[];
  const c={release(){},async query(sql,args=[]){
    queries.push(sql);
    if(sql.startsWith('SELECT to_regclass'))return rows([{t:null}]);
    if(sql.startsWith('SELECT * FROM omr_loc_records'))return rows([structuredClone(remote)]);
    if(sql.startsWith('SELECT * FROM omr_loc_snapshots'))return rows([{id,fingerprint:'frozen',frozen:{truth:'geometry-and-rhythm',records:[structuredClone(remote)]}}]);
    if(sql.startsWith('SELECT * FROM omr_loc_crop_assets'))return rows([{...remote.crop_image,object_key:'crop'}]);
    if(sql.startsWith('SELECT object_key FROM omr_loc_crop_assets'))return rows([{object_key:'crop'}]);
    if(sql.startsWith('SELECT id FROM omr_loc_records')||sql.startsWith('SELECT r.id FROM omr_loc_records'))return rows([]);
    if(sql.startsWith('UPDATE omr_loc_records SET geometry=')){
      remote={...remote,geometry:args[0],status:args[1],confirmed_at:args[2],version:remote.version+1};return rows([structuredClone(remote)]);
    }
    if(sql.startsWith('SELECT pg_advisory')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('omr_deletion'))return rows([]);
    throw Error('Unexpected database dependency: '+sql);
  }};
  const pool={async connect(){return c;},query:(...args)=>c.query(...args)},handlers=new Map();
  const router=Object.fromEntries(['get','post','put'].map(method=>[method,(path,handler)=>handlers.set(method+' '+path,handler)]));
  registerLocalization(router,{pool,config:{oss:{prefix:'omr/'}},storage:{async get(key){assert.equal(key,'crop');return bytes;},async put(){throw Error('Unexpected upload');},async delete(){throw Error('Unexpected deletion');}}});
  const call=async(method,path,body)=>{let result;await handlers.get(method+' '+path)({params:{recordId:id},body},{json(value){result=value;return this;}});return result;};
  const g=structuredClone(remote.geometry);g.measures[0].events=[];
  let r=await call('put','/localization/records/:recordId',{version:1,geometry:g});assert.equal(r.geometry.measures[0].events.length,0);assert.equal(r.status,'draft');assert.equal(r.version,2);
  const empty=structuredClone(g);empty.measures=[];
  r=await call('put','/localization/records/:recordId',{version:2,geometry:empty});assert.equal(r.geometry.measures.length,0);assert.equal(r.version,3);
  const restore=structuredClone(g);restore.measures=[structuredClone(measure)];restore.measures[0].events[0].rhythm={duration:8,dots:1,tuplet:{actual:3,normal:2,groupId:'t'},tie:'start'};
  const before=queries.filter(q=>q.startsWith('UPDATE omr_loc_records')).length;
  r=await call('post','/localization/records/:recordId/confirm',{version:3,geometry:restore,acknowledged:true});
  assert.equal(r.version,4);assert.equal(r.status,'confirmed');assert.deepEqual(r.geometry.measures[0].events[0].rhythm,restore.measures[0].events[0].rhythm);
  assert.equal(queries.filter(q=>q.startsWith('UPDATE omr_loc_records')).length,before+1);
  await assert.rejects(call('put','/localization/records/:recordId',{version:3,geometry:empty}),e=>e.status===409);
  const bad=structuredClone(restore);bad.measures[0].events[0].bbox[1]=1;
  await assert.rejects(call('post','/localization/records/:recordId/confirm',{version:4,geometry:bad,acknowledged:true}),e=>e.status===400);
  assert.equal(remote.version,4);assert.deepEqual(remote.geometry,r.geometry);

  // Exercise the actual ZIP exporter without opening an HTTP or database port.
  const chunks=[],response=new PassThrough();response.on('data',chunk=>chunks.push(chunk));
  response.type=()=>response;response.set=()=>response;
  await handlers.get('get /localization/snapshots/:snapshotId/:kind')({params:{snapshotId:id,kind:'crops'}},response);
  const zip=Buffer.concat(chunks),end=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));let offset=zip.readUInt32LE(end+16),manifest;
  for(let i=0;i<zip.readUInt16LE(end+10);i++){
    const method=zip.readUInt16LE(offset+10),size=zip.readUInt32LE(offset+20),nameLength=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32),local=zip.readUInt32LE(offset+42),name=zip.subarray(offset+46,offset+46+nameLength).toString();
    if(name==='manifest.json'){const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+size);manifest=JSON.parse(method===8?inflateRawSync(data):data);}
    offset+=46+nameLength+extra+comment;
  }
  assert.equal(manifest.schemaVersion,'omr-rhythm-crops-v2');const event=manifest.crops.find(c=>c.kind==='event');
  assert.deepEqual(event.rhythm,restore.measures[0].events[0].rhythm);assert.deepEqual(event.beats,{numerator:1,denominator:2});
  assert.equal(event.sourcePageId,undefined);assert.equal(event.cropChecksum,checksum);assert.ok(event.localToCrop);
});
