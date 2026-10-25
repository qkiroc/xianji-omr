import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {join,resolve,relative,dirname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {assetPath,sealFiles,writeParts} from './cloud-crypto.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),root=join(workspace,'.artifacts/synthetic-renderer'),batch=join(root,'audition-195-batch');
const args=process.argv.slice(2),checkpoint=args.includes('--checkpoint');
const arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const keyPath=resolve(arg('--key-file',join(workspace,'.artifacts/cloud-secrets/material-key'))),output=resolve(arg('--output',checkpoint?join(workspace,'.artifacts/cloud-checkpoint'):join(workspace,'assets/synthetic-cloud')));
await mkdir(dirname(keyPath),{recursive:true,mode:0o700});let key=process.env.OMR_ASSET_KEY;
if(!key){try{key=(await readFile(keyPath,'utf8')).trim();}catch(e){if(e.code!=='ENOENT')throw e;key=randomBytes(32).toString('hex');await writeFile(keyPath,key,{mode:0o600,flag:'wx'});}}
const files=new Map(),readJSON=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function add(path,optional=false){try{if(!(await lstat(path)).isFile())throw Error('Asset must be a regular file');const rel=relative(workspace,path).split(sep).join('/');assetPath(rel);files.set(rel,{path:rel,bytes:await readFile(path)});}catch(e){if(optional&&e.code==='ENOENT')return;throw e;}}
async function tree(directory){for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Source symlinks are not supported');const path=join(directory,entry.name);if(entry.isDirectory())await tree(path);else await add(path);}}
const plan=await readJSON(join(batch,'plan.json'));if(!plan)throw Error('Import plan missing');
if(!checkpoint){
 await add(join(workspace,'downloads/audition-library-20261024-201804.json'));
 for(const file of ['package.json','package-lock.json','batch-render-profile.mjs','batch-worker.mjs','convert-audition.mjs','batch-ssr.cjs','batch-validate.cjs'])await add(join(root,file));
 await tree(join(root,'reference-styled-source'));
}
await add(join(batch,'plan.json'));let pendingEditions=0;
for(const phase of ['layout-revision-v2','accompaniment-revision-v3'])for(const file of ['plan.json','progress.json'])await add(join(batch,phase,file),true);
for(const job of plan.jobs){
 const directory=join(batch,job.id);await add(join(directory,'profiles.json'));await add(join(directory,'state.json'),true);
 for(const phase of ['layout-revision-v2','accompaniment-revision-v3'])for(const profile of job.profiles){
  const outputDir=join(batch,phase,job.id,profile.id),transaction=await readJSON(join(outputDir,'replacement-state.json')),result=await readJSON(join(outputDir,'render-result.json'));
  await add(join(outputDir,'replacement-state.json'),true);
  const report=await readJSON(join(batch,phase,'progress.json'),{completed:[]}),recorded=report.completed?.some(p=>p.key===job.id+':'+profile.id);
  if(!result||transaction?.phase==='preserved'||transaction?.phase==='complete'&&recorded)continue;
  // Original layout runs may predate the aggregate completed list. Their own transaction is sufficient.
  if(phase==='layout-revision-v2'&&transaction?.phase==='complete')continue;
  pendingEditions++;await add(join(outputDir,'render-result.json'));await add(join(outputDir,'annotations.json'));
  const pages=await readJSON(join(outputDir,'annotations.json'));for(const page of pages){if(!/^[a-z0-9._-]+\.png$/i.test(page.filename))throw Error('Unsafe page filename');await add(join(outputDir,page.filename));}
 }
}
const encrypted=sealFiles([...files.values()],key),index=await writeParts(output,encrypted);
console.log(JSON.stringify({checkpoint,files:files.size,plainBytes:[...files.values()].reduce((n,f)=>n+f.bytes.length,0),encryptedBytes:encrypted.length,parts:index.parts.length,pendingEditions,output,keyStoredOutsideRepository:true}));

