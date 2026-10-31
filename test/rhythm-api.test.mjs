import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {fixture} from './fixture.mjs';
import {localizationSetup} from './localization-helpers.mjs';
import {json,request,cookieFor} from './cli-helpers.mjs';
import {newRhythm} from '../shared/rhythm.ts';
import {seedRhythmDemo} from '../tools/dev/rhythm-demo.mjs';
function unzip(buffer){
 const result={};const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0);let p=buffer.readUInt32LE(end+16);
 for(let i=0;i<buffer.readUInt16LE(end+10);i++){
  const method=buffer.readUInt16LE(p+10),size=buffer.readUInt32LE(p+20),n=buffer.readUInt16LE(p+28),extra=buffer.readUInt16LE(p+30),comment=buffer.readUInt16LE(p+32),local=buffer.readUInt32LE(p+42),name=buffer.subarray(p+46,p+46+n).toString();
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),raw=buffer.subarray(start,start+size);result[name]=method===8?inflateRawSync(raw):raw;p+=46+n+extra+comment;
 }return result;
}
test('rhythm API: confirmed layout sync, label validation, save conflicts, confirm, filtered navigation, region-only export and deletion',async t=>{
 const f=await fixture({port:55471});t.after(()=>f.close());const s=await localizationSetup(f);
 const box=(id,classKey,y,height,parentSystemId='system')=>({id,classKey,parentSystemId,readingOrder:y,x:0,y,width:200,height});
 let p=await s.api('/pages/'+s.page.image.id,json({version:s.page.image.version,annotationFormat:'layout-v2',boxes:[box('system','system',0,160,null),box('guitar','guitar',0,70),box('melody','melody',75,40),box('lyrics','lyrics',120,40)]},'PUT'));
 const ds=await s.api('/localization/datasets',json({name:'Rhythm',task:'rhythm',sourceDatasetId:s.dataset.id}),201);
 assert.equal(ds.imported,0);p=await s.api('/pages/'+p.image.id+'/confirm',json({version:p.image.version,acknowledged:true}));
 assert.equal((await s.api('/localization/datasets/'+ds.id+'/sync',json({}))).imported,1);
 let list=await s.api('/localization/datasets/'+ds.id+'/records');assert.equal(list.total,1);let r=await s.api('/localization/records/'+list.items[0].id);const path='/localization/records/'+r.id;
 assert.equal((await s.api('/localization/datasets/'+ds.id+'/sync',json({}))).imported,0);assert.equal(r.geometry.regions.length,3);assert.equal(r.geometry.pages[0].sourceSha,s.page.image.checksum);
 const g=structuredClone(r.geometry);g.measures=g.regions.map((region,i)=>({id:'measure-'+i,pageId:region.pageId,regionId:region.id,systemId:region.systemId,barNumber:1,track:region.track,voice:'1',bbox:region.bbox,staffLines:null,geometryConfirmed:false,completenessConfirmed:false,reviewNote:'',events:[{id:'event-'+i,voice:'1',centerX:50,bbox:[40,region.bbox[1],60,region.bbox[3]],contextBBox:null,status:'accepted',evidence:{},annotationSource:{kind:'manual'},confidence:null,rhythm:newRhythm(region.track,8)}]}));
 const melody=g.measures.find(m=>m.track==='melody');
 Object.assign(g.measures[0].events[0].rhythm,{kind:'rest',dots:1,tuplet:{actual:3,normal:2},tieTo:'not-a-region',text:'not-training-truth'});
 r=await s.api(path,json({version:r.version,geometry:g},'PUT'));await s.api(path,json({version:r.version-1,geometry:g},'PUT'),409);
 r=await s.api(path+'/confirm',json({version:r.version,acknowledged:true}));assert.equal(r.status,'confirmed');assert.ok(r.first_labeled_at);
 list=await s.api('/localization/datasets/'+ds.id+'/records?status=confirmed');assert.equal(list.stats.confirmed,1);assert.equal(list.annotationTrend.today,1);assert.equal(list.items[0].event_count,3);
 assert.deepEqual(await s.api('/localization/datasets/'+ds.id+'/editor?recordId='+r.id+'&status=draft'),{previousId:null,nextId:null});
 assert.deepEqual(await s.api('/localization/datasets/'+ds.id+'/editor?recordId='+r.id),{previousId:null,nextId:null});
 const snapshot=await s.api('/localization/datasets/'+ds.id+'/snapshots',json({}),201);
 const native=await s.api('/localization/snapshots/'+snapshot.id+'/native');assert.equal(native.truth,'geometry-and-event-category');assert.equal(native.records[0].geometry.measures[0].events[0].rhythm.duration,8);
 const response=await request(f,'/api/v2/localization/snapshots/'+snapshot.id+'/crops',{headers:{Authorization:'Bearer '+s.grant.token}});assert.equal(response.status,200);
 const files=unzip(Buffer.from(await response.arrayBuffer())),manifest=JSON.parse(files['manifest.json']);assert.equal(manifest.truth,'geometry-and-event-category');
 const events=manifest.crops.filter(c=>c.kind==='event');assert.ok(events.every(c=>Object.keys(c.rhythm).join(',')==='duration'));assert.equal(events.length,3);assert.ok(events.every(c=>c.anchorX===50&&c.split==='train'));assert.equal(events.find(c=>c.track==='lyrics').rhythm.duration,null);
 assert.equal(manifest.crops.filter(c=>c.kind==='region').length,3);assert.ok(events.every(c=>files[c.contextFile]&&c.localAnchorX===10));
 for(const crop of manifest.crops.filter(c=>c.kind==='region'))assert.equal(crop.annotations[0].events[0].anchorX,50);
 const preview=await s.api('/deletions/preview',json({kind:'locEvent',ids:[r.id],regionIds:[melody.events[0].id]}));await s.api('/deletions/execute',json({token:preview.token,acknowledged:true}));
 r=await s.api(path);assert.equal(r.status,'draft');assert.deepEqual(r.geometry.measures.find(m=>m.track==='lyrics').events[0].rhythm,{duration:null});
 await s.api(path+'/confirm',json({version:r.version,acknowledged:true}));
 assert.equal(f.objects.size,1);
});
test('local development seeds a usable confirmed-layout rhythm sample without starting a persistent preview',async t=>{
 const f=await fixture({port:55472});t.after(()=>f.close());const cookie=await cookieFor(f);
 const api=async(path,body,method='POST',extra={})=>{
  const r=await request(f,'/api/v2'+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:Buffer.isBuffer(body)?body:JSON.stringify(body)});
  const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;
 };
 const ds=await seedRhythmDemo(api);assert.equal(ds.imported,1);
 const list=await api('/localization/datasets/'+ds.id+'/records',undefined,'GET');assert.equal(list.total,1);
 const record=await api('/localization/records/'+list.items[0].id,undefined,'GET');assert.equal(record.geometry.regions.length,3);assert.equal(record.geometry.schemaVersion,'omr-rhythm-v1');
 const datasets=await api('/datasets',undefined,'GET');assert.equal(datasets.find(d=>d.id===ds.source_dataset_id).confirmed_count,1);
});
