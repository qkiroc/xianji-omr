import {loadConfig,poolFor} from './config.mjs';
import {assertSchema} from './migrate.mjs';
import {ossStorage} from './storage.mjs';
import {createApp} from './app.mjs';
import {readFile} from 'node:fs/promises';
let pool;
try{
 const config=await loadConfig();pool=await poolFor(config);await assertSchema(pool);
 const role=(await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];if(role?.rolsuper)throw Error('NON_SUPERUSER_REQUIRED');
 const release=await readFile(new URL('../RELEASE',import.meta.url),'utf8').catch(()=>'development');
 const app=createApp({config,pool,storage:ossStorage(config.oss),staticDir:new URL('../static/',import.meta.url).pathname,release:release.trim()});
 const server=app.listen(config.port,config.host,()=>console.log('XIANJI_OMR_STARTED'));server.on('error',()=>{console.error('LISTEN_FAILED');process.exitCode=1;void pool.end()});
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;server.close(async()=>{await pool.end();process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}catch{console.error('STARTUP_FAILED_CHECK_CONFIG_SCHEMA');await pool?.end();process.exitCode=1}
