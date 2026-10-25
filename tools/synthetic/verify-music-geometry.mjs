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
}console.log(JSON.stringify({event:'geometry-verification-complete',editions,pages}));}finally{await browser.close();}
