import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function annotationHash(value){const annotation=value.annotation||value;return createHash('sha256').update(canonical({annotationFormat:annotation.annotationFormat||value.image?.annotationFormat,pageType:annotation.pageType||value.image?.pageType,boxes:annotation.boxes.map(b=>({...b,reviewStatus:'draft'})).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');}
export async function reconcileCompletedEdition({sourceDirectory,item,datasetId,api,baselineAnnotations,revision,log=()=>{}}){
 const path=join(sourceDirectory,'state.json'),state=JSON.parse(await readFile(path,'utf8')),profile=state.profiles.find(p=>p.id===item.profileId);if(!profile?.pages?.length||profile.layoutRevision!==revision)throw Error('Completed edition checkpoint is missing: '+item.sourceId+':'+item.profileId);
 const save=async()=>{await writeFile(path+'.part',JSON.stringify(state,null,2));await rename(path+'.part',path);};let baseline;
 const preserved=[];
 for(const page of profile.pages){
  if(page.annotationRepairIntent)continue;
  let value;try{value=await api('/api/v2/pages/'+page.pageId);}catch(e){if(e.status!==404)throw e;value=null;}
  const expected={datasetId,checksum:page.sha256,version:page.version,status:'confirmed',boxCount:page.boxCount},actual=value?{datasetId:value.image.datasetId,checksum:value.image.checksum,version:value.image.version,status:value.image.status,boxCount:value.boxes.length}:null;
  const identity=value&&actual.datasetId===datasetId&&actual.checksum===page.sha256,confirmed=value&&actual.status==='confirmed'&&value.boxes.every(b=>b.reviewStatus==='confirmed');
  const sameVersion=identity&&confirmed&&actual.version===page.version&&actual.boxCount===page.boxCount,actualHash=value?annotationHash(value):null;
  if(!page.preservedRemote&&sameVersion&&(!page.annotationSha256||page.annotationSha256===actualHash)){page.annotationSha256=actualHash;continue;}
  let expectedHash=page.annotationSha256;
  if(!page.preservedRemote&&identity&&confirmed&&!expectedHash&&!page.annotationRevision&&baselineAnnotations){baseline??=await baselineAnnotations();const old=baseline.find(p=>p.pageIndex===page.pageIndex&&p.sha256===page.sha256);if(old)expectedHash=annotationHash(old.annotation);}
  if(!page.preservedRemote&&identity&&confirmed&&expectedHash===actualHash){const previousVersion=page.version;Object.assign(page,{version:actual.version,boxCount:actual.boxCount,annotationSha256:actualHash});await save();log({event:'checkpoint-version-synchronized',title:item.title,profile:item.profileId,pageId:page.pageId,page:page.pageIndex+1,previousVersion,version:page.version});continue;}
  const record={pageId:page.pageId,page:page.pageIndex+1,title:item.title,profile:item.profileId,reason:page.preservedRemote?.reason||(!identity?'image-or-dataset-changed':!confirmed?'review-state-changed':!expectedHash?'baseline-unavailable':'annotation-content-changed'),expected,actual,expectedAnnotationHash:expectedHash||null,actualAnnotationHash:actualHash,at:new Date().toISOString()};
  page.preservedRemote=record;profile.annotationRepairStatus='partial';preserved.push(record);await save();log({event:'page-preserved',...record});
 }
 await save();return{preserved};
}
