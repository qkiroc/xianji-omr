import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const ANNOTATION_REVISION='tight-melody-written-key-v1';
const canon=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const draft=boxes=>boxes.map(b=>({...b,reviewStatus:'draft'}));
export async function repairEditionAnnotations({sourceDirectory,profileId,directory,api,datasetId}){
 const stateFile=join(sourceDirectory,'state.json'),state=JSON.parse(await readFile(stateFile,'utf8')),profile=state.profiles.find(p=>p.id===profileId);
 if(profile.annotationRevision===ANNOTATION_REVISION)return;
 const pages=JSON.parse(await readFile(join(directory,'annotations.json'),'utf8'));
 if(pages.length!==profile.pages.length)throw Error('Annotation repair page count differs');
 const save=async()=>{await writeFile(stateFile+'.part',JSON.stringify(state,null,2));await rename(stateFile+'.part',stateFile);};
 for(const entry of profile.pages){
  if(entry.annotationRevision===ANNOTATION_REVISION)continue;
  const local=pages.find(p=>p.pageIndex===entry.pageIndex);if(!local||local.sha256!==entry.sha256)throw Error('Annotation repair would change original pixels');
  const desired=local.annotation,hash=createHash('sha256').update(canon(desired)).digest('hex');
  if(entry.annotationRepairIntent&&entry.annotationRepairIntent!==hash)throw Error('Annotation repair changed during transaction');
  let value=await api('/api/v2/pages/'+entry.pageId);
  if(value.image.datasetId!==datasetId||value.image.checksum!==entry.sha256)throw Error('Annotation repair image differs');
  const matches=()=>canon(draft(value.boxes))===canon(desired.boxes);
  const pristine=value.image.version===entry.version&&value.image.status==='confirmed'&&value.boxes.every(b=>b.reviewStatus==='confirmed');
  if(!pristine&&!(entry.annotationRepairIntent&&matches()))throw Error('Page changed before annotation repair; preserving it');
  entry.annotationRepairIntent=hash;await save();
  if(!matches())value=await api('/api/v2/pages/'+entry.pageId,{...desired,version:value.image.version,source:value.image.source},'PUT');
  if(value.image.status!=='confirmed')value=await api('/api/v2/pages/'+entry.pageId+'/confirm',{version:value.image.version,acknowledged:true,reviewType:'human'});
  if(!matches()||value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed'))throw Error('Repaired annotation confirmation differs');
  Object.assign(entry,{version:value.image.version,boxCount:value.boxes.length,annotationRevision:ANNOTATION_REVISION});delete entry.annotationRepairIntent;await save();
 }
 profile.annotationRevision=ANNOTATION_REVISION;await save();
}
