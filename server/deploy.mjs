import {loadConfig,poolFor} from './src/config.mjs';
import {withLock,checkHistory,files,migrate,backup,command,SCHEMA} from './src/migrate.mjs';
import {activateRelease,releaseSupportsSchema} from './src/release.mjs';
import {resolve,join} from 'node:path';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
const release=resolve(process.argv[2]||''),root='/opt/xianji-omr';let phase='configuration',pool;
const step=s=>{phase=s;console.log('阶段：'+s)};
try{
 if(!release.startsWith(root+'/releases/')||!/^\d{8}T\d{6}Z-[a-f0-9]{12}-\d+$/.test(release.split('/').at(-1)))throw Error('RELEASE_PATH');
 const config=await loadConfig();step('port-ownership');
 const probe=createServer();const busy=await new Promise((resolve,reject)=>{probe.once('error',e=>e.code==='EADDRINUSE'?resolve(true):reject(Error('PORT_BIND_FAILED')));probe.listen(config.port,config.host,()=>probe.close(()=>resolve(false)))});
 if(busy){const pid=execFileSync('systemctl',['show','--property=MainPID','--value','xianji-omr.service'],{encoding:'utf8'}).trim(),sockets=execFileSync('ss',['-H','-ltnp',`sport = :${config.port}`],{encoding:'utf8'}),pids=[...sockets.matchAll(/pid=(\d+)/g)].map(m=>m[1]);if(!pid||pid==='0'||!pids.length||pids.some(p=>p!==pid))throw Error('PORT_OWNED_BY_ANOTHER_PROCESS')}
 try{const st=await lstat(join(root,'current'));if(!st.isSymbolicLink()||!(await realpath(join(root,'current'))).startsWith(root+'/releases/'))throw Error('CURRENT_PATH_CONFLICT')}catch(e){if(e.code!=='ENOENT')throw e}
 if(process.argv.includes('--preflight'))process.exit(0);
 pool=await poolFor(config);await withLock(pool,async c=>{
  step('database-isolation');const r=(await c.query('SELECT current_database() db,current_user usr,rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];if(r.db!=='xianji_omr'||r.usr!=='xianji_omr'||r.rolsuper)throw Error('DEDICATED_NON_SUPERUSER_REQUIRED');
  if(Math.floor(Number((await c.query('SHOW server_version_num')).rows[0].server_version_num)/10000)!==18)throw Error('POSTGRES_18_REQUIRED');
  const fs=await files();if(fs.length!==SCHEMA)throw Error('SCHEMA_MANIFEST');const schema=await checkHistory(c,fs);if(!schema&&(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rowCount)throw Error('INITIAL_DATABASE_NOT_EMPTY');
  step('backup-before-migration');await backup(config,'/var/backups/xianji-omr');step('migrate');await migrate(c,fs);
  const version=(await readFile(join(release,'server/RELEASE'),'utf8')).trim();
  const health=async expected=>{for(let i=0;i<25;i++){try{const base=`http://127.0.0.1:${config.port}`,r=await fetch(base+'/health',{signal:AbortSignal.timeout(2000)}),v=await r.json(),w=await fetch(base+'/__release.json',{signal:AbortSignal.timeout(2000)}),j=await w.json(),page=await fetch(base,{signal:AbortSignal.timeout(2000)});if(r.ok&&v.ok&&v.release===expected&&w.ok&&j.release===expected&&page.ok&&(await page.text()).includes('/_next/static/'))return}catch{}await new Promise(r=>setTimeout(r,400))}throw Error('HEALTH_FAILED')};
  step('atomic-activate');await activateRelease({root,release,version,restart:()=>command('systemctl',['restart','xianji-omr.service']),stop:()=>command('systemctl',['stop','xianji-omr.service']),health,compatible:p=>releaseSupportsSchema(p,SCHEMA)});
 });
}catch{console.error('DEPLOYMENT_FAILED phase='+phase+'（原始错误已隐藏，避免泄露凭据；无数据库自动回滚）');process.exitCode=1}finally{await pool?.end()}
