import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDeployer,createAgentServer,command,atomic,redact} from '../deploy/api-agent.mjs';
const commit='a'.repeat(40),grantId='22222222-2222-4222-8222-222222222222';
async function base(){
 const root=await mkdtemp(join(tmpdir(),'omr-agent-'));
 return{root,stateDir:join(root,'state'),cacheDir:join(root,'cache.git'),workRoot:join(root,'work'),current:async()=>({commit,release:'release',health:{ok:true,schema:9}})};
}
function fake(calls,{gate,fail=false}={}){
 return async(bin,args,options={})=>{
  calls.push({bin,args,options});
  if(args.includes('get-url'))return 'https://github.com/qkiroc/xianji-omr.git';
  if(args.includes('fetch')){if(gate)await gate;if(fail)throw Error('COMMAND_FAILED');return '';}
  if(args.includes('rev-parse'))return commit;
  if(bin==='bash'){for(let i=0;i<130;i++)options.onLine?.('阶段：构建 '+i+' PASSWORD_PRIVATE '+'中'.repeat(1200));}
  return '';
 };
}
test('独立控制器：任务幂等、并发互斥、固定main/固定命令、构建与健康检查成功后才完成',async()=>{
 const options=await base(),calls=[];let release;
 const gate=new Promise(r=>release=r),manager=createDeployer({...options,run:fake(calls,{gate}),secrets:['PASSWORD_PRIVATE']});
 await manager.ready;const id=randomUUID(),first=await manager.submit({requestId:id,grantId});
 assert.equal(first.status,'queued');assert.equal(manager.isBusy(),true);assert.equal((await manager.submit({requestId:id,grantId})).id,id);
 await assert.rejects(manager.submit({requestId:randomUUID(),grantId}),e=>e.status===409&&e.jobId===id);
 await assert.rejects(manager.submit({requestId:randomUUID(),grantId,command:'evil'}),e=>e.status===400);
 release();await manager.idle();const job=await manager.get(id);
 assert.equal(job.status,'succeeded');assert.equal(manager.isBusy(),false);assert.equal(job.commit,commit);assert.equal(job.logs.length,100);
 assert.ok(!JSON.stringify(job).includes('PASSWORD_PRIVATE'));assert.ok(Buffer.byteLength(JSON.stringify(job))<256*1024);
 assert.ok(calls.some(c=>c.bin==='git'&&c.args.join(' ').includes('fetch --no-tags --no-recurse-submodules origin refs/heads/main:refs/remotes/origin/main')));
 const build=calls.find(c=>c.bin==='bash');assert.ok(build.args.includes('--build-on-ecs'));assert.ok(build.args.includes('--non-interactive'));assert.equal(build.options.env.OMR_DEPLOY_API,'1');
 assert.equal((await manager.submit({requestId:id,grantId})).status,'succeeded');
 assert.equal(calls.filter(c=>c.bin==='bash').length,1);
 const disk=JSON.parse(await readFile(join(options.stateDir,'jobs',id+'.json'),'utf8'));assert.equal(disk.status,'succeeded');
});
test('拉取失败不进入构建、迁移或激活；失败保留日志供CLI查询',async()=>{
 const options=await base(),calls=[],manager=createDeployer({...options,run:fake(calls,{fail:true})});
 const job=await manager.submit({requestId:randomUUID(),grantId});await manager.idle();
 assert.equal((await manager.get(job.id)).status,'failed');assert.equal(calls.some(c=>c.bin==='bash'),false);
 assert.equal((await manager.latest()).job.id,job.id);
});
test('控制器重启恢复持久任务：已激活并健康则恢复成功，其余标记中断，不自动再次部署',async()=>{
 const options=await base(),jobs=join(options.stateDir,'jobs');await mkdir(jobs,{recursive:true});
 const done=randomUUID(),stopped=randomUUID();
 for(const[id,c]of [[done,commit],[stopped,'b'.repeat(40)]])await atomic(join(jobs,id+'.json'),{id,grantId,status:'running',phase:'health',commit:c,createdAt:new Date().toISOString(),logs:[]});
 let runs=0;const manager=createDeployer({...options,run:async()=>{runs++;throw Error('不应执行')}});
 await manager.ready;assert.equal((await manager.get(done)).status,'succeeded');assert.equal((await manager.get(stopped)).status,'interrupted');assert.equal(runs,0);
});
test('本地HTTP控制协议返回202后后台继续；只接受固定端点和UUID，拒绝传入命令',async t=>{
 const options=await base(),calls=[];let release;
 const gate=new Promise(r=>release=r),manager=createDeployer({...options,run:fake(calls,{gate})}),server=createAgentServer(manager);
 await manager.ready;await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{release();await manager.idle();await new Promise(r=>server.close(r))});
 const origin='http://127.0.0.1:'+server.address().port,id=randomUUID(),post=body=>fetch(origin+'/jobs',{method:'POST',body:JSON.stringify(body)});
 assert.equal((await post({requestId:id,grantId,command:'node evil'})).status,400);
 const response=await post({requestId:id,grantId});assert.equal(response.status,202);assert.equal((await response.json()).job.id,id);
 assert.equal((await fetch(origin+'/jobs/latest')).status,200);assert.equal((await fetch(origin+'/jobs/../../etc/passwd')).status,404);
 release();await manager.idle();assert.equal((await(await fetch(origin+'/jobs/'+id)).json()).job.status,'succeeded');
});
test('日志脱敏：凭据、Bearer、Git URL认证信息不会出现在任务响应',()=>{
 const text=redact('PASSWORD_PRIVATE https://user:password@github.com/a Bearer abc omr_cli_'+'a'.repeat(64),['PASSWORD_PRIVATE']);
 assert.ok(!text.includes('PASSWORD_PRIVATE'));assert.ok(!text.includes('user:password'));assert.ok(!text.includes('Bearer abc'));assert.ok(!text.includes('omr_cli_'));
});
test('实际Git抓取及独立worktree：冻结main commit，构建调用后清理，不改操作者源码目录',{skip:process.platform==='win32'},async()=>{
 const options=await base(),source=join(options.root,'source');await mkdir(source);
 const git=(args,cwd=source)=>command('git',args,{cwd});
 await git(['init','-q','-b','main']);await writeFile(join(source,'tracked.txt'),'keep\n');await git(['add','.']);
 await git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','initial']);
 const target=await git(['rev-parse','HEAD']);await git(['init','--bare','-q',options.cacheDir]);await git(['--git-dir',options.cacheDir,'remote','add','origin',source]);
 let work;
 const manager=createDeployer({...options,current:async()=>({commit:target,release:'release',health:{ok:true}}),
  run:async(bin,args,opts)=>{
   if(args.includes('get-url'))return 'https://github.com/qkiroc/xianji-omr.git';
   if(bin==='bash'){work=opts.cwd;assert.equal(await git(['rev-parse','HEAD'],work),target);assert.equal(await readFile(join(work,'tracked.txt'),'utf8'),'keep\n');return '';}
   return command(bin,args,opts);
  }});
 const job=await manager.submit({requestId:randomUUID(),grantId});await manager.idle();assert.equal((await manager.get(job.id)).commit,target);assert.equal((await manager.get(job.id)).status,'succeeded');
 assert.equal(await git(['status','--porcelain']),'');assert.equal(await readFile(join(source,'tracked.txt'),'utf8'),'keep\n');await assert.rejects(access(work));
});
