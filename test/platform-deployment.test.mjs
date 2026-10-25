import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {createApp} from '../server/src/app.mjs';
import {createDeployer,createAgentServer} from '../deploy/api-agent.mjs';
import {cookieFor,grantFor,request,json,home,runCli,decide} from './cli-helpers.mjs';
import {deploymentRequest} from '../server/src/platform-deployment.ts';
import {join} from 'node:path';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
test('真实平台HTTP/CLI部署授权：旧凭据和Cookie不能部署，额外授权后202/状态/日志，撤销即时生效',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'omr-api-deploy-')),commit='c'.repeat(40);let release,builds=0;
 const gate=new Promise(r=>release=r),manager=createDeployer({stateDir:join(dir,'state'),cacheDir:join(dir,'cache'),workRoot:join(dir,'work'),
  current:async()=>({commit,release:'new-release',health:{ok:true,schema:9}}),
  run:async(bin,args,{onLine=()=>{}}={})=>{
   if(args.includes('get-url'))return 'https://github.com/qkiroc/xianji-omr.git';
   if(args.includes('fetch')){await gate;return '';}
   if(args.includes('rev-parse'))return commit;
   if(bin==='bash'){builds++;onLine('阶段：安全构建日志');}
   return '';
  }});
 const socket=join(dir,'agent.sock'),agent=createAgentServer(manager);
 await manager.ready;await new Promise(r=>agent.listen(socket,r));
 const send=(method,path,value)=>deploymentRequest(method,path,value,socket);
 const f=await fixture({port:55496,appFactory:deps=>createApp({...deps,deploymentSend:send})});
 t.after(async()=>{release();await manager.idle();await f.close();await new Promise(r=>agent.close(r))});
 const cookie=await cookieFor(f),ordinary=await grantFor(f,cookie),body={requestId:randomUUID()};
 const invoke=(path,options={})=>request(f,'/api/platform/deployments'+path,options);
 assert.equal((await invoke('',{...json(body),headers:{...json(body).headers,Cookie:cookie}})).status,403);
 const normalHeader={Authorization:'Bearer '+ordinary.token};
 for(const [path,options]of [['',json(body)],['/latest',{}],['/'+body.requestId,{}]])assert.equal((await invoke(path,{...options,headers:{...options.headers,...normalHeader}})).status,403);
 const privileged=await grantFor(f,cookie,{scopes:['platform:deploy']}),headers={Authorization:'Bearer '+privileged.token,'Content-Type':'application/json'};
 assert.equal((await invoke('',{...json({...body,command:'evil'}),headers})).status,400);
 let response=await invoke('',{...json(body),headers});assert.equal(response.status,202);assert.equal((await response.json()).job.id,body.requestId);
 assert.equal((await invoke('',{...json(body),headers})).status,202);
 assert.equal((await invoke('',{...json({requestId:randomUUID()}),headers})).status,409);
 assert.equal((await invoke('/latest',{headers})).status,200);
 release();await manager.idle();assert.equal((await(await invoke('/'+body.requestId,{headers})).json()).job.status,'succeeded');assert.equal(builds,1);
 const configHome=await home();
 const auth=await runCli(f,['auth','--deploy','--no-open','--timeout','10'],{configHome,inspectAuth:async url=>{
  const id=new URL(url).searchParams.get('request'),row=(await f.pool.query('SELECT scopes FROM omr_cli_auth_requests WHERE id=$1',[id])).rows[0];
  assert.ok(row.scopes.includes('platform:deploy'));
  const decision=await decide(f,{requestId:id},cookie);await fetch(decision.url);
 }});
 assert.equal(auth.code,0,auth.stderr);assert.ok(auth.value.scopes.includes('platform:deploy'));
 const cliJob=randomUUID(),created=await runCli(f,['platform','deploy','--request-id',cliJob],{configHome});assert.equal(created.code,0,created.stderr);assert.equal(created.value.accepted,true);
 await manager.idle();
 const status=await runCli(f,['platform','status',cliJob],{configHome});assert.equal(status.code,0,status.stderr);assert.equal(status.value.job.status,'succeeded');
 const logs=await runCli(f,['platform','logs',cliJob],{configHome});assert.equal(logs.code,0,logs.stderr);assert.ok(logs.value.logs.some(e=>e.message.includes('安全构建')));
 await f.pool.query('UPDATE omr_cli_grants SET revoked_at=now() WHERE id=$1',[privileged.grantId]);assert.equal((await invoke('/latest',{headers})).status,401);
});
test('控制器不可用返回明确503，未知任务404，不会在Web进程直接执行命令',async t=>{
 const f=await fixture({port:55497,appFactory:deps=>createApp({...deps,deploymentSend:async()=>{throw Error('socket down')}})});
 t.after(()=>f.close());const cookie=await cookieFor(f),grant=await grantFor(f,cookie,{scopes:['platform:deploy']});
 const r=await request(f,'/api/platform/deployments/latest',{headers:{Authorization:'Bearer '+grant.token}});assert.equal(r.status,503);assert.match((await r.json()).error,/部署控制器/);
});
