import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/src/app.mjs';
function headersFor(options={}){
 const app=createApp({config:{passwordHash:'test-only',origin:'http://localhost:4173'},pool:{},storage:{},staticDir:process.cwd(),...options});
 const headers={};
 const res={setHeader(name,value){headers[name.toLowerCase()]=value;return this;},set(values){for(const [name,value] of Object.entries(values))this.setHeader(name,value);return this;}};
 let called=false;
 app.router.stack[0].handle({path:'/',method:'GET',headers:{}},res,()=>{called=true;});
 assert.equal(called,true);
 return headers;
}
test('local Webpack development can evaluate source maps and connect to its own HMR socket',()=>{
 const csp=headersFor({development:true})['content-security-policy'];
 assert.match(csp,/script-src 'self' 'unsafe-inline' 'unsafe-eval'/);
 assert.match(csp,/connect-src 'self' ws:\/\/localhost:4173/);
 assert.match(csp,/frame-ancestors 'none'/);
});
test('production and the default fixture keep eval disabled regardless of the release label',()=>{
 for(const options of [{},{release:'development'},{release:'isolated-test'},{development:false}]){
  const csp=headersFor(options)['content-security-policy'];
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(!csp.includes('ws://'));
 }
});