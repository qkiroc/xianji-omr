import { need, ID, categoriesFor, stable } from './annotation.ts';
export const SHA = /^[a-f0-9]{64}$/;
export const ARTIFACTS: Record<string, {mime: string; max: number; extension: string}> = {
  onnx: {mime:'application/octet-stream',max:128*1024*1024,extension:'onnx'},
  weights: {mime:'application/octet-stream',max:128*1024*1024,extension:'pt'},
  report: {mime:'application/json',max:2*1024*1024,extension:'json'},
  results: {mime:'image/png',max:12*1024*1024,extension:'png'},
  confusion: {mime:'image/png',max:12*1024*1024,extension:'png'},
  preview: {mime:'image/jpeg',max:12*1024*1024,extension:'jpg'},
};
export const metricKeys = [
 'train/box_loss','train/cls_loss','train/dfl_loss','val/box_loss','val/cls_loss','val/dfl_loss',
 'metrics/precision(B)','metrics/recall(B)','metrics/mAP50(B)','metrics/mAP50-95(B)',
 'lr/pg0','lr/pg1','lr/pg2',
];
export function cleanText(value: unknown, max = 200): string {
 need(typeof value === 'string' && value.length>0 && value.length<=max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value),'文本格式无效');
 return String(value);
}
export function runInput(v: any) {
 need(v && ID.test(v.id) && SHA.test(v.fingerprint),'训练 ID 或数据指纹无效');
 const expected = categoriesFor('layout-v2').map(({id,key}: any)=>({id,key}));
 need(stable(v.categories)===stable(expected),'模型类别必须与 layout-v2 完全一致');
 const c=v.config;
 need(c && c.model==='yolo11s.pt' && Number.isInteger(c.epochs) && c.epochs>=1 && c.epochs<=1000 &&
  [640,960,1280,1536].includes(c.imgsz) && Number.isInteger(c.batch) && c.batch>=1 && c.batch<=64,
  '训练配置无效');
 need(v.datasetSummary && JSON.stringify(v.datasetSummary).length<=128000,'数据集摘要无效');
 return {id:v.id,name:cleanText(v.name),fingerprint:v.fingerprint,categories:expected,
  config:{model:c.model,epochs:c.epochs,imgsz:c.imgsz,batch:c.batch,seed:42},datasetSummary:v.datasetSummary};
}
export function cleanEvent(event: any) {
 need(event && Number.isInteger(event.seq) && event.seq>0 && event.seq<=1000000,'事件序号无效');
 need(['epoch','heartbeat','log','state'].includes(event.kind),'事件类型无效');
 const p=event.payload; need(p && typeof p==='object' && !Array.isArray(p),'事件内容无效');
 let payload: any;
 if(event.kind==='epoch') {
  need(Number.isInteger(p.epoch) && p.epoch>=1 && p.epoch<=1000,'epoch 无效');
  need(p.metrics && typeof p.metrics==='object' && !Array.isArray(p.metrics),'指标无效');
  const metrics: Record<string,number>={};
  for(const [key,value] of Object.entries(p.metrics)) {
   need(metricKeys.includes(key) && typeof value==='number' && Number.isFinite(value) && value>=0,'指标名或数值无效');
   if(key.startsWith('metrics/')) need(Number(value)<=1,'评估指标必须在 0–1 之间');
   metrics[key]=Number(value);
  }
  payload={epoch:p.epoch,metrics};
 } else if(event.kind==='state') {
  need(['running','exporting','failed','cancelled'].includes(p.status),'状态无效');
  payload={status:p.status,...(p.message?{message:cleanText(p.message,2000)}:{})};
 } else if(event.kind==='log') payload={message:cleanText(p.message,2000)};
 else payload={};
 return {seq:event.seq,kind:event.kind,payload};
}
export function reduceEvent(run: any, event: any) {
 need(event.seq===run.last_seq+1,'事件缺失或乱序，请先重传未确认事件',409);
 need(!['completed','failed','cancelled'].includes(run.status),'训练已结束',409);
 const next={...run,last_seq:event.seq};
 if(event.kind==='state') {
  const allowed: Record<string,string[]>={created:['running','failed','cancelled'],running:['running','exporting','failed','cancelled'],exporting:['exporting','failed','cancelled']};
  need(allowed[run.status]?.includes(event.payload.status),'不允许的训练状态变化',409);
  next.status=event.payload.status;
  if(event.payload.message) next.error=event.payload.message;
 }
 if(event.kind==='epoch') {
  need(run.status==='running' && event.payload.epoch>run.last_epoch && event.payload.epoch<=run.config.epochs,'epoch 顺序或状态无效',409);
  next.last_epoch=event.payload.epoch; next.metrics=event.payload.metrics;
 }
 return next;
}
export function predictionBoxes(boxes: any, width: number, height: number, categories: any[]) {
 need(Array.isArray(boxes) && boxes.length<=300,'推理框数量无效');
 return boxes.map((b: any)=>{
  need(Number.isInteger(b.classId) && categories.some(c=>c.id===b.classId) && Number.isFinite(b.score) && b.score>=0 && b.score<=1 &&
   [b.x,b.y,b.width,b.height].every(Number.isSafeInteger) && b.x>=0 && b.y>=0 && b.width>0 && b.height>0 &&
   b.x+b.width<=width && b.y+b.height<=height,'推理框坐标或类别无效');
  return {classId:b.classId,classKey:categories.find(c=>c.id===b.classId).key,score:b.score,x:b.x,y:b.y,width:b.width,height:b.height};
 });
}
