import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {fixture} from './fixture.mjs';
import {SCHEMA,withLock,migrate,files,checkHistory,backup,command} from '../server/src/migrate.mjs';
import {activateRelease,releaseSupportsSchema} from '../server/src/release.mjs';
import {mkdtemp,mkdir,writeFile,readlink,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateConfig,hashPassword} from '../server/src/config.mjs';

test('PostgreSQL18 + mock OSS：认证、图片校验、CRUD、版本冲突、故障、迁移与备份恢复',async t=>{
 const f=await fixture({port:55440});t.after(()=>f.close());const origin=f.config.origin;
 const request=async(path,{body,raw,method='GET',cookie,headers={}}={})=>fetch(f.url+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:raw|| (body?JSON.stringify(body):undefined)});
 const version=await f.pool.query('SHOW server_version');assert.match(version.rows[0].server_version,/^18\./);
 assert.equal((await request('/health')).status,200);
 assert.equal((await request('/api/images')).status,401);
 assert.equal((await request('/api/login',{method:'POST',body:{username:'admin',password:'bad'}})).status,401);
 let r=await request('/api/login',{method:'POST',body:{username:'admin',password:'test-admin-12345'}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await fetch(f.url+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.invalid'}})).status,403);
 const image=await sharp({create:{width:800,height:600,channels:3,background:'white'}}).png().toBuffer();
 const upload=(data=image,mime='image/png')=>request('/api/images',{method:'POST',cookie,raw:data,headers:{'Content-Type':mime,'X-File-Name':encodeURIComponent('测试.png')}});
 assert.equal((await upload(Buffer.from('not-image'))).status,400);
 assert.equal((await upload(image,'image/jpeg')).status,400);
 assert.equal((await upload(image,'text/html')).status,400);
 assert.equal((await upload(Buffer.alloc(21*1024*1024))).status,413);
 const oversized=await sharp({create:{width:20001,height:1,channels:3,background:'white'}}).png().toBuffer();assert.equal((await upload(oversized)).status,400);
 f.fail.put=true;assert.equal((await upload()).status,503);f.fail.put=false;assert.equal((await f.pool.query('SELECT * FROM omr_images')).rowCount,0);
 await f.pool.query("ALTER TABLE omr_images ADD CONSTRAINT injected_failure CHECK (original_name <> '测试.png')");assert.equal((await upload()).status,503);assert.equal(f.objects.size,0);await f.pool.query('ALTER TABLE omr_images DROP CONSTRAINT injected_failure');
 r=await upload();assert.equal(r.status,201);const initial=await r.json(),id=initial.image.id;assert.equal(initial.image.width,800);assert.equal(initial.image.height,600);assert.equal(initial.image.checksum.length,64);assert.equal(f.objects.size,1);assert.match([...f.objects.keys()][0],/^omr\/[a-f0-9-]{36}$/);
 const boxes=[{id:'a',x:100,y:100,width:200,height:150}];r=await request('/api/images/'+id,{method:'PUT',cookie,body:{version:1,boxes}});assert.equal(r.status,200);assert.equal((await r.json()).image.version,2);
 assert.equal((await request('/api/images/'+id,{method:'PUT',cookie,body:{version:1,boxes:[]}})).status,409);
 assert.equal((await request('/api/images/'+id,{method:'PUT',cookie,body:{version:2,boxes:[{id:'x',x:799,y:0,width:2,height:1}]}})).status,400);
 await f.pool.query("ALTER TABLE omr_images ADD CONSTRAINT save_failure CHECK(jsonb_array_length(boxes)<2)");assert.equal((await request('/api/images/'+id,{method:'PUT',cookie,body:{version:2,boxes:[...boxes,{...boxes[0],id:'second'}]}})).status,503);await f.pool.query('ALTER TABLE omr_images DROP CONSTRAINT save_failure');
 assert.deepEqual((await(await request('/api/images/'+id,{cookie})).json()).boxes,boxes);
 assert.deepEqual(Buffer.from(await(await request('/api/images/'+id+'/content',{cookie})).arrayBuffer()),image);
 assert.equal((await request('/api/images/'+id+'/content')).status,401);f.fail.get=true;assert.equal((await request('/api/images/'+id+'/content',{cookie})).status,503);f.fail.get=false;
 for(const format of ['jpeg','webp']){const data=await sharp(image)[format]().toBuffer();const response=await upload(data,'image/'+format);assert.equal(response.status,201);assert.equal((await response.json()).image.mime,'image/'+format)}
 // JSON roundtrip uses encoded original + pixel coordinates; new upload gets new safe ID.
 const reimport=await upload();assert.equal(reimport.status,201);const iid=(await reimport.json()).image.id;assert.notEqual(iid,id);assert.equal((await request('/api/images/'+iid,{cookie,method:'PUT',body:{version:1,boxes}})).status,200);
 await withLock(f.pool,async c=>{await assert.rejects(withLock(f.pool,()=>{}),/BUSY/);await migrate(c);assert.equal(await checkHistory(c),SCHEMA);let fs=await files();await assert.rejects(checkHistory(c,[{...fs[0],checksum:'bad'}]),/MISMATCH/);await assert.rejects(migrate(c,[...fs,{version:SCHEMA+1,name:String(SCHEMA+1).padStart(3,'0')+'-fail.sql',checksum:'test',sql:'CREATE TABLE should_rollback(id int); SELECT missing_function()'}]),/FAILED/);assert.equal((await c.query("SELECT to_regclass('public.should_rollback') t")).rows[0].t,null);assert.equal(await checkHistory(c),SCHEMA)});
 const directory=await mkdtemp(join(tmpdir(),'omr-backup-'));await assert.rejects(backup(f.config,directory,{run:async()=>{throw Error('INJECTED_BACKUP_FAILURE')}}),/INJECTED/);assert.equal(await checkHistory(f.pool),SCHEMA);
 const file=await backup(f.config,directory);assert.ok(file.endsWith('.dump'));
 // Restore into a separate isolated schema via new DB owned by the same test-only role.
 const pg=(await import('pg')).default;const admin=new pg.Client({host:'127.0.0.1',port:55440,user:'postgres',database:'postgres'});await admin.connect();await admin.query('CREATE DATABASE omr_restore OWNER xianji_omr');await admin.end();
 await command('pg_restore',['--single-transaction','--no-owner','--no-acl','-d','omr_restore',file],{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:'55440',PGUSER:'xianji_omr'}});
 const restore=new pg.Client({host:'127.0.0.1',port:55440,user:'xianji_omr',database:'omr_restore'});await restore.connect();assert.equal((await restore.query('SELECT * FROM omr_images')).rowCount,4);assert.deepEqual((await restore.query('SELECT boxes FROM omr_images WHERE id=$1',[id])).rows[0].boxes,boxes);await restore.end();
 const columns=(await f.pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='omr_images'")).rows;assert.ok(!columns.some(c=>c.data_type==='bytea'));assert.ok(!JSON.stringify(await(await request('/api/images',{cookie})).json()).includes('dataUrl'));
 // Exercise the exact production entrypoint and built static path; no storage request occurs.
 const configFile=join(f.dir,'entry-config.json');await writeFile(configFile,JSON.stringify({...f.config,port:55442,origin:'http://127.0.0.1:55442',oss:{prefix:'omr/',bucket:'mock-bucket',region:'oss-cn-beijing',endpoint:'https://mock-storage.aliyuncs.com',authMode:'ak',accessKeyId:'test-only',accessKeySecret:'test-only'}}),{mode:0o600});
 const child=spawn(process.execPath,[new URL('../server/src/index.mjs',import.meta.url).pathname],{env:{...process.env,OMR_CONFIG:configFile},stdio:['ignore','pipe','pipe']});
 let diagnostics='';child.stderr.on('data',d=>diagnostics+=String(d));try{await new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(String(d).includes('XIANJI_OMR_STARTED'))resolve()});child.once('exit',()=>reject(Error('ENTRYPOINT_FAILED '+diagnostics)));setTimeout(()=>reject(Error('ENTRYPOINT_TIMEOUT')),5000).unref()});assert.equal((await fetch('http://127.0.0.1:55442/health')).status,200);assert.match(await(await fetch('http://127.0.0.1:55442/')).text(),/id="stage"|\/_next\/static\//)}finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}}
 await request('/api/logout',{method:'POST',cookie});assert.equal((await request('/api/session',{cookie})).status,401);
});

test('原子发布失败：兼容回退，不兼容停服；不还原数据库',async()=>{
 const root=await mkdtemp(join(tmpdir(),'omr-release-'));const old=join(root,'old'),next=join(root,'next');for(const p of [old,next]){await mkdir(join(p,'server'),{recursive:true});await writeFile(join(p,'server/compatibility.json'),'{"schemaMin":1,"schemaMax":1}');await writeFile(join(p,'server/RELEASE'),p===old?'old':'next')};await symlink(old,join(root,'current'));let starts=0,stops=0;
 await assert.rejects(activateRelease({root,release:next,version:'next',restart:async()=>{starts++},health:async v=>{if(v==='next')throw Error()},compatible:p=>releaseSupportsSchema(p,1),stop:async()=>stops++}));assert.equal(await readlink(join(root,'current')),old);assert.equal(starts,2);assert.equal(stops,0);
 await assert.rejects(activateRelease({root,release:next,version:'next',restart:async()=>{},health:async()=>{throw Error()},compatible:async()=>false,stop:async()=>stops++}));assert.equal(stops,1);
});

test('配置隔离：禁止旧库、旧端口和宽松前缀',()=>{
 const c={host:'0.0.0.0',port:8790,origin:'http://localhost:8790',secureCookie:false,username:'admin',passwordHash:hashPassword('test-password'),database:{host:'localhost',port:5432,user:'xianji_omr',database:'xianji_omr',password:'local',sslMode:'disable'},oss:{bucket:'xianji-source',region:'oss-cn-beijing',endpoint:'https://oss-cn-beijing.aliyuncs.com',prefix:'omr/',authMode:'ram'}};assert.equal(validateConfig(c),c);assert.throws(()=>validateConfig({...c,port:8787}));assert.throws(()=>validateConfig({...c,database:{...c.database,database:'xianji'}}));assert.throws(()=>validateConfig({...c,oss:{...c.oss,prefix:'../'}}));
});
