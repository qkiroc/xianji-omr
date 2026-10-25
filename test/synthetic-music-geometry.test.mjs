import test from 'node:test';
import assert from 'node:assert/strict';
import {musicInkBounds,separateMusicPadding} from '../tools/synthetic/music-region-geometry.mjs';
function fixture(t){
 const previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle};t.after(()=>Object.assign(globalThis,previous));
 const identity={a:1,b:0,c:0,d:1,e:0,f:0},metrics={actualBoundingBoxLeft:0,actualBoundingBoxRight:8,actualBoundingBoxAscent:10,actualBoundingBoxDescent:2};
 globalThis.document={createElement:()=>({getContext:()=>({measureText:()=>metrics})})};globalThis.getComputedStyle=e=>({fontStyle:'normal',fontWeight:'400',fontSize:'18px',fontFamily:'test',display:e.hidden?'none':'inline',visibility:'visible',stroke:e.tagName==='line'?'black':'none',strokeWidth:'2'});
 const text=(content,x,y,flags={})=>({tagName:'text',textContent:content,dataset:{lyricVerse:'0'},...flags,getNumberOfChars:()=>content.length,getStartPositionOfChar:i=>({x:x+i*9,y}),getScreenCTM:()=>identity,getBoundingClientRect:()=>({left:x,top:y-30,right:x+40,bottom:y+40}),closest(s){return (this.lyric&&s.includes('[data-melody-lyric]')||this.art&&s.includes('.sheet-note-art')||this.cursor&&s.includes('[data-cursor-bar]'))?{}:null;}});
 const note=text('1',20,100,{art:true}),lyric=text('word',20,130,{lyric:true}),fallback=text('unmarked lyric',20,150),end={tagName:'line',getScreenCTM:()=>identity,getBoundingClientRect:()=>({left:300,top:90,right:300,bottom:113}),closest:()=>null};
 const primitives=[note,lyric,fallback,end],row={querySelectorAll:s=>s==='[data-melody-lyric]'?[lyric]:primitives};return{row,note,lyric,end,primitives};
}
test('glyph ink excludes font leading and fallback lyrics while preserving end barline strokes',t=>{const f=fixture(t),v=musicInkBounds(f.row);assert.equal(v.melody.top,89);assert.equal(v.melody.bottom,114);assert.equal(v.melody.right,301);assert.equal(v.lyrics[0].bounds.top,120);assert.equal(v.lyrics[0].bounds.bottom,132);});
test('hidden text and cursor artwork cannot enlarge the melody crop',t=>{const f=fixture(t);f.primitives.push({...f.note,hidden:true,getStartPositionOfChar:()=>({x:1000,y:1000})},{...f.note,cursor:true,getStartPositionOfChar:()=>({x:2000,y:2000})});const v=musicInkBounds(f.row);assert.equal(v.melody.right,301);assert.equal(v.melody.bottom,114);});
test('shared padding is separated without removing note or lyric ink',()=>{const children=[{classKey:'melody',bbox:[0,0,400,124]},{classKey:'lyrics',bbox:[0,110,400,140]}];separateMusicPadding(children,{melody:{bottom:114},lyrics:[{bounds:{top:120}}]},0);assert.equal(children[0].bbox[3],117);assert.equal(children[1].bbox[1],117);});
test('actual glyph overlap aborts instead of cutting visible notation',()=>{const children=[{classKey:'melody',bbox:[0,0,100,50]},{classKey:'lyrics',bbox:[0,30,100,70]}];assert.throws(()=>separateMusicPadding(children,{melody:{bottom:50},lyrics:[{bounds:{top:40}}]},0),/Actual melody/);assert.equal(children[0].bbox[3],50);});
