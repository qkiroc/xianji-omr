import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {saveCredential} from '../cli/src/credentials.mjs';
import {sealFiles} from './cloud-crypto.mjs';
import {annotationHash,canonical} from './reconcile-completed.mjs';
import {installAccompanimentRenderer} from './install-accompaniment-renderer.mjs';
const workspace=resolve('.'),root=join(workspace,'.artifacts/synthetic-renderer'),batch=join(root,'audition-195-batch'),out=join(root,'preserved-review');
const read=async p=>JSON.parse(await readFile(p,'utf8')),run=promisify(execFile),plan=await read(join(batch,'plan.json')),manifest=await read(join(batch,'accompaniment-revision-v3/plan.json'));
process.env.XDG_CONFIG_HOME=join(workspace,'.artifacts/preserved-review-cli');await saveCredential(plan.origin,{token:process.env.OMR_CLI_TOKEN,allowInsecureHttp:true});
async function cli(args,json=true){const r=await run(process.execPath,['tools/cli/xianji-omr.mjs',...args,'--origin',plan.origin],{env:process.env,maxBuffer:16*1024*1024,timeout:120000});return json?JSON.parse(r.stdout):r.stdout;}
await mkdir(out,{recursive:true});
const targets=[['trial-xiao-xing-yun','synth195-02',3,'2b29b355-19fe-4ee1-b3d0-8e0a62ec6cb4'],['trial-xiao-xing-yun','synth195-03',0,'f1a2297f-e0d0-4938-a78b-416d4b7cad73'],['trial-gu-niang-bie-ku-qi','synth195-02',4,'9495575d-5847-4d63-9158-472798626cd7']];
const installed=await installAccompanimentRenderer(root),renderer=await import(pathToFileURL(installed.path)),{chromium}=await import(pathToFileURL(join(root,'node_modules/playwright-core/index.mjs'))),browser=await chromium.launch({headless:true});
const files=[],report={datasetId:plan.datasetId,readOnly:true,createdAt:new Date().toISOString(),pages:[],editions:[]};
async function add(path,bytes){await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);files.push({path:relative(workspace,path).split(sep).join('/'),bytes:Buffer.from(bytes)});}
async function record(sourceId,profileId,pageIndex,pageId,desired){
 const value=await cli(['pages','get',pageId]),base=sourceId+'-'+profileId+'-p'+(pageIndex+1),path=join(out,base+'.png');await cli(['pages','content',pageId,'--original','--output',path],false);const bytes=await readFile(path),checksum=createHash('sha256').update(bytes).digest('hex');if(checksum!==value.image.checksum)throw Error('Downloaded page pixels differ');
 await add(path,bytes);await add(join(out,base+'.json'),JSON.stringify(value,null,2));if(desired)await add(join(out,base+'-desired.json'),JSON.stringify(desired,null,2));
 const actual=value.boxes.map(b=>({...b,reviewStatus:'draft'})),wanted=desired?.annotation.boxes||[],changes=wanted.map(b=>({id:b.id,expected:b,actual:actual.find(a=>a.id===b.id)||null})).filter(p=>canonical(p.expected)!==canonical(p.actual));
 const entry={sourceId,profile:profileId,page:pageIndex+1,pageId,filename:base+'.png',version:value.image.version,status:value.image.status,checksum,actualAnnotationHash:annotationHash(value),desiredPixelMatch:desired?desired.sha256===checksum:null,actualBoxCount:actual.length,desiredBoxCount:wanted.length,changes,extraActual:actual.filter(a=>!wanted.some(b=>a.id===b.id))};report.pages.push(entry);
 const fingerprint={pageId:value.image.id,datasetId:value.image.datasetId,songId:value.image.songId,checksum,width:value.image.width,height:value.image.height,version:value.image.version,status:value.image.status,source:value.image.source,annotationSha256:annotationHash(value),deletedBoxesSha256:createHash('sha256').update(canonical(value.deletedBoxes||[])).digest('hex')};
 console.log(JSON.stringify({event:'reviewed-page-fingerprint',sourceId,profile:profileId,page:pageIndex+1,fingerprint,desiredAnnotationHash:desired?annotationHash(desired.annotation):null,desiredPixelMatch:entry.desiredPixelMatch,changes:changes.map(c=>({id:c.id,classKey:c.expected.classKey,before:c.actual?{x:c.actual.x,y:c.actual.y,width:c.actual.width,height:c.actual.height,readingOrder:c.actual.readingOrder,parentSystemId:c.actual.parentSystemId,metadata:c.actual.metadata}:null,after:{x:c.expected.x,y:c.expected.y,width:c.expected.width,height:c.expected.height,readingOrder:c.expected.readingOrder,parentSystemId:c.expected.parentSystemId,metadata:c.expected.metadata}})),extraActual:entry.extraActual.map(b=>({id:b.id,classKey:b.classKey,kind:b.metadata?.value?.kind}))}));
 console.log(JSON.stringify({event:'preserved-page-read',sourceId,profile:profileId,page:pageIndex+1,pageId,version:entry.version,status:entry.status,actualBoxCount:entry.actualBoxCount,desiredBoxCount:entry.desiredBoxCount,desiredPixelMatch:entry.desiredPixelMatch,changedBoxIds:changes.map(c=>c.id),extraBoxIds:entry.extraActual.map(b=>b.id)}));return value;
}
try{
 for(const [sourceId,profileId,pageIndex,pageId]of targets){const item=manifest.queue.find(i=>i.sourceId===sourceId&&i.profileId===profileId),dir=join(batch,sourceId);await renderer.renderBatchProfile({source:await read(join(dir,'source-schema2.json')),score:await read(join(dir,'converted-score.json')),profile:item.profile,out:join(out,'rendered',sourceId),browser});const desired=(await read(join(out,'rendered',sourceId,profileId,'annotations.json'))).find(p=>p.pageIndex===pageIndex);if(!desired)throw Error('Target page missing in render');await record(sourceId,profileId,pageIndex,pageId,desired);}
 const sourceId='trial-mo-te',profileId='synth195-03',dir=join(batch,sourceId),item=manifest.queue.find(i=>i.sourceId===sourceId&&i.profileId===profileId),state=await read(join(dir,'state.json')),profile=state.profiles.find(p=>p.id===profileId),remote=await cli(['pages','list','--song',profile.songId]);
 const originalRenderer=await import(pathToFileURL(join(root,'batch-render-profile.mjs'))),originalProfile=(await read(join(dir,'profiles.json'))).find(p=>p.id===profileId);
 await originalRenderer.renderBatchProfile({source:await read(join(dir,'source-schema2.json')),score:await read(join(dir,'converted-score.json')),profile:originalProfile,out:join(out,'original',sourceId),browser});const originals=await read(join(out,'original',sourceId,profileId,'annotations.json'));
 for(const p of remote)await record(sourceId,profileId,p.pageOrder-1,p.id,originals.find(o=>o.pageIndex===p.pageOrder-1));
 const result=await renderer.renderBatchProfile({source:await read(join(dir,'source-schema2.json')),score:await read(join(dir,'converted-score.json')),profile:item.profile,out:join(out,'rendered',sourceId),browser});result.rendererSha256=installed.sha256;await writeFile(join(out,'rendered',sourceId,profileId,'render-result.json'),JSON.stringify(result));
 const desired=await read(join(out,'rendered',sourceId,profileId,'annotations.json'));for(const p of desired){await add(join(out,'mo-te-new-p'+(p.pageIndex+1)+'.png'),await readFile(join(out,'rendered',sourceId,profileId,p.filename)));await add(join(out,'mo-te-new-p'+(p.pageIndex+1)+'.json'),JSON.stringify(p));}
 report.editions.push({sourceId,profileId,songId:profile.songId,oldPages:remote.length,newPages:desired.length,crossPlucks:result.accompanimentCoverage?.crossPlucks});
 await add(join(out,'report.json'),JSON.stringify(report,null,2));
 if(process.argv.includes('--geometry-only'))process.exitCode=0;
 else {const encrypted=sealFiles(files,process.env.OMR_ASSET_KEY),encoded=encrypted.toString('base64'),size=16000,total=Math.ceil(encoded.length/size);await writeFile(join(out,'review.enc'),encrypted);
 console.log(JSON.stringify({event:'review-bundle',files:files.length,bytes:encrypted.length,total,sha256:createHash('sha256').update(encrypted).digest('hex')}));for(let index=0;index<total;index++)console.log(JSON.stringify({event:'sealed-review-part',index,total,data:encoded.slice(index*size,(index+1)*size)}));
 }
}finally{await browser.close();}
