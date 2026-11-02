import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fixture} from './fixture.mjs';
import {localizationSetup} from './localization-helpers.mjs';
import {json,request} from './cli-helpers.mjs';

test('model crops are independent assets; save replaces JSON and confirm atomically saves edits',async t=>{
  const f=await fixture({port:55479});t.after(()=>f.close());const s=await localizationSetup(f);
  const ds=await s.api('/localization/datasets',json({name:'Model output',task:'rhythm'}),201);
  assert.equal(ds.source_dataset_id,null);
  const bytes=await sharp({create:{width:200,height:40,channels:3,background:'#ffffff'}}).png().toBuffer();
  const input={title:'One row',track:'guitar',split:'train',groupKey:'song:model-output',importKey:'model-run:1:row:1',imageBase64:bytes.toString('base64')};
  let r=await s.api('/localization/datasets/'+ds.id+'/crops',json(input),201);
  assert.equal((await s.api('/localization/datasets/'+ds.id+'/crops',json(input),201)).id,r.id);
  await s.api('/localization/datasets/'+ds.id+'/crops',json({...input,track:'lyrics'}),409);
  assert.deepEqual(r.original,{});assert.equal(r.geometry.sample,undefined);
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM omr_loc_record_pages WHERE record_id=$1',[r.id])).rows[0].n,0);
  const path='/localization/records/'+r.id,g=structuredClone(r.geometry),region=g.regions[0];
  g.measures=[{id:'m',pageId:region.pageId,regionId:region.id,systemId:null,barNumber:1,track:'guitar',voice:'1',bbox:[5,0,195,40],staffLines:null,
    geometryConfirmed:false,completenessConfirmed:false,reviewNote:'',events:[{id:'e',voice:'1',centerX:99,bbox:[20,0,60,40],contextBBox:null,status:'accepted',evidence:{},annotationSource:{kind:'manual'},confidence:null,rhythm:{duration:8}}]}];
  const bad=structuredClone(g);bad.measures[0].events[0].bbox[1]=3;
  await s.api(path+'/confirm',json({version:r.version,geometry:bad,acknowledged:true}),400);
  assert.equal((await s.api(path)).version,r.version);
  r=await s.api(path+'/confirm',json({version:r.version,geometry:g,acknowledged:true}));
  assert.equal(r.version,2);assert.equal(r.status,'confirmed');assert.equal(r.geometry.measures[0].events[0].centerX,40);
  const deleted=structuredClone(r.geometry);deleted.measures[0].events=[];
  r=await s.api(path,json({version:r.version,geometry:deleted},'PUT'));
  assert.equal(r.geometry.measures[0].events.length,0);assert.equal(r.status,'draft');
  r=await s.api(path+'/confirm',json({version:r.version,geometry:g,acknowledged:true}));
  await s.api(path,json({version:r.version-1,geometry:deleted},'PUT'),409);

  // Removing the entire source layout dataset must leave this model output usable.
  const deletion=await s.api('/deletions/preview',json({kind:'dataset',ids:[s.dataset.id]}));
  await s.api('/deletions/execute',json({token:deletion.token,acknowledged:true}));
  assert.equal((await s.api(path)).status,'confirmed');
  const response=await request(f,'/api/v2'+path+'/content',{headers:{Authorization:'Bearer '+s.grant.token}});
  assert.equal(response.status,200);assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).height,40);
  const snapshot=await s.api('/localization/datasets/'+ds.id+'/snapshots',json({}),201);
  const frozen=await s.api('/localization/snapshots/'+snapshot.id+'/native');assert.ok(frozen.records[0].crop_image);
  assert.deepEqual(frozen.records[0].original,{});
  const crops=await request(f,'/api/v2/localization/snapshots/'+snapshot.id+'/crops',{headers:{Authorization:'Bearer '+s.grant.token}});
  assert.equal(crops.status,200);await crops.arrayBuffer();

  const ownDeletion=await s.api('/deletions/preview',json({kind:'locDataset',ids:[ds.id]}));
  assert.equal(ownDeletion.summary.objects,1);
  await s.api('/deletions/execute',json({token:ownDeletion.token,acknowledged:true}));
  assert.equal((await f.pool.query('SELECT count(*)::int n FROM omr_loc_crop_assets')).rows[0].n,0);
  assert.equal(f.objects.size,0);
});
