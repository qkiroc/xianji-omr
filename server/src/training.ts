import express from 'express';
import sharp from 'sharp';
import {randomUUID,createHash} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {need,ID,digest,stable} from './annotation.ts';
import {transaction} from './datasets.ts';
import {ARTIFACTS,SHA,cleanText,runInput,cleanEvent,reduceEvent,predictionBoxes} from './training-domain.ts';
const sha=(v: string)=>createHash('sha256').update(v).digest('hex');
const PUBLIC_RUN='id,name,status,fingerprint,categories,config,dataset_summary,last_seq,last_epoch,metrics,error,created_at,updated_at,heartbeat_at,completed_at';
const PUBLIC_JOB='id,run_id,status,width,height,confidence,iou,boxes,elapsed_ms,error,created_at,completed_at';
const uuid=(v: any)=>{need(typeof v==='string' && ID.test(v),'ID 无效');return v;};
const bearer=(req: any)=>{need(req.identity.kind==='bearer' && req.identity.id,'此操作需要 CLI 授权',403);return req.identity.id;};
const owns=(req: any,row: any)=>need(req.identity.kind==='cookie' || row.owner_grant===req.identity.id,'不能修改其他设备创建的训练',403);
export function registerTraining(router: any,{pool,storage,config}: any) {
 let uploadBusy=false;
 const route=(method: string,path: string,...handlers: any[])=>router[method](path,...handlers.map(fn=>(req: any,res: any,next: any)=>Promise.resolve(fn(req,res,next)).catch(next)));
 const run=async(c: any,id: string,lock=false)=>{
  const r=(await c.query('SELECT * FROM omr_training_runs WHERE id=$1'+(lock?' FOR UPDATE':''),[uuid(id)])).rows[0];
  need(r,'训练不存在',404);return r;
 };
 const worker=async(req: any,c: any,id: string)=>{
  const w=(await c.query('SELECT * FROM omr_inference_workers WHERE id=$1 AND owner_grant=$2',[uuid(id),bearer(req)])).rows[0];
  need(w,'推理 worker 未注册或属于其他授权',403);return w;
 };
 const expire=()=>pool.query(`UPDATE omr_predictions SET status='failed',error='推理 worker 超时，请重新提交',completed_at=now()
  WHERE (status='queued' AND created_at<now()-interval '5 minutes') OR (status='running' AND lease_until<now() AND attempts>=2)`);
 route('get','/training/runs',async(_req: any,res: any)=>{
  res.json((await pool.query(`SELECT ${PUBLIC_RUN} FROM omr_training_runs ORDER BY created_at DESC LIMIT 100`)).rows);
 });
 route('post','/training/runs',async(req: any,res: any)=>{
  const v=runInput(req.body),owner=bearer(req);
  const result=await transaction(pool,async(c: any)=>{
   await c.query(`INSERT INTO omr_training_runs(id,name,owner_grant,fingerprint,categories,config,dataset_summary)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,[v.id,v.name,owner,v.fingerprint,JSON.stringify(v.categories),JSON.stringify(v.config),JSON.stringify(v.datasetSummary)]);
   const r=await run(c,v.id,true);owns(req,r);
   need(r.fingerprint===v.fingerprint && stable(r.config)===stable(v.config) && stable(r.categories)===stable(v.categories),'该训练 ID 已绑定其他数据或配置',409);
   return {id:r.id,status:r.status,last_seq:r.last_seq};
  });res.status(201).json(result);
 });
 route('get','/training/runs/:id',async(req: any,res: any)=>{
  const r=await run(pool,req.params.id);delete r.owner_grant;
  const artifacts=(await pool.query('SELECT kind,checksum,bytes,mime,created_at FROM omr_training_artifacts WHERE run_id=$1 ORDER BY kind',[r.id])).rows;
  const workers=(await pool.query("SELECT id,name,device,heartbeat_at FROM omr_inference_workers WHERE heartbeat_at>now()-interval '60 seconds' ORDER BY name")).rows;
  res.json({...r,artifacts,workers});
 });
 route('get','/training/runs/:id/events',async(req: any,res: any)=>{
  const after=Number(req.query.after||0);uuid(req.params.id);
  need(Number.isSafeInteger(after)&&after>=0,'事件游标无效');
  res.json((await pool.query('SELECT seq,kind,payload,created_at FROM omr_training_events WHERE run_id=$1 AND seq>$2 ORDER BY seq LIMIT 1000',[req.params.id,after])).rows);
 });
 route('post','/training/runs/:id/events',async(req: any,res: any)=>{
  need(Array.isArray(req.body.events)&&req.body.events.length>=1&&req.body.events.length<=100,'每次可上报 1–100 个事件');
  const events=req.body.events.map(cleanEvent);
  const result=await transaction(pool,async(c: any)=>{
   let r=await run(c,req.params.id,true);owns(req,r);
   for(const event of events) {
    if(event.seq<=r.last_seq) {
     const old=(await c.query('SELECT kind,payload FROM omr_training_events WHERE run_id=$1 AND seq=$2',[r.id,event.seq])).rows[0];
     need(old && old.kind===event.kind && stable(old.payload)===stable(event.payload),'重传事件内容冲突',409);continue;
    }
    r=reduceEvent(r,event);
    await c.query('INSERT INTO omr_training_events(run_id,seq,kind,payload) VALUES($1,$2,$3,$4)',[r.id,event.seq,event.kind,JSON.stringify(event.payload)]);
   }
   await c.query(`UPDATE omr_training_runs SET status=$2,last_seq=$3,last_epoch=$4,metrics=$5,error=$6,
    updated_at=now(),heartbeat_at=now(),completed_at=CASE WHEN $2 IN ('failed','cancelled') THEN now() ELSE completed_at END WHERE id=$1`,
    [r.id,r.status,r.last_seq,r.last_epoch,JSON.stringify(r.metrics),r.error||null]);
   return {last_seq:r.last_seq,status:r.status};
  });res.json(result);
 });
 route('post','/training/runs/:id/artifacts/:kind',async(req: any,res: any)=>{
  const spec=ARTIFACTS[req.params.kind];need(spec,'不支持的模型文件类型');
  const r=await run(pool,req.params.id);owns(req,r);
  need(['running','exporting'].includes(r.status),'当前状态不能上传模型',409);
  const expected=req.headers['x-checksum-sha256'],length=Number(req.headers['content-length']);
  need(SHA.test(expected||'') && Number.isSafeInteger(length) && length>0 && length<=spec.max,'文件长度或 SHA256 无效');
  const old=(await pool.query('SELECT checksum,bytes FROM omr_training_artifacts WHERE run_id=$1 AND kind=$2',[r.id,req.params.kind])).rows[0];
  if(old) {req.resume();need(old.checksum===expected&&Number(old.bytes)===length,'该文件类型已上传不同内容',409);res.json(old);return;}
  need(!uploadBusy,'另一个文件正在上传，请稍后重试',429);uploadBusy=true;
  const key=config.oss.prefix+'training/'+r.id+'/'+req.params.kind+'-'+expected+'-'+randomUUID()+'.'+spec.extension;
  const hash=createHash('sha256');let bytes=0;const chunks: Buffer[]=[];
  const meter=new Transform({transform(chunk,_encoding,done){
   bytes+=chunk.length;if(bytes>length){done(Error('UPLOAD_LENGTH'));return;}
   hash.update(chunk);if(req.params.kind==='report')chunks.push(Buffer.from(chunk));done(null,chunk);
  }});
  try {
   // Stream to OSS; memory use does not scale with model size.
   const writing=storage.putStream(key,meter,spec.mime);
   try {await Promise.all([pipeline(req,meter),writing]);}catch(e){meter.destroy();throw e;}
   need(bytes===length&&hash.digest('hex')===expected,'文件长度或校验值不匹配');
   if(req.params.kind==='report') {
    let report;try{report=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{need(false,'报告不是有效 JSON');}
    need(report && report.fingerprint===r.fingerprint,'报告数据指纹不匹配');
   }
   await transaction(pool,async(c: any)=>{
    const current=await run(c,r.id,true);owns(req,current);need(['running','exporting'].includes(current.status),'训练状态已变化',409);
    await c.query('INSERT INTO omr_training_artifacts(run_id,kind,object_key,checksum,bytes,mime) VALUES($1,$2,$3,$4,$5,$6)',[r.id,req.params.kind,key,expected,bytes,spec.mime]);
   });res.json({kind:req.params.kind,checksum:expected,bytes});
  }catch(error){await storage.delete(key).catch(()=>{});throw error;}
  finally{uploadBusy=false;}
 });
 route('get','/training/runs/:id/artifacts/:kind',async(req: any,res: any)=>{
  uuid(req.params.id);need(ARTIFACTS[req.params.kind],'文件类型无效');
  const a=(await pool.query('SELECT * FROM omr_training_artifacts WHERE run_id=$1 AND kind=$2',[req.params.id,req.params.kind])).rows[0];
  need(a,'文件不存在',404);
  res.type(a.mime).set({'Content-Length':String(a.bytes),'X-Checksum-Sha256':a.checksum,
   ...(['onnx','weights','report'].includes(req.params.kind)?{'Content-Disposition':`attachment; filename="${req.params.id}-${req.params.kind}.${ARTIFACTS[req.params.kind].extension}"`}:{})});
  await pipeline(await storage.getStream(a.object_key),res);
 });
 route('post','/training/runs/:id/complete',async(req: any,res: any)=>{
  await transaction(pool,async(c: any)=>{
   const r=await run(c,req.params.id,true);owns(req,r);
   if(r.status==='completed')return;
   need(r.status==='exporting'&&r.last_epoch>0,'训练尚未完成导出',409);
   const kinds=(await c.query('SELECT kind FROM omr_training_artifacts WHERE run_id=$1',[r.id])).rows.map((a: any)=>a.kind);
   need(['onnx','weights','report'].every(k=>kinds.includes(k)),'必须先上传 ONNX、权重和训练报告',409);
   await c.query("UPDATE omr_training_runs SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1",[r.id]);
  });res.json({status:'completed'});
 });
 route('post','/training/workers/:id/heartbeat',async(req: any,res: any)=>{
  const id=uuid(req.params.id),owner=bearer(req),name=cleanText(req.body.name,160),device=cleanText(req.body.device,100);
  const r=await pool.query(`INSERT INTO omr_inference_workers(id,owner_grant,name,device) VALUES($1,$2,$3,$4)
   ON CONFLICT(id) DO UPDATE SET name=$3,device=$4,heartbeat_at=now() WHERE omr_inference_workers.owner_grant=$2 RETURNING id`,[id,owner,name,device]);
  need(r.rowCount,'worker 属于其他授权',403);res.json({online:true});
 });
 route('get','/training/workers',async(_req: any,res: any)=>res.json((await pool.query("SELECT id,name,device,heartbeat_at,(heartbeat_at>now()-interval '60 seconds') AS online FROM omr_inference_workers ORDER BY heartbeat_at DESC LIMIT 100")).rows));
 route('post','/training/models/:id/predict',express.raw({type:['image/png','image/jpeg','image/webp'],limit:'20mb'}),async(req: any,res: any)=>{
  const r=await run(pool,req.params.id);need(r.status==='completed','模型尚未就绪',409);
  const requestKey=uuid(req.headers['x-request-id']),confidence=Number(req.query.confidence??0.25),iou=Number(req.query.iou??0.45);
  need(confidence>=0.01&&confidence<=0.99&&iou>=0.01&&iou<=0.99,'阈值无效');
  need(Buffer.isBuffer(req.body)&&req.body.length>0,'请上传 PNG、JPEG 或 WebP 图片');
  const existing=(await pool.query('SELECT '+PUBLIC_JOB+',request_checksum FROM omr_predictions WHERE request_key=$1',[requestKey])).rows[0];
  if(existing){need(existing.run_id===r.id && existing.request_checksum===digest(req.body) && existing.confidence===confidence && existing.iou===iou,'请求 ID 冲突',409);delete existing.request_checksum;res.status(202).json(existing);return;}
  need((await pool.query("SELECT 1 FROM omr_inference_workers WHERE heartbeat_at>now()-interval '60 seconds' LIMIT 1")).rowCount,'推理 worker 离线，请在本机启动 tools/training/worker.py',503);
  await expire();
  need(Number((await pool.query("SELECT count(*) n FROM omr_predictions WHERE status IN ('queued','running')")).rows[0].n)<20,'推理队列已满，请稍后再试',429);
  need(!uploadBusy,'图片正在处理，请稍后再试',429);uploadBusy=true;
  const id=randomUUID(),key=config.oss.prefix+'predictions/'+id+'.png';
  try {
   const image=await sharp(req.body,{limitInputPixels:20000000}).rotate().png().toBuffer({resolveWithObject:true});
   need(image.data.length<=40*1024*1024,'图片解码后过大');
   await storage.put(key,image.data,'image/png');
   await pool.query(`INSERT INTO omr_predictions(id,run_id,request_key,image_key,image_checksum,image_bytes,width,height,confidence,iou,request_checksum)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,r.id,requestKey,key,digest(image.data),image.data.length,image.info.width,image.info.height,confidence,iou,digest(req.body)]);
   res.status(202).json((await pool.query('SELECT '+PUBLIC_JOB+' FROM omr_predictions WHERE id=$1',[id])).rows[0]);
  }catch(error){await storage.delete(key).catch(()=>{});throw error;}
  finally{uploadBusy=false;}
 });
 route('get','/training/predictions/:id',async(req: any,res: any)=>{
  await expire();const j=(await pool.query('SELECT '+PUBLIC_JOB+' FROM omr_predictions WHERE id=$1',[uuid(req.params.id)])).rows[0];need(j,'推理记录不存在',404);res.json(j);
 });
 route('get','/training/predictions/:id/image',async(req: any,res: any)=>{
  const j=(await pool.query('SELECT image_key,image_checksum,image_bytes FROM omr_predictions WHERE id=$1',[uuid(req.params.id)])).rows[0];need(j,'图片不存在',404);
  res.type('png').set({'Content-Length':String(j.image_bytes),'X-Checksum-Sha256':j.image_checksum});await pipeline(await storage.getStream(j.image_key),res);
 });
 route('post','/training/predictions/claim',async(req: any,res: any)=>{
  await expire();const workerId=uuid(req.body.workerId),claimToken=randomUUID();
  const job=await transaction(pool,async(c: any)=>{
   await worker(req,c,workerId);
   return (await c.query(`UPDATE omr_predictions SET status='running',worker_id=$1,claim_hash=$2,lease_until=now()+interval '90 seconds',attempts=attempts+1
    WHERE id=(SELECT id FROM omr_predictions WHERE status='queued' OR (status='running' AND lease_until<now() AND attempts<2)
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[workerId,sha(claimToken)])).rows[0];
  });
  if(!job){res.json(null);return;}
  const model=await run(pool,job.run_id);
  res.json({id:job.id,runId:job.run_id,width:job.width,height:job.height,confidence:job.confidence,iou:job.iou,
   imageChecksum:job.image_checksum,imageBytes:job.image_bytes,categories:model.categories,claimToken});
 });
 for(const action of ['heartbeat','result'])route('post','/training/predictions/:id/'+action,async(req: any,res: any)=>{
  const workerId=uuid(req.body.workerId),claimToken=uuid(req.body.claimToken);
  await transaction(pool,async(c: any)=>{
   await worker(req,c,workerId);
   const j=(await c.query("SELECT * FROM omr_predictions WHERE id=$1 AND status='running' AND worker_id=$2 AND claim_hash=$3 AND lease_until>now() FOR UPDATE",[uuid(req.params.id),workerId,sha(claimToken)])).rows[0];
   need(j,'推理租约已失效，请勿上报旧结果',409);
   if(action==='heartbeat') {await c.query("UPDATE omr_predictions SET lease_until=now()+interval '90 seconds' WHERE id=$1",[j.id]);return;}
   const model=await run(c,j.run_id);
   if(req.body.error) await c.query("UPDATE omr_predictions SET status='failed',error=$2,completed_at=now(),claim_hash=NULL WHERE id=$1",[j.id,cleanText(req.body.error,2000)]);
   else {
    const boxes=predictionBoxes(req.body.boxes,j.width,j.height,model.categories),elapsed=Number(req.body.elapsedMs);
    need(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<=86400000,'推理耗时无效');
    await c.query("UPDATE omr_predictions SET status='completed',boxes=$2,elapsed_ms=$3,completed_at=now(),claim_hash=NULL WHERE id=$1",[j.id,JSON.stringify(boxes),elapsed]);
   }
  });res.json({ok:true});
 });
}
