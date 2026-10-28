import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { KEY_TONICS, keyLabelComplete, keyShortcut } from "../shared/key-signatures.ts";
import { files, SCHEMA } from "../server/src/migrate.ts";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const blank = { tonic: null, kind: null };

test("numeric shortcuts choose C–B; accidentals preserve spelling and Q/W choose the role", () => {
  for (const [index, note] of ["C","D","E","F","G","A","B"].entries())
    assert.equal(keyShortcut({key:String(index+1)},blank,"").label.tonic,note);
  const flat = keyShortcut({key:"ArrowDown"},blank,"");
  const db = keyShortcut({key:"2"},flat.label,flat.accidental);
  assert.equal(db.label.tonic,"Db");
  const sharp = keyShortcut({key:"ArrowUp"},db.label,"b");
  assert.equal(sharp.label.tonic,"D#");
  assert.equal(keyShortcut({key:"0"},sharp.label,"#").label.tonic,"D");
  assert.equal(keyShortcut({key:"Q"},db.label,"b").label.kind,"original");
  assert.equal(keyShortcut({key:"w"},db.label,"b").label.kind,"play");
});
test("shortcuts ignore IME and browser modifiers; complete labels require both fields", () => {
  for (const modifier of ["ctrlKey","metaKey","altKey","isComposing"])
    for (const key of ["1", "ArrowUp", "ArrowDown"])
      assert.equal(keyShortcut({key,[modifier]:true},blank,""),null);
  assert.equal(keyShortcut({key:"8"},blank,""),null);
  for (const label of [null,undefined,blank,{tonic:"C",kind:null},{tonic:null,kind:"play"},{tonic:"H",kind:"original"},{tonic:"C",kind:"written"}])
    assert.equal(keyLabelComplete(label),false);
  for (const tonic of KEY_TONICS)
    for (const kind of ["original","play"]) assert.equal(keyLabelComplete({tonic,kind}),true);
  assert.ok(KEY_TONICS.includes("Db") && KEY_TONICS.includes("C#"));
});
test("schema13 is expand-only with frozen sources, unique imports, and tracked source references", async () => {
  const migrations=await files();
  assert.equal(SCHEMA,13);assert.equal(migrations.length,SCHEMA);
  const sql=migrations.find(m=>m.version===11).sql;
  assert.match(sql,/UNIQUE\(dataset_id,source_page_id,source_box_id\)/);
  assert.match(sql,/REFERENCES omr_images\(id\)/);assert.match(sql,/source_checksum text NOT NULL/);
  assert.match(sql,/status <> 'confirmed' OR \(tonic IS NOT NULL AND kind IS NOT NULL\)/);
});

// Exercise the actual production handlers and transaction helper without external transports.
// Real PostgreSQL and PNG pixels are covered in key-signatures-integration.test.mjs.
const moduleURL=new URL("../server/src/crop-labels.ts",import.meta.url);
let source=await readFile(moduleURL,"utf8");
source=source.replace('import sharp from "sharp";',`const sharp = (data) => ({extract: (rectangle) => ({png: () => ({toBuffer: async () => Buffer.from(JSON.stringify({rectangle,source:data.toString()}))})})});`)
  .replace(/from "([^"]+)"/g,(match,path)=>path.startsWith(".")?'from "'+new URL(path,moduleURL).href+'"':match);
const {registerKeySignatures,registerTimeSignatures}=await import("data:text/javascript;base64,"+Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
class MemoryPool {
  datasets=new Map();records=new Map();sourceId=randomUUID();sources=[];nextSequence=0;
  async connect(){return this;} release(){}
  async query(sql,p=[]){
    const time=sql.includes('omr_time_');
    if(time)sql=sql.replaceAll('omr_time_','omr_key_').replaceAll('numerator','tonic').replaceAll('denominator','kind').replaceAll('tonic::text','tonic').replaceAll('kind::text','kind');
    let rows=[];
    if(sql.startsWith("BEGIN"))this.snapshot=structuredClone({datasets:this.datasets,records:this.records});
    else if(sql==="ROLLBACK")Object.assign(this,this.snapshot);
    else if(sql.includes("to_regclass"))rows=[{t:null}];
    else if(sql==="COMMIT"||sql.includes("pg_advisory")||sql.includes("omr_deletion_jobs")){}
    else if(sql.startsWith("SELECT * FROM omr_datasets")){if(p[0]===this.sourceId)rows=[{id:this.sourceId,deleted_at:null}];}
    else if(sql.startsWith("INSERT INTO omr_key_datasets"))this.datasets.set(p[0],{id:p[0],name:p[1],description:p[2],source_dataset_id:p[3],source_name:"Layout source"});
    else if(sql.includes("CROSS JOIN LATERAL"))rows=this.sources;
    else if(sql.startsWith("INSERT INTO omr_key_records")){
      for(const x of JSON.parse(p[1])){
        if([...this.records.values()].some(r=>r.dataset_id===p[0]&&r.source_page_id===x.source_page_id&&r.source_box_id===x.source_box_id))continue;
        const r={...x,id:x.id,dataset_id:p[0],sequence:++this.nextSequence,status:"draft",version:1,tonic:null,kind:null};
        this.records.set(x.id,r);rows.push({id:x.id});
      }
    }
    else if(sql.startsWith("SELECT to_char(first_labeled_at")) {
      const totals=new Map();
      for(const r of this.records.values())if(r.dataset_id===p[0]&&r.first_labeled_at){
        const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.first_labeled_at));
        if(date>=p[1]&&date<=p[2]){const prior=totals.get(date)||{date,count:0,estimated:0};prior.count++;prior.estimated+=r.label_time_estimated?1:0;totals.set(date,prior);}
      }
      rows=[...totals.values()];
    }
    else if(sql.startsWith("SELECT d.*")){
      rows=[...this.datasets.values()].filter(d=>!p.length||d.id===p[0]).map(d=>{
        const records=[...this.records.values()].filter(r=>r.dataset_id===d.id);
        return {...d,sample_count:records.length,confirmed_count:records.filter(r=>r.status==="confirmed").length};
      });
    }
    else if(sql.startsWith("SELECT id,status FROM omr_key_records"))rows=[...this.records.values()].filter(r=>r.dataset_id===p[0]).sort((a,b)=>a.sequence-b.sequence).map(r=>({id:r.id,status:r.status}));
    else if(sql.startsWith("SELECT count(*) AS total FROM omr_key_records") || (sql.startsWith("SELECT * FROM omr_key_records WHERE dataset_id") && sql.includes("LIMIT $7"))) {
      let filtered=[...this.records.values()].filter(r=>r.dataset_id===p[0]&&(!p[1]||r.status===p[1])&&(!p[2]||String(r.tonic)===p[2])&&(!p[3]||String(r.kind)===p[3])&&(!p[4]||r.split===p[4])&&(!p[5]||(r.source.songName+" "+r.source.pageName).toLowerCase().includes(p[5].toLowerCase()))).sort((a,b)=>a.sequence-b.sequence);
      rows=sql.startsWith("SELECT count")?[{total:String(filtered.length)}]:filtered.slice(p[7],p[7]+p[6]);
    }
    else if(sql.startsWith("SELECT * FROM omr_key_records WHERE dataset_id"))rows=[...this.records.values()].filter(r=>r.dataset_id===p[0]&&r.status==="confirmed").sort((a,b)=>a.sequence-b.sequence);
    else if(sql.startsWith("SELECT * FROM omr_key_records WHERE id")||sql.startsWith("SELECT id FROM omr_key_records")){
      const r=this.records.get(p[0]);if(r?.dataset_id===p[1])rows=[r];
    }
    else if(sql.startsWith("UPDATE omr_key_records")){
      const r=this.records.get(p[2]);
      if(r?.dataset_id===p[3]&&r.version===p[4]){Object.assign(r,{tonic:p[0],kind:p[1],status:"confirmed",first_labeled_at:r.first_labeled_at||new Date().toISOString(),version:r.version+1});rows=[r];}
    }
    else if(sql.startsWith("UPDATE omr_key_datasets")){}
    else if(sql.startsWith("SELECT r.*,i.object_key")){
      const r=this.records.get(p[0]),page=this.sources.find(s=>s.id===r?.source_page_id);
      if(r?.dataset_id===p[1]&&page)rows=[{...r,object_key:"source/"+page.id,checksum:page.checksum,coordinate:page.coordinate}];
    }
    else throw Error("Unhandled SQL: "+sql);
    if(time)rows=rows.map(r=>{
      if(!Object.hasOwn(r,'tonic'))return r;
      const {tonic,kind,...rest}=r;return {...rest,numerator:tonic,denominator:kind};
    });
    return {rows:structuredClone(rows),rowCount:rows.length};
  }
}
function setup(time=false){
  const pool=new MemoryPool(),routes=new Map(),objects=new Map();
  const router=Object.fromEntries(["get","post","put"].map(method=>[method,(path,handler)=>routes.set(method+" "+path,handler)]));
  (time?registerTimeSignatures:registerKeySignatures)(router,{pool,storage:{async get(key){if(!objects.has(key))throw Error("storage unavailable");return objects.get(key);}}});
  const pageId=randomUUID(),image=Buffer.from("test coordinate image");
  pool.sources=[{id:pageId,checksum:sha(image),width:300,height:200,page_order:1,original_name:"score.png",song_id:randomUUID(),song_name:"Song",song_group_key:"song-group",split:"val",
    box:{id:"key-1",classKey:"key_signature",x:10,y:20,width:70,height:30,metadata:{value:{tonic:"C",kind:"original"}}}}];
  objects.set("source/"+pageId,image);
  const invoke=async(method,path,{body={},params={},query={}}={})=>{
    const res={code:200,value:undefined,headers:{},status(code){this.code=code;return this;},json(value){this.value=value;return this;},type(value){this.mime=value;return this;},set(k,v){this.headers[k]=v;return this;},send(value){this.value=value;return this;}};
    await routes.get(method+" "+path)({body,params,query},res);return res;
  };
  const create=()=>invoke("post",(time?"/time-signatures/datasets":"/key-signatures/datasets"),{body:{name:"Keys",sourceDatasetId:pool.sourceId}});
  return {pool,objects,invoke,create};
}
const root="/key-signatures/datasets/:datasetId";
test("create imports blank key labels with frozen geometry and inherited song split; sync deduplicates",async()=>{
  const f=setup(),created=await f.create(),d=created.value;
  assert.equal(created.code,201);assert.equal(d.imported,1);
  const r=[...f.pool.records.values()][0];
  assert.equal(r.tonic,null);assert.equal(r.kind,null);assert.equal(r.status,"draft");assert.equal(r.split,"val");
  assert.equal(r.song_group_key,"song-group");assert.deepEqual(r.rectangle,{left:10,top:20,width:70,height:30});
  const params={datasetId:d.id};
  const noChanges=await f.invoke("post",root+"/sync",{params});
  assert.equal(noChanges.value.imported,0);
  f.pool.sources[0].box.x=25;
  f.pool.sources.push({...f.pool.sources[0],box:{...f.pool.sources[0].box,id:"key-2"}});
  assert.equal((await f.invoke("post",root+"/sync",{params})).value.imported,1);
  assert.equal(f.pool.records.get(r.id).rectangle.left,10);
  assert.equal((await f.invoke("get",root+"/editor",{params})).value.position,1);
});
test("save validates label/version/ownership; pending navigation skips completed and wraps; export includes only saved truth",async()=>{
  const f=setup();f.pool.sources.push({...f.pool.sources[0],box:{...f.pool.sources[0].box,id:"key-2"}});
  const d=(await f.create()).value,params={datasetId:d.id};
  const initial=(await f.invoke("get",root+"/editor",{params})).value;
  const id=initial.record.id,recordParams={...params,recordId:id};
  assert.equal(initial.nextId,[...f.pool.records.values()][1].id);
  for(const body of [{tonic:"C",kind:null,version:1},{tonic:"H",kind:"play",version:1},{tonic:"C",kind:"play",version:0}])
    await assert.rejects(f.invoke("put",root+"/records/:recordId",{params:recordParams,body}),e=>e.status===400);
  const body={tonic:"Db",kind:"play",version:1};
  const saved=(await f.invoke("put",root+"/records/:recordId",{params:recordParams,body})).value;
  assert.equal(saved.version,2);assert.equal(saved.status,"confirmed");
  await assert.rejects(f.invoke("put",root+"/records/:recordId",{params:recordParams,body}),e=>e.status===409);
  const next=(await f.invoke("get",root+"/editor",{params,query:{recordId:id,direction:"pending"}})).value;
  assert.equal(next.position,2);
  const back=(await f.invoke("get",root+"/editor",{params,query:{recordId:next.record.id,direction:"previous"}})).value;
  assert.equal(back.record.tonic,"Db");assert.equal(back.dataset.confirmed_count,1);
  const other=(await f.create()).value;
  await assert.rejects(f.invoke("get",root+"/editor",{params:{datasetId:other.id},query:{recordId:id}}),e=>e.status===404);
  await assert.rejects(f.invoke("put",root+"/records/:recordId",{params:{datasetId:other.id,recordId:id},body:{...body,version:2}}),e=>e.status===404);
  const exported=JSON.parse((await f.invoke("get",root+"/export",{params})).value);
  assert.equal(exported.records.length,1);assert.equal(exported.records[0].tonic,"Db");assert.equal(exported.records[0].split,"val");
  assert.ok(exported.records[0].imageUrl.endsWith(id+"/content"));
  await f.invoke("put",root+"/records/:recordId",{params:{...params,recordId:next.record.id},body:{tonic:"C#",kind:"original",version:1}});
  const all=(await f.invoke("get",root+"/editor",{params,query:{recordId:next.record.id,direction:"pending"}})).value;
  assert.equal(all.record.id,next.record.id);assert.equal(all.dataset.confirmed_count,2);
  // Make the first item pending and verify wrapping from the end.
  f.pool.records.get(id).status="draft";
  assert.equal((await f.invoke("get",root+"/editor",{params,query:{recordId:next.record.id,direction:"pending"}})).value.record.id,id);
});
test("content uses the working-coordinate checksum and frozen crop; changed images are refused",async()=>{
  const f=setup(),p=f.pool.sources[0],work=Buffer.from("oriented working image");
  p.coordinate={working:{key:"working",checksum:sha(work),width:300,height:200}};
  f.objects.set("working",work);
  const d=(await f.create()).value,r=[...f.pool.records.values()][0],params={datasetId:d.id,recordId:r.id};
  const content=await f.invoke("get",root+"/records/:recordId/content",{params});
  assert.equal(content.mime,"image/png");
  assert.deepEqual(JSON.parse(content.value).rectangle,r.rectangle);
  assert.equal(JSON.parse(content.value).source,"oriented working image");
  f.objects.set("working",Buffer.from("changed"));
  await assert.rejects(f.invoke("get",root+"/records/:recordId/content",{params}),e=>e.status===409);
});
test("invalid crop import rolls back the dataset instead of leaving a partial queue",async()=>{
  const f=setup();f.pool.sources[0].box.width=1000;
  await assert.rejects(f.create());
  assert.equal(f.pool.datasets.size,0);assert.equal(f.pool.records.size,0);
  await assert.rejects(f.invoke("post","/key-signatures/datasets",{body:{name:"Missing source"}}),e=>e.status===400);
});
test("record list filters labels, roles and text, paginates, clamps stale pages and rejects invalid filters",async()=>{
  const f=setup(),source=f.pool.sources[0];
  f.pool.sources=Array.from({length:23},(_,i)=>({...source,box:{...source.box,id:"key-"+i}}));
  const d=(await f.create()).value,params={datasetId:d.id};
  const first=(await f.invoke("get",root+"/records",{params,query:{pageSize:"10",page:"1"}})).value;
  const second=(await f.invoke("get",root+"/records",{params,query:{pageSize:"10",page:"2"}})).value;
  assert.equal(first.total,23);assert.equal(first.items.length,10);assert.equal(second.items.length,10);
  assert.ok(!first.items.some(r=>second.items.some(s=>s.id===r.id)));
  assert.equal((await f.invoke("get",root+"/records",{params,query:{pageSize:"10",page:"999"}})).value.page,3);
  const r=first.items[0];
  await f.invoke("put",root+"/records/:recordId",{params:{...params,recordId:r.id},body:{tonic:"Bb",kind:"original",version:1}});
  const labeled=(await f.invoke("get",root+"/records",{params,query:{status:"confirmed",tonic:"Bb",kind:"original",split:"val",search:"score"}})).value;
  assert.equal(labeled.total,1);assert.equal(labeled.items[0].id,r.id);assert.equal(labeled.dataset.confirmed_count,1);
  assert.equal((await f.invoke("get",root+"/records",{params,query:{status:"draft"}})).value.total,22);
  assert.equal((await f.invoke("get",root+"/records",{params,query:{search:"absent"}})).value.total,0);
  for(const query of [{page:"0"},{pageSize:"10000"},{status:"unknown"},{kind:"written"},{tonic:"H"},{split:"invalid"}])
    await assert.rejects(f.invoke("get",root+"/records",{params,query}),e=>e.status===400);
});
test("daily label chart fills every day, ignores table filters and counts first saves only",async()=>{
 const f=setup(),d=(await f.create()).value,params={datasetId:d.id};
 const r=[...f.pool.records.values()][0],recordParams={...params,recordId:r.id};
 let result=(await f.invoke("get",root+"/records",{params,query:{trendDays:"7"}})).value;
 assert.equal(result.annotationTrend.points.length,7);assert.equal(result.annotationTrend.total,0);
 await f.invoke("put",root+"/records/:recordId",{params:recordParams,body:{tonic:"D",kind:"play",version:1}});
 const first=f.pool.records.get(r.id).first_labeled_at;
 result=(await f.invoke("get",root+"/records",{params,query:{trendDays:"7",status:"draft",search:"absent"}})).value;
 assert.equal(result.total,0);assert.equal(result.annotationTrend.today,1);
 await f.invoke("put",root+"/records/:recordId",{params:recordParams,body:{tonic:"G",kind:"original",version:2}});
 assert.equal(f.pool.records.get(r.id).first_labeled_at,first);
 assert.equal((await f.invoke("get",root+"/records",{params,query:{trendDays:"30"}})).value.annotationTrend.total,1);
 for(const trendDays of ["8","0","NaN","90 OR 1=1"])
  await assert.rejects(f.invoke("get",root+"/records",{params,query:{trendDays}}),e=>e.status===400);
});
test("time signatures share import and queue semantics but retain numeric labels and validate musical denominators",async()=>{
 const f=setup(true);f.pool.sources[0].box.classKey="time_signature";
 const d=(await f.create()).value,params={datasetId:d.id},base="/time-signatures/datasets/:datasetId";
 const r=(await f.invoke("get",base+"/editor",{params})).value.record;
 assert.equal(r.numerator,null);assert.equal(r.denominator,null);
 for(const label of [{numerator:0,denominator:4},{numerator:33,denominator:4},{numerator:4,denominator:3},{numerator:4.5,denominator:4},{numerator:"4",denominator:4}])
  await assert.rejects(f.invoke("put",base+"/records/:recordId",{params:{...params,recordId:r.id},body:{...label,version:1}}),e=>e.status===400);
 const saved=(await f.invoke("put",base+"/records/:recordId",{params:{...params,recordId:r.id},body:{numerator:6,denominator:8,version:1}})).value;
 assert.equal(saved.numerator,6);assert.equal(saved.denominator,8);assert.equal(saved.status,"confirmed");
 assert.equal(Object.hasOwn(saved,"tonic"),false);
 const list=(await f.invoke("get",base+"/records",{params,query:{numerator:"6",denominator:"8",trendDays:"7"}})).value;
 assert.equal(list.total,1);assert.equal(list.items[0].denominator,8);assert.equal(list.annotationTrend.today,1);
 const exported=JSON.parse((await f.invoke("get",base+"/export",{params})).value);
 assert.equal(exported.task,"time-signature");assert.equal(exported.records[0].numerator,6);
 assert.ok(exported.records[0].imageUrl.includes("/time-signatures/"));
 assert.equal((await f.invoke("post",base+"/sync",{params})).value.imported,0);
});