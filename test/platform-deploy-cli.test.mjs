import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {platformCommand,connection,runProcess} from '../tools/cli/src/deploy.mjs';
import {args} from '../tools/cli/src/input.mjs';
const commit='a'.repeat(40),sha='b'.repeat(64);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'omr-platform-test-')),source=join(root,'source'),archive=join(root,'release with spaces.tar.gz');
 await mkdir(source);
 const manifest={format:'xianji-omr-standalone-v1',platform:'linux',arch:'x64',nodeMajor:22,commit,schema:8,files:{}};
 await writeFile(join(source,'artifact.json'),JSON.stringify(manifest));
 const tar=spawnSync('tar',['-czf',archive,'-C',source,'.'],{encoding:'utf8'});
 assert.equal(tar.status,0,tar.stderr);
 const checksum=createHash('sha256').update(await readFile(archive)).digest('hex');
 await writeFile(archive+'.sha256',checksum+'  '+archive+'\n');
 return{root,archive,checksum,manifest};
}
test('部署预演：真实tar/摘要/带空格路径、Node入口无需origin或平台登录',async()=>{
 const f=await fixture(),events=[],calls=[];
 const result=await platformCommand(['platform','deploy'],{host:'omr-ecs',artifact:f.archive,'dry-run':true},{report:e=>events.push(e),run:async(...a)=>{calls.push(a);return runProcess(...a)}});
 assert.equal(result.dryRun,true);assert.equal(result.remoteChecked,false);assert.equal(result.commit,commit);assert.equal(result.sha256,f.checksum);
 assert.deepEqual(calls.map(c=>c[0]),['tar']);assert.equal(events[0].phase,'verify-package');
 const cli=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/cli/xianji-omr.mjs',import.meta.url)),'platform','deploy','--host','omr-ecs','--artifact',f.archive,'--dry-run'],{encoding:'utf8',env:{...process.env,XDG_CONFIG_HOME:join(f.root,'no-platform-login'),APPDATA:join(f.root,'no-platform-login')}});
 assert.equal(cli.status,0,cli.stderr);assert.equal(JSON.parse(cli.stdout).commit,commit);
});
test('SSH部署：上传校验包和独立脚本，免密sudo/noTTY，完成后清理，stdout返回固定commit',async()=>{
 const f=await fixture(),calls=[],events=[];
 const run=async(bin,argv,options)=>{calls.push({bin,argv,options});return bin==='tar'?runProcess(bin,argv,options):{code:0,stdout:'',stderr:''}};
 const r=await platformCommand(['platform','deploy'],{host:'admin@ecs.example',port:'2222',identity:join(f.root,'key'),artifact:f.archive},{run,report:e=>events.push(e)});
 assert.equal(r.deployed,true);assert.equal(r.commit,commit);assert.equal(r.sha256,f.checksum);
 assert.ok(calls.findIndex(c=>c.bin==='ssh'&&c.argv.at(-1).includes('test -f /etc/xianji-omr/config.json'))<calls.findIndex(c=>c.bin==='scp'));
 const transfers=calls.filter(c=>c.bin==='scp');assert.equal(transfers.length,4);
 assert.equal(transfers[0].argv.at(-2),'./release with spaces.tar.gz');assert.equal(transfers[0].options.cwd,f.root);
 for(const c of transfers){assert.ok(c.argv.includes('BatchMode=yes'));assert.ok(c.argv.includes('StrictHostKeyChecking=yes'));assert.ok(c.argv.includes('-P'));assert.ok(!c.argv.includes('-T'));}
 const deploy=calls.find(c=>c.bin==='ssh'&&c.argv.at(-1).includes('--non-interactive'));
 assert.ok(deploy);assert.match(deploy.argv.at(-1),/sudo -n --/);assert.ok(deploy.argv.includes('-T'));
 assert.ok(deploy.argv.at(-1).includes("'--commit' '"+commit+"'"));assert.match(deploy.argv.at(-1),/--sha256/);
 assert.ok(!calls.some(c=>c.argv.join(' ').includes('git ')));
 const cleanup=calls.at(-1).argv.at(-1);assert.match(cleanup,/rm -f --/);assert.match(cleanup,/rmdir --/);assert.ok(!cleanup.includes('rm -r'));
 await assert.rejects(access(transfers[1].options.cwd)); // local scripts are removed
 assert.ok(events.some(e=>e.phase==='deploy'));
});
test('错误摘要/目标参数在连接ECS前拒绝，未知参数不被当成业务授权',async()=>{
 const f=await fixture(),calls=[];
 const run=async(...a)=>{calls.push(a);return runProcess(...a)};
 await assert.rejects(platformCommand(['platform','deploy'],{host:'omr-ecs',artifact:f.archive,sha256:sha},{run,report:()=>{}}),e=>e.code==='INTEGRITY');
 assert.equal(calls.length,0);
 for(const host of ['-oProxyCommand=bad','user@host;touch bad','user@host\nbad','user@host:22',"host'bad",'user@@host'])assert.throws(()=>connection({host}),e=>e.code==='INPUT');
 for(const port of ['0','65536','22;bad'])assert.throws(()=>connection({host:'omr-ecs',port}),e=>e.code==='INPUT');
 await assert.rejects(platformCommand(['platform','deploy'],{host:'omr-ecs',artifact:f.archive,origin:'https://example.com'},{run}),e=>e.code==='ARGUMENT');
 const parsed=args(['platform','deploy','--host','omr-ecs','--artifact','x.tar.gz','--dry-run']);assert.equal(parsed.options['dry-run'],true);
 assert.ok(!connection({host:'omr-ecs'}).ssh.includes('-p')); // SSH config Port remains effective.
});
test('上传失败清理暂存；远端部署失败保留包并提示查询，绝不报告成功',async()=>{
 const f=await fixture();
 for(const failAt of ['upload','deploy']){
  const calls=[],events=[];
  const run=async(bin,argv,opts)=>{
   calls.push({bin,argv});
   if(bin==='tar')return runProcess(bin,argv,opts);
   return{code:bin==='scp'&&failAt==='upload'||bin==='ssh'&&argv.at(-1).includes('--non-interactive')&&failAt==='deploy'?1:0,stdout:'',stderr:'test failure'};
  };
  await assert.rejects(platformCommand(['platform','deploy'],{host:'omr-ecs',artifact:f.archive},{run,report:e=>events.push(e)}),e=>e.code==='DEPLOY_TRANSPORT');
  assert.equal(calls.some(c=>c.argv.at(-1).startsWith('rm -f')),failAt==='upload');
  assert.equal(events.some(e=>e.phase==='remote-result-unknown'),failAt==='deploy');
 }
});
test('查询状态只通过SSH读取明确字段，不需要artifact和平台auth',async()=>{
 const calls=[],value={service:'active',commit,release:'version',health:{ok:true,schema:8,release:'version'}};
 const r=await platformCommand(['platform','status'],{host:'omr-ecs'},{report:()=>{},run:async(bin,argv)=>{calls.push({bin,argv});return{code:0,stdout:JSON.stringify(value),stderr:''}}});
 assert.deepEqual(r,{host:'omr-ecs',...value});assert.equal(calls.length,1);assert.equal(calls[0].bin,'ssh');
 assert.match(calls[0].argv.at(-1),/sudo -n/);assert.ok(!calls[0].argv.at(-1).includes('console.log(config'));
});
test('真实子进程支持取消，不启本地shell；部署取消后提示远端结果未知',async()=>{
 const abort=new AbortController();setTimeout(()=>abort.abort(),50);
 await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:abort.signal}),e=>e.name==='AbortError');
 const f=await fixture(),controller=new AbortController(),events=[],calls=[];
 const run=async(bin,argv,opts)=>{
  calls.push(argv);
  if(bin==='tar')return runProcess(bin,argv,opts);
  if(bin==='ssh'&&argv.at(-1).includes('--non-interactive')){controller.abort();throw Object.assign(new Error('aborted'),{name:'AbortError'});}
  return{code:0,stdout:'',stderr:''};
 };
 await assert.rejects(platformCommand(['platform','deploy'],{host:'omr-ecs',artifact:f.archive},{signal:controller.signal,run,report:e=>events.push(e)}),e=>e.code==='DEPLOY_TIMEOUT'&&e.exit===130);
 assert.ok(events.some(e=>e.phase==='remote-result-unknown'));assert.ok(!calls.some(argv=>argv.at(-1).startsWith('rm -f')));
});
test('离线CLI归档包含部署脚本，解包后可独立执行platform预演',async()=>{
 const f=await fixture(),output=join(f.root,'cli-dist');
 const pack=spawnSync(process.execPath,[fileURLToPath(new URL('../tools/package-cli.mjs',import.meta.url)),'--output',output],{encoding:'utf8'});
 assert.equal(pack.status,0,pack.stderr);
 const archive=JSON.parse(pack.stdout).archive,extract=spawnSync('tar',['-xzf',archive,'-C',output],{encoding:'utf8'});
 assert.equal(extract.status,0,extract.stderr);
 const root=join(output,'xianji-omr-cli-0.6.0'),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
 for(const name of ['artifact.mjs','bootstrap.sh','deploy.sh'])assert.ok(manifest.files['src/deploy/'+name]);
 const result=spawnSync(process.execPath,[join(root,'xianji-omr.mjs'),'platform','deploy','--host','omr-ecs','--artifact',f.archive,'--dry-run'],{encoding:'utf8',cwd:f.root});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).commit,commit);
});
