// Manual cloud-browser QA helper; talks only to the local isolated preview.
// No HTTP test routes or production hooks are installed by this helper.
import {cookieFor,pendingFor,grantFor,request,json} from './cli-helpers.mjs';
import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const f={url:'http://127.0.0.1:4173',config:{origin:'http://terminal.local:4173'}},cookie=await cookieFor(f);
const approve=await pendingFor(f,{clientName:'云端浏览器 · 批准验收',deviceDescription:'隔离测试，浏览器与CLI不同容器'}),deny=await pendingFor(f,{clientName:'云端浏览器 · 拒绝验收'}),grant=await grantFor(f,cookie,{clientName:'云端浏览器 · 撤销验收'});
const api=async(path,options={})=>{const r=await request(f,path,{...options,headers:{Authorization:'Bearer '+grant.token,...options.headers}});if(!r.ok)throw Error('ISOLATED_SEED_FAILED');return r.json()};
const dataset=await api('/api/v2/datasets',json({name:'CLI升级 · 网页回归'})),song=await api('/api/v2/datasets/'+dataset.id+'/songs',json({name:'隔离原图',songGroupKey:'browser-cli-qa',split:'train'}));const image=await sharp({create:{width:800,height:1000,channels:3,background:'#f8f8fc'}}).composite([{input:Buffer.from('<svg width="800" height="1000"><text x="80" y="100" font-size="28">CLI AUTH / WORKBENCH QA</text><path d="M80 250 H720 M80 270 H720 M80 290 H720 M80 310 H720 M80 330 H720 M80 350 H720" stroke="#30384a" fill="none"/></svg>')}]).png().toBuffer();let page=await api('/api/v2/songs/'+song.id+'/pages',{method:'POST',headers:{'Content-Type':'image/png','X-File-Name':'browser-qa.png'},body:image});page=await api('/api/v2/pages/'+page.image.id,json({version:page.image.version,annotationFormat:'layout-v1',pageType:'music',boxes:[{id:'system',classKey:'system',parentSystemId:null,readingOrder:0,x:60,y:200,width:680,height:200}]},'PUT'));
await writeFile('/tmp/omr-browser-qa.json',JSON.stringify({approveId:approve.requestId,denyId:deny.requestId,grantId:grant.grantId,pageId:page.image.id}),{mode:0o600});
console.log(JSON.stringify({approveUrl:approve.authorizeUrl,denyUrl:deny.authorizeUrl,grantId:grant.grantId,datasetId:dataset.id,pageId:page.image.id,notice:'浏览器回环跨容器不可达；只验证页面审批/拒绝，完整CLI交换由独立集成测试覆盖。'}));
