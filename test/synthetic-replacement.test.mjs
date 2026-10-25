import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {uploadEdition} from '../tools/synthetic/revise-audition.mjs';
import {LAYOUT_REVISION} from '../tools/synthetic/page-style.mjs';
import {ACCOMPANIMENT_REVISION} from '../tools/synthetic/accompaniment.mjs';
async function fixture(t){
 const testRoot=join(process.cwd(),'.test-data');await mkdir(testRoot,{recursive:true});const root=await mkdtemp(join(testRoot,'omr-layout-replacement-'));assert.ok(root.startsWith(testRoot));t.after(()=>rm(root,{recursive:true,force:true}));
 const sourceDirectory=join(root,'source'),directory=join(root,'new','synth195-01'),backupDirectory=join(root,'backups');await mkdir(sourceDirectory,{recursive:true});await mkdir(directory,{recursive:true});
 const bytes=Buffer.from('test-png-fixture'),checksum=createHash('sha256').update(bytes).digest('hex'),oldChecksum='old-image-checksum';
 const plan={datasetId:'dataset-1',revision:'original-v1'},job={id:'song-1',title:'测试歌曲',songGroupKey:'group-1',split:'val'},profile={id:'synth195-01',name:'test-profile'};
 const annotation={annotationFormat:'layout-v2',pageType:'music',boxes:[{id:'system-1',classKey:'system',parentSystemId:null,readingOrder:0,x:10,y:20,width:800,height:200,reviewStatus:'draft'}]};
 const page={filename:'synth195-01-p01.png',pageIndex:0,width:1000,height:1400,sha256:checksum,annotation};await writeFile(join(directory,page.filename),bytes);await writeFile(join(directory,'annotations.json'),JSON.stringify([page]));
 const original={sourceId:job.id,profiles:[{id:profile.id,songId:'edition-1',status:'complete',pages:[{pageIndex:0,pageId:'old-1',sha256:oldChecksum,version:4,status:'confirmed',boxCount:1}]}]};await writeFile(join(sourceDirectory,'state.json'),JSON.stringify(original));
 const values=new Map([['old-1',{image:{id:'old-1',datasetId:plan.datasetId,checksum:oldChecksum,width:1000,height:1400,version:4,status:'confirmed',annotationFormat:'layout-v2',pageType:'music',source:'synthetic:original-v1:song-1:synth195-01'},boxes:annotation.boxes.map(b=>({...b,reviewStatus:'confirmed'}))}]]);
 const song={id:'edition-1',name:'old edition',version:1,song_group_key:job.songGroupKey,split:job.split};
 const events=[],behavior={failSave:false,failAfterDeletion:false,unrelatedSnapshot:false,wrongGroup:false,renameDuringReorder:false,failRename:false};let sequence=0,deletionIds=[];
 const api=async(path,value,method)=>{
  events.push({path,value,method});
  if(path==='/api/v2/datasets/dataset-1/songs')return[{...song,song_group_key:behavior.wrongGroup?'other-group':job.songGroupKey}];
  if(path==='/api/v2/songs/edition-1'){assert.equal(method,'PUT');assert.equal(value.version,song.version);if(behavior.failRename){behavior.failRename=false;const error=Error('metadata version conflict');error.status=409;throw error;}Object.assign(song,{name:value.name,song_group_key:value.songGroupKey,split:value.split,version:song.version+1});return structuredClone(song);}
  if(path==='/api/v2/songs/edition-1/pages')return[...values.values()].map(v=>({...v.image,name:v.image.name||(v.image.id==='old-1'?'old.png':page.filename)}));
  if(path==='/api/v2/deletions/preview'){if(behavior.editAfterPreview)values.get('old-1').image.version++;deletionIds=value.ids;return{token:'preview-token',summary:{pages:value.ids.length,snapshots:behavior.unrelatedSnapshot?1:0}};}
  if(path==='/api/v2/deletions/execute'){for(const id of deletionIds)values.delete(id);song.version++;if(behavior.failAfterDeletion){behavior.failAfterDeletion=false;throw Error('network interruption after delete');}return{deleted:true};}
  if(path==='/api/v2/songs/edition-1/pages/reorder'){if(behavior.failReorder){behavior.failReorder=false;throw Error('reorder interrupted');}if(behavior.renameDuringReorder){song.name='Manually renamed';song.version++;}return value.items.map((p,i)=>({...values.get(p.id).image,pageOrder:i+1}));}
  const match=path.match(/^\/api\/v2\/pages\/([^/]+)(\/confirm)?$/);assert.ok(match,'unexpected mock route '+path);const current=values.get(match[1]);if(!current){const e=Error('not found');e.status=404;throw e;}
  if(match[2]){current.image.status='confirmed';current.image.version++;current.boxes=current.boxes.map(b=>({...b,reviewStatus:'confirmed'}));}
  else if(method==='PUT'){if(behavior.failSave){behavior.failSave=false;throw Error('interrupted annotation save');}current.boxes=structuredClone(value.boxes);current.image.source=value.source;current.image.version++;}
  return structuredClone(current);
 };
 const request=async(path,options)=>{assert.equal(path,'/api/v2/songs/edition-1/pages');assert.equal(options.method,'POST');const id='new-'+(++sequence);const v={image:{id,datasetId:plan.datasetId,checksum,width:1000,height:1400,version:1,status:'draft',annotationFormat:'layout-v2',pageType:'music'},boxes:[]};values.set(id,v);if(behavior.failAfterUpload){behavior.failAfterUpload=false;throw Object.assign(Error('lost upload response'),{code:'NETWORK'});}return new Response(JSON.stringify(v));};
 const run=(overrides={})=>uploadEdition({plan,job,profile,directory,result:{layoutRevision:LAYOUT_REVISION},sourceDirectory,backupDirectory,api,request,...overrides});
 return{root,directory,run,values,events,behavior,sourceDirectory,job,get uploads(){return sequence;}};
}
test('replacement confirms new images before deleting old pages and preserves split/group',async t=>{
 const f=await fixture(t),s=await f.run();assert.equal(s.phase,'complete');assert.equal(f.uploads,1);assert.ok(!f.values.has('old-1'));assert.equal(f.values.get('new-1').image.status,'confirmed');
 const confirm=f.events.findIndex(e=>e.path.endsWith('/confirm')),cleanup=f.events.findIndex(e=>e.path.endsWith('/deletions/execute'));assert.ok(confirm<cleanup);
 const checkpoint=JSON.parse(await readFile(join(f.sourceDirectory,'state.json'),'utf8'));assert.equal(checkpoint.profiles[0].layoutRevision,LAYOUT_REVISION);assert.equal(checkpoint.profiles[0].pages[0].pageId,'new-1');
 await f.run();assert.equal(f.uploads,1);
});
test('an interrupted annotation save resumes the uploaded image without duplicating it',async t=>{
 const f=await fixture(t);f.behavior.failSave=true;await assert.rejects(f.run(),/interrupted annotation save/);assert.ok(f.values.has('old-1'));assert.equal(f.uploads,1);await f.run();assert.equal(f.uploads,1);
});
test('cleanup refuses modified original pages and preserves them',async t=>{
 const f=await fixture(t);f.values.get('old-1').image.version++;const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/was changed/);assert.equal(state.conflict.details.pageId,'old-1');assert.ok(f.values.has('old-1'));assert.ok(!f.events.some(e=>e.path.endsWith('/deletions/execute')));assert.equal(f.uploads,0);
});
test('cleanup refuses to remove existing snapshots',async t=>{
 const f=await fixture(t);f.behavior.unrelatedSnapshot=true;const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/unrelated data/);assert.ok(f.values.has('old-1'));
});
test('interruption after successful cleanup resumes through the persisted cleanup intent',async t=>{
 const f=await fixture(t);f.behavior.failAfterDeletion=true;await assert.rejects(f.run(),/network interruption/);assert.ok(!f.values.has('old-1'));await f.run();assert.equal(f.uploads,1);
});
test('moved song group aborts before uploading or removing anything',async t=>{
 const f=await fixture(t);f.behavior.wrongGroup=true;const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/group or split changed/);assert.equal(f.uploads,0);assert.ok(f.values.has('old-1'));
});


test('new accompaniment revision replaces old images and records its own checkpoint',async t=>{
 const f=await fixture(t),options={revision:ACCOMPANIMENT_REVISION,result:{layoutRevision:ACCOMPANIMENT_REVISION,rendererSha256:'renderer-v3'}};
 await f.run(options);assert.ok(f.values.get('new-1').image.source.endsWith(ACCOMPANIMENT_REVISION));
 const checkpoint=JSON.parse(await readFile(join(f.sourceDirectory,'state.json'),'utf8'));assert.equal(checkpoint.profiles[0].layoutRevision,ACCOMPANIMENT_REVISION);
});
test('changing the renderer during an interrupted edition preserves the upload checkpoint',async t=>{
 const f=await fixture(t);f.behavior.failSave=true;
 await assert.rejects(f.run({revision:ACCOMPANIMENT_REVISION,result:{layoutRevision:ACCOMPANIMENT_REVISION,rendererSha256:'first'}}),/interrupted annotation save/);
 await assert.rejects(f.run({revision:ACCOMPANIMENT_REVISION,result:{layoutRevision:ACCOMPANIMENT_REVISION,rendererSha256:'changed'}}),/revision changed/);
 assert.ok(f.values.has('old-1'));assert.equal(f.uploads,1);
});

test('a repaired edition is renamed after its images are safely replaced',async t=>{
 const f=await fixture(t);await f.run({revision:ACCOMPANIMENT_REVISION,result:{layoutRevision:ACCOMPANIMENT_REVISION,rendererSha256:'v3'},renameSong:true});
 const renamed=f.events.findIndex(e=>e.path==='/api/v2/songs/edition-1'),deleted=f.events.findIndex(e=>e.path.endsWith('/deletions/execute'));assert.ok(renamed>deleted);assert.equal(f.events[renamed].value.split,'val');assert.equal(f.events[renamed].value.songGroupKey,'group-1');
});


test('edition metadata uses the song version refreshed after old pages are deleted',async t=>{
 const f=await fixture(t);await f.run({renameSong:true});
 const renamed=f.events.findIndex(e=>e.path==='/api/v2/songs/edition-1');assert.equal(f.events[renamed].value.version,2);
 const cleanup=f.events.findIndex(e=>e.path.endsWith('/deletions/execute'));
 assert.ok(f.events.some((e,i)=>i>cleanup&&i<renamed&&e.path==='/api/v2/datasets/dataset-1/songs'));
});

test('a concurrent song rename is preserved while confirmed replacement pages remain recoverable',async t=>{
 const f=await fixture(t);f.behavior.renameDuringReorder=true;
 const state=await f.run({renameSong:true});assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/Song name changed during replacement/);
 assert.ok(!f.events.some(e=>e.path==='/api/v2/songs/edition-1'));assert.equal(f.values.get('new-1').image.status,'confirmed');assert.equal(f.uploads,1);
 f.behavior.renameDuringReorder=false;await f.run({renameSong:true});assert.equal(f.uploads,1);
});


test('a metadata version conflict remains preserved across retries',async t=>{
 const f=await fixture(t);f.behavior.failRename=true;
 const preserved=await f.run({renameSong:true});assert.equal(preserved.phase,'preserved');assert.equal(preserved.conflict.status,409);
 assert.ok(!f.values.has('old-1'));assert.equal(f.values.get('new-1').image.status,'confirmed');
 const state=await f.run({renameSong:true});assert.equal(state.phase,'preserved');assert.equal(f.uploads,1);
});


test('unexpected pages without original render evidence are preserved',async t=>{
 const f=await fixture(t);f.values.set('manual-extra',{image:{id:'manual-extra',datasetId:'dataset-1',checksum:'unknown',version:1,status:'draft'},boxes:[]});
 const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/Unexpected page in song/);assert.equal(f.uploads,0);assert.ok(f.values.has('manual-extra'));assert.ok(f.values.has('old-1'));
});


test('a verified pristine original tail upload is recovered and removed after replacement confirmation',async t=>{
 const f=await fixture(t),catalog=JSON.parse(await readFile(new URL('../tools/synthetic/original-page-checksums.json',import.meta.url),'utf8'));
 f.job.id='trial-gu-niang-bie-ku-qi';f.values.get('old-1').image.source='synthetic:original-v1:'+f.job.id+':synth195-01';
 const tail=catalog[f.job.id+':synth195-01'].at(-1);
 f.values.set('tail',{image:{id:'tail',name:tail.filename,datasetId:'dataset-1',checksum:tail.sha256,version:1,status:'draft'},boxes:[]});
 const state=await f.run();assert.equal(state.phase,'complete');assert.ok(!f.values.has('tail'));assert.equal(f.values.get('new-1').image.status,'confirmed');assert.equal(f.uploads,1);
});

test('a preserved edition does not stop a following valid edition and cannot be silently retried',async t=>{
 const conflict=await fixture(t),next=await fixture(t);conflict.values.get('old-1').image.version++;
 const first=await conflict.run(),second=await next.run();assert.equal(first.phase,'preserved');assert.equal(second.phase,'complete');
 const events=conflict.events.length;assert.equal((await conflict.run()).phase,'preserved');assert.equal(conflict.events.length,events);assert.equal(conflict.uploads,0);
 const disk=JSON.parse(await readFile(join(conflict.directory,'replacement-state.json')));assert.equal(disk.phase,'preserved');assert.deepEqual(disk.conflict.oldPageIds,['old-1']);
});
test('an edited replacement draft is preserved during upload recovery',async t=>{
 const f=await fixture(t);f.behavior.failSave=true;await assert.rejects(f.run(),/interrupted annotation save/);
 const draft=f.values.get('new-1');draft.image.version++;draft.boxes=[{id:'manual',x:42}];
 const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/draft was changed/);assert.equal(draft.boxes[0].x,42);assert.ok(f.values.has('old-1'));
});
test('an old page edited after deletion preview is not deleted',async t=>{
 const f=await fixture(t);f.behavior.editAfterPreview=true;const state=await f.run();assert.equal(state.phase,'preserved');assert.ok(f.values.has('old-1'));assert.ok(f.values.has('new-1'));assert.ok(!f.events.some(e=>e.path.endsWith('/deletions/execute')));
});
test('a modified confirmed replacement is preserved before reorder recovery',async t=>{
 const f=await fixture(t);f.behavior.failReorder=true;await assert.rejects(f.run(),/reorder interrupted/);
 f.values.get('new-1').boxes[0].x=123;const state=await f.run();assert.equal(state.phase,'preserved');assert.match(state.conflict.reason,/changed before cleanup/);assert.equal(f.values.get('new-1').boxes[0].x,123);
});
test('a missing original page becomes a review item instead of stopping the batch',async t=>{
 const f=await fixture(t);f.values.delete('old-1');const state=await f.run();assert.equal(state.phase,'preserved');assert.equal(state.conflict.status,404);assert.equal(state.conflict.path,'/api/v2/pages/old-1');assert.equal(f.uploads,0);
});
test('a lost upload response is recovered without treating the pristine upload as an unexpected page',async t=>{
 const f=await fixture(t);f.behavior.failAfterUpload=true;await assert.rejects(f.run(),/lost upload response/);const state=await f.run();assert.equal(state.phase,'complete');assert.equal(f.uploads,1);
});
test('permission errors remain fatal and are not mislabeled as preserved edits',async t=>{
 const f=await fixture(t);await assert.rejects(f.run({api:async()=>{throw Object.assign(Error('permission denied'),{status:403});}}),e=>e.status===403);
 const disk=JSON.parse(await readFile(join(f.directory,'replacement-state.json')));assert.equal(disk.phase,'upload');assert.ok(!disk.conflict);
});
