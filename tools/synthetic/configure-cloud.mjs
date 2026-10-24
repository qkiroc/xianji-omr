import {readFile,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {readCredential} from '../cli/src/credentials.mjs';
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),repository='qkiroc/xianji-omr';
async function run(executable,args,input){const child=spawn(executable,args,{stdio:[input===undefined?'inherit':'pipe','inherit','inherit']});if(input!==undefined)child.stdin.end(input);const [code]=await once(child,'exit');if(code!==0)throw Error('GitHub setup command failed ('+code+')');}
let gh='gh';if(spawnSync(gh,['--version'],{stdio:'ignore'}).status!==0){
 const candidates=process.platform==='win32'?[join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI/gh.exe'),join(process.env.LOCALAPPDATA||'','Programs/GitHub CLI/gh.exe')]:[];gh='';
 for(const p of candidates){try{await access(p);gh=p;break;}catch{}}
 if(!gh&&process.platform==='win32'){console.log('Installing GitHub CLI for the one-time cloud setup...');await run('winget',['install','--id','GitHub.cli','--exact']);const p=join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI/gh.exe');await access(p);gh=p;}
 if(!gh)throw Error('Install GitHub CLI from https://cli.github.com and run this command again');
}
if(spawnSync(gh,['auth','status','--hostname','github.com'],{stdio:'ignore'}).status!==0)await run(gh,['auth','login','--hostname','github.com','--git-protocol','https','--web']);
const key=(await readFile(join(workspace,'.artifacts/cloud-secrets/material-key'),'utf8')).trim();if(!/^[a-f0-9]{64}$/i.test(key))throw Error('Material key is missing or invalid');
const plan=JSON.parse(await readFile(join(workspace,'.artifacts/synthetic-renderer/audition-195-batch/plan.json'),'utf8'));
process.env.XDG_CONFIG_HOME=join(workspace,'.artifacts/cli-config');const credential=await readCredential(plan.origin);if(!credential)throw Error('Platform CLI authorization missing; authorize this computer first');
console.log('Saving the material key and platform authorization as encrypted repository Secrets. Values are not printed.');
await run(gh,['secret','set','OMR_ASSET_KEY','--repo',repository],key);
await run(gh,['secret','set','OMR_CLI_TOKEN','--repo',repository],credential.token);
await run(gh,['workflow','run','synthetic-corpus.yml','--repo',repository,'--ref','main','-f','limit=585','-f','auto_continue=true']);
console.log('Cloud job started: https://github.com/'+repository+'/actions/workflows/synthetic-corpus.yml');

