import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {fixture} from './fixture.mjs';
import {cookieFor,grantFor,request,json} from './cli-helpers.mjs';
import {taskCommand} from '../tools/cli/src/tasks.mjs';
import {client} from '../tools/cli/src/http.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');

test('key labels round-trip through real PG/API/CLI, exact PNG crops, filtered lists and deletion previews',async(t)=>{
 const f=await fixture({port:55571});t.after(()=>f.close());
 const cookie=await cookieFor(f),grant=await grantFor(f,cookie),dir=await mkdtemp(join(tmpdir(),'omr-key-integration-'));
 const api=async(path,options={})=>{
   const response=await request(f,'/api/v2'+path,{...options,headers:{Cookie:cookie,...options.headers}});
   const body=await response.json();assert.ok(response.ok,JSON.stringify(body));return body;
 };
 const layout=await api('/datasets',json({name:'Key source'}));
 const song=await api('/datasets/'+layout.id+'/songs',json({name:'Source song',songGroupKey:'same-song',split:'val'}));
 const pixels=Buffer.alloc(200*120*3);for(let i=0;i<pixels.length;i++)pixels[i]=i%251;
 const image=await sharp(pixels,{raw:{width:200,height:120,channels:3}}).png().toBuffer();
 const pageId=randomUUID(),objectKey='omr/key-integration-'+pageId;
 await f.storage.put(objectKey,image,'image/png');
 const keyBox={id:'key-1',classKey:'key_signature',parentSystemId:null,readingOrder:0,x:11,y:13,width:80,height:25};
 const otherBox={...keyBox,id:'lyrics',classKey:'lyrics',y:60};
 await f.pool.query(`INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,song_id,boxes,annotation_format,annotation_version)
  VALUES($1,$2,'score.png','image/png',200,120,$3,$4,$5,'layout-v1','layout-v2')`,
  [pageId,objectKey,sha(image),song.id,JSON.stringify([keyBox,otherBox])]);
 const task=(words,options={})=>taskCommand(words.split(' '),options,{request:client(f.url,grant.token)});
 const input=join(dir,'input.json');
 await writeFile(input,JSON.stringify({name:'Key labels',sourceDatasetId:layout.id}));
 const dataset=await task('key-signatures datasets create',{input});
 assert.equal(dataset.sample_count,1);assert.equal(dataset.imported,1);
 assert.equal((await task('key-signatures datasets sync '+dataset.id)).imported,0);
 let listed=await task('key-signatures records list',{dataset:dataset.id,status:'draft',search:'Source song','page-size':'10'});
 assert.equal(listed.total,1);
 const record=listed.items[0];assert.equal(record.tonic,null);assert.equal(record.split,'val');assert.equal(record.song_group_key,'same-song');
 const output=join(dir,'crop.png');await task('key-signatures records content '+record.id,{dataset:dataset.id,output});
 const actual=await sharp(await readFile(output)).ensureAlpha().raw().toBuffer();
 const expected=await sharp(image).extract({left:11,top:13,width:80,height:25}).ensureAlpha().raw().toBuffer();
 assert.deepEqual(actual,expected);
 await writeFile(input,JSON.stringify({version:record.version,tonic:'Bb',kind:'original'}));
 const saved=await task('key-signatures records update '+record.id,{dataset:dataset.id,input});
 assert.equal(saved.status,'confirmed');assert.equal(saved.version,2);
 listed=await task('key-signatures records list',{dataset:dataset.id,status:'confirmed',tonic:'Bb',kind:'original'});
 assert.equal(listed.total,1);assert.equal(listed.dataset.confirmed_count,1);
 const stale=await request(f,'/api/v2/key-signatures/datasets/'+dataset.id+'/records/'+record.id,{
   ...json({version:1,tonic:'C',kind:'play'},'PUT'),headers:{...json({}).headers,Cookie:cookie}});
 assert.equal(stale.status,409);
 const exportFile=join(dir,'labels.json');
 await task('key-signatures datasets export '+dataset.id,{output:exportFile});
 const exported=JSON.parse(await readFile(exportFile,'utf8'));assert.equal(exported.records.length,1);assert.equal(exported.records[0].tonic,'Bb');
 // Layout edits keep imported pixels fixed; only newly added key boxes are appended.
 await f.pool.query('UPDATE omr_images SET boxes=$1 WHERE id=$2',[JSON.stringify([{...keyBox,x:30},{...keyBox,id:'key-2',x:100}]),pageId]);
 assert.equal((await task('key-signatures datasets sync '+dataset.id)).imported,1);
 assert.equal((await task('key-signatures records get '+record.id,{dataset:dataset.id})).rectangle.left,11);
 const pending=await task('key-signatures records next '+record.id,{dataset:dataset.id});
 assert.equal(pending.position,2);assert.equal(pending.record.status,'draft');
 // Source deletion includes the dependent labels in its preview and removes no hidden references.
 const plan=await api('/deletions/preview',json({kind:'dataset',ids:[layout.id]}));
 assert.equal(plan.summary.keySignatureRecords,2);
 await api('/deletions/execute',json({token:plan.token,acknowledged:true}));
 const remaining=await task('key-signatures datasets list');
 const detached=remaining.find(d=>d.id===dataset.id);
 assert.equal(detached.source_dataset_id,null);assert.equal(detached.sample_count,0);
 assert.equal((await f.pool.query('SELECT count(*) n FROM omr_key_records')).rows[0].n,'0');
});