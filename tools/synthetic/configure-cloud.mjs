import {readFile,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {readCredential} from '../cli/src/credentials.mjs';
const defaultWorkspace=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),repository='qkiroc/xianji-omr';

export function githubEnvironment(environment=process.env){
 return {...environment,GH_HOST:'github.com'};
}
export async function readOmrCredential(workspace,origin,reader=readCredential){
 const previous=process.env.XDG_CONFIG_HOME;
 try{process.env.XDG_CONFIG_HOME=join(workspace,'.artifacts/cli-config');return await reader(origin);}
 finally{if(previous===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=previous;}
}
async function run(executable,args,environment,input){
 const child=spawn(executable,args,{env:environment,stdio:[input===undefined?'inherit':'pipe','inherit','inherit']});
 if(input!==undefined)child.stdin.end(input);
 const [code]=await once(child,'exit');if(code!==0)throw Error('GitHub setup command failed ('+code+')');
}
export async function configureCloud(workspace=defaultWorkspace,dependencies={}){
 const sync=dependencies.spawnSync||spawnSync,execute=dependencies.execute||run,reader=dependencies.readCredential||readCredential,log=dependencies.log||console.log;
 // Every GitHub subprocess uses the environment that existed before the OMR config read.
 const ghEnv=githubEnvironment();let gh='gh';
 if(sync(gh,['--version'],{env:ghEnv,stdio:'ignore'}).status!==0){
  const candidates=process.platform==='win32'?[join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI/gh.exe'),join(process.env.LOCALAPPDATA||'','Programs/GitHub CLI/gh.exe')]:[];gh='';
  for(const p of candidates){try{await access(p);gh=p;break;}catch{}}
  if(!gh&&process.platform==='win32'){
   log('Installing GitHub CLI for the one-time cloud setup...');
   await execute('winget',['install','--id','GitHub.cli','--exact'],ghEnv);
   const p=join(process.env.ProgramFiles||'C:/Program Files','GitHub CLI/gh.exe');await access(p);gh=p;
  }
  if(!gh)throw Error('Install GitHub CLI from https://cli.github.com and run this command again');
 }
 if(sync(gh,['auth','status','--hostname','github.com'],{env:ghEnv,stdio:'ignore'}).status!==0){
  log('GitHub device login: copy the XXXX-XXXX one-time code printed below into the browser. Keep this terminal open until login finishes.');
  await execute(gh,['auth','login','--hostname','github.com','--git-protocol','https','--web'],ghEnv);
 }
 const verification=sync(gh,['api','user','--hostname','github.com','--jq','.login'],{env:ghEnv,encoding:'utf8'});
 if(verification.status!==0||!verification.stdout?.trim())throw Error('GitHub login verification failed. Run gh auth login --hostname github.com --web, complete device authorization, then run this script again.');
 log('GitHub login verified: '+verification.stdout.trim());
 const key=(await readFile(join(workspace,'.artifacts/cloud-secrets/material-key'),'utf8')).trim();
 if(!/^[a-f0-9]{64}$/i.test(key))throw Error('Material key is missing or invalid');
 const plan=JSON.parse(await readFile(join(workspace,'.artifacts/synthetic-renderer/audition-195-batch/plan.json'),'utf8'));
 const credential=await readOmrCredential(workspace,plan.origin,reader);
 if(!credential)throw Error('Platform CLI authorization missing; authorize this computer first');
 log('Saving the material key and platform authorization as encrypted repository Secrets. Values are not printed.');
 await execute(gh,['secret','set','OMR_ASSET_KEY','--repo','github.com/'+repository],ghEnv,key);
 await execute(gh,['secret','set','OMR_CLI_TOKEN','--repo','github.com/'+repository],ghEnv,credential.token);
 await execute(gh,['workflow','run','synthetic-corpus.yml','--repo','github.com/'+repository,'--ref','main','-f','limit=585','-f','auto_continue=true'],ghEnv);
 log('Cloud job started: https://github.com/'+repository+'/actions/workflows/synthetic-corpus.yml');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))configureCloud().catch(error=>{console.error('Cloud setup failed: '+error.message);process.exitCode=1;});

