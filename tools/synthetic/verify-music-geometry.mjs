import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installAccompanimentRenderer} from './install-accompaniment-renderer.mjs';
import {assignAccompanimentStyles,accompanimentProfile} from './accompaniment.mjs';
const root=resolve('.artifacts/synthetic-renderer'),batch=join(root,'audition-195-batch'),read=async p=>JSON.parse(await readFile(p,'utf8')),plan=await read(join(batch,'plan.json')),choices=assignAccompanimentStyles(plan.jobs),installed=await installAccompanimentRenderer(root),renderer=await import(pathToFileURL(installed.path)),{chromium}=await import(pathToFileURL(join(root,'node_modules/playwright-core/index.mjs')));
const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'}:{})}),out=join(root,'geometry-verification');await mkdir(out,{recursive:true});let editions=0,pages=0;
try{for(const index of [0,2,15,31,70,120]){const job=plan.jobs[index],source=await read(join(batch,job.id,'source-schema2.json')),score=await read(join(batch,job.id,'converted-score.json')),profiles=await read(join(batch,job.id,'profiles.json'));
 for(const base of profiles){const profile=accompanimentProfile(base,choices.get(job.id)[base.id]);await renderer.renderBatchProfile({source,score,profile,out:join(out,job.id),browser});const annotations=await read(join(out,job.id,profile.id,'annotations.json'));
  for(const page of annotations){const boxes=page.annotation.boxes;if(boxes.some(b=>b.classKey==='key_signature'&&b.metadata?.value?.kind==='original'))throw Error('Original key is annotated');for(const m of boxes.filter(b=>b.classKey==='melody'))for(const l of boxes.filter(b=>b.classKey==='lyrics'&&b.parentSystemId===m.parentSystemId)){if(Math.min(m.x+m.width,l.x+l.width)>Math.max(m.x,l.x)&&Math.min(m.y+m.height,l.y+l.height)>Math.max(m.y,l.y))throw Error('Melody and lyric padding still overlaps');}}
  editions++;pages+=annotations.length;console.log(JSON.stringify({event:'music-geometry-verified',title:job.title,profile:profile.id,style:profile.pluckNotation,pages:annotations.length}));
 }
}
 const historic=await installAccompanimentRenderer(root,{annotationGeometry:'initial'}),historicalRenderer=await import(pathToFileURL(historic.path)),job=plan.jobs.find(j=>j.id==='trial-xiao-xing-yun');
 if(job){const sourceDirectory=join(batch,job.id),state=await read(join(sourceDirectory,'state.json'));
  for(const id of ['synth195-02','synth195-03']){const saved=state.profiles.find(p=>p.id===id);if(!saved?.layoutRevision)continue;const base=(await read(join(sourceDirectory,'profiles.json'))).find(p=>p.id===id),profile=accompanimentProfile(base,choices.get(job.id)[id]);
   await historicalRenderer.renderBatchProfile({source:await read(join(sourceDirectory,'source-schema2.json')),score:await read(join(sourceDirectory,'converted-score.json')),profile,out:join(out,'historical',job.id),browser});
   const original=await read(join(out,'historical',job.id,id,'annotations.json'));for(const page of saved.pages){const baseline=original.find(p=>p.pageIndex===page.pageIndex);if(!baseline||baseline.sha256!==page.sha256)throw Error('Historical baseline pixels differ from frozen checkpoint');if(!page.annotationRevision&&baseline.annotation.boxes.length!==page.boxCount)throw Error('Historical annotation baseline box count differs');}
   console.log(JSON.stringify({event:'historical-baseline-verified',title:job.title,profile:id,pages:original.length}));
  }
 }
 console.log(JSON.stringify({event:'geometry-verification-complete',editions,pages}));}finally{await browser.close();}
