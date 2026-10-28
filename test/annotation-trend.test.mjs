import {test} from "node:test";
import assert from "node:assert/strict";
import {annotationWindow,annotationTrend} from "../shared/annotation-trend.ts";
import {timeSignatureComplete,COMMON_TIME_SIGNATURES} from "../shared/time-signatures.ts";
import {compile} from "./compile-ui.mjs";
import {fileURLToPath} from "node:url";
const client=await import(await compile(fileURLToPath(new URL("../shared/crop-label-client.ts",import.meta.url))));
test("daily annotation dates use Shanghai midnight, fill gaps and support the stated ranges",()=>{
 assert.equal(annotationWindow(7,new Date("2026-10-28T15:59:59Z")).end,"2026-10-28");
 assert.equal(annotationWindow(7,new Date("2026-10-28T16:00:00Z")).end,"2026-10-29");
 const trend=annotationTrend(7,[{date:"2026-10-28",count:"3",estimated:"1"}],new Date("2026-10-28T04:00:00Z"));
 assert.equal(trend.start,"2026-10-22");assert.equal(trend.points.length,7);assert.equal(trend.points[0].count,0);
 assert.equal(trend.total,3);assert.equal(trend.today,3);assert.equal(trend.estimated,1);
 for(const days of [7,14,30,90])assert.equal(annotationWindow(days).dates.length,days);
 assert.throws(()=>annotationWindow(8));
});
test("time-signature shortcuts and custom numeric labels preserve the pair",()=>{
 for(const [i,pair]of COMMON_TIME_SIGNATURES.entries()){
  const result=client.timeSignatureShortcut(i===9?"0":String(i+1),{tonic:null,kind:null});
  assert.equal(result.label.tonic,pair.join("/"));
  assert.ok(client.cropLabelComplete("time-signatures",result.label));
 }
 for(const tonic of ["4/","/4","0/4","33/4","4/3","NaN/4"])
  assert.equal(client.cropLabelComplete("time-signatures",{tonic,kind:"play"}),false);
 assert.ok(timeSignatureComplete({numerator:7,denominator:8}));
 assert.equal(client.timeSignatureShortcut("q",{tonic:null,kind:null}),null);
});
test("time-signature editor transports numerator and denominator without leaking key-specific fields",async(t)=>{
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;});
 let sent;
 globalThis.fetch=async(_url,options)=>{
  sent=JSON.parse(options.body);
  return Response.json({id:"sample",numerator:6,denominator:8,status:"confirmed",version:2});
 };
 const saved=await client.cropApi("time-signatures","/v2/time-signatures/datasets/d/records/r",{
  method:"PUT",body:JSON.stringify({tonic:"6/8",kind:"play",version:1}),
 });
 assert.deepEqual(sent,{numerator:6,denominator:8,version:1});
 assert.equal(saved.tonic,"6/8");assert.equal(saved.version,2);
});