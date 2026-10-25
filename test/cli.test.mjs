import {test} from 'node:test';import {fixture} from './fixture.mjs';import {entry} from './cli-helpers.mjs';import {workflow} from './cli-workflow.mjs';
test('Node入口子进程真实API：55模板（含7个410旧模板）/上传file+stdin/并发version/确认/旧快照两包下载',async t=>{const f=await fixture({port:55446});t.after(()=>f.close());await workflow(f,entry)});
