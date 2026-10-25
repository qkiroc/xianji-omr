import {ANNOTATION_REVISION,repairEditionAnnotations} from './repair-annotations.mjs';
import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {ACCOMPANIMENT_REVISION,assignAccompanimentStyles,accompanimentProfile,applyAccompanimentNotation,repairQueue,REPAIR_PHASES} from './accompaniment.mjs';
import {installAccompanimentRenderer} from './install-accompaniment-renderer.mjs';
import {stylesForScore,renderDocument,paginateScore,LAYOUT_REVISION} from './page-style.mjs';
import {uploadEdition} from './revise-audition.mjs';
import {readCredential} from '../cli/src/credentials.mjs';
import {client,limitedJSON,jsonBody} from '../cli/src/http.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const readJSON=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const atomic=async(path,value)=>{await mkdir(dirname(path),{recursive:true});const temp=path+'.part';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);};
const log=value=>console.log(JSON.stringify(value));
const performanceScore=(score,profile)=>{score=structuredClone(score);for(const change of profile.performancePlan||[]){const {bar,event,...flags}=change;const beat=score.bars[bar]?.beats[event];if(!beat)throw Error('Invalid performance target');beat.synth={...beat.synth,...flags};}return score;};
const music=score=>JSON.stringify(score, (key,value)=>['mode','synthKeepFret'].includes(key)?undefined:value);

async function collectPlan(batch,sourcePlan){
 const choices=assignAccompanimentStyles(sourcePlan.jobs),states=new Map(),profiles=new Map(),byId=new Map(sourcePlan.jobs.map(j=>[j.id,j]));
 const audit={revision:ACCOMPANIMENT_REVISION,styles:{},coverage:{},sourceSongs:sourcePlan.jobs.length,editions:0,commonCrossEditions:0};
 for(const job of sourcePlan.jobs){
  const directory=join(batch,job.id),source=await readJSON(join(directory,'source-schema2.json')),score=await readJSON(join(directory,'converted-score.json')),base=await readJSON(join(directory,'profiles.json')),state=await readJSON(join(directory,'state.json'),{profiles:[]});
  if(!source||!score||!base)throw Error('Original source missing: '+job.id);
  for(const p of base){
   const key=job.id+':'+p.id,profile=accompanimentProfile(p,choices.get(job.id)[p.id]),performed=performanceScore(score,profile),applied=applyAccompanimentNotation(performed,source,profile);
   if(music(performed)!==music(applied.score))throw Error('Musical content changed: '+key);
   profiles.set(key,profile);audit.editions++;audit.styles[profile.pluckNotation]=(audit.styles[profile.pluckNotation]||0)+1;
   if(p.featureFamily===0&&profile.pluckNotation==='chord-cross')audit.commonCrossEditions++;
   for(const[k,v]of Object.entries(applied.coverage))if(typeof v==='number')audit.coverage[k]=(audit.coverage[k]||0)+v;
   const pending=await readJSON(join(batch,'layout-revision-v2',job.id,p.id,'replacement-state.json'));
   if(pending&&pending.phase!=='complete'&&pending.newPages?.length){let prior=state.profiles.find(r=>r.id===p.id);if(!prior){prior={id:p.id,pages:[]};state.profiles.push(prior);}prior.pendingPages=pending.newPages.length;}
  }
  states.set(job.id,state);
 }
 const queue=repairQueue(sourcePlan.jobs,states).map(item=>({...item,title:byId.get(item.sourceId).title,profile:profiles.get(item.sourceId+':'+item.profileId)}));
 audit.phases=Object.fromEntries(REPAIR_PHASES.map(phase=>[phase,queue.filter(q=>q.phase===phase).length]));
 audit.crossPluckRatio=audit.coverage.crossPlucks/(audit.coverage.pluckedNotes-audit.coverage.mutedPlucks);
 if(audit.commonCrossEditions!==sourcePlan.jobs.length||audit.crossPluckRatio<.75)throw Error('Cross accompaniment does not form a clear majority');
 return{revision:ACCOMPANIMENT_REVISION,sourceSha256:sourcePlan.sourceSha256,datasetId:sourcePlan.datasetId,createdAt:new Date().toISOString(),audit,queue};
}
async function connection(root,sourcePlan){
 process.env.XDG_CONFIG_HOME=join(root,'../cli-config');const cloudToken=process.env.OMR_CLI_TOKEN;if(cloudToken&&!/^omr_cli_[a-f0-9]{64}$/.test(cloudToken))throw Error('Cloud CLI token format is invalid');const credential=cloudToken?{token:cloudToken}:await readCredential(sourcePlan.origin);if(!credential)throw Error('CLI authorization missing');
 const request=client(sourcePlan.origin,credential.token),api=async(path,value,method='POST')=>{for(let i=0;;i++){try{return await limitedJSON(await request(path,value===undefined?{}:jsonBody(value,method)));}catch(e){if(e.status!==429||i>=20)throw e;await new Promise(r=>setTimeout(r,600+Math.min(150*i,2000)));}}};
 await api('/api/v2/datasets/'+sourcePlan.datasetId+'/songs');return{request,api};
}
async function waitForPreviousTask(batch){
 const file=join(batch,'layout-revision-v2/progress.json'),first=await readJSON(file);if(!first?.updatedAt)return;
 // Do not race an older process that has not yet observed the user's Ctrl+C.
 const age=Date.now()-Date.parse(first.updatedAt);if(age>=30000)return;
 log({event:'waiting-for-previous-task',seconds:Math.ceil((30000-age)/1000)});
 while(Date.now()-Date.parse(first.updatedAt)<30000){await new Promise(r=>setTimeout(r,1000));const current=await readJSON(file);if(current?.updatedAt!==first.updatedAt)throw Error('Previous layout task is still writing; stop it before starting this revision');}
}
async function finishPendingLegacy(batch,sourcePlan,conn){
 let recovered=0;
 for(const job of sourcePlan.jobs)for(const p of job.profiles){
  const directory=join(batch,'layout-revision-v2',job.id,p.id),state=await readJSON(join(directory,'replacement-state.json')),result=await readJSON(join(directory,'render-result.json'));
  if(state?.phase==='complete'||!result)continue;
  // A fully rendered edition can have an upload interrupted before its first checkpoint.
  const sourceState=await readJSON(join(batch,job.id,'state.json'),{profiles:[]}),prior=sourceState.profiles.find(r=>r.id===p.id);
  if(prior?.layoutRevision===ACCOMPANIMENT_REVISION||!state&&prior?.layoutRevision===LAYOUT_REVISION)continue;
  if(result.layoutRevision!==LAYOUT_REVISION)throw Error('Unexpected interrupted legacy revision');
  log({event:'recovering-interrupted-edition',title:job.title,profile:p.id});
  const profile=(await readJSON(join(batch,job.id,'profiles.json'))).find(v=>v.id===p.id);
  await uploadEdition({plan:sourcePlan,job,profile,directory,result,...conn,sourceDirectory:join(batch,job.id),backupDirectory:join(batch,'layout-revision-v2/previous-states'),revision:LAYOUT_REVISION});recovered++;
 }
 if(recovered)log({event:'interrupted-editions-recovered',editions:recovered});
}
async function verifyCompletedEdition(batch,item,sourcePlan,api){
 const state=await readJSON(join(batch,item.sourceId,'state.json')),profile=state?.profiles.find(p=>p.id===item.profileId);if(!profile?.pages?.length||profile.layoutRevision!==ACCOMPANIMENT_REVISION)throw Error('Completed edition checkpoint is missing');
 for(const page of profile.pages){if(page.annotationRepairIntent)continue;const saved=await api('/api/v2/pages/'+page.pageId);if(saved.image.datasetId!==sourcePlan.datasetId||saved.image.checksum!==page.sha256||saved.image.version!==page.version||saved.image.status!=='confirmed'||saved.boxes.length!==page.boxCount||saved.boxes.some(b=>b.reviewStatus!=='confirmed'))throw Error('Completed remote edition was changed; preserving it');}
}
async function writePreviews(root,batch,out,manifest,installed,songId){
 const first=manifest.queue.find(q=>!songId||q.sourceId===songId);if(!first)throw Error('Unknown song');
 const source=await readJSON(join(batch,first.sourceId,'source-schema2.json')),score=await readJSON(join(batch,first.sourceId,'converted-score.json')),base=first.profile;
 const require=createRequire(pathToFileURL(join(root,'accompaniment-preview.mjs'))),links=[],directory=join(out,'previews');await mkdir(directory,{recursive:true});
 for(const style of ['chord-cross','mixed','numeric']){
  const profile=accompanimentProfile(base,style),applied=applyAccompanimentNotation(performanceScore(score,profile),source,profile);
  globalThis.__SYNTH_STYLE__=profile;globalThis.__SYNTH_SCORE__=applied.score;delete require.cache[installed.bundle];const fragment=require(installed.bundle);
  const glyphs=(fragment.match(/data-pluck-cross=/g)||[]).length;if(glyphs!==applied.coverage.crossPlucks)throw Error('Preview glyph count differs');
  const payload={profile,styles:stylesForScore(profile,source,score.bars.length+1)},html=renderDocument(fragment,profile)+`<script>document.fonts.ready.then(()=>{try{(${paginateScore.toString()})(${JSON.stringify(payload).replaceAll('<','\\u003c')});document.body.dataset.layoutReady='true';}catch(error){document.body.dataset.layoutError=error.message;const pre=document.createElement('pre');pre.textContent=error.stack;document.body.append(pre);}});</script>`;
  await writeFile(join(directory,style+'.html'),html);links.push(`<li><a href="${style}.html">${style}</a> · × ${glyphs}</li>`);
 }
 await writeFile(join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><h1>伴奏写法对照</h1><ul>'+links.join('')+'</ul>');log({event:'previews-prepared',sourceId:first.sourceId,directory,visualVerification:'pending'});
}
export async function runAccompaniment(args=process.argv.slice(2)){
 const flag=k=>args.includes(k),option=(k,fallback)=>{const i=args.indexOf(k);return i<0?fallback:args[i+1];};
 if(flag('--help')||!args.length){console.log('node tools/synthetic/revise-audition.mjs --prepare --previews | --run | --render | --upload [--limit N] [--song SOURCE_ID]\nRuns repair-common, repair-existing and continue-import in that order.');return;}
 const root=resolve(option('--root',join(workspace,'.artifacts/synthetic-renderer'))),batch=join(root,'audition-195-batch'),out=join(batch,'accompaniment-revision-v3'),reportFile=join(out,'progress.json');await mkdir(out,{recursive:true});
 const sourcePlan=await readJSON(join(batch,'plan.json'));if(!sourcePlan)throw Error('Original import plan missing');
 const manifestFile=join(out,'plan.json'),previousReport=await readJSON(reportFile,{completed:[]});let manifest=await readJSON(manifestFile);if(!manifest||flag('--prepare')&&!previousReport.completed.length){manifest=await collectPlan(batch,sourcePlan);await atomic(manifestFile,manifest);}
 if(manifest.revision!==ACCOMPANIMENT_REVISION||manifest.sourceSha256!==sourcePlan.sourceSha256)throw Error('Revision plan does not match the original library');
 if(flag('--prepare'))log({event:'prepared',...manifest.audit});
 const render=flag('--render')||flag('--run'),upload=flag('--upload')||flag('--run');if(!render&&!upload&&!flag('--previews'))return;
 const installed=await installAccompanimentRenderer(root);
 if(flag('--previews'))await writePreviews(root,batch,out,manifest,installed,option('--song'));
 if(!render&&!upload)return;
 const lockPath=join(out,'task.lock');let lock;
 try{lock=await open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const owner=await readJSON(lockPath);if(!Number.isInteger(owner?.pid))throw Error('Revision lock is invalid');try{process.kill(owner.pid,0);throw Error('Another accompaniment revision is running');}catch(alive){if(alive.code!=='ESRCH')throw alive;}await unlink(lockPath);lock=await open(lockPath,'wx');}
 await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
 const report=await readJSON(reportFile,{revision:ACCOMPANIMENT_REVISION,completed:[],failed:[],status:'running'}),startedAt=Date.now(),timeBudget=Number(option('--time-budget',300))*60000;let browser,conn,done=0;
 try{
  if(upload){await waitForPreviousTask(batch);conn=await connection(root,sourcePlan);await finishPendingLegacy(batch,sourcePlan,conn);
   // Finish already-uploaded transactions with their frozen pixels before annotation migration.
   for(const item of manifest.queue){const directory=join(out,item.sourceId,item.profileId),pending=await readJSON(join(directory,'replacement-state.json')),result=await readJSON(join(directory,'render-result.json'));if(!pending||pending.phase==='complete'||!pending.newPages?.length||!result)continue;
    const job=sourcePlan.jobs.find(j=>j.id===item.sourceId);log({event:'recovering-interrupted-accompaniment',title:item.title,profile:item.profileId,phase:pending.phase});
    const state=await uploadEdition({plan:sourcePlan,job,profile:item.profile,directory,result,...conn,sourceDirectory:join(batch,job.id),backupDirectory:join(out,'previous-states'),revision:ACCOMPANIMENT_REVISION,renameSong:true});
    const key=item.sourceId+':'+item.profileId;if(!report.completed.some(p=>p.key===key))report.completed.push({key,phase:item.phase,style:item.profile.pluckNotation,songId:state.songId,pages:state.newPages.length,rendererSha256:result.rendererSha256});await atomic(reportFile,report);log({event:'interrupted-accompaniment-recovered',title:item.title,profile:item.profileId,completedEditions:report.completed.length});
   }
}
  if(render){const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright-core/index.mjs')));browser=await chromium.launch({...((option('--browser',process.env.OMR_BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined)))?{executablePath:option('--browser',process.env.OMR_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')}:{ }),headless:true});}
  const renderer=render?await import(pathToFileURL(installed.path)):null,limit=Number(option('--limit',Infinity));if(!(limit>0))throw Error('--limit must be positive');
  report.status='running';delete report.failure;let phase;
  for(const item of manifest.queue){
   if(option('--song')&&item.sourceId!==option('--song'))continue;const key=item.sourceId+':'+item.profileId,completed=report.completed.find(p=>p.key===key);if(completed&&(upload||flag('--cloud'))){if(completed.rendererSha256!==installed.sha256&&!flag('--cloud'))throw Error('An uploaded edition uses another renderer; keep this revision frozen');if(flag('--cloud')&&upload){await verifyCompletedEdition(batch,item,sourcePlan,conn.api);
    if(completed.annotationRevision!==ANNOTATION_REVISION){
     if(Date.now()-startedAt>timeBudget){report.status='paused';await atomic(reportFile,report);return;}
     const job=sourcePlan.jobs.find(j=>j.id===item.sourceId),sourceDirectory=join(batch,job.id),directory=join(out,job.id,item.profileId);
     if(!renderer)throw Error('Use --run to repair completed annotations');
     await renderer.renderBatchProfile({source:await readJSON(join(sourceDirectory,'source-schema2.json')),score:await readJSON(join(sourceDirectory,'converted-score.json')),profile:item.profile,out:join(out,job.id),browser});
     await repairEditionAnnotations({sourceDirectory,profileId:item.profileId,directory,api:conn.api,datasetId:sourcePlan.datasetId});
     completed.annotationRevision=ANNOTATION_REVISION;await atomic(reportFile,report);log({event:'annotations-repaired',title:item.title,profile:item.profileId,completedEditions:report.completed.length});
    }
   }continue;}if(done>=limit||Date.now()-startedAt>timeBudget){report.status='paused';report.current=null;await atomic(reportFile,report);log({event:'paused',reason:'limit',completedEditions:report.completed.length});return;}
   if(phase!==item.phase){phase=item.phase;log({event:'phase',phase,total:manifest.queue.filter(q=>q.phase===phase).length});}
   report.current={sourceId:item.sourceId,title:item.title,profile:item.profileId,phase};report.updatedAt=new Date().toISOString();await atomic(reportFile,report);
   const job=sourcePlan.jobs.find(j=>j.id===item.sourceId),sourceDirectory=join(batch,job.id),source=await readJSON(join(sourceDirectory,'source-schema2.json')),score=await readJSON(join(sourceDirectory,'converted-score.json')),profile=item.profile,directory=join(out,job.id,profile.id),resultFile=join(directory,'render-result.json');let result=await readJSON(resultFile);const pending=await readJSON(join(directory,'replacement-state.json')),resumeExisting=!!(flag('--cloud')&&pending&&result&&result.layoutRevision===ACCOMPANIMENT_REVISION&&pending.newPages?.length);
   if(render&&!resumeExisting&&(!result||result.rendererSha256!==installed.sha256||result.layoutRevision!==ACCOMPANIMENT_REVISION)){
    const transaction=await readJSON(join(directory,'replacement-state.json'));if(transaction?.newPages?.length)throw Error('Renderer changed after this edition started uploading; preserving its checkpoint');
    result=await renderer.renderBatchProfile({source,score,profile,out:join(out,job.id),browser});result.rendererSha256=installed.sha256;await atomic(resultFile,result);
   }
   if(upload){if(!result||!resumeExisting&&result.rendererSha256!==installed.sha256)throw Error('Current revision not rendered: '+key);const state=await uploadEdition({plan:sourcePlan,job,profile,directory,result,...conn,sourceDirectory,backupDirectory:join(out,'previous-states'),revision:ACCOMPANIMENT_REVISION,renameSong:true});if(resumeExisting){await renderer.renderBatchProfile({source,score,profile,out:join(out,job.id),browser});}await repairEditionAnnotations({sourceDirectory,profileId:profile.id,directory,api:conn.api,datasetId:sourcePlan.datasetId});report.completed.push({annotationRevision:ANNOTATION_REVISION,key,phase,style:profile.pluckNotation,songId:state.songId,pages:state.newPages.length,rendererSha256:result.rendererSha256});}
   done++;report.updatedAt=new Date().toISOString();await atomic(reportFile,report);log({event:upload?'replaced':'rendered',phase,title:job.title,profile:profile.id,style:profile.pluckNotation,pages:result.pageCount,crossPlucks:result.accompanimentCoverage?.renderedCrossPlucks,completedEditions:report.completed.length});
  }
  report.status=option('--song')?'selection-complete':'complete';report.current=null;report.updatedAt=new Date().toISOString();await atomic(reportFile,report);log({event:'complete',status:report.status,editions:report.completed.length,pages:report.completed.reduce((n,p)=>n+p.pages,0)});
 }catch(error){report.status='blocked';report.failure={message:error.message,status:error.status,at:new Date().toISOString()};await atomic(reportFile,report);throw error;}
 finally{await browser?.close();await lock.close();await unlink(lockPath).catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runAccompaniment().catch(error=>{console.error(JSON.stringify({error:error.message,status:error.status}));process.exitCode=1;});

