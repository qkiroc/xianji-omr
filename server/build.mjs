import {mkdir,cp,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
await mkdir(new URL('./static/',import.meta.url),{recursive:true});await cp(new URL('../web/',import.meta.url),new URL('./static/',import.meta.url),{recursive:true});
const {default:ts}=await import('typescript');const {readFile}=await import('node:fs/promises');await writeFile(new URL('./static/crop-rules.mjs',import.meta.url),ts.transpileModule(await readFile(new URL('./src/crop-rules.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/next/dist/bin/next','build','--webpack']]){const p=spawn(process.execPath,args,{stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=2048'}});const code=await new Promise(r=>p.once('exit',r));if(code)process.exit(Number(code)||1)}
