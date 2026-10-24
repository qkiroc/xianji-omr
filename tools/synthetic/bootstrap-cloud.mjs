import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {openFiles,readParts,restoreFiles} from './cloud-crypto.mjs';
const args=process.argv.slice(2),option=(k,f)=>{const i=args.indexOf(k);return i<0?f:args[i+1];};
const workspace=resolve(option('--workspace',resolve(dirname(fileURLToPath(import.meta.url)),'../..'))),root=join(workspace,'.artifacts/synthetic-renderer'),batch=join(root,'audition-195-batch');
const key=process.env.OMR_ASSET_KEY;if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('OMR_ASSET_KEY must be configured as a private environment secret');
await restoreFiles(workspace,openFiles(await readParts(resolve(option('--assets',join(workspace,'assets/synthetic-cloud')))),key));
const expected=JSON.parse(await readFile(join(batch,'plan.json'),'utf8'));
if(option('--checkpoint')){
 const files=openFiles(await readParts(resolve(option('--checkpoint'))),key),planFile=files.find(f=>f.path==='.artifacts/synthetic-renderer/audition-195-batch/plan.json');
 if(!planFile)throw Error('Checkpoint import plan is missing');const p=JSON.parse(planFile.bytes.toString());if(p.sourceSha256!==expected.sourceSha256||p.datasetId!==expected.datasetId)throw Error('Checkpoint belongs to another dataset');await restoreFiles(workspace,files);
}
const input=await readFile(join(workspace,'downloads/audition-library-20261024-201804.json'));
if(createHash('sha256').update(input).digest('hex')!==expected.sourceSha256)throw Error('Original library checksum differs');
const library=JSON.parse(input),sources=new Map(library.songs.map(s=>[s.score.id,s.score])),{convertAudition}=await import(pathToFileURL(join(root,'convert-audition.mjs'))),require=createRequire(import.meta.url),{validateScore}=require(join(root,'batch-validate.cjs'));
for(const job of expected.jobs){
 if(!/^[a-z0-9_-]+$/i.test(job.id))throw Error('Unsafe source ID');const source=sources.get(job.id);if(!source)throw Error('Missing source song');const {score}=convertAudition(source);validateScore(score);const directory=join(batch,job.id);await mkdir(directory,{recursive:true});await writeFile(join(directory,'source-schema2.json'),JSON.stringify(source));await writeFile(join(directory,'converted-score.json'),JSON.stringify(score));
}
if(process.platform==='linux'){
 const fontconfig=join(root,'fontconfig.xml');await writeFile(fontconfig,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><alias><family>Microsoft YaHei</family><prefer><family>Noto Sans CJK SC</family></prefer></alias><alias><family>SimHei</family><prefer><family>Noto Sans CJK SC</family></prefer></alias><alias><family>SimSun</family><prefer><family>Noto Serif CJK SC</family></prefer></alias><alias><family>KaiTi</family><prefer><family>AR PL UKai CN</family></prefer></alias><alias><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias></fontconfig>`);
 if(process.env.GITHUB_ENV)await appendFile(process.env.GITHUB_ENV,'FONTCONFIG_FILE='+fontconfig+'\n');
}
console.log(JSON.stringify({event:'cloud-inputs-restored',songs:expected.jobs.length,revision:'audition195-accompaniment-v3',checkpoint:!!option('--checkpoint')}));

