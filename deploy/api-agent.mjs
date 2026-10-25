// Local deployment controller. Installed root-owned; listens only on a systemd Unix socket.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdir,readdir,lstat,open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ROOT='/opt/xianji-omr',STATE='/var/lib/xianji-omr-deploy';
const REMOTES=['https://github.com/qkiroc/xianji-omr.git','https://github.com/qkiroc/xianji-omr','git@github.com:qkiroc/xianji-omr.git'];
const fault=(status,message)=>Object.assign(new Error(message),{status});
const clone=value=>structuredClone(value);

export async function atomic(file,value){
 const temporary=file+'.'+randomUUID()+'.tmp';
 let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=null;
  await rename(temporary,file);
 }finally{await handle?.close();await unlink(temporary).catch(()=>{});}
}
export function redact(line,secrets=[]){
 let text=line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
 for(const secret of secrets.filter(s=>typeof s==='string'&&s.length>=4).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[REDACTED]');
 return text.replace(/omr_cli_[a-f0-9]{64}/g,'[REDACTED]').replace(/(https?:\/\/)[^/\s@]+@/g,'$1[REDACTED]@').replace(/\b(Bearer\s+)\S+/gi,'$1[REDACTED]').slice(0,500);
}
export function secretValues(value,result=[]){
 if(value&&typeof value==='object')for(const[key,item]of Object.entries(value)){
  if(/password|secret|token|accesskey/i.test(key)&&typeof item==='string')result.push(item);
  else if(item&&typeof item==='object')secretValues(item,result);
 }
 return result;
}
export function command(bin,args,{cwd,signal,onLine=()=>{},env={}}={}){
 return new Promise((yes,no)=>{
  const child=spawn(bin,args,{cwd,shell:false,windowsHide:true,signal,
   env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8',GIT_TERMINAL_PROMPT:'0',GIT_SSH_COMMAND:'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes',NEXT_TELEMETRY_DISABLED:'1',...env},
   stdio:['ignore','pipe','pipe']});
  let output='';
  for(const stream of [child.stdout,child.stderr]){
   stream.setEncoding('utf8');let pending='';
   stream.on('data',chunk=>{output=(output+chunk).slice(-1024*1024);pending+=chunk;
    for(;;){const n=pending.indexOf('\n');if(n<0)break;onLine(pending.slice(0,n));pending=pending.slice(n+1);}
    if(pending.length>4096){onLine(pending.slice(0,4096));pending='';}
   });
   stream.on('end',()=>{if(pending)onLine(pending)});
  }
  child.once('error',no);
  child.once('close',code=>code===0?yes(output.trim()):no(fault(500,'COMMAND_FAILED')));
 });
}
export async function currentState(){
 let commit=null,release=null,health=null;
 try{commit=(await readFile(ROOT+'/current/server/COMMIT','utf8')).trim()}catch{}
 try{release=(await readFile(ROOT+'/current/server/RELEASE','utf8')).trim()}catch{}
 try{
  const config=JSON.parse(await readFile('/etc/xianji-omr/config.json','utf8'));
  const response=await fetch('http://127.0.0.1:'+config.port+'/health',{signal:AbortSignal.timeout(5000)}),body=await response.json();
  health={ok:response.ok&&body.ok===true&&body.release===release,schema:body.schema,release:body.release};
 }catch{}
 return{commit,release,health};
}
export function createDeployer({stateDir=STATE,cacheDir=ROOT+'/deploy-source.git',workRoot=ROOT+'/deploy-worktrees',run=command,current=currentState,secrets=[],onIdle=()=>{}}={}){
 stateDir=resolve(stateDir);cacheDir=resolve(cacheDir);workRoot=resolve(workRoot);
 const jobs=join(stateDir,'jobs');let active=null,submitting=0,ready,writing=Promise.resolve(),lastFlush=0;
 const pathFor=id=>{if(!UUID.test(id))throw fault(400,'部署任务ID无效');return join(jobs,id+'.json')};
 const save=job=>{const snapshot=clone(job);writing=writing.catch(()=>{}).then(()=>atomic(pathFor(snapshot.id),snapshot));return writing};
 const get=async id=>{
  pathFor(id);if(active?.id===id)return clone(active);
  try{const file=pathFor(id),st=await lstat(file);if(!st.isFile()||st.size>256*1024)throw fault(500,'部署记录无效');return JSON.parse(await readFile(file,'utf8'))}
  catch(error){if(error.code==='ENOENT')throw fault(404,'部署任务不存在');throw error;}
 };
 const append=(job,line)=>{
  const text=redact(line,secrets);if(!text.trim())return;
  job.logs.push({time:new Date().toISOString(),message:text});job.logs=job.logs.slice(-100);
  if(Date.now()-lastFlush>1000){lastFlush=Date.now();void save(job).catch(()=>{});}
 };
 const phase=async(job,value)=>{
  job.phase=value;append(job,'阶段：'+value);await save(job);
 };
 async function initialize(){
  for(const dir of [stateDir,jobs,workRoot]){await mkdir(dir,{recursive:true,mode:0o700});if((await lstat(dir)).isSymbolicLink())throw fault(500,'部署目录不能为符号链接');}
  const entries=(await readdir(jobs)).filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json'));
  let latest=null,currentValue;
  for(const name of entries){
   const job=await get(name.slice(0,-5));
   if(['queued','running'].includes(job.status)){
    currentValue??=await current();
    const completed=job.commit&&currentValue.commit===job.commit&&currentValue.health?.ok===true;
    job.status=completed?'succeeded':'interrupted';job.phase=job.status;job.completedAt=new Date().toISOString();
    job.error=completed?null:'部署控制进程曾中断，请核对当前版本后再发起新任务';append(job,'任务恢复：'+job.status);await save(job);
   }
   if(!latest||job.createdAt>latest.createdAt)latest=job;
  }
  if(latest)await atomic(join(stateDir,'latest.json'),{id:latest.id});
 }
 ready=initialize();
 async function execute(job){
  const signal=AbortSignal.timeout(2*60*60*1000),work=join(workRoot,job.id);
  let worktree=false;
  try{
   job.status='running';job.startedAt=new Date().toISOString();await phase(job,'fetch');
   const invoke=(bin,args,extra={})=>run(bin,args,{signal,onLine:line=>append(job,line),...extra});
   const origin=await invoke('git',['--git-dir',cacheDir,'remote','get-url','origin']);
   if(!REMOTES.includes(origin.trim()))throw fault(500,'DEPLOY_REMOTE_NOT_ALLOWED');
   await invoke('git',['--git-dir',cacheDir,'fetch','--no-tags','--no-recurse-submodules','origin','refs/heads/main:refs/remotes/origin/main']);
   const commit=(await invoke('git',['--git-dir',cacheDir,'rev-parse','--verify','refs/remotes/origin/main^{commit}'])).trim();
   if(!/^[a-f0-9]{40}$/.test(commit))throw fault(500,'DEPLOY_COMMIT_INVALID');
   job.commit=commit;await save(job);
   // This UUID worktree belongs only to this controller; never alter an operator checkout.
   if(!resolve(work).startsWith(workRoot+sep)||!UUID.test(job.id))throw fault(500,'DEPLOY_WORKTREE_INVALID');
   await invoke('git',['--git-dir',cacheDir,'-c','core.hooksPath=/dev/null','worktree','add','--detach',work,commit]);worktree=true;
   await phase(job,'build-and-deploy');
   await invoke('bash',[join(work,'deploy/deploy.sh'),'--build-on-ecs','--non-interactive'],{cwd:work,env:{OMR_DEPLOY_API:'1'}});
   await phase(job,'health');
   const state=await current();
   if(state.commit!==commit||state.health?.ok!==true)throw fault(500,'DEPLOY_HEALTH_FAILED');
   job.status='succeeded';job.phase='succeeded';job.error=null;job.release=state.release;
   append(job,'部署成功，当前版本与目标commit一致');
  }catch(error){
   job.status='failed';job.phase='failed';job.error=signal.aborted?'部署超时；请核对当前状态后处理':'部署失败；请查看任务阶段日志';
   append(job,signal.aborted?'DEPLOY_TIMEOUT':/^(DEPLOY_|COMMAND_FAILED)/.test(error.message||'')?error.message:'DEPLOY_STEP_FAILED');
  }finally{
   if(worktree)await run('git',['--git-dir',cacheDir,'worktree','remove','--force',work],{signal:AbortSignal.timeout(30000)}).catch(()=>append(job,'临时源码目录清理失败，已保留'));
   job.completedAt=new Date().toISOString();await save(job);active=null;onIdle();
  }
 }
 return{
  ready,
  async submit(value){
   submitting++;
   try {
   await ready;
   if(!value||Object.keys(value).some(key=>!['requestId','grantId'].includes(key))||!UUID.test(value.requestId||'')||!UUID.test(value.grantId||''))throw fault(400,'部署请求只接受requestId和授权标识');
   try{return await get(value.requestId)}catch(error){if(error.status!==404)throw error;}
   if(active){if(active.id===value.requestId)return clone(active);throw Object.assign(fault(409,'已有部署任务执行中'),{jobId:active.id});}
   if((await readdir(jobs)).length>=1000)throw fault(429,'部署记录已达上限，请管理员归档历史记录');
   // Recheck after asynchronous filesystem access.
   if(active){if(active.id===value.requestId)return clone(active);throw Object.assign(fault(409,'已有部署任务执行中'),{jobId:active.id});}
   const job={id:value.requestId,grantId:value.grantId,branch:'main',status:'queued',phase:'queued',commit:null,error:null,createdAt:new Date().toISOString(),logs:[]};
   active=job;
   try{await save(job);await atomic(join(stateDir,'latest.json'),{id:job.id})}catch(error){active=null;throw error;}
   setImmediate(()=>void execute(job).catch(()=>{active=null;onIdle()}));
   return clone(job);
   } finally { submitting--; }
  },
  isBusy(){return !!active||submitting>0;},
  async get(id){await ready;return get(id)},
  async latest(){await ready;let job=null;try{job=await get(JSON.parse(await readFile(join(stateDir,'latest.json'),'utf8')).id)}catch(error){if(error.code!=='ENOENT')throw error;}return{job,current:await current()};},
  async idle(){await ready;while(active)await new Promise(r=>setTimeout(r,10));await writing;}
 };
}
export function createAgentServer(manager){
 return createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
   if(req.method==='POST'&&req.url==='/jobs'){
    let size=0,body='';for await(const chunk of req){size+=chunk.length;if(size>4096)throw fault(413,'请求过大');body+=chunk.toString();}
    let value;try{value=JSON.parse(body)}catch{throw fault(400,'JSON无效');}
    const job=await manager.submit(value);res.writeHead(202).end(JSON.stringify({job}));return;
   }
   if(req.method==='GET'&&req.url==='/jobs/latest'){res.end(JSON.stringify(await manager.latest()));return;}
   const match=/^\/jobs\/([a-f0-9-]{36})$/.exec(req.url||'');
   if(req.method==='GET'&&match){res.end(JSON.stringify({job:await manager.get(match[1])}));return;}
   throw fault(404,'接口不存在');
  }catch(error){res.writeHead(error.status||503).end(JSON.stringify({error:error.status?error.message:'部署控制器暂不可用',...(error.jobId?{jobId:error.jobId}:{})}));}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.getuid?.()!==0||process.env.LISTEN_FDS!=='1'||Number(process.env.LISTEN_PID)!==process.pid)throw Error('SYSTEMD_SOCKET_REQUIRED');
  const config=JSON.parse(await readFile('/etc/xianji-omr/config.json','utf8'));
  let server;
  const manager=createDeployer({secrets:secretValues(config),onIdle:()=>setTimeout(()=>{if(manager.isBusy())return;server.close();server.closeAllConnections();process.exit(0)},500)});
  await manager.ready;server=createAgentServer(manager);server.listen({fd:3});
 }catch{console.error('DEPLOY_AGENT_START_FAILED');process.exitCode=1;}
}
