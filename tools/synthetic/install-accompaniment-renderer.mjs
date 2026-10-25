import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {installRenderer} from './install-renderer.mjs';
import {LAYOUT_REVISION} from './page-style.mjs';
import {ACCOMPANIMENT_REVISION} from './accompaniment.mjs';

export function crossNotationSource(original){
 let text=original;
 const first=' const labels=notes.map(',start=text.indexOf(first),end=text.indexOf('\n',start);
 if(start<0||end<0)throw Error('Notation label stage missing');
 const labels=text.slice(start,end).replace('const labels=','const allLabels=');
 text=text.slice(0,start)+" const arrowOnly=!!b.stroke&&style.strumHeadStyle==='arrows'&&!style.strumXs&&!b.synth?.mute&&!b.synth?.ghost&&!slash&&!(style.longNoteCircles&&b.duration<=2);\n"+labels+"\n const labels=allLabels.filter(({note}:any)=>!arrowOnly||note.synthKeepFret||note.synthDisplayFret||note.mode==='mute');"+text.slice(end);
 const connector='!slash&&notes.length>1&&';if(!text.includes(connector))throw Error('Pluck connector stage missing');text=text.replace(connector,'!slash&&!arrowOnly&&notes.length>1&&');
 text=text.replace('data-notation-family={style.notationFamily}',"data-notation-family={style.notationFamily} data-arrow-only={arrowOnly?'true':undefined} data-pluck-scheme={style.pluckNotation}");
 const marker='data-dead-note={text===\'x\'?\'true\':undefined}';if(!text.includes(marker))throw Error('Dead note marker missing');
 text=text.replace(marker,marker+" data-pluck-cross={!b.stroke&&text==='×'?note.string:undefined} data-pluck-numeric={!b.stroke&&/^[0-9()]+$/.test(text)?note.string:undefined}");
 text=text.replace('ax=nx-Math.min(12,slot*.4)','ax=arrowOnly?nx:nx-Math.min(12,slot*.4)');
 return text;
}
export async function buildAccompanimentBundle(root){
 const {build}=await import(pathToFileURL(join(root,'node_modules/esbuild/lib/main.js')));
 const entry=join(root,'accompaniment-entry.tsx'),bundle=join(root,'accompaniment-ssr.cjs');
 await writeFile(entry,"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import SongSheet from './reference-styled-source/app/song-sheet';import {validateScore} from './reference-styled-source/lib/score';const score=globalThis.__SYNTH_SCORE__;validateScore(score);module.exports=renderToStaticMarkup(<SongSheet score={score}/>);");
 await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',jsx:'automatic',define:{__SYNTH_STYLE__:'globalThis.__SYNTH_STYLE__'},alias:{'@/components/ui/button':join(root,'reference-styled-source/button-stub.tsx'),'lucide-react':join(root,'reference-styled-source/lucide-stub.tsx')},plugins:[{name:'cross-accompaniment',setup(build){build.onLoad({filter:/notation-eight\.tsx$/},async args=>({contents:crossNotationSource(await readFile(args.path,'utf8')),loader:'tsx',resolveDir:dirname(args.path)}));}}],outfile:bundle,logLevel:'silent'});
 return bundle;
}
export async function installAccompanimentRenderer(root,options={}){
 const legacy=await installRenderer(root,options),bundle=await buildAccompanimentBundle(root);
 let text=await readFile(legacy.path,'utf8');
 text="import {applyAccompanimentNotation} from '../../tools/synthetic/accompaniment.mjs';\n"+text;
 if(!text.includes("bundle=join(root,'batch-ssr.cjs')"))throw Error('Legacy bundle selector missing');
 text=text.replace("bundle=join(root,'batch-ssr.cjs')","bundle=join(root,'accompaniment-ssr.cjs')");
 const apply='const profileScore=performanceStyle(noteStyle(score,profile,source),profile);';if(!text.includes(apply))throw Error('Score appearance stage missing');
 text=text.replace(apply,'const accompaniment=applyAccompanimentNotation(performanceStyle(score,profile),source,profile);const profileScore=accompaniment.score;');
 text=text.replace('layoutRevision:'+JSON.stringify(LAYOUT_REVISION),'layoutRevision:'+JSON.stringify(ACCOMPANIMENT_REVISION)+',accompanimentCoverage:{...accompaniment.coverage,...pluckGlyphs}');
 text=text.replace('  const strumCoverage=await page.evaluate(',`  const pluckGlyphs=await page.evaluate(()=>({renderedCrossPlucks:document.querySelectorAll('[data-pluck-cross]').length,renderedArrowOnlyStrums:document.querySelectorAll('[data-arrow-only="true"]').length}));\n  if(pluckGlyphs.renderedCrossPlucks!==accompaniment.coverage.crossPlucks)throw Error('Chord pluck crosses missing from rendered score');\n  const strumCoverage=await page.evaluate(`);
 text=text.replace('const fragment=require(bundle);',"const fragment=require(bundle);const loaded=require.cache[bundle];if(loaded?.parent)loaded.parent.children=loaded.parent.children.filter(child=>child!==loaded);delete require.cache[bundle];");
 const path=join(root,options.annotationGeometry==='initial'?'batch-render-accompaniment-initial.mjs':'batch-render-accompaniment.mjs');await writeFile(path,text);
 const sha256=createHash('sha256').update(text).update(await readFile(bundle)).update(await readFile(new URL('./page-style.mjs',import.meta.url))).update(await readFile(new URL('./accompaniment.mjs',import.meta.url))).digest('hex');
 return{path,bundle,revision:ACCOMPANIMENT_REVISION,sha256};
}

