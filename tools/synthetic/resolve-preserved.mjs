import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {annotationHash,canonical} from './reconcile-completed.mjs';
import {reviewedFingerprint,assertReviewedPage,approveReviewedRemoval,validateReviewedGeometry} from './reviewed-pages.mjs';
import {installAccompanimentRenderer} from './install-accompaniment-renderer.mjs';
import {uploadEdition} from './revise-audition.mjs';
import {repairEditionAnnotations,ANNOTATION_REVISION} from './repair-annotations.mjs';
import {ACCOMPANIMENT_REVISION} from './accompaniment.mjs';
import {client,jsonBody,limitedJSON} from '../cli/src/http.mjs';
import {resilientRequest,serviceFailureDisposition} from './resilient-request.mjs';
import {regions} from '../../server/src/annotation.ts';
const root=resolve('.artifacts/synthetic-renderer'),batch=join(root,'audition-195-batch'),out=join(batch,'accompaniment-revision-v3'),reportPath=join(out,'progress.json');
const read=async(p,fallback)=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e;}};
const atomic=async(p,v)=>{await mkdir(dirname(p),{recursive:true});await writeFile(p+'.part',JSON.stringify(v,null,2));await rename(p+'.part',p);};
const log=v=>console.log(JSON.stringify(v));
const review=await read('tools/synthetic/approved-preserved-review.json'),plan=await read(join(batch,'plan.json')),manifest=await read(join(out,'plan.json')),report=await read(reportPath);
if(review.datasetId!==plan.datasetId||manifest.revision!==ACCOMPANIMENT_REVISION)throw Error('Review belongs to another dataset or revision');
const apply=process.argv.includes('--apply'),request=resilientRequest(client(plan.origin,process.env.OMR_CLI_TOKEN)),api=async(path,value,method='POST')=>limitedJSON(await request(path,value===undefined?{}:jsonBody(value,method)));
const sourceStatePath=sourceId=>join(batch,sourceId,'state.json');
async function entryFor(target){const state=await read(sourceStatePath(target.sourceId)),profile=state.profiles.find(p=>p.id===target.profileId),entry=profile?.pages.find(p=>p.pageId===target.fingerprint.pageId);if(!entry)throw Error('Reviewed page is missing from checkpoint');return{state,profile,entry};}
function assertPageOrIntent(target,entry,value){
 if(canonical(reviewedFingerprint(value))===canonical(target.fingerprint))return;
 const saved=entry.reviewResolution,fp=target.fingerprint,i=value.image,version=i.status==='draft'?fp.version+1:i.status==='confirmed'?fp.version+2:-1;
 if(saved?.reviewId===review.reviewId&&saved.desiredAnnotationHash===target.desiredAnnotationHash&&i.version===version&&i.id===fp.pageId&&i.datasetId===fp.datasetId&&i.songId===fp.songId&&i.checksum===fp.checksum&&i.width===fp.width&&i.height===fp.height&&i.source===fp.source&&annotationHash(value)===target.desiredAnnotationHash)return;
 assertReviewedPage(target.fingerprint,value);
}
let browser;
try{
 // Validate every observed record before any platform write.
 for(const target of review.pages){const {entry}=await entryFor(target),value=await api('/api/v2/pages/'+target.fingerprint.pageId);assertPageOrIntent(target,entry,value);}
 const item=manifest.queue.find(q=>q.sourceId===review.edition.sourceId&&q.profileId===review.edition.profileId);if(!item)throw Error('Reviewed edition is missing');
 const transactionPath=join(out,item.sourceId,item.profileId,'replacement-state.json');let transaction=await read(transactionPath);
 if(transaction.phase==='preserved'){
  if(transaction.newPages.length)throw Error('Reviewed edition gained new uploads');
  if(canonical(transaction.oldPages.map(p=>p.pageId).sort())!==canonical(review.edition.pages.map(p=>p.fingerprint.pageId).sort()))throw Error('Reviewed old page set changed');
  const listed=await api('/api/v2/songs/'+transaction.songId+'/pages');if(canonical(listed.map(p=>p.id).sort())!==canonical(transaction.oldPages.map(p=>p.pageId).sort()))throw Error('Reviewed song gained or lost pages');
  for(const old of review.edition.pages)assertReviewedPage(old.fingerprint,await api('/api/v2/pages/'+old.fingerprint.pageId));
 }else if(transaction.reviewedResolution?.reviewId!==review.reviewId)throw Error('Replacement is not a recognized reviewed transaction');
 const installed=await installAccompanimentRenderer(root),renderer=await import(pathToFileURL(installed.path)),{chromium}=await import(pathToFileURL(join(root,'node_modules/playwright-core/index.mjs')));
 browser=await chromium.launch({headless:true});const generated=new Map();
 for(const target of [...review.pages,{sourceId:item.sourceId,profileId:item.profileId}]){
  const key=target.sourceId+':'+target.profileId;if(generated.has(key))continue;
  const q=manifest.queue.find(q=>q.sourceId===target.sourceId&&q.profileId===target.profileId),dir=join(batch,q.sourceId),directory=join(out,q.sourceId,q.profileId),previous=await read(join(directory,'render-result.json'),null);
  // Pending replacement pixels remain frozen on a resumed write.
  const keepPending=key===item.sourceId+':'+item.profileId&&transaction.phase!=='preserved'&&transaction.newPages.length&&previous;
  const result=keepPending?previous:await renderer.renderBatchProfile({source:await read(join(dir,'source-schema2.json')),score:await read(join(dir,'converted-score.json')),profile:q.profile,out:join(out,q.sourceId),browser});
  if(!keepPending){result.rendererSha256=installed.sha256;await atomic(join(directory,'render-result.json'),result);}
  const pages=await read(join(directory,'annotations.json'));for(const page of pages){validateReviewedGeometry(page);regions(page.annotation.boxes,page.width,page.height,{confirm:true,pageType:'music',taxonomyVersion:'layout-v2'});}
  generated.set(key,{directory,result,pages});
 }
 for(const target of review.pages){const local=generated.get(target.sourceId+':'+target.profileId).pages.find(p=>p.pageIndex===target.pageIndex);if(!local||local.sha256!==target.fingerprint.checksum||annotationHash(local.annotation)!==target.desiredAnnotationHash)throw Error('Reviewed target pixels or geometry changed after approval');}
 const next=generated.get(item.sourceId+':'+item.profileId);if(next.pages.length!==review.edition.expectedPageCount)throw Error('Reviewed edition pagination changed');
 log({event:'review-resolution-preflight',reviewId:review.reviewId,annotationPages:review.pages.length,editionPages:next.pages.length,apply});
 if(!apply)process.exitCode=0;
 else{
  report.status='running';report.current={phase:'resolve-reviewed',reviewId:review.reviewId};await atomic(reportPath,report);
  for(const target of review.pages){
   const {state,profile,entry}=await entryFor(target),path='/api/v2/pages/'+target.fingerprint.pageId,local=generated.get(target.sourceId+':'+target.profileId).pages.find(p=>p.pageIndex===target.pageIndex);let value=await api(path);assertPageOrIntent(target,entry,value);
   if(!entry.reviewResolution){entry.reviewResolution={reviewId:review.reviewId,desiredAnnotationHash:target.desiredAnnotationHash,before:value,phase:'prepared',at:new Date().toISOString()};await atomic(sourceStatePath(target.sourceId),state);}
   if(annotationHash(value)!==target.desiredAnnotationHash)value=await api(path,{...local.annotation,version:value.image.version,source:value.image.source},'PUT');
   entry.reviewResolution.phase='saved';entry.reviewResolution.savedVersion=value.image.version;await atomic(sourceStatePath(target.sourceId),state);
   if(value.image.status!=='confirmed')value=await api(path+'/confirm',{version:value.image.version,acknowledged:true,reviewType:'human'});
   value=await api(path);if(value.image.checksum!==target.fingerprint.checksum||value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed')||annotationHash(value)!==target.desiredAnnotationHash)throw Error('Reviewed page readback differs');
   validateReviewedGeometry(value);Object.assign(entry,{version:value.image.version,boxCount:value.boxes.length,annotationSha256:annotationHash(value),annotationRevision:ANNOTATION_REVISION});delete entry.preservedRemote;delete entry.annotationRepairIntent;entry.reviewResolution.phase='confirmed';
   profile.annotationRevision=ANNOTATION_REVISION;profile.annotationRepairStatus=profile.pages.some(p=>p.preservedRemote)?'partial':'complete';await atomic(sourceStatePath(target.sourceId),state);
   report.preservedPages=(report.preservedPages||[]).filter(p=>p.pageId!==entry.pageId);report.consecutiveReviewServicePauses=0;await atomic(reportPath,report);
   log({event:'reviewed-page-repaired',sourceId:target.sourceId,profile:target.profileId,page:target.pageIndex+1,pageId:entry.pageId,version:entry.version,boxes:entry.boxCount});
  }
  transaction=await read(transactionPath);
  if(transaction.phase==='preserved'){
   const before=[];
   for(const old of review.edition.pages){const value=await api('/api/v2/pages/'+old.fingerprint.pageId);assertReviewedPage(old.fingerprint,value);before.push(value);const at=transaction.oldPages.findIndex(p=>p.pageId===old.fingerprint.pageId);transaction.oldPages[at]=approveReviewedRemoval(transaction.oldPages[at],value,old.fingerprint,review.reviewId);}
   transaction.reviewedResolution={reviewId:review.reviewId,priorConflict:transaction.conflict,before,at:new Date().toISOString()};delete transaction.conflict;transaction.phase='upload';transaction.rendererSha256=next.result.rendererSha256;await atomic(transactionPath,transaction);
  }
  const job=plan.jobs.find(j=>j.id===item.sourceId),settled=await uploadEdition({plan,job,profile:item.profile,directory:next.directory,result:next.result,api,request,sourceDirectory:join(batch,item.sourceId),backupDirectory:join(out,'previous-states'),revision:ACCOMPANIMENT_REVISION,renameSong:true});
  if(settled.phase!=='complete')throw Error('Reviewed edition encountered a new conflict; retained all conflict details');
  const repaired=await repairEditionAnnotations({sourceDirectory:join(batch,item.sourceId),profileId:item.profileId,directory:next.directory,api,datasetId:plan.datasetId});if(repaired.preserved.length)throw Error('Reviewed edition still has preserved pages');
  const key=item.sourceId+':'+item.profileId;report.completed=report.completed.filter(p=>p.key!==key);report.completed.push({annotationRevision:ANNOTATION_REVISION,key,phase:item.phase,style:item.profile.pluckNotation,songId:settled.songId,pages:settled.newPages.length,rendererSha256:next.result.rendererSha256});
  report.preservedEditions=(report.preservedEditions||[]).filter(p=>p.key!==key);await atomic(reportPath,report);
  // Verify every page in all four affected editions against stored image and annotation hashes.
  const affected=[...new Map([...review.pages,{sourceId:item.sourceId,profileId:item.profileId}].map(t=>[t.sourceId+':'+t.profileId,t])).values()];let verified=0;
  for(const t of affected){const state=await read(sourceStatePath(t.sourceId)),profile=state.profiles.find(p=>p.id===t.profileId),listed=await api('/api/v2/songs/'+profile.songId+'/pages');if(canonical(listed.map(p=>p.id).sort())!==canonical(profile.pages.map(p=>p.pageId).sort()))throw Error('Affected edition page set differs');
   for(const p of profile.pages){const value=await api('/api/v2/pages/'+p.pageId);if(value.image.datasetId!==plan.datasetId||value.image.checksum!==p.sha256||value.image.version!==p.version||value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed')||annotationHash(value)!==p.annotationSha256)throw Error('Affected edition readback differs');validateReviewedGeometry(value);verified++;}
   log({event:'reviewed-edition-verified',sourceId:t.sourceId,profile:t.profileId,pages:profile.pages.length});
  }
  if(report.completed.length!==manifest.queue.length||report.preservedEditions.length||report.preservedPages.length)throw Error('Corpus still has unresolved work');
  report.status='complete';report.current=null;delete report.failure;report.consecutiveReviewServicePauses=0;report.updatedAt=new Date().toISOString();report.reviewResolution={reviewId:review.reviewId,status:'complete',verifiedPages:verified,at:report.updatedAt};await atomic(reportPath,report);
  log({event:'review-resolution-complete',editions:report.completed.length,pages:report.completed.reduce((n,p)=>n+p.pages,0),preservedEditions:0,preservedPages:0,verifiedPages:verified});
 }
}catch(error){if(apply){const disposition=serviceFailureDisposition(error,report.consecutiveReviewServicePauses||0);report.consecutiveReviewServicePauses=disposition.consecutiveServicePauses;report.status=disposition.status;report.failure={message:error.message,code:error.code,pageId:error.pageId,fields:error.fields,status:error.status,path:error.apiPath,at:new Date().toISOString()};await atomic(reportPath,report);log({event:'review-resolution-paused-or-blocked',status:report.status,...report.failure});if(report.status!=='paused')throw error;}else throw error;}
finally{await browser?.close();}
