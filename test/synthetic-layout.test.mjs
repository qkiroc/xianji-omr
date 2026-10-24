import test from 'node:test';
import assert from 'node:assert/strict';
import {pageStyle,stylesForScore,headerHTML,footerHTML,decorationHTML,mergeLyricRegions,HEADER_LAYOUTS,FOOTER_LAYOUTS,WATERMARK_LAYOUTS} from '../tools/synthetic/page-style.mjs';
import {regions} from '../server/src/annotation.ts';
const source={title:'一首歌 <demo>',artist:'歌手 & guest',key:'G',fingeringKey:'C',meter:[4,4],bpm:86,defaultCapo:2};
test('page appearance is reproducible and varies between physical pages',()=>{
 assert.deepEqual(pageStyle(42,0),pageStyle(42,0));assert.notDeepEqual(pageStyle(42,0),pageStyle(42,1));
 const p={seed:42,pageWidth:1500,pageHeight:2120};
 assert.deepEqual(stylesForScore({...p,featureFamily:1,split:'train'},source,2),stylesForScore({...p,featureFamily:8,split:'test'},source,2));
});
test('independent draws cover all layouts, all colors and asymmetric margins',()=>{
 const samples=Array.from({length:4000},(_,i)=>pageStyle(i,0));
 for(const [key,expected]of [['header',HEADER_LAYOUTS],['footer',FOOTER_LAYOUTS],['watermark',WATERMARK_LAYOUTS]]){
  const counts=new Map();for(const p of samples){const k=key==='watermark'?p[key].kind:p[key].layout;counts.set(k,(counts.get(k)||0)+1);}
  assert.deepEqual([...counts.keys()].sort(),[...expected].sort());
  for(const count of counts.values())assert.ok(count>samples.length/expected.length*.65);
 }
 assert.ok(samples.filter(p=>p.margins.left!==p.margins.right).length>3900);
 assert.ok(new Set(samples.map(p=>p.colors.accent)).size>3900);
 assert.ok(samples.some(p=>p.watermark.kind==='none'&&!p.dirt.enabled));
 for(const p of samples){assert.ok(p.contentWidth>=1210);assert.ok(p.footerTop>1800);assert.ok(p.watermark.opacity<.081);assert.ok(p.dirt.opacity<.081);}
 // Each header family must see every footer family; no pre-wired style combinations.
 for(const h of HEADER_LAYOUTS)assert.equal(new Set(samples.filter(p=>p.header.layout===h).map(p=>p.footer.layout)).size,FOOTER_LAYOUTS.length);
});
test('header metadata is escaped, shuffled, complete and unknown capo is omitted',()=>{
 const orders=new Set();for(let i=0;i<100;i++){
  const style=pageStyle(i,0),html=headerHTML(source,style);orders.add(style.header.order.join());
  assert.ok(html.includes('一首歌 &lt;demo&gt;'));assert.ok(html.includes('歌手 &amp; guest'));
  assert.equal((html.match(/data-meta=/g)||[]).length,7);assert.ok(!html.includes('<demo>'));
 }
 assert.equal(orders.size,6);assert.ok(!headerHTML({...source,defaultCapo:-1},pageStyle(1,0)).includes('data-meta="capo"'));
});
test('decorations never add music labels and include every dirt family',()=>{
 const kinds=new Set();for(let i=0;i<300;i++){
  const p=pageStyle(i,0),d=decorationHTML(p);d.dirtKinds.forEach(k=>kinds.add(k));
  assert.ok(!d.html.includes('data-meta='));assert.ok(d.html.includes('data-ignore-annotation="true"'));
  assert.ok(!footerHTML(p).includes('data-meta='));
 }
 assert.equal(kinds.size,6);
});
test('multiple lyric verses merge only within their own system and preserve unrelated boxes',()=>{
 const boxes=[{id:'s1',classKey:'system',parentSystemId:null,readingOrder:0,x:5,y:5,width:900,height:260},{id:'s1-m',classKey:'melody',parentSystemId:'s1',readingOrder:1,x:20,y:100,width:840,height:30},{id:'v1',classKey:'lyrics',parentSystemId:'s1',readingOrder:2,x:25,y:150,width:700,height:20},{id:'v2',classKey:'lyrics',parentSystemId:'s1',readingOrder:3,x:20,y:180,width:800,height:25},{id:'s2',classKey:'system',parentSystemId:null,readingOrder:4,x:5,y:300,width:900,height:260},{id:'s2-m',classKey:'melody',parentSystemId:'s2',readingOrder:5,x:20,y:400,width:840,height:30},{id:'v3',classKey:'lyrics',parentSystemId:'s2',readingOrder:6,x:30,y:450,width:650,height:20}];
 const before=structuredClone(boxes),merged=mergeLyricRegions(boxes),lyrics=merged.filter(b=>b.classKey==='lyrics');
 assert.deepEqual(boxes,before);assert.equal(lyrics.length,2);assert.deepEqual({...lyrics[0],readingOrder:2},{id:'s1-lyrics',classKey:'lyrics',parentSystemId:'s1',readingOrder:2,x:20,y:150,width:800,height:55});
 assert.deepEqual(mergeLyricRegions(merged),merged);
 regions(merged,1000,700,{confirm:true,pageType:'music',taxonomyVersion:'layout-v2'});
});

