import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rhythmBeats,eventName} from '../shared/rhythm.ts';
import {validateGeometry} from '../server/src/localization/geometry.ts';
const page={localPageId:'crop',sourcePageId:'crop',sourceSha:'a'.repeat(64),pixelSha:null,width:200,height:40,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
function geometry(label){return {schemaVersion:'omr-rhythm-v1',pages:[page],regions:[{id:'r',pageId:'crop',systemId:null,track:'guitar',bbox:[0,0,200,40]}],
  measures:[{id:'m',pageId:'crop',regionId:'r',systemId:null,track:'guitar',voice:'1',barNumber:1,bbox:[0,0,200,40],staffLines:null,geometryConfirmed:false,completenessConfirmed:false,reviewNote:'',
    events:[{id:'e',voice:'1',centerX:30,bbox:[10,0,50,40],contextBBox:null,status:'accepted',evidence:{},annotationSource:{},confidence:null,rhythm:label}]}]};}
test('exact beat fractions include dots and tuplet ratios, without accumulating rounding errors',()=>{
  assert.deepEqual(rhythmBeats({duration:4}),{numerator:1,denominator:1});
  assert.deepEqual(rhythmBeats({duration:8,dots:1}),{numerator:3,denominator:4});
  assert.deepEqual(rhythmBeats({duration:4,dots:2}),{numerator:7,denominator:4});
  assert.deepEqual(rhythmBeats({duration:8,tuplet:{actual:3,normal:2}}),{numerator:1,denominator:3});
  assert.deepEqual(rhythmBeats({duration:8,dots:1,tuplet:{actual:3,normal:2}}),{numerator:1,denominator:2});
  assert.deepEqual(rhythmBeats({duration:16,tuplet:{actual:5,normal:4}}),{numerator:1,denominator:5});
  assert.equal(rhythmBeats({duration:null}),null);
});
test('validation preserves timing labels and rejects invalid durations, dots, tuplets and rest ties',()=>{
  const label={duration:8,dots:2,tuplet:{actual:3,normal:2,groupId:'group'},tie:'start'};
  const clean=validateGeometry(geometry(label),[page],{confirm:true});assert.deepEqual(clean.measures[0].events[0].rhythm,label);
  assert.match(eventName(clean.measures[0].events[0]),/双附点.*3:2.*延音起点/);
  for(const invalid of [{duration:3},{duration:8,dots:-1},{duration:8,dots:4},{duration:8,dots:1.5},
    {duration:8,tuplet:{actual:3,normal:0}},{duration:8,tuplet:{actual:'3',normal:2}},{duration:8,tuplet:{actual:3,normal:3}},
    {duration:8,tie:'bad'},{duration:8,kind:'rest',tie:'start'}]){
    assert.throws(()=>validateGeometry(geometry(invalid),[page],{confirm:true}));
  }
  const rest=validateGeometry(geometry({duration:16,dots:1,kind:'rest'}),[page],{confirm:true});assert.equal(rest.measures[0].events[0].rhythm.kind,'rest');
});
test('one tuplet group must use one ratio and remain within the same track row',()=>{
  const g=geometry({duration:8,tuplet:{actual:3,normal:2,groupId:'group'}}),m=g.measures[0];
  m.events.push({...structuredClone(m.events[0]),id:'e2',bbox:[60,0,100,40]});
  validateGeometry(g,[page],{confirm:true});m.events[1].rhythm.tuplet.normal=4;
  assert.throws(()=>validateGeometry(g,[page],{confirm:true}),/同组连音/);
});
