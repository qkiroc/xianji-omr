import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PoolClient } from "pg";
import type { Geometry, LocalizationRecord, SourcePage, XYXY } from "../../../shared/localization.ts";
import { insist, validateGeometry, fingerprint } from "./geometry.ts";

export interface CropStorage {
  get(key:string):Promise<Buffer>;
  put(key:string,data:Buffer,mime:string):Promise<unknown>;
  delete(key:string):Promise<unknown>;
}
const writes=new WeakMap<PoolClient,{storage:CropStorage;keys:string[]}>();
export async function finishCropWrites(c:PoolClient,committed:boolean) {
  const pending=writes.get(c);writes.delete(c);
  if(!committed&&pending)await Promise.allSettled(pending.keys.map(key=>pending.storage.delete(key)));
}
export const sha256=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

export async function storeCrop(c:PoolClient,storage:CropStorage,prefix:string,recordId:string,bytes:Buffer) {
  const image=await sharp(bytes,{limitInputPixels:50000000}).metadata();
  insist(image.width&&image.height,"裁片尺寸无效");
  const descriptor={width:image.width,height:image.height,checksum:sha256(bytes)};
  const key=prefix+"rhythm-crops/"+randomUUID()+".png";
  const pending=writes.get(c)||{storage,keys:[]};pending.keys.push(key);writes.set(c,pending);
  await storage.put(key,bytes,"image/png");
  await c.query("INSERT INTO omr_loc_crop_assets(record_id,object_key,checksum,width,height) VALUES($1,$2,$3,$4,$5)",
    [recordId,key,descriptor.checksum,descriptor.width,descriptor.height]);
  return descriptor;
}

// A source is consulted once, while materializing the crop. The resulting
// record has no source-page attachment, page offset or original-page metadata.
export async function detachRhythmRecord(c:PoolClient,r:LocalizationRecord,storage:CropStorage,prefix:string):Promise<LocalizationRecord> {
  if(r.geometry.schemaVersion!=="omr-rhythm-v1"||r.crop_image)return r;
  const sample=r.geometry.sample,page=r.geometry.pages[0];
  insist(page,"裁片数据缺少图像");
  const source=(await c.query("SELECT object_key,checksum FROM omr_images WHERE id=$1",[page.sourcePageId])).rows[0];
  insist(source&&source.checksum===page.sourceSha,"旧数据的原图不存在或已改变，请重新导入裁片",409);
  const raw=await storage.get(source.object_key);insist(sha256(raw)===page.sourceSha,"原图校验失败",409);
  const bounds:XYXY=sample?.bbox||[0,0,page.width,page.height];
  const bytes=await sharp(raw,{limitInputPixels:50000000}).extract({left:bounds[0],top:bounds[1],width:bounds[2]-bounds[0],height:bounds[3]-bounds[1]}).png().toBuffer();
  const image=await storeCrop(c,storage,prefix,r.id,bytes),localId=randomUUID();
  const local=(b:XYXY):XYXY=>[b[0]-bounds[0],b[1]-bounds[1],b[2]-bounds[0],b[3]-bounds[1]];
  const p:SourcePage={localPageId:localId,sourcePageId:localId,sourceSha:image.checksum,pixelSha:null,
    width:image.width,height:image.height,mapping:[[1,0,0],[0,1,0],[0,0,1]]};
  const geometry:Geometry={schemaVersion:"omr-rhythm-v1",pages:[p],
    regions:r.geometry.regions?.map(region=>({...region,pageId:localId,bbox:local(region.bbox)})),
    measures:r.geometry.measures.map(m=>{
      const region=r.geometry.regions?.find(region=>region.id===m.regionId),row=region?local(region.bbox):[0,0,image.width,image.height];
      const stripe=(b:XYXY):XYXY=>[b[0]-bounds[0],row[1],b[2]-bounds[0],row[3]];
      return {...m,pageId:localId,bbox:m.bbox?stripe(m.bbox):null,staffLines:null,
        events:m.events.map(e=>{const b=e.bbox?stripe(e.bbox):null;return {...e,bbox:b,centerX:b?Math.round((b[0]+b[2])/2):null,contextBBox:null};})};
    })};
  const clean=validateGeometry(geometry,[p],{confirm:r.status==="confirmed"});
  await c.query("DELETE FROM omr_loc_record_pages WHERE record_id=$1",[r.id]);
  const corpusId=r.corpus_id.startsWith("crop")?r.corpus_id:"crop:"+fingerprint(r.corpus_id);
  const metadata=r.original&&typeof r.original==="object"&&!Array.isArray(r.original)?r.original:{};
  const title=typeof metadata.songName==="string"?metadata.songName+(sample?" · 第 "+sample.index+" 行":""):r.title;
  return (await c.query("UPDATE omr_loc_records SET geometry=$2,crop_image=$3,original='{}'::jsonb,source='crop-image',source_fingerprint=$4,input_checksum=$4,corpus_id=$5,title=$6,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
    [r.id,clean,image,image.checksum,corpusId,title])).rows[0];
}
