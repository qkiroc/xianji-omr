import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {bytes,fail,imageType,jsonInput} from './input.mjs';
import {limitedJSON,jsonBody} from './http.mjs';
import {download} from './download.mjs';

const BASE_TASK_COMMANDS=[
 ['key-signatures datasets list','GET','/api/v2/key-signatures/datasets'],
 ['key-signatures datasets create','POST','/api/v2/key-signatures/datasets'],
 ['key-signatures datasets sync','POST','/api/v2/key-signatures/datasets/:datasetId/sync'],
 ['key-signatures datasets export','GET','/api/v2/key-signatures/datasets/:datasetId/export'],
 ['key-signatures records list','GET','/api/v2/key-signatures/datasets/:datasetId/records'],
 ['key-signatures records get','GET','/api/v2/key-signatures/datasets/:datasetId/records/:recordId'],
 ['key-signatures records update','PUT','/api/v2/key-signatures/datasets/:datasetId/records/:recordId'],
 ['key-signatures records content','GET','/api/v2/key-signatures/datasets/:datasetId/records/:recordId/content'],
 ['key-signatures records next','GET','/api/v2/key-signatures/datasets/:datasetId/editor'],
 ['layout training runs list','GET','/api/v2/training/runs'],
 ['layout training runs create','POST','/api/v2/training/runs'],
 ['layout training runs get','GET','/api/v2/training/runs/:id'],
 ['layout training runs complete','POST','/api/v2/training/runs/:id/complete'],
 ['layout training events list','GET','/api/v2/training/runs/:id/events'],
 ['layout training events append','POST','/api/v2/training/runs/:id/events'],
 ['layout training artifacts upload','POST','/api/v2/training/runs/:id/artifacts/:kind'],
 ['layout training artifacts download','GET','/api/v2/training/runs/:id/artifacts/:kind'],
 ['layout inference workers list','GET','/api/v2/training/workers'],
 ['layout inference workers heartbeat','POST','/api/v2/training/workers/:id/heartbeat'],
 ['layout inference predict','POST','/api/v2/training/models/:id/predict'],
 ['layout inference predictions get','GET','/api/v2/training/predictions/:id'],
 ['layout inference predictions image','GET','/api/v2/training/predictions/:id/image'],
 ['layout inference predictions claim','POST','/api/v2/training/predictions/claim'],
 ['layout inference predictions heartbeat','POST','/api/v2/training/predictions/:id/heartbeat'],
 ['layout inference predictions result','POST','/api/v2/training/predictions/:id/result'],
].map(([command,method,path])=>({command,method,path}));

export const TASK_COMMANDS=[...BASE_TASK_COMMANDS,...BASE_TASK_COMMANDS.filter(c=>c.command.startsWith("key-signatures ")).map(c=>({...c,command:c.command.replace("key-signatures","time-signatures"),path:c.path.replace("key-signatures","time-signatures")}))];
export function normalizeTaskWords(words) {
 if(words[0]==='layout'&&!['training','inference'].includes(words[1])) {
   if(words.length>1&&!['taxonomy','datasets','songs','pages','records','regions','snapshots','annotations'].includes(words[1]))fail('ARGUMENT','未知切图标注命令');
   return words.slice(1);
 }
 return words;
}
export const isTaskCommand=words=>['key-signatures','time-signatures'].includes(words[0])||words[0]==='layout'&&['training','inference'].includes(words[1]);
const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))fail('ARGUMENT','请提供有效 UUID');return value;};
const artifacts={onnx:{max:128*1024*1024,mime:'application/octet-stream'},weights:{max:128*1024*1024,mime:'application/octet-stream'},
 report:{max:2*1024*1024,mime:'application/json'},results:{max:12*1024*1024,mime:'image/png'},
 confusion:{max:12*1024*1024,mime:'image/png'},preview:{max:12*1024*1024,mime:'image/jpeg'}};

export async function taskCommand(words,o,{request,signal}) {
 const command=TASK_COMMANDS.find(c=>words.slice(0,c.command.split(' ').length).join(' ')===c.command);
 if(!command)fail('ARGUMENT','未知标注类型命令，请查看 --help');
 const tail=words.slice(command.command.split(' ').length);
 if(tail.length>1)fail('ARGUMENT','位置参数过多');
 const id=tail[0];
 const datasetId=o.dataset||(command.path.includes(':recordId')||command.command.endsWith('records next')?undefined:id);
 const parameters={id,recordId:id,datasetId,kind:o.kind};
 const path=command.path.replace(/:([a-zA-Z]+)/g,(_,key)=>{
   if(key==='kind'){if(!Object.hasOwn(artifacts,o.kind||''))fail('ARGUMENT','请选择有效模型文件类型');return o.kind;}
   return encodeURIComponent(uuid(parameters[key]));
 });
 const query=new URLSearchParams();
 if(command.method==='GET')for(const [flag,key] of [['search','search'],['status','status'],['split','split'],['page','page'],['page-size','pageSize'],['tonic','tonic'],['kind','kind'],['after','after'],['numerator','numerator'],['denominator','denominator'],['trend-days','trendDays']])
   if(o[flag]!==undefined&&!command.path.includes(':'+key))query.set(key,o[flag]);
 if(command.command.endsWith('records next')) {
   if(o.record&&id&&o.record!==id)fail('ARGUMENT','切图 ID 参数冲突');
   const record=o.record||id;
   if(record)query.set('recordId',uuid(record));
   if(o.direction&&!['pending','previous','next'].includes(o.direction))fail('ARGUMENT','切换方向无效');
   if(o.direction||record)query.set('direction',o.direction||'pending');
 }
 let options={method:command.method};
 if(command.command==='layout inference predict') {
   const confidence=Number(o.confidence??0.25),iou=Number(o.iou??0.45);
   if(!Number.isFinite(confidence)||confidence<0.01||confidence>0.99||!Number.isFinite(iou)||iou<0.01||iou>0.99)fail('ARGUMENT','推理阈值必须在 0.01–0.99 之间');
   const image=await bytes(o.file,20*1024*1024),mime=imageType(image);
   if(o.mime&&o.mime!==mime)fail('IMAGE','MIME 与图片内容不一致');
   query.set('confidence',String(confidence));query.set('iou',String(iou));
   options={method:'POST',headers:{'Content-Type':mime,'X-Request-Id':uuid(o['request-id']||randomUUID())},body:image};
 } else if(command.command==='layout training artifacts upload') {
   if(!o.file||o.file==='-')fail('INPUT','模型文件上传需要 --file 本地文件');
   const spec=artifacts[o.kind],info=await stat(o.file);
   if(!info.isFile()||info.size<1||info.size>spec.max)fail('INPUT','模型文件大小无效或超出该类型限制');
   const hash=createHash('sha256');for await(const chunk of createReadStream(o.file))hash.update(chunk);
   options={method:'POST',headers:{'Content-Type':spec.mime,'Content-Length':String(info.size),'X-Checksum-Sha256':hash.digest('hex')},body:createReadStream(o.file),duplex:'half'};
 } else if(command.method!=='GET') {
   const empty=command.command.endsWith('datasets sync')||command.command.endsWith('runs complete');
   const body=empty?{}:await jsonInput(o.input);
   if(command.method==='PUT'&&(!Number.isSafeInteger(body.version)||body.version<1))fail('VERSION','修改 JSON 必须包含正整数 version');
   options=jsonBody(body,command.method);
 }
 const url=path+(query.size?'?'+query:'');
 const binary=command.command.endsWith('records content')||command.command.endsWith('artifacts download')||command.command.endsWith('predictions image');
 if((binary||command.command.endsWith('datasets export'))&&o.output===undefined&&binary)fail('OUTPUT','下载需要 --output 文件路径');
 const response=await request(url,options);
 if(binary||command.command.endsWith('datasets export')&&o.output)return download(response,o.output,undefined,signal);
 return limitedJSON(response);
}