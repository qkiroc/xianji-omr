import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {rhythmSamples} from '../shared/rhythm-samples.ts';
import {validateGeometry} from '../server/src/localization/geometry.ts';
import {fixture} from './fixture.mjs';
import {localizationSetup} from './localization-helpers.mjs';
import {json,request} from './cli-helpers.mjs';
import {files,migrate,withLock} from '../server/src/migrate.mjs';

const region=(id,systemId,track,bbox,pageId='p')=>({id,systemId,track,bbox,pageId});
test('samples group aligned tracks, keep unparented regions separate and sort in reading order',()=>{
 const groups=rhythmSamples([region('g2','s2','guitar',[0,100,200,150]),region('l1','s1','lyrics',[0,60,200,80]),region('g1','s1','guitar',[0,10,200,50]),region('orphan',null,'melody',[0,160,200,180])]);
 assert.deepEqual(groups.map(g=>g.sample.index),[1,2,3]);assert.equal(groups[0].regions.length,2);
 assert.deepEqual(groups[0].sample.bbox,[0,10,200,80]);assert.equal(groups[2].sample.id,'region:orphan');
 const page={localPageId:'p',width:200,height:200};
 const geometry={schemaVersion:'omr-rhythm-v1',pages:[page],regions:groups[0].regions,sample:groups[0].sample,measures:[]};
 assert.deepEqual(validateGeometry(geometry,[page]).sample,groups[0].sample);
 const changed=structuredClone(geometry);changed.sample.bbox[1]=0;
 assert.throws(()=>validateGeometry(changed,[page],{previous:geometry}),/不可修改/);
 const mixed=structuredClone(geometry);mixed.regions.push(groups[1].regions[0]);mixed.sample.bbox[3]=150;
 assert.throws(()=>validateGeometry(mixed,[page]),/其他谱行/);
});

test('two systems become independent records, cropped content and navigation stay on one row',async t=>{
 const f=await fixture({port:55477});t.after(()=>f.close());const s=await localizationSetup(f);
 const boxes=[{id:'s1',classKey:'system',x:0,y:0,width:200,height:60,parentSystemId:null,readingOrder:1},
   {id:'g1',classKey:'guitar',x:0,y:10,width:200,height:40,parentSystemId:'s1',readingOrder:2},
   {id:'s2',classKey:'system',x:0,y:90,width:200,height:70,parentSystemId:null,readingOrder:3},
   {id:'g2',classKey:'guitar',x:0,y:100,width:200,height:50,parentSystemId:'s2',readingOrder:4}];
 let p=await s.api('/pages/'+s.page.image.id,json({version:s.page.image.version,annotationFormat:'layout-v2',boxes},'PUT'));
 await s.api('/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true}));
 const ds=await s.api('/localization/datasets',json({name:'Rows',task:'rhythm',sourceDatasetId:s.dataset.id}),201);
 assert.equal(ds.imported,2);const path='/localization/datasets/'+ds.id;
 const list=await s.api(path+'/records');assert.equal(list.total,2);assert.deepEqual(list.items.map(r=>r.line_index),['1','2']);
 const first=await s.api('/localization/records/'+list.items[0].id),second=await s.api('/localization/records/'+list.items[1].id);
 assert.equal(first.geometry.regions.length,1);assert.equal(second.geometry.sample.id,'system:s2');assert.deepEqual(second.geometry.sample.bbox,[0,100,200,150]);
 assert.equal((await s.api(path+'/sync',json({}))).imported,0);
 const queue=await s.api(path+'/editor?recordId='+first.id);assert.equal(queue.nextId,second.id);
 const response=await request(f,'/api/v2/localization/records/'+second.id+'/content',{headers:{Authorization:'Bearer '+s.grant.token}});
 assert.equal(response.status,200);const metadata=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(metadata.width,200);assert.equal(metadata.height,50);
 assert.equal(first.group_key,second.group_key);assert.equal(first.split,second.split);
});

test('schema 14 page records split without losing saved annotations, confirmations, snapshots or original backups',async t=>{
 const f=await fixture({port:55478,migrationVersion:14});t.after(()=>f.close());const s=await localizationSetup(f);
 const id=randomUUID(),ds=s.loc.id,p=s.page.image;
 await f.pool.query("UPDATE omr_loc_datasets SET task='rhythm',source_dataset_id=$2 WHERE id=$1",[ds,s.dataset.id]);
 const regions=[region('g1','s1','guitar',[0,10,200,60],p.id),region('g2','s2','guitar',[0,100,200,150],p.id)];
 const geometry={schemaVersion:'omr-rhythm-v1',pages:[{localPageId:p.id,sourcePageId:p.id,sourceSha:p.checksum,pixelSha:null,width:200,height:160,mapping:[[1,0,0],[0,1,0],[0,0,1]]}],regions,
  measures:regions.map((r,i)=>({id:'m'+i,pageId:p.id,regionId:r.id,systemId:r.systemId,track:'guitar',voice:'1',barNumber:1,bbox:r.bbox,staffLines:null,geometryConfirmed:true,completenessConfirmed:true,reviewNote:'',
    events:[{id:'e'+i,voice:'1',centerX:50,bbox:[40,r.bbox[1]+5,60,r.bbox[3]-5],contextBBox:null,status:'accepted',evidence:{},annotationSource:{kind:'manual'},confidence:null,rhythm:{duration:8}}]}))};
 await f.pool.query("INSERT INTO omr_loc_records(id,dataset_id,corpus_id,corpus_revision,source_fingerprint,input_checksum,original,geometry,title,group_key,split,source,version,status,confirmed_at,first_labeled_at) VALUES($1,$2,$3,1,$4,$4,$5,$6,'Saved page','real-score:老男孩','train','layout-confirmed',7,'confirmed',now(),now())",[id,ds,'layout-page:'+p.id,'a'.repeat(64),{pageOrder:1,regions},geometry]);
 await f.pool.query("INSERT INTO omr_loc_record_pages VALUES($1,$2::text,$2::uuid,$3,NULL,$4)",[id,p.id,p.checksum,JSON.stringify(geometry.pages[0].mapping)]);
 const frozen={records:[{id,geometry}]};await f.pool.query("INSERT INTO omr_loc_snapshots(id,dataset_id,frozen,fingerprint) VALUES($1,$2,$3,$4)",[randomUUID(),ds,frozen,'b'.repeat(64)]);
 // A single, transactional migration creates the row records and archives the page.
 await withLock(f.pool,c=>migrate(c));await withLock(f.pool,c=>migrate(c));
 const list=await s.api('/localization/datasets/'+ds+'/records');assert.equal(list.total,2);assert.equal(list.stats.confirmed,2);
 for(const [i,item] of list.items.entries()){
  const r=await s.api('/localization/records/'+item.id);assert.equal(r.geometry.sample.index,i+1);assert.equal(r.version,7);assert.equal(r.status,'confirmed');assert.ok(r.first_labeled_at);
  assert.deepEqual(r.geometry.measures,[geometry.measures[i]]);assert.equal(r.original.previousPageRecordId,id);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM omr_loc_record_pages WHERE record_id=$1',[r.id])).rows[0].n,1);
 }
 const backup=(await f.pool.query('SELECT * FROM omr_loc_records WHERE id=$1',[id])).rows[0];assert.ok(backup.superseded_at);assert.deepEqual(backup.geometry,geometry);
 await s.api('/localization/records/'+id,{},410);
 assert.deepEqual((await f.pool.query('SELECT frozen FROM omr_loc_snapshots WHERE dataset_id=$1',[ds])).rows[0].frozen,frozen);
 const snapshot=await s.api('/localization/datasets/'+ds+'/snapshots',json({}),201);
 const exported=await s.api('/localization/snapshots/'+snapshot.id+'/native');assert.equal(exported.records.length,2);assert.ok(exported.records.every(r=>r.geometry.sample));
 assert.equal((await files()).length,15);
});
