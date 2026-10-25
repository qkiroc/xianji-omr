import {test} from 'node:test';import assert from 'node:assert/strict';import {createApp} from '../server/src/app.mjs';import {COMMANDS} from '../tools/cli/src/commands.mjs';
export function collect(stack,prefix=''){const result=[];for(const l of stack){if(l.route){for(const method of Object.keys(l.route.methods))if(method!=='head')result.push(method.toUpperCase()+' '+prefix+l.route.path)}else if(l.handle?.stack){const mount=['/api/v2','/api/cli-auth','/api'].find(p=>l.matchers?.some(m=>{try{return m(p)?.path===p}catch{return false}}));assert.ok(mount,'未知router挂载必须纳入覆盖');result.push(...collect(l.handle.stack,prefix+mount))}}return result}
// Deployment control commands have their own end-to-end coverage in platform-deployment.test.mjs.
const excluded=['POST /api/platform/deployments','GET /api/platform/deployments/latest','GET /api/platform/deployments/:deploymentId','POST /api/login','POST /api/logout','GET /api/session','POST /api/cli-auth/requests','POST /api/cli-auth/token','GET /api/cli-auth/self','POST /api/cli-auth/self/revoke','GET /api/cli-auth/grants','POST /api/cli-auth/grants/:id/revoke','GET /api/cli-auth/requests/:id','POST /api/cli-auth/requests/:id/decision'];
// Training uses the dedicated Python/Node runner rather than the annotation CLI.
// Keep every training route explicit so newly added unmapped endpoints still fail coverage.
const trainingRoutes=[
 'GET /api/v2/training/runs','POST /api/v2/training/runs','GET /api/v2/training/runs/:id',
 'GET /api/v2/training/runs/:id/events','POST /api/v2/training/runs/:id/events',
 'GET /api/v2/training/runs/:id/artifacts/:kind','POST /api/v2/training/runs/:id/artifacts/:kind',
 'POST /api/v2/training/runs/:id/complete','GET /api/v2/training/workers','POST /api/v2/training/workers/:id/heartbeat',
 'POST /api/v2/training/models/:id/predict','GET /api/v2/training/predictions/:id','GET /api/v2/training/predictions/:id/image',
 'POST /api/v2/training/predictions/claim','POST /api/v2/training/predictions/:id/heartbeat','POST /api/v2/training/predictions/:id/result'
];
export function coverage(app){const routes=collect(app.router.stack).filter(x=>x.includes(' /api/')&&!excluded.includes(x));assert.deepEqual(routes.sort(),[...COMMANDS.map(c=>c.method+' '+c.path),...trainingRoutes].sort());return routes.length}
test('真实Express挂载CLI及训练业务模板双向覆盖，新增未映射路由会失败',()=>{const app=createApp({config:{passwordHash:'test',origin:'http://localhost'},pool:{},storage:{},staticDir:'/tmp'});assert.equal(coverage(app),55+trainingRoutes.length);app.get('/api/new-unmapped',()=>{});assert.throws(()=>coverage(app))});
