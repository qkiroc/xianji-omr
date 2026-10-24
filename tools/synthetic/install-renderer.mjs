import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {LAYOUT_REVISION} from './page-style.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function installRenderer(root=join(workspace,'.artifacts/synthetic-renderer')){
 const original=await readFile(join(root,'batch-render-profile.mjs'),'utf8');
 const start=original.indexOf('  const contentWidth='),end=original.indexOf('  const geometry=await page.evaluate(',start);
 if(start<0||end<start)throw Error('Verified base renderer stage missing');
 const stage=`  const page=await browser.newPage({viewport:{width:Math.max(1400,profile.pageWidth+40),height:profile.pageHeight+40},deviceScaleFactor:1});\n  await page.setContent(renderDocument(fragment,profile),{waitUntil:'load'});\n  await page.evaluate(()=>document.fonts.ready);\n  const rendered=await page.evaluate(paginateScore,{profile,styles:stylesForScore(profile,source,score.bars.length+1)});\n  await page.evaluate(()=>document.fonts.ready);\n`;
 let text="import {renderDocument,stylesForScore,paginateScore,mergeLyricRegions} from '../../tools/synthetic/page-style.mjs';\n"+original.slice(0,start)+stage+original.slice(end);
 const validation='    regions(p.annotation.boxes,p.width,p.height,';
 if(!text.includes(validation))throw Error('Verified geometry validator missing');
 text=text.replace(validation,'    p.annotation.boxes=mergeLyricRegions(p.annotation.boxes);\n'+validation);
 text=text.replace('watermarks:rendered.watermarks,pages:','watermarks:rendered.watermarks,layoutRevision:'+JSON.stringify(LAYOUT_REVISION)+',pageStyles:rendered.pageStyles,pages:');
 text=text.replace("container.querySelectorAll('.watermark,.graphic-watermark').length","container.querySelectorAll('.page-decoration text,.page-decoration g').length");
 const path=join(root,'batch-render-randomized.mjs');await writeFile(path,text);
 const batch=join(root,'audition-195-batch');await mkdir(batch,{recursive:true});
 await writeFile(join(batch,'PAUSE.json'),JSON.stringify({reason:'Regenerate existing and remaining pages using '+LAYOUT_REVISION,createdAt:new Date().toISOString()},null,2));
 const workerFile=join(root,'batch-worker.mjs');let worker=await readFile(workerFile,'utf8');
 if(!worker.includes('SYNTH_LAYOUT_PAUSE')){
  const guard="if(await readJSON(join(out,'PAUSE.json'),null))throw Error('SYNTH_LAYOUT_PAUSE: use tools/synthetic/revise-audition.mjs instead');";
  worker=worker.replace('const browser=await chromium.launch(',guard+'\nconst browser=await chromium.launch(');
  worker=worker.replace('   for(const profile of profiles){','   for(const profile of profiles){\n    '+guard);
  worker=worker.replace('    for(const local of pages){','    for(const local of pages){\n     '+guard);
  await writeFile(workerFile,worker);
 }
 return{path,revision:LAYOUT_REVISION,sha256:createHash('sha256').update(text).update(await readFile(new URL('./page-style.mjs',import.meta.url))).update(await readFile(join(root,'batch-ssr.cjs'))).digest('hex')};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await installRenderer(process.argv[2]?resolve(process.argv[2]):undefined)));

