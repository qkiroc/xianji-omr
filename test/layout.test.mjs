import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import sharp from 'sharp';
import {writeFile,readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {regions,canonicalAnnotation,digest} from '../server/src/annotation.mjs';
import {files,migrate,checkHistory,withLock} from '../server/src/migrate.mjs';
import {freezeSnapshot} from '../server/src/snapshots.mjs';
import {transformBox,coordinateImage} from '../server/src/images.mjs';
const root={id:'root',classKey:'system',parentSystemId:null,readingOrder:0,x:10,y:10,width:180,height:130};
const child={id:'tab',classKey:'guitar',parentSystemId:'root',readingOrder:1,x:20,y:40,width:150,height:60};
const sleep=()=>new Promise(r=>setTimeout(r,20));
test('七类、父子、负样本、等价拓扑（忽略ID但不忽略关系）',()=>{
 assert.equal(regions([root,child],200,160,{confirm:true}).length,2);
 for(const boxes of [[{...root,classKey:'wrong'}],[root,{...child,parentSystemId:null}],[root,{...child,x:0}],[root,{...child,id:'root'}],[{...root,x:.5}]])assert.throws(()=>regions(boxes,200,160,{confirm:true}));
 assert.throws(()=>regions([],200,160,{confirm:true}));assert.deepEqual(regions([],200,160,{confirm:true,pageType:'negative'}),[]);assert.throws(()=>regions([root],200,160,{confirm:true,pageType:'negative'}));
 assert.equal(canonicalAnnotation([root,child],'music'),canonicalAnnotation([{...child,id:'c2',parentSystemId:'r2'},{...root,id:'r2'}],'music'));assert.notEqual(canonicalAnnotation([root,child],'music'),canonicalAnnotation([root,{...child,readingOrder:2}],'music'));
});
test('PG18平台闭环：迁移、分组、多页、版本、确认、EXIF、快照导出和失败重试',async t=>{
 const f=await fixture({port:55441});t.after(()=>f.close());
 const req=async(path,options={})=>{const r=await fetch(f.url+'/api'+path,{...options,headers:{Origin:f.config.origin,...(cookie?{Cookie:cookie}:{}),...options.headers}});return{status:r.status,headers:r.headers,value:()=>r.json(),buffer:async()=>Buffer.from(await r.arrayBuffer())}};
 const json=(data,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});let cookie;
 cookie=(await req('/login',json({username:'admin',password:'test-admin-12345'}))).headers.get('set-cookie').split(';')[0];
 // Real v1 -> v2 upgrade in separate schema-preserving isolated database.
 const fs=await files();assert.equal(fs.length,3);assert.equal(await checkHistory(f.pool),3);await withLock(f.pool,c=>migrate(c));
 const ds=await(await req('/v2/datasets',json({name:'网格谱图',description:'test'}))).value();const song=await(await req('/v2/datasets/'+ds.id+'/songs',json({name:'同一首歌',songGroupKey:'song-a',split:'train'}))).value();
 assert.equal((await req('/v2/datasets/'+ds.id+'/songs',json({name:'另一谱本',songGroupKey:'song-a',split:'val'}))).status,409);
 const pageUpload=async(data,name='page.png',mime='image/png',s=song)=>{const r=await req('/v2/songs/'+s.id+'/pages',{method:'POST',headers:{'Content-Type':mime,'X-File-Name':encodeURIComponent(name)},body:data});const value=await r.value();assert.equal(r.status,201,JSON.stringify(value));return value};
 const data=await sharp({create:{width:200,height:160,channels:4,background:{r:200,g:100,b:50,alpha:.5}}}).composite([{input:Buffer.from('<svg width="200" height="160"><rect x="30" y="50" width="35" height="70" fill="#246bcd"/><rect x="90" y="20" width="70" height="50" fill="#dc3571"/></svg>')}]).png().toBuffer();let page=await pageUpload(data),duplicate=await pageUpload(data,'page-02.png');assert.equal(duplicate.image.pageOrder,2);
 const save=async(p,boxes=[root,child],extra={})=>{const r=await req('/v2/pages/'+p.image.id,json({version:p.image.version,annotationFormat:'layout-v1',boxes,pageType:'music',...extra},'PUT'));return{...r,data:await r.value()}};
 let result=await save(page);assert.equal(result.status,200);const stale=page;page=result.data;assert.equal((await save(stale)).status,409);
 assert.equal((await req('/images/'+page.image.id,json({version:page.image.version,boxes:[]},'PUT'))).status,409);
 assert.equal((await req('/v2/pages/'+page.image.id+'/confirm',json({version:page.image.version,acknowledged:false}))).status,400);
 page=await(await req('/v2/pages/'+page.image.id+'/confirm',json({version:page.image.version,acknowledged:true}))).value();assert.equal(page.image.status,'confirmed');
 duplicate=(await save(duplicate,[{...root,id:'r2'},{...child,id:'c2',parentSystemId:'r2'}])).data;duplicate=await(await req('/v2/pages/'+duplicate.image.id+'/confirm',json({version:duplicate.image.version,acknowledged:true}))).value();
 const frozen=await freezeSnapshot(f.pool,ds.id);assert.equal(frozen.frozen.stats.sourcePages,2);assert.equal(frozen.frozen.stats.uniqueImages,1);assert.equal(frozen.frozen.images[0].aliases.length,2);assert.equal(frozen.frozen.stats.sourceBoxes,4);assert.equal(frozen.frozen.stats.uniqueBoxes,2);
 // Incomplete registration simulates process restart; startup recovery never labels it ready.
 await f.app.locals.platform.exporter.recover();assert.equal((await f.pool.query('SELECT status FROM omr_snapshots WHERE id=$1',[frozen.id])).rows[0].status,'failed');
 const retry=await req('/v2/snapshots/'+frozen.id+'/retry',json({}));assert.equal(retry.status,202);assert.equal((await req('/v2/snapshots/'+frozen.id+'/detection')).status,409);await f.app.locals.platform.exporter.idle();
 let snap=(await f.pool.query('SELECT * FROM omr_snapshots WHERE id=$1',[frozen.id])).rows[0];assert.equal(snap.status,'ready',snap.error);assert.equal(snap.manifest.stats.uniqueImages,1);assert.equal(snap.manifest.stats.uniqueBoxes,2);assert.ok(!JSON.stringify(snap.manifest).includes('object_key'));assert.ok(!JSON.stringify(snap.manifest).includes('omr/'));
 const temp=await mkdtemp(join(tmpdir(),'omr-package-test-'));for(const kind of ['detection','crops']){const file=join(temp,kind+'.zip'),r=await req('/v2/snapshots/'+frozen.id+'/'+kind);assert.equal(r.status,200);const bytes=await r.buffer();assert.equal(digest(bytes),snap.artifacts[kind].checksum);await writeFile(file,bytes)}
 const validated=spawnSync('python3',[new URL('../tools/validate-export.py',import.meta.url).pathname,join(temp,'detection.zip'),join(temp,'crops.zip')],{encoding:'utf8'});assert.equal(validated.status,0,validated.stdout+validated.stderr);
 // Decode exported crops and compare every RGBA pixel against exact source extraction.
 const extracted=spawnSync('python3',['-c',"import zipfile,json,base64,sys;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([{**c,'bytes':base64.b64encode(z.read(c['path'])).decode()} for c in json.loads(z.read('sources.json'))]))",join(temp,'crops.zip')],{encoding:'utf8'});assert.equal(extracted.status,0,extracted.stderr);
 for(const crop of JSON.parse(extracted.stdout)){const b=crop.box,expected=await sharp(data).extract({left:b.x,top:b.y,width:b.width,height:b.height}).ensureAlpha().raw().toBuffer(),actual=await sharp(Buffer.from(crop.bytes,'base64')).ensureAlpha().raw().toBuffer();assert.deepEqual(actual,expected)}
 await assert.rejects(f.pool.query("UPDATE omr_snapshots SET frozen='{}' WHERE id=$1",[frozen.id]));
 await assert.rejects(f.pool.query("UPDATE omr_snapshots SET manifest='{}' WHERE id=$1",[frozen.id]));
 page=(await save(page,[root,{...child,width:140}])).data;assert.equal(page.image.status,'draft');assert.deepEqual((await f.pool.query('SELECT frozen FROM omr_snapshots WHERE id=$1',[frozen.id])).rows[0].frozen,frozen.frozen);
 page=await(await req('/v2/pages/'+page.image.id+'/confirm',json({version:page.image.version,acknowledged:true}))).value();await assert.rejects(freezeSnapshot(f.pool,ds.id),/标注不一致/);
 // Force same original onto val under a different group: image identity leak is rejected at export.
 const val=await(await req('/v2/datasets/'+ds.id+'/songs',json({name:'不同分组',songGroupKey:'other',split:'val'}))).value();duplicate=(await save(duplicate,[root,child],{songId:val.id,pageOrder:1})).data;duplicate=await(await req('/v2/pages/'+duplicate.image.id+'/confirm',json({version:duplicate.image.version,acknowledged:true}))).value();await assert.rejects(freezeSnapshot(f.pool,ds.id),/跨split/);
 // Failure leaves same frozen source retryable; no partial download and no source mutation.
 f.fail.get=true;const failedId=await f.app.locals.platform.exporter.launch(ds.id,frozen.id).catch(()=>null);assert.equal(failedId,null); // ready cannot retry
 const failure=(await f.pool.query('INSERT INTO omr_snapshots(id,dataset_id,frozen,status) VALUES(gen_random_uuid(),$1,$2,\'failed\') RETURNING id',[ds.id,frozen.frozen])).rows[0].id;await f.app.locals.platform.exporter.launch(null,failure);await f.app.locals.platform.exporter.idle();assert.equal((await f.pool.query('SELECT status FROM omr_snapshots WHERE id=$1',[failure])).rows[0].status,'failed');assert.equal((await req('/v2/snapshots/'+failure+'/detection')).status,409);f.fail.get=false;await f.app.locals.platform.exporter.launch(null,failure);await f.app.locals.platform.exporter.idle();assert.equal((await f.pool.query('SELECT status FROM omr_snapshots WHERE id=$1',[failure])).rows[0].status,'ready');
 // EXIF rotate/mirror and alpha preserve exact coordinate image dimensions.
 for(const o of [2,3,5,6,7,8]){const jpg=await sharp(data).jpeg().withMetadata({orientation:o}).toBuffer(),p=await pageUpload(jpg,'exif.jpg','image/jpeg');assert.equal(p.image.width,o>=5?160:200);assert.equal(p.image.height,o>=5?200:160);assert.equal(p.image.coordinate.orientation,o);const content=await(await req('/v2/pages/'+p.image.id+'/content')).buffer(),m=await sharp(content).metadata();assert.ok(!m.orientation);assert.equal(m.width,p.image.width);assert.equal(digest(content),p.image.coordinate.working.checksum);assert.deepEqual(await(await req('/v2/pages/'+p.image.id+'/content?original=1')).buffer(),jpg)}
 // Invalid parent, negative sample, missing class and page order conflicts are rejected.
 const neg=await pageUpload(await sharp(data).negate().png().toBuffer(),'negative.png');assert.equal((await save(neg,[root,{...child,parentSystemId:null}])).status,200);let orphan=(await(await req('/v2/pages/'+neg.image.id)).value());assert.equal((await req('/v2/pages/'+neg.image.id+'/confirm',json({version:orphan.image.version,acknowledged:true}))).status,400);orphan=(await save(orphan,[],{pageType:'negative'})).data;assert.equal((await req('/v2/pages/'+orphan.image.id+'/confirm',json({version:orphan.image.version,acknowledged:true}))).status,200);
 const count=(await req('/v2/datasets')).value();assert.ok((await count).find(d=>d.id===ds.id).confirmed_count>0);
});
test('schema1真实升级保留原框/版本/会话；legacy转换不得成为自动真值',async t=>{
 const f=await fixture({port:55443,migrationVersion:1});t.after(()=>f.close());assert.equal(await checkHistory(f.pool),1);const image=await sharp({create:{width:200,height:160,channels:3,background:'white'}}).png().toBuffer(),id='11111111-1111-4111-8111-111111111111',boxes=[{id:'old-id',x:20,y:30,width:100,height:70}];
 f.objects.set('omr/old-object',image);await f.pool.query('INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,boxes,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,7)',[id,'omr/old-object','legacy.png','image/png',200,160,digest(image),JSON.stringify(boxes)]);await f.pool.query("INSERT INTO omr_sessions VALUES($1,$2,now()+interval '1 day')",['a'.repeat(64),'b'.repeat(64)]);
 await withLock(f.pool,c=>migrate(c));await withLock(f.pool,c=>migrate(c));assert.equal(await checkHistory(f.pool),3);const row=(await f.pool.query('SELECT * FROM omr_images WHERE id=$1',[id])).rows[0];assert.equal(row.version,7);assert.deepEqual(row.boxes,boxes);assert.equal(row.annotation_format,'legacy');assert.equal(row.status,'draft');assert.equal(row.coordinate,null);assert.equal((await f.pool.query('SELECT count(*) n FROM omr_sessions')).rows[0].n,'1');assert.equal((await f.pool.query('SELECT name FROM omr_datasets WHERE id=$1',['00000000-0000-4000-8000-000000000001'])).rows[0].name,'历史未归类');
});
