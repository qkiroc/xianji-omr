import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {platformCommand} from '../tools/cli/src/deploy.mjs';
import {CliError,args} from '../tools/cli/src/input.mjs';
import {VERSION} from '../tools/cli/src/version.mjs';
const id='11111111-1111-4111-8111-111111111111',commit='a'.repeat(40);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('HTTP部署：只向平台POST一次，requestId可复用，默认异步返回，不使用SSH/本地Git',async()=>{
 const calls=[],events=[];
 const result=await platformCommand(['platform','deploy'],{'request-id':id},{report:e=>events.push(e),request:async(path,options)=>{calls.push({path,options});return json({job:{id,status:'queued'}})}});
 assert.equal(result.accepted,true);assert.equal(result.job.id,id);assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/platform/deployments');assert.equal(calls[0].options.method,'POST');
 assert.deepEqual(JSON.parse(calls[0].options.body),{requestId:id});
 assert.equal(events[0].jobId,id);
 for(const opts of [{host:'ecs'},{artifact:'x.tar.gz'},{'request-id':'bad'}])await assert.rejects(platformCommand(['platform','deploy'],opts,{request:()=>assert.fail('不能请求平台')}),e=>['ARGUMENT','INPUT'].includes(e.code));
 assert.equal(args(['auth','--deploy']).options.deploy,true);assert.equal(args(['platform','deploy','--wait']).options.wait,true);
});
test('等待部署：平台重启期间仅重试GET，成功前不输出deployed，进度日志在report',async()=>{
 const events=[],calls=[];let polls=0;
 const result=await platformCommand(['platform','deploy'],{wait:true,'request-id':id},{
  report:e=>events.push(e),sleep:async()=>{},
  request:async(path,options)=>{
   calls.push({path,options});
   if(options?.method==='POST')return json({job:{id,status:'queued',phase:'queued',logs:[]}});
   if(++polls===1)throw new CliError('HTTP_ERROR','restarting',6,503);
   return json({job:{id,status:polls<3?'running':'succeeded',phase:polls<3?'build-and-deploy':'succeeded',commit,logs:[{time:'now',message:'safe build log'}]}});
  }});
 assert.equal(result.deployed,true);assert.equal(result.job.commit,commit);assert.equal(calls.filter(c=>c.options?.method==='POST').length,1);
 assert.ok(events.some(e=>e.phase==='reconnecting'));assert.equal(events.filter(e=>e.log).length,1);
});
test('失败/403/中断不自动重发部署；停止本地等待后保留任务ID',async()=>{
 for(const status of ['failed','interrupted'])await assert.rejects(platformCommand(['platform','deploy'],{wait:true,'request-id':id},{report:()=>{},request:async()=>json({job:{id,status,error:'build failed'}})}),e=>e.code==='DEPLOY_FAILED');
 let calls=0;
 await assert.rejects(platformCommand(['platform','deploy'],{'request-id':id},{report:()=>{},request:async()=>{calls++;throw new CliError('PERMISSION','denied',4,403)}}),e=>e.exit===4);assert.equal(calls,1);
 const controller=new AbortController();
 await assert.rejects(platformCommand(['platform','deploy'],{wait:true,'request-id':id},{signal:controller.signal,report:()=>{},request:async()=>json({job:{id,status:'queued'}}),sleep:async()=>{controller.abort();throw Error('aborted')}}),e=>e.code==='INTERRUPTED'&&e.exit===130&&e.message.includes(id));
});
test('状态与日志使用平台GET接口，不要求本机SSH权限',async()=>{
 const calls=[],job={id,status:'running',phase:'fetch',logs:[{message:'fetch main'}]};
 const request=async path=>{calls.push(path);return json({job,current:{commit:'old'}})};
 assert.equal((await platformCommand(['platform','status'],{},{request})).current.commit,'old');
 assert.deepEqual((await platformCommand(['platform','logs',id],{},{request})).logs,job.logs);
 assert.deepEqual(calls,['/api/platform/deployments/latest','/api/platform/deployments/'+id]);
});
async function cli(entry,argv,env){return new Promise((yes,no)=>{const p=spawn(process.execPath,[entry,...argv],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',no);p.on('close',code=>yes({code,stdout,stderr}));});}
test('离线CLI包可直接用已授权Bearer调用部署接口，无npm/Git/SSH依赖',async t=>{
 const root=await mkdtemp(join(tmpdir(),'omr-http-cli-')),out=join(root,'dist');
 const pack=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/package-cli.mjs',import.meta.url)),'--output',out],{encoding:'utf8'});
 assert.equal(pack.status,0,pack.stderr);const archive=JSON.parse(pack.stdout).archive;
 assert.equal(spawnSync('tar',['-xzf',archive,'-C',out]).status,0);
 const dir=join(out,'xianji-omr-cli-'+VERSION),manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8'));
 assert.ok(!Object.keys(manifest.files).some(p=>p.startsWith('src/deploy/')));
 const token='omr_cli_'+'b'.repeat(64),job={id,status:'queued',phase:'queued',logs:[]},calls=[];
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer '+token);calls.push(req.method+' '+req.url);
  let body='';for await(const c of req)body+=c;
  if(req.method==='POST')assert.deepEqual(JSON.parse(body),{requestId:id});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({job}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port,config=join(root,'config','xianji-omr');await mkdir(config,{recursive:true,mode:0o700});
 await writeFile(join(config,createHash('sha256').update(origin).digest('hex')+'.json'),JSON.stringify({origin,token,scopes:['platform:deploy']}),{mode:0o600});
 const env={XDG_CONFIG_HOME:join(root,'config'),APPDATA:join(root,'config')};
 for(const argv of [['platform','deploy','--request-id',id],['platform','status',id],['platform','logs',id]]){
  const result=await cli(join(dir,'xianji-omr.mjs'),[...argv,'--origin',origin],env);assert.equal(result.code,0,result.stderr);assert.ok(JSON.parse(result.stdout));
 }
 assert.deepEqual(calls,['POST /api/platform/deployments','GET /api/platform/deployments/'+id,'GET /api/platform/deployments/'+id]);
});
