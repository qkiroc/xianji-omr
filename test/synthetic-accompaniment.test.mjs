import test from 'node:test';
import assert from 'node:assert/strict';
import {assignAccompanimentStyles,accompanimentProfile,applyAccompanimentNotation,repairQueue} from '../tools/synthetic/accompaniment.mjs';
const note=(string,fret,extra={})=>({string,fret,mode:'fret',...extra});
const beat=(notes,extra={})=>({duration:4,dotted:false,rest:false,notes,...extra});
const c=[0,1,0,2,3,-1],g=[3,0,0,0,2,3];
const base=bars=>({customChords:[{id:'c',name:'C',frets:c},{id:'g',name:'G',frets:g}],bars});
const raw=measures=>({id:'test-song',chordShapes:{C:[...c].reverse(),G:[...g].reverse()},measures});
const profile=style=>({id:'synth195-01',pluckNotation:style,strumHeadStyle:style==='numeric'?'numeric':'arrows'});
const jobs=Array.from({length:195},(_,index)=>({id:'song-'+index,index,profiles:[{id:'synth195-01',family:0},{id:'synth195-02',family:1},{id:'synth195-03',family:4}]}));
test('crosses dominate the corpus and every common edition is corrected',()=>{
 const assignments=assignAccompanimentStyles(jobs),counts={};
 for(const j of jobs){const styles=assignments.get(j.id);assert.equal(styles['synth195-01'],'chord-cross');assert.ok(Object.values(styles).filter(s=>s==='chord-cross').length>=2);for(const s of Object.values(styles))counts[s]=(counts[s]||0)+1;}
 assert.deepEqual(counts,{'chord-cross':497,mixed:59,numeric:29});assert.deepEqual(assignments,assignAccompanimentStyles([...jobs].reverse()));
});
test('chord plucks use crosses, passing notes retain their actual fret, context crosses bar lines',()=>{
 const score=base([{beats:[beat([note(2,1)],{chord:'c'}),beat([note(1,3)])]},{beats:[beat([note(3,0)])]}]),source=raw([{chords:[{beat:0,name:'C'}]},{chords:[]}]);
 const before=structuredClone(score),applied=applyAccompanimentNotation(score,source,profile('chord-cross'));
 assert.deepEqual(score,before);assert.equal(applied.score.bars[0].beats[0].notes[0].mode,'chord');assert.equal(applied.score.bars[0].beats[1].notes[0].mode,'fret');assert.equal(applied.score.bars[1].beats[0].notes[0].mode,'chord');assert.equal(applied.coverage.crossPlucks,2);
 assert.deepEqual(applied.score.bars.map(b=>b.beats.map(e=>e.notes.map(n=>[n.string,n.fret]))),score.bars.map(b=>b.beats.map(e=>e.notes.map(n=>[n.string,n.fret]))));
});
test('chords changing during a sustained event apply at the following pluck',()=>{
 const score=base([{beats:[beat([note(2,1)],{chord:'c'}),beat([note(2,0)])]}]),source=raw([{chords:[{beat:0,name:'C'},{beat:.5,name:'G'}]}]);
 const {score:s}=applyAccompanimentNotation(score,source,profile('chord-cross'));assert.equal(s.bars[0].beats[1].notes[0].mode,'chord');
});
test('technique endpoints, explicit frets, ghost notes and mute meanings are retained',()=>{
 const score=base([{beats:[beat([note(1,0)],{chord:'c'}),beat([note(1,1,{technique:'h'})]),beat([note(2,1,{synthDisplayFret:true})]),beat([note(3,0)]),beat([note(2,1)],{synth:{ghost:true}}),beat([note(3,0,{mode:'mute'})])]}]),source=raw([{chords:[{beat:0,name:'C'}],guitar:[{},{},{},{notes:[{string:3,fret:0,displayFret:true}]},{},{}]}]);
 const applied=applyAccompanimentNotation(score,source,profile('chord-cross')),notes=applied.score.bars[0].beats.map(b=>b.notes[0]);assert.deepEqual(notes.map(n=>n.mode),['fret','fret','fret','fret','fret','mute']);assert.equal(notes[0].synthKeepFret,true);assert.equal(applied.coverage.crossPlucks,0);assert.equal(applied.coverage.mutedPlucks,1);
});
test('mixed and numeric versions are reproducible and retain rhythm, lyrics and technique fields',()=>{
 const score=base(Array.from({length:30},(_,i)=>({melody:[{degree:1,duration:4,lyric:'词'+i}],beats:[beat([note(2,1)],{chord:'c',dotted:i%2===0})]}))),source=raw(score.bars.map(()=>({chords:[{beat:0,name:'C'}]})));
 const mixed=applyAccompanimentNotation(score,source,profile('mixed'));assert.ok(mixed.coverage.crossPlucks>0&&mixed.coverage.crossPlucks<30);assert.deepEqual(mixed,applyAccompanimentNotation(score,source,profile('mixed')));
 assert.deepEqual(mixed.score.bars.map(b=>b.melody),score.bars.map(b=>b.melody));assert.deepEqual(mixed.score.bars.map(b=>b.beats[0].dotted),score.bars.map(b=>b.beats[0].dotted));assert.equal(applyAccompanimentNotation(score,source,profile('numeric')).coverage.crossPlucks,0);
});
test('reference cross columns, long circles and alternate directions remain configurable',()=>{
 const p=accompanimentProfile({strumXs:true,notationHead:'slash',longNoteCircles:true,strumPlacement:'pick',featureFamily:9},'chord-cross');assert.equal(p.strumXs,true);assert.equal(p.longNoteCircles,true);assert.equal(p.notationHead,'slash');assert.equal(p.strumPlacement,'pick');
});
test('previously uploaded common editions precede other repairs and all new imports',()=>{
 const selected=jobs.slice(0,3),states=new Map([[selected[1].id,{profiles:[{id:'synth195-01',pages:[{pageId:'old-1'}]},{id:'synth195-02',pages:[{pageId:'old-2'}]}]}],[selected[2].id,{profiles:[{id:'synth195-01',pages:[],pendingPages:1}]}]]);
 const q=repairQueue(selected,states);assert.equal(q.length,9);assert.deepEqual(q.slice(0,3).map(p=>[p.sourceId,p.profileId,p.phase]),[['song-1','synth195-01','repair-common'],['song-2','synth195-01','repair-common'],['song-1','synth195-02','repair-existing']]);assert.ok(q.slice(3).every(p=>p.phase==='continue-import'));
});

