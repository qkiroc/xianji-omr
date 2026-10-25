import {readParts,openFiles} from './cloud-crypto.mjs';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {saveCredential} from '../cli/src/credentials.mjs';
const run=promisify(execFile),prefix='.artifacts/synthetic-renderer/audition-195-batch/',key=process.env.OMR_ASSET_KEY;
async function archive(dir){const files=openFiles(await readParts(dir),key);return new Map(files.map(f=>[f.path,f.bytes]));}
const current=await archive(process.argv[2]),previous=await archive(process.argv[3]);const read=(map,path)=>{const bytes=map.get(prefix+path);return bytes?JSON.parse(bytes.toString('utf8')):null;};
const plan=read(current,'plan.json'),report=read(current,'accompaniment-revision-v3/progress.json'),manifest=read(current,'accompaniment-revision-v3/plan.json');
const latest='ink-melody-barlines-written-key-v2',pending=manifest.queue.filter(q=>{const done=report.completed.find(c=>c.key===q.sourceId+':'+q.profileId);return done&&done.annotationRevision!==latest;});
console.log(JSON.stringify({event:'checkpoint-summary',completedEditions:report.completed.length,repairedEditions:report.completed.filter(c=>c.annotationRevision===latest).length,failure:report.failure,nextPending:pending.slice(0,4).map(q=>({sourceId:q.sourceId,title:q.title,profile:q.profileId}))}));
process.env.XDG_CONFIG_HOME=resolve('.artifacts/diagnostic-cli-config');await saveCredential(plan.origin,{token:process.env.OMR_CLI_TOKEN,allowInsecureHttp:true});
async function getPage(id){const r=await run(process.execPath,['tools/cli/xianji-omr.mjs','pages','get',id,'--origin',plan.origin],{env:process.env,maxBuffer:16*1024*1024,timeout:120000});return JSON.parse(r.stdout);}
const targets=[...manifest.queue.filter(q=>q.title==='Letting Go'&&q.profileId==='synth195-03'),...pending.slice(0,3)];
for(const item of targets){const state=read(current,item.sourceId+'/state.json'),profile=state.profiles.find(p=>p.id===item.profileId),old=read(previous,item.sourceId+'/state.json')?.profiles.find(p=>p.id===item.profileId);console.log(JSON.stringify({event:'diagnosing-edition',title:item.title,profile:item.profileId,checkpointAnnotationRevision:profile.annotationRevision,priorAnnotationRevision:old?.annotationRevision,pages:profile.pages.length}));
 for(const page of profile.pages){const value=await getPage(page.pageId),expected={datasetId:plan.datasetId,checksum:page.sha256,version:page.version,status:'confirmed',boxCount:page.boxCount,unconfirmedBoxes:0},actual={datasetId:value.image.datasetId,checksum:value.image.checksum,version:value.image.version,status:value.image.status,boxCount:value.boxes.length,unconfirmedBoxes:value.boxes.filter(b=>b.reviewStatus!=='confirmed').length};const changed=Object.keys(expected).filter(k=>expected[k]!==actual[k]);
  console.log(JSON.stringify({event:'page-comparison',title:item.title,profile:item.profileId,pageIndex:page.pageIndex,pageId:page.pageId,changed,expected,actual,source:value.image.source,updatedAt:value.image.updatedAt,annotationRepairIntent:!!page.annotationRepairIntent,pageAnnotationRevision:page.annotationRevision,priorVersion:old?.pages.find(p=>p.pageId===page.pageId)?.version,deletedBoxes:value.deletedBoxes?.length||0}));
 }
}
