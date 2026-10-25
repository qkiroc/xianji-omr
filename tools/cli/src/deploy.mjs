import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fail} from './input.mjs';

const ASSETS=['deploy.sh','bootstrap.sh','artifact.mjs'];
const quote=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
const progress=value=>process.stderr.write(JSON.stringify(value)+'\n');
export function connection(options){
 const host=options.host,port=options.port===undefined?null:Number(options.port);
 // Use an SSH config alias for IPv6, proxies, certificates or custom host-key settings.
 if(typeof host!=='string'||host.length>254||!/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(host))fail('INPUT','--host必须是SSH别名或user@hostname');
 if(port!==null&&(!Number.isInteger(port)||port<1||port>65535))fail('INPUT','--port必须为1–65535');
 const common=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','ForwardAgent=no','-o','ClearAllForwardings=yes'];
 if(options.identity){if(typeof options.identity!=='string'||/[\x00-\x1f]/.test(options.identity))fail('INPUT','--identity无效');common.push('-i',resolve(options.identity));}
 return{host,ssh:[...common,...(port===null?[]:['-p',String(port)]),'-T',host],scp:[...common,...(port===null?[]:['-P',String(port)])]};
}

// No local shell is used. SSH receives a single, quoted remote command.
export function runProcess(bin,args,{signal,cwd,stream=false,maxOutput=8*1024*1024}={}){
 return new Promise((yes,no)=>{
  const child=spawn(bin,args,{shell:false,windowsHide:true,cwd,signal,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',size=0,overflow=false;
  for(const [name,pipe]of [['stdout',child.stdout],['stderr',child.stderr]])pipe.on('data',chunk=>{
   size+=chunk.length;
   if(size>maxOutput){overflow=true;child.kill();return;}
   if(stream)process.stderr.write(chunk);
   else if(name==='stdout')stdout+=chunk.toString();else stderr+=chunk.toString();
  });
  child.once('error',error=>{if(error.name==='AbortError')no(error);else no(Object.assign(new Error('无法启动'+bin+'，请安装系统OpenSSH和tar'),{code:'TOOL_REQUIRED'}));});
  child.once('close',code=>overflow?no(new Error('子进程输出超过限制')):yes({code,stdout,stderr}));
 });
}

function elevated(program,args){
 const command=[program,...args].map(quote).join(' ');
 return 'if [ "$(id -u)" = 0 ]; then exec '+command+'; else exec sudo -n -- '+command+'; fi';
}
const STATUS=String.raw`
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
try{
 let service='inactive';try{service=execFileSync('systemctl',['is-active','xianji-omr.service'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{}
 const config=JSON.parse(await readFile('/etc/xianji-omr/config.json','utf8'));
 let commit=null,release=null,health=null;
 try{commit=JSON.parse(await readFile('/opt/xianji-omr/current/artifact.json','utf8')).commit}catch{}
 try{release=(await readFile('/opt/xianji-omr/current/server/RELEASE','utf8')).trim()}catch{}
 try{const r=await fetch('http://127.0.0.1:'+config.port+'/health',{signal:AbortSignal.timeout(5000)}),v=await r.json();health={ok:r.ok&&v.ok===true,schema:v.schema,release:v.release}}catch{}
 console.log(JSON.stringify({service,commit,release,health}));
}catch{console.error('平台配置不可读取，或平台尚未初始化');process.exitCode=1}
`;

async function assetDirectory(){
 const packed=new URL('./deploy/',import.meta.url);
 try{await lstat(new URL('deploy.sh',packed));return packed}catch(error){if(error.code!=='ENOENT')throw error;}
 return new URL('../../../deploy/',import.meta.url);
}

export async function platformCommand(words,options,{signal,run=runProcess,report=progress,assets}={}){
 const action=words[1];
 if(words.length!==2||!['deploy','status'].includes(action))fail('ARGUMENT','用法：platform deploy|status --host SSH_HOST');
 const allowed=action==='deploy'?['host','port','identity','artifact','sha256','timeout','dry-run']:['host','port','identity','timeout'];
 if(Object.keys(options).some(key=>!allowed.includes(key)))fail('ARGUMENT','platform命令含不支持的选项');
 const transport=connection(options),seconds=Number(options.timeout??(action==='deploy'?1800:30));
 if(!Number.isInteger(seconds)||seconds<1||seconds>7200)fail('INPUT','--timeout必须为1–7200秒');
 const deadline=AbortSignal.timeout(seconds*1000),active=signal?AbortSignal.any([signal,deadline]):deadline;
 const invoke=async(bin,args,extra={})=>{
  const result=await run(bin,args,{signal:active,...extra});
  if(result.code!==0){if(result.stderr)report({phase:'command-failed',tool:bin,message:result.stderr.trim().slice(-4096)});fail('DEPLOY_TRANSPORT',bin+'执行失败；检查SSH主机指纹、密钥、免密sudo及部署阶段日志',6);}
  return result.stdout;
 };
 if(action==='status'){
  try{
   const result=JSON.parse(await invoke('ssh',[...transport.ssh,elevated('/opt/xianji-omr/runtime/node/bin/node',['--input-type=module','-e',STATUS])]));
   return{host:transport.host,...result};
  }catch(error){if(active.aborted)fail('DEPLOY_TIMEOUT','状态查询已取消或超时',signal?.aborted?130:6);throw error;}
 }
 let stage,created=false,started=false,completed=false,temp;
 try{
  if(typeof options.artifact!=='string'||/[\x00-\x1f]/.test(options.artifact))fail('INPUT','部署必须提供--artifact预构建tar.gz');
  const archive=resolve(options.artifact),info=await lstat(archive);
  if(!info.isFile()||info.size<1||info.size>2*1024*1024*1024)fail('INPUT','部署包必须是2GiB以内的普通文件');
  let expected=options.sha256;
  if(expected===undefined){
   let sidecar;try{sidecar=await readFile(archive+'.sha256','utf8')}catch{fail('INPUT','请提供--sha256或与部署包同名的.sha256文件');}
   expected=/^([a-f0-9]{64})(?:[ \t]+[^\r\n]+)?\r?\n?$/.exec(sidecar)?.[1];
  }
  if(!/^[a-f0-9]{64}$/.test(expected||''))fail('INPUT','SHA256必须为64位小写十六进制');
  report({phase:'verify-package'});
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(archive,{signal:active}))hash.update(chunk);
  if(hash.digest('hex')!==expected)fail('INTEGRITY','部署包SHA256不一致，未连接ECS',7);
  let manifest;try{manifest=JSON.parse(await invoke('tar',['-xOzf',archive,'./artifact.json'],{maxOutput:32*1024*1024}));}catch(error){if(error.name==='SyntaxError')fail('INPUT','部署包artifact.json无效');throw error;}
  if(!manifest||manifest.format!=='xianji-omr-standalone-v1'||manifest.platform!=='linux'||manifest.arch!=='x64'||manifest.nodeMajor!==22||!/^[a-f0-9]{40}$/.test(manifest.commit||''))fail('INPUT','仅支持Linux x64 / Node22平台预构建包');
  const plan={host:transport.host,commit:manifest.commit,sha256:expected,artifact:archive,mode:'prebuilt',schema:manifest.schema};
  if(options['dry-run'])return{...plan,dryRun:true,remoteChecked:false};
  assets??=await assetDirectory();
  temp=await mkdtemp(join(tmpdir(),'omr-cli-deploy-'));
  const scriptDir=join(temp,'deploy');await mkdir(scriptDir);
  for(const name of ASSETS)await writeFile(join(scriptDir,name),await readFile(new URL(name,assets)));
  report({phase:'remote-preflight',host:transport.host});
  await invoke('ssh',[...transport.ssh,elevated('bash',['-c',"test -f /etc/xianji-omr/config.json && test ! -L /etc/xianji-omr/config.json && test -f /opt/xianji-omr/.xianji-omr-managed || { echo '首次安装请先完成ECS初始配置' >&2; exit 1; }"])]);
  stage='/var/tmp/xianji-omr-cli-'+randomUUID();
  report({phase:'upload',host:transport.host,commit:manifest.commit});
  await invoke('ssh',[...transport.ssh,'umask 077 && mkdir -- '+quote(stage)+' && mkdir -- '+quote(stage+'/deploy')]);
  created=true;
  await invoke('scp',[...transport.scp,'./'+basename(archive),transport.host+':'+stage+'/release.tar.gz'],{cwd:dirname(archive),stream:true});
  for(const name of ASSETS)await invoke('scp',[...transport.scp,'./'+name,transport.host+':'+stage+'/deploy/'+name],{cwd:scriptDir,stream:true});
  started=true;
  report({phase:'deploy',host:transport.host,remoteStage:stage});
  await invoke('ssh',[...transport.ssh,elevated('bash',[stage+'/deploy/deploy.sh','--artifact',stage+'/release.tar.gz','--sha256',expected,'--commit',manifest.commit,'--non-interactive'])],{stream:true,maxOutput:64*1024*1024});
  completed=true;
  return{...plan,deployed:true};
 }catch(error){
  if(stage&&started&&!completed)report({phase:'remote-result-unknown',host:transport.host,remoteStage:stage,message:'部署可能仍在远端运行，请先platform status并核对远端部署日志，再决定是否重试'});
  if(active.aborted)fail('DEPLOY_TIMEOUT','部署已取消或超时；远端可能仍在运行，请先查询platform status',signal?.aborted?130:6);
  if(error.code==='TOOL_REQUIRED')fail('TOOL_REQUIRED',error.message,7);
  throw error;
 }finally{
  if(created&&(!started||completed)){
   try{const cleaned=await run('ssh',[...transport.ssh,'rm -f -- '+['release.tar.gz',...ASSETS.map(name=>'deploy/'+name)].map(name=>quote(stage+'/'+name)).join(' ')+' && rmdir -- '+quote(stage+'/deploy')+' '+quote(stage)],{signal:AbortSignal.timeout(20000)});
    if(cleaned.code!==0)report({phase:'cleanup-needed',remoteStage:stage});
   }catch{report({phase:'cleanup-needed',remoteStage:stage});}
  }
  if(temp)await rm(temp,{recursive:true,force:true});
 }
}
