import {randomUUID} from 'node:crypto';
import {client,jsonBody,limitedJSON} from './http.mjs';
import {fail} from './input.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const progress=value=>process.stderr.write(JSON.stringify(value)+'\n');
const pause=(ms,signal)=>new Promise((yes,no)=>{
 const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);yes()};
 const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);no(signal.reason)};
 const timer=setTimeout(done,ms);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
});
export async function platformCommand(words,options,{origin,credential,signal,request:provided,report=progress,sleep=pause}={}){
 const action=words[1];
 if(!['deploy','status','logs'].includes(action)||words.length>(action==='deploy'?2:3))fail('ARGUMENT','用法：platform deploy [--wait] | status [JOB_ID] | logs [JOB_ID]');
 const allowed=['origin','allow-insecure-http','timeout',...(action==='deploy'?['wait','request-id']:[])];
 if(Object.keys(options).some(key=>!allowed.includes(key)))fail('ARGUMENT','platform命令含不支持的选项；使用--origin调用平台部署接口');
 const seconds=Number(options.timeout??(options.wait?7200:120));
 if(!Number.isInteger(seconds)||seconds<1||seconds>14400)fail('INPUT','--timeout必须为1–14400秒');
 const deadline=AbortSignal.timeout(seconds*1000),active=signal?AbortSignal.any([signal,deadline]):deadline;
 const request=provided||client(origin,credential.token,active);
 const get=async id=>limitedJSON(await request('/api/platform/deployments/'+(id||'latest')));
 let id=action==='deploy'?(options['request-id']||randomUUID()):words[2];
 if(id&&!UUID.test(id))fail('INPUT','部署任务ID必须为UUID');
 try{
  if(action!=='deploy'){
   const value=await get(id);
   if(action==='status')return value;
   if(!value.job)fail('DEPLOY_NOT_FOUND','还没有部署任务',6);
   return{id:value.job.id,status:value.job.status,phase:value.job.phase,logs:value.job.logs};
  }
  report({phase:'request',jobId:id});
  const value=await limitedJSON(await request('/api/platform/deployments',jsonBody({requestId:id})));
  if(!value.job||value.job.id!==id)fail('DEPLOY_RESPONSE','部署任务响应无效',6);
  if(!options.wait)return{accepted:true,job:value.job};
  let job=value.job,previous='',shown=new Set();
  for(;;){
   const state=[job.status,job.phase,job.commit].join(':');
   if(state!==previous){report({jobId:id,status:job.status,phase:job.phase,commit:job.commit});previous=state;}
   for(const log of job.logs||[]){const key=log.time+':'+log.message;if(!shown.has(key)){report({jobId:id,log});shown.add(key);}}
   if(shown.size>500)shown=new Set([...shown].slice(-200));
   if(job.status==='succeeded')return{deployed:true,job};
   if(['failed','interrupted'].includes(job.status))fail('DEPLOY_FAILED',job.error||'部署失败，请查询platform status和logs',6);
   await sleep(2000,active);
   try{job=(await get(id)).job;if(!job||job.id!==id)fail('DEPLOY_RESPONSE','部署状态响应无效',6);}
   catch(error){
    if(active.aborted)throw error;
    if(error.code==='NETWORK'||error.code==='HTTP_ERROR'&&[500,502,503,504].includes(error.status)){
     report({jobId:id,phase:'reconnecting',message:'等待平台重启或恢复连接'});continue;
    }
    throw error;
   }
  }
 }catch(error){
  if(active.aborted)fail(signal?.aborted?'INTERRUPTED':'DEPLOY_TIMEOUT','本地等待已停止，ECS任务继续执行；用platform status '+(id||'')+'查询',signal?.aborted?130:6);
  throw error;
 }
}
