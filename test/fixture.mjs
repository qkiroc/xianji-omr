import {createHash,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import pg from 'pg';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashPassword,poolFor} from '../server/src/config.mjs';
import {withLock,migrate,files,SCHEMA} from '../server/src/migrate.mjs';
import {createApp} from '../server/src/app.mjs';
export async function fixture({port=55439,webPort=0,host='0.0.0.0',tempRoot=process.env.OMR_TEST_TMP_DIR||tmpdir(),origin,previewLogin=false,migrationVersion=SCHEMA,webHandler,development=false,appFactory=createApp}={}){
 await mkdir(tempRoot,{recursive:true});
 const dir=await mkdtemp(join(tempRoot,'omr-isolated-'));
 const platform=process.platform==='win32'?'windows':process.platform;
 const packageRoot=new URL('../node_modules/@embedded-postgres/'+platform+'-'+process.arch+'/native/',import.meta.url);
 const binaries=fileURLToPath(new URL('bin/',packageRoot));
 let shim=process.env.OMR_TEST_ROOT_SHIM;
 if(process.getuid?.()===0&&!shim){shim=join(dir,'root-namespace-test.so');const p=spawn('gcc',['-shared','-fPIC',new URL('./root-namespace-shim.c',import.meta.url).pathname,'-ldl','-o',shim],{stdio:'ignore'});if((await once(p,'exit'))[0]!==0)throw Error('ROOT_NAMESPACE_TEST_SHIM_COMPILE_FAILED')}
 const env={...process.env,LD_LIBRARY_PATH:fileURLToPath(new URL('lib/',packageRoot)),...(shim?{LD_PRELOAD:shim}:{})};
 const run=async(bin,args)=>{const p=spawn(join(binaries,bin+(process.platform==='win32'?'.exe':'')),args,{env,stdio:'inherit',windowsHide:true});const [code]=await once(p,'exit');if(code!==0){if(bin==='pg_ctl')console.error(await readFile(join(dir,'postgres.log'),'utf8').catch(()=>''));throw Error('ISOLATED_PG_'+bin+'_FAILED')}};
 await run('initdb',['-D',join(dir,'pg'),'-U','postgres','--auth=trust','--no-locale','-E','UTF8']);
 // pg_ctl parses -o through the platform shell; Windows preserves single quotes literally.
 // Put the empty socket directory in the config so both Windows and Unix disable sockets.
 await appendFile(join(dir,'pg','postgresql.conf'), "\nunix_socket_directories = ''\n");
 await run('pg_ctl',['-D',join(dir,'pg'),'-l',join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=20 -c shared_buffers=16MB`,'-w','start']);
 const cluster={async stop(){await run('pg_ctl',['-D',join(dir,'pg'),'-m','fast','-w','stop'])}};
 const admin=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'isolated-test-only',database:'postgres'});
 try {
  await admin.connect();
  await admin.query("CREATE USER xianji_omr PASSWORD 'isolated-app-only' NOSUPERUSER NOCREATEDB NOCREATEROLE");await admin.query('CREATE DATABASE xianji_omr OWNER xianji_omr');
 } catch(error) {
  await admin.end().catch(()=>{});
  await cluster.stop().catch(()=>{});
  throw error;
 }
 await admin.end();
 const config={host:'127.0.0.1',port:webPort,origin:origin||'http://127.0.0.1',secureCookie:false,username:'admin',passwordHash:hashPassword('test-admin-12345'),database:{host:'127.0.0.1',port,database:'xianji_omr',user:'xianji_omr',password:'isolated-app-only',sslMode:'disable'},oss:{prefix:'omr/'}};
 const pool=await poolFor(config);await withLock(pool,async c=>migrate(c,(await files()).slice(0,migrationVersion)));
 const objects=new Map,fail={put:false,get:false,delete:false};const storage={async put(k,d){if(fail.put)throw Error('MOCK_STORAGE_DOWN');objects.set(k,Buffer.from(d))},async putStream(k,stream){const chunks=[];for await(const b of stream)chunks.push(b);await this.put(k,Buffer.concat(chunks))},async getStream(k){return Readable.from(await this.get(k))},async get(k){if(fail.get||!objects.has(k))throw Error('MOCK_STORAGE_DOWN');return objects.get(k)},async delete(k){if(fail.delete)throw Error('MOCK_STORAGE_DOWN');objects.delete(k)}};
 const app=appFactory({config,pool,storage,development,staticDir:new URL('../server/static/',import.meta.url).pathname,release:'isolated-test',webHandler});if(previewLogin){app.get('/__test-login',async(req,res)=>{const token=randomBytes(32).toString('hex'),hash=s=>createHash('sha256').update(s).digest('hex');await pool.query("INSERT INTO omr_sessions VALUES($1,$2,now()+interval '1 day')",[hash(token),hash(config.passwordHash)]);res.cookie('omr_session',token,{httpOnly:true,sameSite:'strict'});res.redirect('/')});app.router.stack.unshift(app.router.stack.pop())}const server=app.listen(webPort,host);await new Promise(r=>server.once('listening',r));if(!origin)config.origin='http://127.0.0.1:'+server.address().port;
 return {app,config,pool,cluster,storage,objects,fail,dir,server,url:'http://127.0.0.1:'+server.address().port,async close(){await app.locals.platform.exporter.idle();await new Promise(r=>server.close(r));await pool.end();await cluster.stop()}};
}
