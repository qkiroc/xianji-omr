import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {detachRhythmRecord,finishCropWrites,sha256} from '../server/src/localization/crop-assets.ts';

test('materializing an old sample copies pixels, rebases coordinates, removes page attachments and preserves labels',async()=>{
  const bytes=await sharp({create:{width:200,height:160,channels:3,background:'#c8d8ea'}}).png().toBuffer();
  const page={localPageId:'original',sourcePageId:'original',sourceSha:sha256(bytes),pixelSha:null,width:200,height:160,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
  const r={id:'record',corpus_id:'layout-system:original:system:one',version:4,status:'confirmed',original:{pageId:'original'},
    geometry:{schemaVersion:'omr-rhythm-v1',pages:[page],sample:{unit:'system',id:'system:one',pageId:'original',index:1,bbox:[10,50,190,130]},
      regions:[{id:'row',pageId:'original',systemId:'one',track:'guitar',bbox:[10,60,190,90]}],
      measures:[{id:'m',pageId:'original',regionId:'row',systemId:'one',track:'guitar',voice:'1',barNumber:1,bbox:[20,60,180,90],staffLines:null,geometryConfirmed:true,completenessConfirmed:true,reviewNote:'',
        events:[{id:'e',voice:'1',centerX:48,bbox:[40,65,60,80],contextBBox:[20,60,180,90],status:'accepted',evidence:{},annotationSource:{kind:'manual'},confidence:null,rhythm:{duration:8}}]}]}};
  const objects=new Map([['original-key',bytes]]),queries=[];let asset,detached=false;
  const storage={async get(key){assert.ok(objects.has(key));return objects.get(key);},async put(key,data){objects.set(key,data);},async delete(key){objects.delete(key);}};
  const c={async query(sql,args){
    queries.push(sql);
    if(sql.startsWith('SELECT object_key,checksum'))return {rows:[{object_key:'original-key',checksum:sha256(bytes)}]};
    if(sql.startsWith('INSERT INTO omr_loc_crop_assets')){asset={key:args[1],checksum:args[2]};return {rows:[]};}
    if(sql.startsWith('DELETE FROM omr_loc_record_pages')){detached=true;return {rows:[]};}
    if(sql.startsWith('UPDATE omr_loc_records'))return {rows:[{...r,geometry:args[1],crop_image:args[2],original:{},source:'crop-image',source_fingerprint:args[3],corpus_id:args[4],version:5}]};
    throw Error('Unexpected query: '+sql);
  }};
  const result=await detachRhythmRecord(c,r,storage,'omr/');await finishCropWrites(c,true);
  assert.ok(detached);assert.deepEqual(result.original,{});assert.equal(result.geometry.sample,undefined);assert.equal(result.status,'confirmed');
  assert.deepEqual(result.geometry.regions[0].bbox,[0,10,180,40]);
  assert.deepEqual(result.geometry.measures[0].bbox,[10,10,170,40]);
  const event=result.geometry.measures[0].events[0];assert.deepEqual(event.bbox,[30,10,50,40]);assert.equal(event.centerX,40);assert.equal(event.contextBBox,null);assert.deepEqual(event.rhythm,{duration:8});
  assert.notEqual(result.geometry.pages[0].sourcePageId,'original');assert.equal(result.geometry.pages[0].width,180);assert.equal(result.geometry.pages[0].height,80);
  assert.deepEqual(result.geometry.pages[0].mapping,[[1,0,0],[0,1,0],[0,0,1]]);
  assert.equal(result.crop_image.checksum,sha256(objects.get(asset.key)));
  const expected=await sharp(bytes).extract({left:10,top:50,width:180,height:80}).png().toBuffer();assert.deepEqual(objects.get(asset.key),expected);
  objects.delete('original-key');const count=queries.length;
  assert.equal(await detachRhythmRecord(c,result,storage,'omr/'),result);assert.equal(queries.length,count);
  assert.ok(objects.has(asset.key));assert.equal(r.geometry.pages[0].sourcePageId,'original');
});

test('a failed materialization removes newly written objects on transaction rollback',async()=>{
  const bytes=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer(),objects=new Map([['source',bytes]]);
  const storage={async get(key){return objects.get(key);},async put(key,data){objects.set(key,data);throw Error('UPLOAD_FAILED');},async delete(key){objects.delete(key);}};
  const c={async query(){return {rows:[{object_key:'source',checksum:sha256(bytes)}]};}};
  const r={id:'r',geometry:{schemaVersion:'omr-rhythm-v1',pages:[{sourcePageId:'s',sourceSha:sha256(bytes),width:20,height:20}]}};
  await assert.rejects(detachRhythmRecord(c,r,storage,'omr/'),/UPLOAD_FAILED/);
  await finishCropWrites(c,false);assert.deepEqual([...objects.keys()],['source']);
});
