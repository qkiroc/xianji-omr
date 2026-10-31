#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {normalizeOrigin, readCredential, requireTransport} from '../cli/src/credentials.mjs';
import {client, jsonBody, limitedJSON} from '../cli/src/http.mjs';

// Use the same authenticated HTTP client and credential store as the platform CLI.
// Do not retry POST requests: a lost response can still mean a committed import.
export async function importSources({request, health, sourceIds=[], dryRun=false, log=()=>{}, checkpoint=async()=>{}}) {
  if(health?.ok!==true||!Number.isSafeInteger(health.schema)||health.schema<14) {
    throw new Error(`线上版本尚不支持来源导入（schema ${health?.schema??'未知'}，需要 >=14）。请先提交并推送本次小节与事件功能代码，再部署到 ECS；本次没有创建或导入数据。`);
  }
  const sources=await limitedJSON(await request('/api/v2/datasets'));
  const targets=await limitedJSON(await request('/api/v2/localization/datasets'));
  if(!Array.isArray(sources)||!Array.isArray(targets)) throw new Error('平台返回的数据集列表格式无效');
  if(targets.some(t=>!['geometry','rhythm'].includes(t.task)||!Object.hasOwn(t,'source_dataset_id'))) {
    throw new Error('线上数据集接口缺少 task/source_dataset_id，尚未部署来源导入能力；本次没有创建或导入数据。');
  }
  for(const id of sourceIds) if(!sources.some(s=>s.id===id)) throw new Error('找不到切图来源数据集：'+id);
  const selected=sourceIds.length?sources.filter(s=>sourceIds.includes(s.id)):sources;
  const report={startedAt:new Date().toISOString(),dryRun,sourceCount:selected.length,addedPages:0,actions:[],errors:[]};
  await checkpoint(report);
  for(const [index, source] of selected.entries()) {
    log(`[${index+1}/${selected.length}] ${source.name}（已确认 ${source.confirmed_count??'?'} 页）`);
    const linked=targets.filter(t=>t.task==='rhythm'&&t.source_dataset_id===source.id);
    if(!linked.length&&Number(source.confirmed_count)===0) {
      report.actions.push({sourceId:source.id,operation:'skip',reason:'no-confirmed-pages'});
      log('  跳过：没有已确认谱页。');
      await checkpoint(report);
      continue;
    }
    // If several datasets are intentionally linked, update each; never create another.
    for(const target of linked.length?linked:[null]) {
      const operation=target?'sync':'create';
      if(dryRun) {
        report.actions.push({sourceId:source.id,datasetId:target?.id,operation});
        log(target?`  预览：同步 ${target.name} (${target.id})`:'  预览：创建关联数据集并导入');
        continue;
      }
      try {
        const result=await limitedJSON(await request(target
          ?`/api/v2/localization/datasets/${target.id}/sync`
          :'/api/v2/localization/datasets',jsonBody(target?{}:{
            name:('小节与事件 · '+source.name).slice(0,200),task:'rhythm',sourceDatasetId:source.id,
            description:'从切图数据集的已确认谱页导入，供人工标注小节与事件区域。',
          })));
        if(!Number.isSafeInteger(result.imported)||result.imported<0||(!target&&!result.id)) throw Object.assign(new Error('导入接口响应缺少有效的 imported/id；操作可能已提交，已停止后续操作，请核对服务端版本和数据集列表。'),{code:'IMPORT_RESPONSE'});
        const datasetId=target?.id??result.id;
        report.actions.push({sourceId:source.id,datasetId,operation,imported:result.imported});
        report.addedPages+=result.imported;
        log(`  ${target?'同步完成':'创建完成'}：新增 ${result.imported} 页，数据集 ${datasetId}`);
      } catch(error) {
        report.errors.push({sourceId:source.id,datasetId:target?.id,operation,code:error.code,status:error.status,message:error.message});
        log(`  失败：${error.message}${error.status?' (HTTP '+error.status+')':''}`);
        // Stop on connectivity/auth problems; completed operations remain on the platform.
        if(['NETWORK','AUTH_REQUIRED','PERMISSION','IMPORT_RESPONSE'].includes(error.code)) {
          await checkpoint(report);
          throw error;
        }
      }
      await checkpoint(report);
    }
    await checkpoint(report);
  }
  report.finishedAt=new Date().toISOString();
  await checkpoint(report);
  return report;
}

async function main() {
  const {values}=parseArgs({options:{origin:{type:'string',default:'http://116.62.12.100:8790'},source:{type:'string',multiple:true},'dry-run':{type:'boolean'},'allow-insecure-http':{type:'boolean'},help:{type:'boolean'}}});
  if(values.help) {
    console.log('导入所有切图数据集中已确认的谱页，复用已有小节与事件数据集。\n运行：.\\import-localization-sources.cmd [--origin URL] [--source 切图数据集UUID] [--dry-run]\n重复运行只同步新增页；不修改来源标注、不生成小节/事件框、不自动确认。');
    return;
  }
  const origin=normalizeOrigin(values.origin), credential=await readCredential(origin);
  if(!credential) throw new Error(`请先授权：node tools/cli/xianji-omr.mjs auth --origin ${origin}${origin.startsWith('http:')?' --allow-insecure-http':''}`);
  requireTransport(origin,values['allow-insecure-http']||credential.allowInsecureHttp);
  const controller=new AbortController();
  const abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  const reportPath=fileURLToPath(new URL('../../.artifacts/localization-import/latest.json',import.meta.url));
  await mkdir(resolve(reportPath,'..'),{recursive:true});
  console.log(`平台：${origin}\n模式：${values['dry-run']?'仅预览':'导入已确认来源页'}\n报告：${reportPath}`);
  try {
    const request=client(origin,credential.token,controller.signal);
    let healthResponse;
    try {
      healthResponse=await fetch(origin+'/health',{redirect:'manual',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
    } catch { throw new Error('无法检查线上 /health，请检查网络连接后重试。'); }
    if(!healthResponse.ok) {
      await healthResponse.body?.cancel();
      throw new Error(`线上健康检查失败 (HTTP ${healthResponse.status})，未开始导入。`);
    }
    const health=await limitedJSON(healthResponse,65536);
    await limitedJSON(await request('/api/cli-auth/self'));
    const report=await importSources({request,health,sourceIds:values.source,dryRun:values['dry-run'],log:console.log,
      checkpoint:r=>writeFile(reportPath,JSON.stringify({origin,...r},null,2)+'\n','utf8')});
    console.log(`${report.errors.length?'部分完成':'完成'}：检查 ${report.sourceCount} 个来源，新增 ${report.addedPages} 页，失败 ${report.errors.length} 项。`);
    console.log(report.errors.length?'请根据报告排除问题后重新运行；已完成的导入保留。':'打开平台“小节与音符事件”查看；之后可重复运行同一脚本同步新增页。');
    if(report.errors.length) process.exitCode=1;
  } finally {
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(`STOPPED: ${error.message}`);console.error('已完成的导入保留在平台；修复问题后可重新执行。');process.exitCode=error.exit??1;});
}
