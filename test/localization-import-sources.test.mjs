import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSources} from '../tools/localization/import-sources.mjs';

function platform() {
  const sources=[{id:'a',name:'真实谱',confirmed_count:3},{id:'b',name:'合成谱',confirmed_count:2},{id:'c',name:'草稿',confirmed_count:0}];
  const targets=[{id:'existing',name:'已有人工作业',task:'rhythm',source_dataset_id:'a'}, {id:'legacy',task:'geometry',source_dataset_id:'b'}];
  const pending={a:3,b:2};
  const calls=[];
  return {calls,targets,health:{ok:true,schema:14},request:async(path,options={})=>{
    calls.push({path,options});
    if(path==='/api/v2/datasets') return Response.json(sources);
    if(path==='/api/v2/localization/datasets'&&!options.method) return Response.json(targets);
    if(path==='/api/v2/localization/datasets') {
      const body=JSON.parse(options.body);
      assert.equal(body.task,'rhythm');
      const target={id:'created',name:body.name,task:body.task,source_dataset_id:body.sourceDatasetId};
      targets.push(target);
      const imported=pending[body.sourceDatasetId];pending[body.sourceDatasetId]=0;
      return Response.json({...target,imported});
    }
    const target=targets.find(t=>path===`/api/v2/localization/datasets/${t.id}/sync`);
    assert.ok(target,'Only dataset create/sync mutations are allowed');
    assert.deepEqual(JSON.parse(options.body),{});
    const imported=pending[target.source_dataset_id];pending[target.source_dataset_id]=0;
    return Response.json({imported});
  }};
}
test('bulk import reuses linked datasets, creates missing sources and reruns without duplicates',async()=>{
  const p=platform();
  const first=await importSources(p);
  assert.equal(first.addedPages,5);assert.equal(first.errors.length,0);
  assert.equal(first.actions.at(-1).operation,'skip');
  const second=await importSources(p);
  assert.equal(second.addedPages,0);
  assert.equal(p.calls.filter(c=>c.path==='/api/v2/localization/datasets'&&c.options.method==='POST').length,1);
});
test('preview and selected-source validation do not mutate platform',async()=>{
  const p=platform();
  const report=await importSources({...p,dryRun:true,sourceIds:['b']});
  assert.equal(report.sourceCount,1);assert.equal(report.actions[0].operation,'create');
  await assert.rejects(importSources({...p,sourceIds:['missing']}),/找不到/);
  assert.ok(p.calls.every(c=>!c.options.method));
});
test('failed network write is checkpointed and never automatically retried',async()=>{
  const p=platform();let writes=0;let saved;
  const request=async(path,options={})=>{
    if(options.method){writes++;throw Object.assign(new Error('network unavailable'),{code:'NETWORK'});}
    return p.request(path,options);
  };
  await assert.rejects(importSources({request,health:p.health,checkpoint:async r=>{saved=structuredClone(r);}}),/network unavailable/);
  assert.equal(writes,1);assert.equal(saved.errors.length,1);
});
test('schema 13 is rejected before any dataset request or write, even with no existing datasets',async()=>{
  const p=platform();
  await assert.rejects(importSources({...p,health:{ok:true,schema:13}}),/需要 >=14/);
  assert.equal(p.calls.length,0);
});
test('incomplete deployment missing association fields is rejected without writes',async()=>{
  const p=platform();p.targets.push({id:'old-empty',name:'旧接口创建的空数据集',record_count:0});
  await assert.rejects(importSources(p),/缺少 task\/source_dataset_id/);
  assert.ok(p.calls.every(c=>!c.options.method));
});
