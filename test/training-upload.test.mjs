import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';

async function storageFixture(t) {
 const seen=[],key='ossTest'+randomUUID().replaceAll('-','');
 class FakeOSS {
  constructor(options){this.options=options;seen.push({event:'construct',options});}
  async putStream(name,stream,options) {
   const timeout=options.timeout??this.options.timeout;
   seen.push({event:'upload',name,options});
   // A deterministic provider clock advances while live chunks arrive.
   let elapsed=0;
   for await(const chunk of stream) {
    elapsed+=25000;
    if(elapsed>timeout)throw Error('simulated OSS timeout');
    assert.ok(chunk.length>0);
   }
  }
 }
 globalThis[key]=FakeOSS;t.after(()=>{delete globalThis[key];});
 let source=await readFile(new URL('../server/src/storage.ts',import.meta.url),'utf8');
 source=source.replace(/import \{[\s\S]*?\} from "\.\/oss-delete\.ts";/,'const deleteOssKeyPermanently=()=>{},probeOssPermanentDeleteAccess=()=>{};')
  .replace('const { default: OSS } = await import("ali-oss");','const OSS=globalThis['+JSON.stringify(key)+'];');
 const {ossStorage}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
 return {storage:ossStorage({authMode:'ak',bucket:'test',prefix:'omr/',accessKeyId:'test',accessKeySecret:'test'}),seen};
}

test('stream uploads outlive the old 20s OSS budget while the metadata default stays bounded',async t=>{
 const {storage,seen}=await storageFixture(t);
 const slow=()=>Readable.from((async function*(){for(let i=0;i<4;i++)yield Buffer.alloc(8);})());
 // The live stream represents 100 seconds, beyond the legacy 20-second budget.
 await assert.rejects(storage.putStream('legacy',slow(),'application/octet-stream',{timeout:20000}),/simulated OSS timeout/);
 await storage.putStream('model',slow(),'application/octet-stream');
 assert.equal(seen.find(s=>s.event==='construct').options.timeout,20000);
 assert.equal(seen.find(s=>s.name==='model').options.timeout,300000);
});

test('model routes can set a ten-minute provider budget and forward the verified content length',async t=>{
 const {storage,seen}=await storageFixture(t);
 await storage.putStream('model',Readable.from([Buffer.from('model')]),'application/octet-stream',{timeout:600000,contentLength:5});
 const upload=seen.find(s=>s.event==='upload');
 assert.equal(upload.options.timeout,600000);assert.equal(upload.options.contentLength,5);
 assert.equal(upload.options.headers['Content-Type'],'application/octet-stream');
});
