import {annotationHash} from './reconcile-completed.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export const ANNOTATION_REVISION='ink-melody-barlines-written-key-v2';
const canon=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const draft=boxes=>boxes.map(b=>({...b,reviewStatus:'draft'}));
export async function repairEditionAnnotations({sourceDirectory,profileId,directory,api,datasetId}){
 const stateFile=join(sourceDirectory,'state.json'),state=JSON.parse(await readFile(stateFile,'utf8')),profile=state.profiles.find(p=>p.id===profileId);
 if(profile.annotationRevision===ANNOTATION_REVISION)return {preserved:profile.pages.filter(p=>p.preservedRemote).map(p=>p.preservedRemote)};
 const pages=JSON.parse(await readFile(join(directory,'annotations.json'),'utf8'));
 if(pages.length!==profile.pages.length)throw Error('Annotation repair page count differs');
 const save=async()=>{await writeFile(stateFile+'.part',JSON.stringify(state,null,2));await rename(stateFile+'.part',stateFile);};
 const preserve=async(entry,value,reason)=>{entry.preservedRemote={pageId:entry.pageId,page:entry.pageIndex+1,profile:profileId,reason,expectedVersion:entry.version,actualVersion:value?.image.version??null,actualStatus:value?.image.status??null,at:new Date().toISOString()};delete entry.annotationRepairIntent;await save();};
 for(const entry of profile.pages){
  if(entry.preservedRemote||entry.annotationRevision===ANNOTATION_REVISION)continue;
  const local=pages.find(p=>p.pageIndex===entry.pageIndex);if(!local||local.sha256!==entry.sha256)throw Error('Annotation repair would change original pixels');
  const desired=local.annotation,hash=createHash('sha256').update(canon(desired)).digest('hex');
  let value;try{value=await api('/api/v2/pages/'+entry.pageId);}catch(error){if(error.status!==404)throw error;await preserve(entry,null,'page-missing-during-annotation-repair');continue;}
  if(value.image.datasetId!==datasetId||value.image.checksum!==entry.sha256){await preserve(entry,value,'image-or-dataset-changed');continue;}
  try{
  if(entry.annotationRepairIntent&&entry.annotationRepairIntent!==hash){
   const oldHash=createHash('sha256').update(canon({...desired,boxes:draft(value.boxes)})).digest('hex');
   if(oldHash!==entry.annotationRepairIntent){await preserve(entry,value,'annotation-repair-intent-diverged');continue;}
   if(value.image.status!=='confirmed')value=await api('/api/v2/pages/'+entry.pageId+'/confirm',{version:value.image.version,acknowledged:true,reviewType:'human'});
   const confirmedHash=createHash('sha256').update(canon({...desired,boxes:draft(value.boxes)})).digest('hex');if(confirmedHash!==oldHash||value.image.status!=='confirmed'){await preserve(entry,value,'prior-annotation-recovery-changed');continue;}
   Object.assign(entry,{version:value.image.version,boxCount:value.boxes.length});delete entry.annotationRepairIntent;await save();
  }
  const matches=()=>canon(draft(value.boxes))===canon(desired.boxes);
  const pristine=value.image.version===entry.version&&value.image.status==='confirmed'&&value.boxes.every(b=>b.reviewStatus==='confirmed');
  if(!pristine&&!(entry.annotationRepairIntent&&matches())){await preserve(entry,value,'changed-during-annotation-repair');continue;}
  entry.annotationRepairIntent=hash;await save();
  if(!matches())value=await api('/api/v2/pages/'+entry.pageId,{...desired,version:value.image.version,source:value.image.source},'PUT');
  if(value.image.status!=='confirmed')value=await api('/api/v2/pages/'+entry.pageId+'/confirm',{version:value.image.version,acknowledged:true,reviewType:'human'});
  if(!matches()||value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed')){await preserve(entry,value,'annotation-changed-during-confirmation');continue;}
  Object.assign(entry,{version:value.image.version,boxCount:value.boxes.length,annotationSha256:annotationHash(value),annotationRevision:ANNOTATION_REVISION});delete entry.annotationRepairIntent;await save();
  }catch(error){if(![404,409].includes(error.status))throw error;let current=null;try{current=await api('/api/v2/pages/'+entry.pageId);}catch(readError){if(readError.status!==404)throw readError;}await preserve(entry,current,current?'version-conflict-during-annotation-repair':'page-missing-during-annotation-repair');}
 }
 profile.annotationRevision=ANNOTATION_REVISION;profile.annotationRepairStatus=profile.pages.some(p=>p.preservedRemote)?'partial':'complete';await save();return {preserved:profile.pages.filter(p=>p.preservedRemote).map(p=>p.preservedRemote)};
}
