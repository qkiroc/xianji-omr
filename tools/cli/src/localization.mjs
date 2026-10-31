import {lstat} from 'node:fs/promises';
import {COMMANDS} from './commands.mjs';
import {fail,jsonInput,versionInput} from './input.mjs';
import {jsonBody,limitedJSON} from './http.mjs';
import {download} from './download.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function uuid(value,name){if(!UUID.test(value||''))fail('ARGUMENT',name+' 必须是有效 UUID');return value;}
async function outputAvailable(output){
 if(!output)fail('OUTPUT','下载需要 --output 文件路径');
 try{await lstat(output);fail('EXISTS','目标文件已存在，拒绝覆盖',7);}catch(error){if(error.code!=='ENOENT')throw error;}
}
async function selection(o){
 const body=o.input?await jsonInput(o.input):{};
 if(Object.keys(body).some(key=>key!=='recordIds'))fail('INPUT','快照选择只支持 recordIds');
 if(o.record){const record=uuid(o.record,'--record');if(body.recordIds&&JSON.stringify(body.recordIds)!==JSON.stringify([record]))fail('ARGUMENT','--record 与输入 recordIds 冲突');body.recordIds=[record];}
 if(body.recordIds!==undefined&&(!Array.isArray(body.recordIds)||!body.recordIds.length||body.recordIds.length>100||new Set(body.recordIds).size!==body.recordIds.length||body.recordIds.some(id=>!UUID.test(id))))fail('INPUT','recordIds 必须是 1–100 个不重复 UUID');
 return body;
}
export async function localizationCommand(words,o,{request,signal}){
 if(o.classes!==undefined)fail('ARGUMENT','小节与事件导出暂不支持 --classes；使用 --record 或 recordIds 选择谱行');
 if(words.slice(0,3).join(' ')==='localization datasets export'){
  if(words.length>4)fail('ARGUMENT','多余位置参数');
  const dataset=uuid(o.dataset||words[3],'数据集'),kind=o.kind||'crops';
  if(o.dataset&&words[3]&&o.dataset!==words[3])fail('ARGUMENT','数据集参数冲突');
  if(!['native','crops'].includes(kind))fail('ARGUMENT','导出 kind 只能是 native 或 crops');
  await outputAvailable(o.output);
  const snapshot=await limitedJSON(await request('/api/v2/localization/datasets/'+dataset+'/snapshots',jsonBody(await selection(o),'POST')));
  uuid(snapshot.id,'快照');
  const result=await download(await request('/api/v2/localization/snapshots/'+snapshot.id+'/'+kind),o.output,undefined,signal);
  return {snapshotId:snapshot.id,snapshotFingerprint:snapshot.fingerprint,...result};
 }
 const command=COMMANDS.find(c=>c.command.startsWith('localization ')&&words.slice(0,c.command.split(' ').length).join(' ')===c.command);
 if(!command)fail('ARGUMENT','未知小节与音符事件命令，请查看 --help');
 const tail=words.slice(command.command.split(' ').length);if(tail.length>1)fail('ARGUMENT','多余位置参数');
 const id=tail[0],neighbors=command.command==='localization records neighbors';
 if((neighbors||command.path.includes(':recordId'))&&o.record&&id&&o.record!==id)fail('ARGUMENT','记录参数冲突');
 if(o.dataset&&id&&command.path.includes(':datasetId')&&!neighbors&&o.dataset!==id)fail('ARGUMENT','数据集参数冲突');
 const parameters={datasetId:o.dataset||(!neighbors?id:undefined),recordId:o.record||id,pageId:id,snapshotId:id,eventId:o.event,kind:o.kind||'native'};
 const path=command.path.replace(/:([a-zA-Z]+)/g,(_,key)=>{
  const value=parameters[key];
  if(key==='kind'){if(!['native','crops'].includes(value))fail('ARGUMENT','下载 kind 只能是 native 或 crops');return value;}
  if(key==='eventId'){if(typeof value!=='string'||!value.length||value.length>200||/[\x00-\x1f]/.test(value))fail('ARGUMENT','需要有效 --event 事件 ID');return encodeURIComponent(value);}
  return uuid(value,key);
 });
 const query=new URLSearchParams();
 if(command.method==='GET'){
  for(const [flag,key] of [['source','source'],['search','search'],['status','status'],['split','split'],['page','page'],['page-size','pageSize'],['trend-days','trendDays']])if(o[flag]!==undefined)query.set(key,o[flag]);
  if(o['trend-days']!==undefined&&![7,14,30,90].includes(Number(o['trend-days'])))fail('ARGUMENT','--trend-days 只能是 7、14、30、90');
  if(neighbors)query.set('recordId',uuid(o.record||id,'记录'));
 }
 let options={method:command.method};
 if(command.method!=='GET'){
  let body;
  if(command.command==='localization datasets create'){
   body=o.input?await jsonInput(o.input):{};
   if(o.name!==undefined)body.name=o.name;
   if(o.source!==undefined){if(body.sourceDatasetId&&body.sourceDatasetId!==o.source)fail('ARGUMENT','切图来源参数冲突');body.sourceDatasetId=uuid(o.source,'--source');}
   if(typeof body.name!=='string'||!body.name.trim())fail('INPUT','创建数据集需要 name 或 --name');
   if(body.sourceDatasetId){uuid(body.sourceDatasetId,'sourceDatasetId');body.task??='rhythm';}
   if(body.task==='rhythm'&&!body.sourceDatasetId)fail('INPUT','音符事件数据集需要关联 sourceDatasetId 或 --source');
  }else if(command.command==='localization datasets sync')body={};
  else if(command.command.endsWith('snapshots create'))body=await selection(o);
  else if(command.command.endsWith(' confirm')){
   if(!o.acknowledge)fail('CONFIRM','确认区域标注必须显式提供 --acknowledge');
   body={version:versionInput(o),acknowledged:true};
  }else if(command.command.endsWith(' unconfirm')||command.command.startsWith('localization events '))body={version:versionInput(o)};
  else{body=await jsonInput(o.input);if(command.method==='PUT'&&(!Number.isSafeInteger(body.version)||body.version<1))fail('VERSION','修改 JSON 必须包含正整数 version');}
  options=jsonBody(body,command.method);
 }
 const url=path+(query.size?'?'+query:'');
 if(command.command.endsWith(' content')||command.command.endsWith('snapshots download')){
  await outputAvailable(o.output);return download(await request(url,options),o.output,undefined,signal);
 }
 return limitedJSON(await request(url,options));
}
