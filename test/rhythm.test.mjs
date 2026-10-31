import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newRhythm,eventName,orderedEvents} from '../shared/rhythm.ts';
import {validateGeometry} from '../server/src/localization/geometry.ts';
import {keepRegionDraft,readRegionDraft,clearRegionDraft} from '../shared/localization-draft.ts';
const page={localPageId:'p',sourcePageId:'00000000-0000-4000-8000-000000000001',sourceSha:'a'.repeat(64),pixelSha:null,width:300,height:200,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
function sample(){
 const event={id:'e',centerX:50,bbox:[40,10,60,80],contextBBox:null,status:'accepted',evidence:{},annotationSource:{kind:'manual'},confidence:null,rhythm:newRhythm('guitar',8)};
 const measure={id:'m',pageId:'p',systemId:'system',regionId:'r',barNumber:null,track:'guitar',bbox:[0,0,200,100],staffLines:null,events:[event],geometryConfirmed:false,completenessConfirmed:false,reviewNote:''};
 return {schemaVersion:'omr-rhythm-v1',pages:[page],regions:[{id:'r',pageId:'p',systemId:'system',track:'guitar',bbox:[0,0,300,100]}],measures:[measure]};
}
test('region labels contain only the base category, and spatial ordering excludes rejected regions',()=>{
 assert.deepEqual(newRhythm('guitar',8),{duration:8});assert.deepEqual(newRhythm('lyrics'),{duration:null});
 const m=sample().measures[0];m.events=[{...m.events[0],id:'b',centerX:80},{...m.events[0],id:'a',centerX:20},{...m.events[0],id:'rejected',status:'rejected',centerX:10}];
 assert.deepEqual(orderedEvents(m).map(e=>e.id),['a','b']);assert.equal(eventName(m.events[0]),'八分音符');
});
test('confirmation needs valid regions and categories, without voice, meter, duration totals or musical-content annotations',()=>{
 const g=sample();const result=validateGeometry(g,[page],{confirm:true});assert.equal(result.measures[0].barNumber,null);assert.deepEqual(result.measures[0].events[0].rhythm,{duration:8});
 for(const change of [g=>g.measures[0].events[0].bbox=null,g=>g.measures[0].events[0].rhythm.duration=null,g=>g.measures[0].events[0].centerX=50.5,g=>g.measures[0].bbox=[0,0,301,100],g=>g.regions.push({...g.regions[0],id:'unused'})]){
  const bad=structuredClone(g);change(bad);assert.throws(()=>validateGeometry(bad,[page],{confirm:true}));
 }
 const changed=structuredClone(g);changed.regions[0].bbox[2]=299;assert.throws(()=>validateGeometry(changed,[page],{previous:g}),/来源谱行/);
 // Content from the earlier UI must neither block region confirmation nor leak
 // into the new training labels, even when it is incomplete or invalid.
 g.measures[0].timeSignature={numerator:0,denominator:0};g.measures[0].partial=true;
 Object.assign(g.measures[0].events[0].rhythm,{kind:'rest',dots:-1,tuplet:{actual:0},tieTo:'missing',alignTo:'missing',text:'unused',verse:0});
 const clean=validateGeometry(g,[page],{confirm:true});assert.deepEqual(clean.measures[0].events[0].rhythm,{duration:8});assert.ok(!('timeSignature' in clean.measures[0]));
});
test('lyrics regions need no text, verse, links or note category; equal x in different lyric rows is valid',()=>{
 const g=sample(),m=g.measures[0];m.track='lyrics';g.regions[0].track='lyrics';delete m.events[0].rhythm;
 m.events[0].bbox=[40,10,60,40];m.events.push({...structuredClone(m.events[0]),id:'verse-2',bbox:[40,50,60,80]});
 const clean=validateGeometry(g,[page],{confirm:true});assert.ok(clean.measures[0].events.every(e=>e.rhythm.duration===null));
});
test('region drafts survive failed saves and restore only against the same record version and source images',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const record={id:'record',dataset_id:'dataset',version:1,source_fingerprint:'source',geometry:sample()};
 const draft=sample();draft.measures[0].events[0].centerX=55;
 assert.equal(keepRegionDraft(storage,record,draft),true);assert.deepEqual(readRegionDraft(storage,record),draft);
 assert.equal(readRegionDraft(storage,{...record,version:2}),null);
 const changed=structuredClone(record);changed.geometry.pages[0].sourceSha='b'.repeat(64);assert.equal(readRegionDraft(storage,changed),null);
 assert.equal(map.size,1);clearRegionDraft(storage,record);assert.equal(readRegionDraft(storage,record),null);
});
