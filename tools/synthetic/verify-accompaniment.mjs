import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {applyAccompanimentNotation} from './accompaniment.mjs';
import {installAccompanimentRenderer} from './install-accompaniment-renderer.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),root=resolve(process.argv[2]||join(workspace,'.artifacts/synthetic-renderer')),batch=join(root,'audition-195-batch'),out=join(batch,'accompaniment-revision-v3');
const manifest=JSON.parse(await readFile(join(out,'plan.json'),'utf8')),installed=await installAccompanimentRenderer(root),require=createRequire(pathToFileURL(join(root,'verify-accompaniment-entry.mjs')));
const audit={revision:manifest.revision,rendererSha256:installed.sha256,editions:0,styles:{},renderedCrossPlucks:0,renderedDirectionOnlyStrums:0,sourceGuitarEvents:0,failed:[],startedAt:new Date().toISOString()};
let lastId,source,score;
for(const item of manifest.queue){
 if(item.sourceId!==lastId){source=JSON.parse(await readFile(join(batch,item.sourceId,'source-schema2.json'),'utf8'));score=JSON.parse(await readFile(join(batch,item.sourceId,'converted-score.json'),'utf8'));lastId=item.sourceId;}
 const profile=item.profile,performed=structuredClone(score);
 for(const change of profile.performancePlan||[]){const {bar,event,...flags}=change;performed.bars[bar].beats[event].synth={...performed.bars[bar].beats[event].synth,...flags};}
 const applied=applyAccompanimentNotation(performed,source,profile);globalThis.__SYNTH_STYLE__=profile;globalThis.__SYNTH_SCORE__=applied.score;
 const fragment=require(installed.bundle),cross=(fragment.match(/data-pluck-cross=/g)||[]).length,arrows=(fragment.match(/data-arrow-only="true"/g)||[]).length,events=(fragment.match(/data-synth-track="guitar"/g)||[]).length,expectedEvents=score.bars.reduce((n,b)=>n+b.beats.length,0);
 if(cross!==applied.coverage.crossPlucks||arrows!==applied.coverage.arrowStrums||events!==expectedEvents)audit.failed.push({sourceId:item.sourceId,profileId:profile.id,cross,expectedCross:applied.coverage.crossPlucks,arrows,expectedArrows:applied.coverage.arrowStrums,events,expectedEvents});
 audit.editions++;audit.styles[profile.pluckNotation]=(audit.styles[profile.pluckNotation]||0)+1;audit.renderedCrossPlucks+=cross;audit.renderedDirectionOnlyStrums+=arrows;audit.sourceGuitarEvents+=events;
 const module=require.cache[installed.bundle];if(module?.parent)module.parent.children=module.parent.children.filter(child=>child!==module);delete require.cache[installed.bundle];
 if(audit.editions%30===0){if(globalThis.gc)globalThis.gc();console.log(JSON.stringify({event:'verified',editions:audit.editions,failures:audit.failed.length}));}
}
audit.completedAt=new Date().toISOString();await writeFile(join(out,'glyph-audit.json'),JSON.stringify(audit,null,2));console.log(JSON.stringify(audit));if(audit.failed.length)process.exitCode=1;

