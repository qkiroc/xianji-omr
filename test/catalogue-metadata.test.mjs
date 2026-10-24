import {test} from 'node:test';import assert from 'node:assert/strict';import {fixture} from './fixture.mjs';import {cookieFor,grantFor,request,json} from './cli-helpers.mjs';import sharp from 'sharp';import {freezeSnapshot} from '../server/src/snapshots.mjs';import {regions,CATEGORIES,ALL_CATEGORIES,canonicalAnnotation} from '../server/src/annotation.mjs';import {files,withLock,migrate,checkHistory} from '../server/src/migrate.mjs';import {writeFile,mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const root={id:'line',classKey:'system',parentSystemId:null,readingOrder:0,x:0,y:0,width:200,height:160};
export const metadataBoxes=[['title',{rawText:'多行\n标题',scope:'page',value:{text:'多行标题'}}],['performer',{rawText:'演唱：张三',scope:'global',value:{name:'张三',role:'performer'}}],['time_signature',{rawText:'6/8',scope:'local',value:{numerator:6,denominator:8}}],['key_signature',{rawText:'1=E♭',scope:'global',value:{kind:'original',tonic:'E♭'}}],['tempo',{rawText:'附点四分音符 = 72',scope:'local',value:{bpm:72,beatUnit:4,dotted:true}}],['capo',{rawText:'Capo=0（不夹）',scope:'page',value:{fret:0}}]].map(([classKey,metadata],i)=>({id:'meta-'+i,classKey,parentSystemId:metadata.scope==='local'?'line':null,readingOrder:i+1,x:10,y:10+i*20,width:120,height:15,metadata}));
async function setup(f){const cookie=await cookieFor(f),grant=await grantFor(f,cookie);const api=async(path,options={},status=200)=>{const r=await request(f,'/api'+path,{...options,headers:{Authorization:'Bearer '+grant.token,...options.headers}});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value};const ds=await api('/v2/datasets',json({name:'分页与元信息'}),201),song=await api('/v2/datasets/'+ds.id+'/songs',json({name:'曲目A',songGroupKey:'song-a',split:'train'}),201),data=await sharp({create:{width:200,height:160,channels:3,background:'white'}}).png().toBuffer();const upload=async(name='same.png',s=song)=>api('/v2/songs/'+s.id+'/pages',{method:'POST',headers:{'Content-Type':'image/png','X-File-Name':encodeURIComponent(name)},body:data},201);return{api,ds,song,upload,grant}}
test('六类元信息原文/结构化值/空值、Capo0、拍单位附点/范围和旧七类ID不变',()=>{assert.deepEqual(ALL_CATEGORIES.slice(0,7),CATEGORIES);const boxes=regions([root,...metadataBoxes],200,160,{confirm:true,taxonomyVersion:'layout-v2'});assert.deepEqual(boxes,[root,...metadataBoxes]);for(const classKey of ['title','performer','time_signature','key_signature','tempo','capo']){const b={...metadataBoxes[0],classKey,metadata:{}};const r=regions([b],200,160,{confirm:true,taxonomyVersion:'layout-v2'});assert.deepEqual(r[0].metadata,{scope:'page'});assert.equal(r[0].metadata.value,undefined)}assert.throws(()=>regions(metadataBoxes,200,160),/版本/);assert.throws(()=>regions([{...metadataBoxes[1],metadata:{value:{role:'composer'}}}],200,160,{taxonomyVersion:'layout-v2'}),/演唱者/);assert.throws(()=>regions([{...metadataBoxes[5],metadata:{value:{fret:-1}}}],200,160,{taxonomyVersion:'layout-v2'}),/0–24/);assert.throws(()=>regions([{...metadataBoxes[0],metadata:{unexpected:'no'}}],200,160,{taxonomyVersion:'layout-v2'}),/未知/);assert.notEqual(canonicalAnnotation([metadataBoxes[5]],'music'),canonicalAnnotation([{...metadataBoxes[5],metadata:{scope:'page'}}],'music'))});
test('真实PG：metadata保存回读/旧客户端保护/多页归属/v1快照与v2双包兼容',async t=>{const f=await fixture({port:55450});t.after(()=>f.close());const{api,ds,upload}=await setup(f);let p=await upload(),other=await upload('page2.png');const put=(value,boxes,version='layout-v2')=>api('/v2/pages/'+value.image.id,json({version:value.image.version,annotationFormat:version,boxes,pageType:'music'},'PUT'));
 p=await put(p,[root],'layout-v1');p=await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true}));const v1=await freezeSnapshot(f.pool,ds.id);assert.equal(v1.frozen.taxonomyVersion,'layout-v1');await f.app.locals.platform.exporter.recover();await f.app.locals.platform.exporter.launch(null,v1.id);await f.app.locals.platform.exporter.idle();const old=(await f.pool.query('SELECT * FROM omr_snapshots WHERE id=$1',[v1.id])).rows[0];assert.equal(old.manifest.categories.length,7);
 p=await put(p,[root,...metadataBoxes]);assert.equal(p.image.annotationFormat,'layout-v2');assert.deepEqual((await api('/v2/pages/'+p.image.id)).boxes.map(({reviewStatus,...b})=>b),[root,...metadataBoxes]);assert.deepEqual((await api('/v2/pages/'+other.image.id)).boxes,[]);await api('/v2/pages/'+p.image.id,json({version:p.image.version,annotationFormat:'layout-v1',boxes:[root]},'PUT'),409);p=await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true}));const next=await api('/v2/datasets/'+ds.id+'/snapshots',json({pageIds:[p.image.id]}),202);await f.app.locals.platform.exporter.idle();const snap=(await f.pool.query('SELECT * FROM omr_snapshots WHERE id=$1',[next.id])).rows[0];assert.equal(snap.status,'ready',snap.error);assert.equal(snap.manifest.categories.length,13);assert.equal(snap.manifest.taxonomyVersion,'layout-v2');const dir=await mkdtemp(join(tmpdir(),'omr-metadata-export-'));for(const kind of ['detection','crops'])await writeFile(join(dir,kind+'.zip'),f.objects.get(snap.artifacts[kind].key));const validated=spawnSync('python3',[new URL('../tools/validate-export.py',import.meta.url).pathname,join(dir,'detection.zip'),join(dir,'crops.zip')],{encoding:'utf8'});assert.equal(validated.status,0,validated.stderr);assert.deepEqual((await f.pool.query('SELECT frozen,manifest,artifacts FROM omr_snapshots WHERE id=$1',[v1.id])).rows[0],{frozen:old.frozen,manifest:old.manifest,artifacts:old.artifacts});
 // Raw-only tempo and missing capo remain distinct from explicit zero.
 const raw=[{...metadataBoxes[4],parentSystemId:null,metadata:{scope:'global',rawText:'Adagio'}},{...metadataBoxes[5],metadata:{scope:'page'}}];other=await put(other,raw);assert.equal(other.boxes[0].metadata.value,undefined);assert.equal(other.boxes[1].metadata.value,undefined);
});
test('永久删除替代软删除：真实OSS清理、原图不存在、恢复接口拒绝',async t=>{
 const f=await fixture({port:55451});t.after(()=>f.close());const{api,ds,upload}=await setup(f);const a=await upload('a.png'),b=await upload('b.png');
 await api('/v2/datasets/'+ds.id+'/pages/delete',json({items:[{id:b.image.id,version:1}]}),410);
 const preview=await api('/v2/deletions/preview',json({kind:'page',ids:[b.image.id]}));await api('/v2/deletions/execute',json({token:preview.token,acknowledged:true}));
 await api('/v2/pages/'+b.image.id,{},404);await api('/images/'+b.image.id,{},404);assert.equal((await api('/v2/datasets/'+ds.id+'/pages')).total,1);assert.equal((await api('/v2/datasets/'+ds.id+'/pages?deleted=deleted')).total,0);assert.equal(f.objects.size,1);
 await api('/v2/datasets/'+ds.id+'/restore',json({version:1}),410);assert.ok(await api('/v2/pages/'+a.image.id));
});
test('数千页服务端分页/稳定排序/搜索筛选计数与邻居，批处理全成或全败',async t=>{const f=await fixture({port:55452});t.after(()=>f.close());const{api,ds,song}=await setup(f);await f.pool.query("INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,song_id,page_order,source,status,annotation_format) SELECT gen_random_uuid(),'omr/fake-'||n,'page-'||lpad(n::text,4,'0')||'.png','image/png',200,160,repeat('a',64),$1,n,CASE WHEN n%2=0 THEN '扫描' ELSE '导入' END,CASE WHEN n%3=0 THEN 'confirmed' ELSE 'draft' END,'layout-v1' FROM generate_series(1,2051) n",[song.id]);const page1=await api('/v2/datasets/'+ds.id+'/pages?pageSize=100&page=1'),page2=await api('/v2/datasets/'+ds.id+'/pages?pageSize=100&page=2');assert.equal(page1.total,2051);assert.equal(new Set([...page1.items,...page2.items].map(p=>p.id)).size,200);assert.deepEqual((await api('/v2/datasets/'+ds.id+'/pages?pageSize=100&page=1')).items.map(p=>p.id),page1.items.map(p=>p.id));assert.ok(page1.items.every(p=>!('boxes'in p)));const filtered=await api('/v2/datasets/'+ds.id+'/pages?search='+encodeURIComponent('扫描')+'&status=confirmed&pageSize=100');assert.equal(filtered.total,341);const neighbors=await api('/v2/datasets/'+ds.id+'/pages/'+page1.items.at(-1).id+'/neighbors');assert.equal(neighbors.next,page2.items[0].id);await api('/v2/datasets/'+ds.id+'/pages?pageSize=999',{},400);const batch=page1.items.slice(0,2).map(p=>p.id);let p=await api('/v2/deletions/preview',json({kind:'page',ids:batch}));await f.pool.query('UPDATE omr_images SET version=version+1 WHERE id=$1',[batch[0]]);await api('/v2/deletions/execute',json({token:p.token,acknowledged:true}),409);assert.equal((await api('/v2/datasets/'+ds.id+'/pages')).total,2051);
 p=await api('/v2/deletions/preview',json({kind:'page',ids:batch}));const auth=(await setupGrant(f)).token;const rs=await Promise.all([1,2].map(()=>request(f,'/api/v2/deletions/execute',{...json({token:p.token,acknowledged:true}),headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'}})));assert.deepEqual(rs.map(r=>r.status),[200,200]);assert.equal((await api('/v2/datasets/'+ds.id+'/pages')).total,2049);});

async function setupGrant(f){return grantFor(f,await cookieFor(f))}

test('schema3带旧页/会话/CLI grant/ready快照升级4且幂等，原授权持续有效',async t=>{const f=await fixture({port:55453,migrationVersion:3});t.after(()=>f.close());const cookie=await cookieFor(f),grant=await grantFor(f,cookie),page='11111111-1111-4111-8111-111111111114',boxes=[{id:'legacy',x:1,y:2,width:10,height:11}];await f.pool.query("INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,boxes,version) VALUES($1,'omr/old','old.png','image/png',30,40,repeat('b',64),$2,9)",[page,JSON.stringify(boxes)]);const snapshot=(await f.pool.query("INSERT INTO omr_snapshots(id,dataset_id,frozen,status,manifest,artifacts) VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000001',$1,'ready',$2,$3) RETURNING *",[{taxonomyVersion:'layout-v1',kept:'snapshot'},{kept:'manifest'},{kept:'artifacts'}])).rows[0];await withLock(f.pool,c=>migrate(c));await withLock(f.pool,c=>migrate(c));assert.equal(await checkHistory(f.pool),7);const r=await request(f,'/api/v2/taxonomy',{headers:{Authorization:'Bearer '+grant.token}});assert.equal(r.status,200);assert.equal((await r.json()).taxonomyVersion,'layout-v2');assert.equal((await request(f,'/api/session',{headers:{Cookie:cookie}})).status,200);const old=(await f.pool.query('SELECT * FROM omr_images WHERE id=$1',[page])).rows[0];assert.equal(old.version,9);assert.deepEqual(old.boxes,boxes);assert.equal(old.annotation_version,'layout-v1');assert.equal(old.deleted_at,null);const kept=(await f.pool.query('SELECT * FROM omr_snapshots WHERE id=$1',[snapshot.id])).rows[0];assert.deepEqual(kept,snapshot)});
test('歌曲维度分页/聚合/排序，完整页序原子交换、并发冲突与歌曲级永久删除',async t=>{
 const f=await fixture({port:55455});t.after(()=>f.close());const{api,ds,song,upload}=await setup(f);let a=await upload('第一页.png'),b=await upload('第二页.png'),c=await upload('单独删除.png');
 const catalogue=()=>api('/v2/datasets/'+ds.id+'/song-records?pageSize=25');let listed=await catalogue();assert.equal(listed.total,1);assert.equal(listed.items[0].page_count,3);assert.equal(listed.items[0].first_page_id,a.image.id);assert.equal((await api('/v2/datasets/'+ds.id+'/song-records?search=第一页')).total,1);assert.equal((await api('/v2/datasets/'+ds.id+'/song-records?status=confirmed')).total,0);
 const reorder=items=>api('/v2/songs/'+song.id+'/pages/reorder',json({items}));const old=[a,b,c].map(p=>({id:p.image.id,version:p.image.version}));await api('/v2/songs/'+song.id+'/pages/reorder',json({items:old.slice(1)}),409);assert.deepEqual((await api('/v2/songs/'+song.id+'/pages')).map(p=>p.id),[a.image.id,b.image.id,c.image.id]);
 let ordered=await reorder([old[1],old[0],old[2]]);assert.deepEqual(ordered.map(p=>[p.id,p.pageOrder]),[[b.image.id,1],[a.image.id,2],[c.image.id,3]]);await api('/v2/songs/'+song.id+'/pages/reorder',json({items:old}),409);
 const foreign=await api('/v2/datasets/'+ds.id+'/songs',json({name:'另一首歌',songGroupKey:'other',split:'val'}),201),foreignPage=await upload('另一首歌.png',foreign);await api('/v2/songs/'+song.id+'/pages/reorder',json({items:[...ordered.slice(0,2),{id:foreignPage.image.id,version:1}]}),409);
 let preview=await api('/v2/deletions/preview',json({kind:'page',ids:[c.image.id]}));await api('/v2/deletions/execute',json({token:preview.token,acknowledged:true}));ordered=await reorder(ordered.slice(0,2).reverse().map(p=>({id:p.id,version:p.version})));assert.deepEqual(ordered.map(p=>p.pageOrder),[1,2]);
 preview=await api('/v2/deletions/preview',json({kind:'song',ids:[song.id]}));const content=await api('/v2/pages/'+a.image.id);await api('/v2/pages/'+a.image.id,json({version:content.image.version,annotationFormat:'layout-v2',boxes:metadataBoxes.map(p=>({...p,parentSystemId:null,metadata:{scope:'page'}}))},'PUT'));await api('/v2/deletions/execute',json({token:preview.token,acknowledged:true}),409);
 preview=await api('/v2/deletions/preview',json({kind:'song',ids:[song.id]}));await api('/v2/deletions/execute',json({token:preview.token,acknowledged:true}));assert.equal((await catalogue()).total,1);await api('/v2/pages/'+a.image.id,{},404);assert.equal((await api('/v2/songs/'+foreign.id+'/pages')).length,1);assert.equal(f.objects.size,1);
 // Stable server pagination is by song, not by the number of pages in a song.
 await f.pool.query("INSERT INTO omr_songs(id,dataset_id,name,song_group_key,split) SELECT gen_random_uuid(),$1,'Song '||n,'g-'||n,'train' FROM generate_series(1,60) n",[ds.id]);const first=await catalogue(),second=await api('/v2/datasets/'+ds.id+'/song-records?pageSize=25&page=2');assert.equal(first.total,61);assert.equal(first.items.length,25);assert.ok(first.items.every(s=>!second.items.some(x=>x.id===s.id)));assert.equal((await api('/v2/datasets/'+ds.id+'/song-records?search=Song%201')).total,11);
});

test('单页工作队列：跨歌曲跳过确认页、末尾循环、无待办与数据集隔离',async t=>{
 const f=await fixture({port:55459});t.after(()=>f.close());const {api,ds,song,upload}=await setup(f);
 const a=await upload('first.png'),b=await upload('confirmed.png');
 const other=await api('/v2/datasets/'+ds.id+'/songs',json({name:'B',songGroupKey:'b',split:'train'}),201);
 const c=await upload('last.png',other);
 for(const [i,p] of [a,b,c].entries())await f.pool.query("UPDATE omr_images SET created_at='2026-01-01'::timestamptz+($2::int*interval '1 second') WHERE id=$1",[p.image.id,i]);
 await f.pool.query("UPDATE omr_images SET status='confirmed' WHERE id=$1",[b.image.id]);
 const next=id=>api('/v2/datasets/'+ds.id+'/pages/'+id+'/neighbors');
 assert.deepEqual((await next(c.image.id)).nextUnconfirmed,{id:a.image.id,songId:song.id});
 assert.deepEqual((await next(a.image.id)).nextUnconfirmed,{id:c.image.id,songId:other.id});
 const list=await api('/v2/datasets/'+ds.id+'/pages');assert.equal(list.total,3);assert.deepEqual(list.items.map(p=>p.id),[c.image.id,b.image.id,a.image.id]);assert.equal(list.items[0].songName,'B');
 const isolated=await api('/v2/datasets',json({name:'隔离'}),201);await api('/v2/datasets/'+isolated.id+'/pages/'+a.image.id+'/neighbors',{},409);
 await f.pool.query("UPDATE omr_images SET status='confirmed' WHERE song_id=ANY($1::uuid[])",[[song.id,other.id]]);
 assert.equal((await next(c.image.id)).nextUnconfirmed,null);
});

test('AI复核：真实CLI、分页筛选、版本冲突、修改失效且不成为人工训练真值',async t=>{
 const {home,authCli,runCli}=await import('./cli-helpers.mjs');
 const f=await fixture({port:55459});t.after(()=>f.close());const {api,ds,upload}=await setup(f);
 let p=await upload('ai.png');p=await api('/v2/pages/'+p.image.id+'/normalize',json({version:p.image.version}));
 p=await api('/v2/pages/'+p.image.id,json({version:p.image.version,annotationFormat:'layout-v2',boxes:[root]},'PUT'));
 const configHome=await home();assert.equal((await authCli(f,await cookieFor(f),configHome)).code,0);
 const r=await runCli(f,['pages','confirm',p.image.id,'--version',String(p.image.version),'--acknowledge','--review-type','ai'],{configHome});assert.equal(r.code,0,r.stderr);p=r.value;assert.equal(p.image.status,'ai_reviewed');assert.equal(p.boxes[0].reviewStatus,'draft');
 assert.equal((await api('/v2/datasets/'+ds.id+'/pages?status=ai_reviewed')).total,1);
 assert.equal((await api('/v2/datasets/'+ds.id+'/pages?status=confirmed')).total,0);
 assert.equal((await api('/v2/datasets/'+ds.id+'/songs'))[0].confirmed_count,0);
 await assert.rejects(freezeSnapshot(f.pool,ds.id),/确认|数据|页面/);
 await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version-1,acknowledged:true,reviewType:'ai'}),409);
 await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true,reviewType:'invalid'}),400);
 p=await api('/v2/pages/'+p.image.id,json({version:p.image.version,annotationFormat:'layout-v2',boxes:[{...root,width:190}]},'PUT'));assert.equal(p.image.status,'draft');
 p=await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true,reviewType:'ai'}));
 p=await api('/v2/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true}));assert.equal(p.image.status,'confirmed');assert.equal(p.boxes[0].reviewStatus,'confirmed');
});

test("同类复核队列：过滤条件贯穿跳页，保存/确认后锚点仍有效，空队列不回到自己", async t => {
  const f = await fixture({ port: 55510 }); t.after(() => f.close());
  const { api, ds, song, upload } = await setup(f);
  const other = await api('/v2/datasets/' + ds.id + '/songs',
    json({ name: '第二首', songGroupKey: 'queue-b', split: 'train' }), 201);
  const validation = await api('/v2/datasets/' + ds.id + '/songs',
    json({ name: '验证歌曲', songGroupKey: 'queue-val', split: 'val' }), 201);
  let a = await upload('queue-a.png'), b = await upload('queue-b.png', other);
  const draft = await upload('queue-draft.png'), val = await upload('queue-val.png', validation);
  const noSearchMatch = await upload('unrelated.png');
  for (const [i, page] of [a, b, draft, val, noSearchMatch].entries()) {
    await f.pool.query("UPDATE omr_images SET created_at='2026-01-01'::timestamptz+($2::int*interval '1 second') WHERE id=$1",
      [page.image.id, 10 - i]);
  }
  for (const page of [a, b]) await api('/v2/pages/' + page.image.id,
    json({ version: page.image.version, annotationFormat: 'layout-v2', boxes: [root] }, 'PUT'));
  await f.pool.query("UPDATE omr_images SET status='ai_reviewed' WHERE id=ANY($1::uuid[])",
    [[a.image.id, b.image.id, val.image.id, noSearchMatch.image.id]]);
  const queue = id => api('/v2/datasets/' + ds.id + '/pages/' + id +
    '/neighbors?status=ai_reviewed&split=train&search=queue');
  assert.deepEqual((await queue(a.image.id)).nextPage, { id: b.image.id, songId: other.id });
  assert.deepEqual((await queue(b.image.id)).previousPage, { id: a.image.id, songId: song.id });
  a = await api('/v2/pages/' + a.image.id);
  a = await api('/v2/pages/' + a.image.id + '/confirm', json({ version: a.image.version, acknowledged: true }));
  assert.equal(a.image.status, 'confirmed');
  assert.deepEqual((await queue(a.image.id)).nextPage, { id: b.image.id, songId: other.id });
  b = await api('/v2/pages/' + b.image.id);
  b = await api('/v2/pages/' + b.image.id, json({
    version: b.image.version, annotationFormat: 'layout-v2', boxes: [{ ...root, width: 190 }],
  }, 'PUT'));
  assert.equal(b.image.status, 'draft');
  assert.equal((await queue(b.image.id)).nextPage, null);
  const rows = await api('/v2/datasets/' + ds.id + '/pages?pageSize=25');
  assert.equal(rows.items.find(p => p.id === b.image.id).pageOrder, 1);
  assert.equal(rows.items.find(p => p.id === draft.image.id).pageOrder, 2);
  await api('/v2/datasets/' + ds.id + '/pages/' + a.image.id + '/neighbors?status=bad', {}, 400);
});
