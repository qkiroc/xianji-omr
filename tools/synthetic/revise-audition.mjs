import {hasReviewedRemoval} from './reviewed-pages.mjs';
import {editionConflict,isEditionConflict,replacementIsTerminal} from './edition-conflicts.mjs';
import {annotationHash} from './reconcile-completed.mjs';
import {resilientRequest} from './resilient-request.mjs';
import {readFile,writeFile,mkdir,rename,cp} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {installRenderer} from './install-renderer.mjs';
import {LAYOUT_REVISION,stylesForScore,renderDocument,paginateScore,mergeLyricRegions} from './page-style.mjs';
import {regions} from '../../server/src/annotation.ts';
import {readCredential} from '../cli/src/credentials.mjs';
import {client,limitedJSON,jsonBody} from '../cli/src/http.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),flag=name=>args.includes(name),option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const root=resolve(option('--root',join(workspace,'.artifacts/synthetic-renderer'))),batch=join(root,'audition-195-batch'),revisionDir=join(batch,'layout-revision-v2');
const readJSON=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
const atomic=async(path,value)=>{await mkdir(dirname(path),{recursive:true});const temp=path+'.part';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,path);};
const canon=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=b=>createHash('sha256').update(b).digest('hex');
const log=v=>console.log(JSON.stringify(v));
async function prepare(plan){
 const summary={revision:LAYOUT_REVISION,datasetId:plan.datasetId,sourceSongs:plan.jobs.length,editions:0,previouslyCompleteSongs:0,previouslyConfirmedPages:0,existingMultiVerseSystems:0,changedLyricBoxes:0,jobs:[]};
 for(const job of plan.jobs){
  const dir=join(batch,job.id),state=await readJSON(join(dir,'state.json'),{profiles:[]}),profiles=await readJSON(join(dir,'profiles.json'));
  if(!profiles)throw Error('Source profiles missing: '+job.id);
  if(state.status==='complete')summary.previouslyCompleteSongs++;
  for(const profile of profiles){
   const previous=state.profiles.find(p=>p.id===profile.id),pages=await readJSON(join(dir,profile.id,'annotations.json'),[]);
   summary.editions++;summary.previouslyConfirmedPages+=(previous?.pages||[]).filter(p=>p.status==='confirmed').length;
   for(const p of pages){const merged=mergeLyricRegions(p.annotation.boxes),before=p.annotation.boxes.filter(b=>b.classKey==='lyrics').length,after=merged.filter(b=>b.classKey==='lyrics').length;summary.changedLyricBoxes+=before-after;summary.existingMultiVerseSystems+=new Set(p.annotation.boxes.filter(b=>b.classKey==='lyrics'&&p.annotation.boxes.filter(c=>c.classKey==='lyrics'&&c.parentSystemId===b.parentSystemId).length>1).map(b=>b.parentSystemId)).size;regions(merged,p.width,p.height,{confirm:true,pageType:'music',taxonomyVersion:'layout-v2'});}
   const styled=stylesForScore(profile,await readJSON(join(dir,'source-schema2.json')),1)[0];
   summary.jobs.push({sourceId:job.id,title:job.title,profileId:profile.id,seed:profile.seed,songGroupKey:job.songGroupKey,split:job.split,songId:previous?.songId||null,oldPages:previous?.pages?.length||0,header:styled.header.layout,footer:styled.footer.layout,watermark:styled.watermark.kind,margins:styled.margins});
  }
 }
 const hist=(key)=>Object.fromEntries([...new Set(summary.jobs.map(j=>j[key]))].map(k=>[k,summary.jobs.filter(j=>j[key]===k).length]));
 summary.styles={headers:hist('header'),footers:hist('footer'),watermarks:hist('watermark')};summary.updatedAt=new Date().toISOString();
 await atomic(join(revisionDir,'plan.json'),summary);log({...summary,jobs:undefined});return summary;
}
async function previews(plan){
 const job=plan.jobs.find(j=>j.id===option('--song',plan.jobs[0].id));if(!job)throw Error('Unknown source song');
 const source=await readJSON(join(batch,job.id,'source-schema2.json')),score=await readJSON(join(batch,job.id,'converted-score.json')),profiles=await readJSON(join(batch,job.id,'profiles.json'));
 const out=join(revisionDir,'previews');await mkdir(out,{recursive:true});const require=createRequire(pathToFileURL(join(root,'preview-entry.mjs'))),bundle=join(root,'batch-ssr.cjs');const links=[];
 for(let i=0;i<9;i++){
  let seed=1;while(stylesForScore({...profiles[0],seed},source,1)[0].footer.layout!==['none','folio','rule','columns','banner','split','vertical','sticker','ticket'][i])seed++;
  const profile={...profiles[0],seed},symbolic=structuredClone(score);
  for(const change of profile.performancePlan||[]){const {bar,event,...flags}=change;symbolic.bars[bar].beats[event].synth={...symbolic.bars[bar].beats[event].synth,...flags};}
  globalThis.__SYNTH_STYLE__=profile;globalThis.__SYNTH_SCORE__=symbolic;delete require.cache[bundle];const fragment=require(bundle),payload={profile,styles:stylesForScore(profile,source,score.bars.length+1)};
  const html=renderDocument(fragment,profile)+`<script>document.fonts.ready.then(()=>{try{(${paginateScore.toString()})(${JSON.stringify(payload).replaceAll('<','\\u003c')});document.body.dataset.layoutReady='true';}catch(error){document.body.dataset.layoutError=error.message;const p=document.createElement('pre');p.textContent=error.stack;document.body.append(p);}});</script>`;
  const file='style-'+String(i+1).padStart(2,'0')+'.html';await writeFile(join(out,file),html);links.push(`<li><a href="${file}">${i+1} · ${payload.styles[0].footer.layout} / ${payload.styles[0].header.layout}</a></li>`);
 }
 await writeFile(join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>谱面随机排版预览</title><h1>'+job.title+' · 随机排版</h1><ul>'+links.join('')+'</ul>');log({event:'previews-prepared',directory:out,count:links.length,visualVerification:'pending'});
}
async function connect(plan){
 process.env.XDG_CONFIG_HOME=join(root,'../cli-config');const credential=await readCredential(plan.origin);if(!credential)throw Error('CLI authorization missing');
 const request=resilientRequest(client(plan.origin,credential.token));
 const api=async(path,value,method='POST')=>limitedJSON(await request(path,value===undefined?{}:jsonBody(value,method)));
 await api('/api/v2/datasets/'+plan.datasetId+'/songs');return{api,request};
}
export async function uploadEdition(options){
 try{return await replaceEdition(options);}catch(error){
  if(!isEditionConflict(error))throw error;
  const file=join(options.directory,'replacement-state.json'),state=await readJSON(file);
  if(!state)throw error;
  state.conflict={reason:error.message,code:error.code||'REMOTE_CONFLICT',status:error.status,path:error.apiPath,failedPhase:state.phase,details:error.details||{},oldPageIds:state.oldPages.map(p=>p.pageId),newPageIds:state.newPages.map(p=>p.pageId),at:new Date().toISOString()};
  state.phase='preserved';await atomic(file,state);return state;
 }
}
async function replaceEdition({plan,job,profile,directory,result,api:remoteApi,request,revision=LAYOUT_REVISION,renameSong=false,sourceDirectory=join(batch,job.id),backupDirectory=join(revisionDir,'previous-states')}){
 const api=async(path,...args)=>{try{return await remoteApi(path,...args);}catch(error){error.apiPath??=path;throw error;}};
 const stateFile=join(directory,'replacement-state.json'),oldState=await readJSON(join(sourceDirectory,'state.json'),{profiles:[]}),oldProfile=oldState.profiles.find(p=>p.id===profile.id);
 const state=await readJSON(stateFile,{revision:revision,rendererSha256:result.rendererSha256,sourceId:job.id,profileId:profile.id,songId:oldProfile?.songId,oldPages:oldProfile?.pages||[],newPages:[],phase:'upload'}),save=()=>atomic(stateFile,state);
 if(replacementIsTerminal(state))return state;
 if(state.revision!==revision||state.rendererSha256&&result.rendererSha256&&state.rendererSha256!==result.rendererSha256)throw Error('Rendered revision changed after replacement started');
 await save();
 const local=await readJSON(join(directory,'annotations.json'));if(!local||result.layoutRevision!==revision)throw Error('Current revision has not been rendered');
 if(!state.songId){const name='合成 · '+job.title+' · '+sha(job.id).slice(0,8)+'-'+profile.id.slice(-2)+' · '+profile.name;const songs=await api('/api/v2/datasets/'+plan.datasetId+'/songs');const song=songs.find(s=>s.name===name)||await api('/api/v2/datasets/'+plan.datasetId+'/songs',{name,songGroupKey:job.songGroupKey,split:job.split});state.songId=song.id;await save();}
 const songs=await api('/api/v2/datasets/'+plan.datasetId+'/songs'),song=songs.find(s=>s.id===state.songId);if(!song||song.song_group_key!==job.songGroupKey||song.split!==job.split)throw editionConflict('Song group or split changed; refusing replacement',{songId:state.songId,expected:{songGroupKey:job.songGroupKey,split:job.split},actual:song||null});
 let remote=await api('/api/v2/songs/'+state.songId+'/pages');
 const recoverOriginalTailPages=async()=>{
  const listed=await api('/api/v2/songs/'+state.songId+'/pages'),tracked=new Set([...state.oldPages,...state.newPages].map(p=>p.pageId));
  const extras=listed.filter(p=>!tracked.has(p.id));remote=listed;
  if(extras.length){
   const catalog=await readJSON(new URL('./original-page-checksums.json',import.meta.url),{}),known=catalog[job.id+':'+profile.id]||[];
   const recovered=[];
   for(const extra of extras){const value=await api('/api/v2/pages/'+extra.id),image=value.image;
    const rendered=local.find(p=>p.filename===extra.name&&p.sha256===image.checksum&&p.width===image.width&&p.height===image.height);
    if(rendered&&image.datasetId===plan.datasetId&&((image.version===1&&image.status==='draft'&&!image.source&&!value.boxes.length)||(image.source==='synthetic:'+plan.revision+':'+job.id+':'+profile.id+':'+revision&&annotationHash(value)===annotationHash(rendered.annotation)))){
     state.newPages.push({pageIndex:rendered.pageIndex,pageId:extra.id,sha256:rendered.sha256,filename:rendered.filename,status:'uploaded'});await save();continue;
    }

    const expected=known.find(p=>p.filename===extra.name&&p.sha256===image.checksum);
    const untouched=image.version===1&&image.status==='draft'&&!image.source&&value.boxes.length===0;
    const synthetic=image.version===3&&image.status==='confirmed'&&value.boxes.every(b=>b.reviewStatus==='confirmed')&&image.source?.startsWith('synthetic:'+plan.revision+':'+job.id+':'+profile.id);
    if(!expected||image.datasetId!==plan.datasetId||(!untouched&&!synthetic))throw editionConflict('Unexpected page in song; preserving it',{pageId:extra.id,name:extra.name,version:image.version,status:image.status,checksum:image.checksum});
    recovered.push({pageId:extra.id,sha256:image.checksum,filename:extra.name,status:untouched?'uploaded':'confirmed',...(untouched?{}:{version:image.version})});
   }
   state.oldPages.push(...recovered);if(recovered.length&&state.phase==='reorder')state.phase='cleanup';await save();if(recovered.length)log({event:'recovered-original-tail-pages',sourceId:job.id,profile:profile.id,pages:recovered.length});
  }
 };
 if(state.phase==='upload')await recoverOriginalTailPages();
 const validateOldPage=async old=>{
  const value=await api('/api/v2/pages/'+old.pageId),image=value.image;
  const pristine=old.status==='uploaded'&&old.version===undefined&&image.version===1&&image.status==='draft'&&!value.boxes.length&&!image.source;
  const synthetic=image.version===old.version&&(image.status==='confirmed'&&value.boxes.every(b=>b.reviewStatus==='confirmed')||hasReviewedRemoval(old,value))&&image.source?.startsWith('synthetic:'+plan.revision+':'+job.id+':'+profile.id)&&(!old.annotationSha256||old.annotationSha256===annotationHash(value));
  if(image.datasetId!==plan.datasetId||image.checksum!==old.sha256||(!pristine&&!synthetic))throw editionConflict('Previously imported page was changed; preserving it',{pageId:old.pageId,expected:old,actual:image,actualBoxCount:value.boxes.length});
 };
 if(state.phase==='upload')for(const old of state.oldPages)await validateOldPage(old);

 if(state.phase==='upload')for(const page of local){
  const bytes=await readFile(join(directory,page.filename));if(sha(bytes)!==page.sha256)throw Error('Rendered PNG changed');
  let entry=state.newPages.find(p=>p.pageIndex===page.pageIndex),value;
  const identical=remote.find(p=>p.name===page.filename&&p.checksum===page.sha256);
  if(entry||identical)value=await api('/api/v2/pages/'+(entry?.pageId||identical.id));
  else value=await limitedJSON(await request('/api/v2/songs/'+state.songId+'/pages',{method:'POST',headers:{'Content-Type':'image/png','X-File-Name':encodeURIComponent(page.filename)},body:bytes}));
  if(value.image.checksum!==page.sha256||value.image.width!==page.width||value.image.height!==page.height)throw editionConflict('Replacement image differs',{pageId:value.image.id,expected:{checksum:page.sha256,width:page.width,height:page.height},actual:value.image});
  if(!entry){entry={pageIndex:page.pageIndex,pageId:value.image.id,sha256:page.sha256,filename:page.filename,status:'uploaded'};state.newPages.push(entry);await save();}
  const desiredSource='synthetic:'+plan.revision+':'+job.id+':'+profile.id+':'+revision;
  const desiredBoxes=canon(value.boxes.map(b=>({...b,reviewStatus:'draft'})))===canon(page.annotation.boxes);
  const pristine=value.image.version===1&&value.image.status==='draft'&&!value.image.source&&value.boxes.length===0;
  if(value.image.status!=='confirmed'&&!pristine&&!(desiredBoxes&&value.image.source===desiredSource))throw editionConflict('Replacement draft was changed; preserving it',{pageId:entry.pageId,actual:value.image,actualBoxCount:value.boxes.length});
  if(value.image.status!=='confirmed'){

   value=await api('/api/v2/pages/'+entry.pageId,{...page.annotation,version:value.image.version,source:'synthetic:'+plan.revision+':'+job.id+':'+profile.id+':'+revision},'PUT');
   if(canon(value.boxes)!==canon(page.annotation.boxes))throw editionConflict('Saved annotation differs',{pageId:entry.pageId});
   value=await api('/api/v2/pages/'+entry.pageId+'/confirm',{version:value.image.version,acknowledged:true,reviewType:'human'});
  }
  const normalized=value.boxes.map(b=>({...b,reviewStatus:'draft'}));
  if(value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed')||canon(normalized)!==canon(page.annotation.boxes))throw editionConflict('Replacement confirmation or boxes differ',{pageId:entry.pageId,version:value.image.version,status:value.image.status});
  Object.assign(entry,{status:'confirmed',version:value.image.version,boxCount:value.boxes.length,annotationSha256:annotationHash(value)});await save();
 }
 if(state.phase==='upload'){if(state.newPages.length!==local.length)throw Error('Replacement page count differs');state.phase='cleanup';await save();}
 const validateNewPages=async()=>{for(const entry of state.newPages){
  const value=await api('/api/v2/pages/'+entry.pageId),localPage=local.find(p=>p.pageIndex===entry.pageIndex);
  if(!localPage||value.image.datasetId!==plan.datasetId||value.image.checksum!==entry.sha256||value.image.status!=='confirmed'||value.boxes.some(b=>b.reviewStatus!=='confirmed')||annotationHash(value)!==annotationHash(localPage.annotation))throw editionConflict('Replacement page changed before cleanup; preserving it',{pageId:entry.pageId,actual:value.image});
 }};
 if(state.phase==='cleanup'||state.phase==='reorder'){await validateNewPages();await recoverOriginalTailPages();}
 if(state.phase==='cleanup'){
  // Only pages tracked by the paused original import are eligible for cleanup.
  const obsolete=[];
  for(const old of state.oldPages.filter(p=>!state.newPages.some(n=>n.pageId===p.pageId))){
   try{await validateOldPage(old);}catch(e){if(e.status===404&&state.cleanupIntent?.includes(old.pageId))continue;throw e;}
   obsolete.push(old.pageId);
  }
  for(let i=0;i<obsolete.length;i+=100){const ids=obsolete.slice(i,i+100),preview=await api('/api/v2/deletions/preview',{kind:'page',ids});if(preview.summary.pages!==ids.length||['datasets','songs','localizationRecords','measures','events','snapshots'].some(k=>Number(preview.summary[k]||0)!==0))throw editionConflict('Cleanup would affect unrelated data',{summary:preview.summary,ids});await validateNewPages();for(const id of ids)await validateOldPage(state.oldPages.find(p=>p.pageId===id));state.cleanupIntent=[...new Set([...(state.cleanupIntent||[]),...ids])];await save();const deleted=await api('/api/v2/deletions/execute',{token:preview.token,acknowledged:true});if(!deleted.deleted)throw Error('Superseded page cleanup incomplete');}
  state.phase='reorder';await save();
 }
 if(state.phase==='reorder'){
  remote=await api('/api/v2/songs/'+state.songId+'/pages');if(remote.length!==state.newPages.length||remote.some(p=>!state.newPages.some(n=>n.pageId===p.id)))throw editionConflict('Unexpected page in song; preserving it',{songId:state.songId,expectedPageIds:state.newPages.map(p=>p.pageId),actualPageIds:remote.map(p=>p.id)});
  const ordered=await api('/api/v2/songs/'+state.songId+'/pages/reorder',{items:state.newPages.slice().sort((a,b)=>a.pageIndex-b.pageIndex).map(p=>({id:p.pageId,version:remote.find(r=>r.id===p.pageId).version}))});
  for(const p of state.newPages){const v=ordered.find(r=>r.id===p.pageId);if(!v||v.pageOrder!==p.pageIndex+1||v.status!=='confirmed')throw editionConflict('Page order or confirmation differs',{pageId:p.pageId,actual:v||null});p.version=v.version;}
  if(renameSong){const desired='合成 · '+job.title+' · '+sha(job.id).slice(0,8)+'-'+profile.id.slice(-2)+' · '+profile.name;const currentSongs=await api('/api/v2/datasets/'+plan.datasetId+'/songs'),currentSong=currentSongs.find(s=>s.id===state.songId);if(!currentSong||currentSong.song_group_key!==job.songGroupKey||currentSong.split!==job.split)throw editionConflict('Song group or split changed; refusing metadata update',{songId:state.songId,actual:currentSong||null});if(currentSong.name!==song.name&&currentSong.name!==desired)throw editionConflict('Song name changed during replacement; preserving it',{songId:state.songId,expected:song.name,actual:currentSong.name});if(currentSong.name!==desired){const saved=await api('/api/v2/songs/'+state.songId,{version:currentSong.version,name:desired,songGroupKey:job.songGroupKey,split:job.split},'PUT');if(saved.song_group_key!==job.songGroupKey||saved.split!==job.split||saved.name!==desired)throw editionConflict('Edition metadata differs after rename',{songId:state.songId,actual:saved});}}
  await atomic(join(backupDirectory,job.id+'-'+profile.id+'.json'),oldProfile||{});
  // Preserve the original plan's group and split, and make its checkpoint current.
  const current=await readJSON(join(sourceDirectory,'state.json'),{sourceId:job.id,title:job.title,songGroupKey:job.songGroupKey,split:job.split,profiles:[]});
  let p=current.profiles.find(p=>p.id===profile.id);if(!p){p={id:profile.id,name:profile.name};current.profiles.push(p);}
  await cp(directory,join(sourceDirectory,profile.id),{recursive:true,force:true});
  Object.assign(p,{name:profile.name,songId:state.songId,pages:state.newPages,rendered:true,status:'complete',layoutRevision:revision});
  if(current.profiles.length===3&&current.profiles.every(p=>p.layoutRevision===revision&&p.status==='complete'))current.status='complete';else current.status='revision-in-progress';
  await atomic(join(sourceDirectory,'state.json'),current);state.phase='complete';state.completedAt=new Date().toISOString();await save();
 }
 return state;
}
async function main(){
 if(!flag('--legacy-layout')){const {runAccompaniment}=await import('./run-accompaniment.mjs');return runAccompaniment(args);}
 if(flag('--help')||!args.length){console.log('node tools/synthetic/revise-audition.mjs --prepare | --previews | --render | --upload | --run [--limit N] [--song SOURCE_ID] [--root PATH]\nPrepare/previews are local. Run renders, uploads and replaces the paused import while preserving groups/splits.');return;}
 await mkdir(revisionDir,{recursive:true});const plan=await readJSON(join(batch,'plan.json'));if(!plan)throw Error('Original import plan missing');
 const installed=await installRenderer(root);
 if(flag('--prepare'))await prepare(plan);
 if(flag('--previews'))await previews(plan);
 const render=flag('--render')||flag('--run'),upload=flag('--upload')||flag('--run');if(!render&&!upload)return;
 let connection,browser,renderer;
 if(upload)connection=await connect(plan);
 if(render){const {chromium}=await import(pathToFileURL(join(root,'node_modules/playwright-core/index.mjs')));browser=await chromium.launch({executablePath:option('--browser','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'),headless:true});renderer=await import(pathToFileURL(installed.path));}
 const reportFile=join(revisionDir,'progress.json'),report=await readJSON(reportFile,{revision:LAYOUT_REVISION,completed:[],failed:[]});let done=0;const limit=Number(option('--limit',Infinity));
 try{for(const job of plan.jobs){if(option('--song')&&job.id!==option('--song'))continue;const dir=join(batch,job.id),source=await readJSON(join(dir,'source-schema2.json')),score=await readJSON(join(dir,'converted-score.json')),profiles=await readJSON(join(dir,'profiles.json'));
  for(const profile of profiles){const key=job.id+':'+profile.id,directory=join(revisionDir,job.id,profile.id);if(report.preservedEditions?.some(p=>p.key===key)||upload&&report.completed.some(p=>p.key===key))continue;if(done>=limit)return;
   const renderedFile=join(directory,'render-result.json');let result=await readJSON(renderedFile);
   if(render&&(!result||result.layoutRevision!==LAYOUT_REVISION||result.rendererSha256!==installed.sha256)){await mkdir(directory,{recursive:true});result=await renderer.renderBatchProfile({source,score,profile,out:join(revisionDir,job.id),browser});result.rendererSha256=installed.sha256;await atomic(renderedFile,result);}
   if(upload){if(!result||result.rendererSha256!==installed.sha256)throw Error('Current renderer revision not rendered: '+key);const state=await uploadEdition({plan,job,profile,directory,result,...connection});if(state.phase==='preserved'){report.preservedEditions=[...(report.preservedEditions||[]).filter(p=>p.key!==key),{key,...state.conflict}];await atomic(reportFile,report);log({event:'edition-preserved',key,...state.conflict});continue;}report.completed=report.completed.filter(p=>p.key!==key);report.completed.push({key,songId:state.songId,pages:state.newPages.length});}
   done++;report.updatedAt=new Date().toISOString();report.current={id:job.id,title:job.title,profile:profile.id};await atomic(reportFile,report);log({event:upload?'replaced':'rendered',title:job.title,profile:profile.id,pages:result.pageCount,completedEditions:report.completed.length});
  }
 }report.status=report.preservedEditions?.length?'complete-with-preserved-editions':'complete';report.current=null;await atomic(reportFile,report);
 }finally{await browser?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({error:error.message,status:error.status}));process.exitCode=1;});

