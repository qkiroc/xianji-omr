import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {repairEditionAnnotations,ANNOTATION_REVISION} from '../tools/synthetic/repair-annotations.mjs';
async function fixture(t){
 const base=join(process.cwd(),'.test-data');await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'annotation-repair-'));assert.ok(root.startsWith(base));t.after(()=>rm(root,{recursive:true,force:true}));
 const old={id:'melody',classKey:'melody',x:10,y:20,width:100,height:90,reviewStatus:'confirmed'},box={...old,height:20,reviewStatus:'draft'},desired={annotationFormat:'layout-v2',pageType:'music',boxes:[box]};
 const entry={pageIndex:0,pageId:'page',sha256:'pixels',version:3,boxCount:2};const profile={id:'profile',pages:[entry]};await writeFile(join(root,'state.json'),JSON.stringify({profiles:[profile]}));await writeFile(join(root,'annotations.json'),JSON.stringify([{pageIndex:0,sha256:'pixels',annotation:desired}]));
 const remote={image:{datasetId:'dataset',checksum:'pixels',version:3,status:'confirmed',source:'synthetic:test'},boxes:[old,{id:'original',classKey:'key_signature',reviewStatus:'confirmed'}]},events=[],behavior={failConfirm:false};
 const api=async(path,body,method)=>{events.push({path,method});if(method==='PUT'){assert.equal(body.version,remote.image.version);remote.boxes=structuredClone(body.boxes);remote.image.version++;remote.image.status='draft';}if(path.endsWith('/confirm')){if(behavior.failConfirm){behavior.failConfirm=false;throw Error('lost confirm');}remote.image.version++;remote.image.status='confirmed';remote.boxes=remote.boxes.map(b=>({...b,reviewStatus:'confirmed'}));}return structuredClone(remote);};
 return{root,remote,events,behavior,run:()=>repairEditionAnnotations({sourceDirectory:root,profileId:'profile',directory:root,api,datasetId:'dataset'})};
}
test('annotation correction keeps image identity, tightens melody and removes the original key',async t=>{const f=await fixture(t);await f.run();assert.equal(f.remote.image.checksum,'pixels');assert.equal(f.remote.image.status,'confirmed');assert.equal(f.remote.boxes.length,1);assert.equal(f.remote.boxes[0].height,20);const p=JSON.parse(await readFile(join(f.root,'state.json'))).profiles[0];assert.equal(p.annotationRevision,ANNOTATION_REVISION);assert.equal(p.pages[0].version,5);});
test('interrupted annotation correction resumes its draft with no duplicate save',async t=>{const f=await fixture(t);f.behavior.failConfirm=true;await assert.rejects(f.run(),/lost confirm/);await f.run();assert.equal(f.events.filter(e=>e.method==='PUT').length,1);assert.equal(f.remote.image.status,'confirmed');});
test('manual edits are preserved before annotation correction',async t=>{const f=await fixture(t);f.remote.image.version++;await assert.rejects(f.run(),/Page changed/);assert.ok(!f.events.some(e=>e.method==='PUT'));});
test('different rendered pixels abort annotation correction before any server call',async t=>{const f=await fixture(t);await writeFile(join(f.root,'annotations.json'),JSON.stringify([{pageIndex:0,sha256:'changed'}]));await assert.rejects(f.run(),/original pixels/);assert.equal(f.events.length,0);});


test('a prior annotation revision is migrated again',async t=>{const f=await fixture(t);const state=JSON.parse(await readFile(join(f.root,'state.json')));state.profiles[0].annotationRevision='tight-melody-written-key-v1';state.profiles[0].pages[0].annotationRevision='tight-melody-written-key-v1';await writeFile(join(f.root,'state.json'),JSON.stringify(state));await f.run();assert.equal(f.remote.boxes[0].height,20);const updated=JSON.parse(await readFile(join(f.root,'state.json')));assert.equal(updated.profiles[0].annotationRevision,ANNOTATION_REVISION);});

test('a frozen old annotation save is confirmed before migrating to different geometry',async t=>{const f=await fixture(t);f.behavior.failConfirm=true;await assert.rejects(f.run(),/lost confirm/);const annotations=JSON.parse(await readFile(join(f.root,'annotations.json')));annotations[0].annotation.boxes[0].height=15;await writeFile(join(f.root,'annotations.json'),JSON.stringify(annotations));await f.run();assert.equal(f.remote.image.status,'confirmed');assert.equal(f.remote.boxes[0].height,15);assert.equal(f.events.filter(e=>e.method==='PUT').length,2);});
