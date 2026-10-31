// Isolated local acceptance server: actual Next/React/API/PG, with seeded sample images.
import next from 'next';
import sharp from 'sharp';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {localStorage} from './storage.mjs';
import {hashPassword} from '../../server/src/config.mjs';
import {fixture} from '../../test/fixture.mjs';
import {seedRhythmDemo} from './rhythm-demo.mjs';
const port=Number(process.env.PORT||4173),origin='http://localhost:'+port;
const nextApp=next({dev:true,webpack:true,dir:process.cwd(),hostname:'127.0.0.1',port});
await nextApp.prepare();
let f;
const tempRoot=join(process.cwd(),'.artifacts','local-preview'),sessionFile=join(tempRoot,'session.json');
await mkdir(tempRoot,{recursive:true});
let previous;
try{previous=JSON.parse(await readFile(sessionFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous){const rel=relative(resolve(tempRoot),resolve(previous.directory));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('LOCAL_SESSION_PATH_OUTSIDE_WORKSPACE');}
let passwordHash;
try{passwordHash=await readFile(join(tempRoot,'password.hash'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;passwordHash=hashPassword('test-admin-12345');await writeFile(join(tempRoot,'password.hash'),passwordHash,{mode:0o600});}
const storageBackend=await localStorage(join(tempRoot,'objects'));
try {
 f=await fixture({port:Number(process.env.OMR_DEV_PG_PORT||55439),webPort:port,tempRoot,reuseDirectory:previous?.directory,storageBackend,passwordHash,host:'127.0.0.1',origin,previewLogin:true,development:true,webHandler:nextApp.getRequestHandler()});
 await writeFile(sessionFile,JSON.stringify({directory:f.dir})+'\n');
} catch(error) {
 console.error('LOCAL_STARTUP_FAILED',error.message);
 await nextApp.close();
 process.exit(1);
}
async function seed(){
 const login=await fetch(f.url+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'test-admin-12345'})});
 const cookie=login.headers.get('set-cookie')?.split(';')[0];
 if(!cookie)throw Error('LOCAL_LOGIN_FAILED');
 const api=async(path,body,method='POST',extra={})=>{
   const response=await fetch(f.url+'/api/v2'+path,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...extra},body:Buffer.isBuffer(body)?body:JSON.stringify(body)});
   const result=await response.json();if(!response.ok)throw Error(result.error);return result;
 };
 const ds=await api('/datasets',{name:'切图验收样例',description:'本地演示数据：曲目页面、调号框与补充导入。'});
 for(const [index,tonics] of [['C','G','D'],['Bb','F#','Eb'],['A','F','B']].entries()){
   const song=await api('/datasets/'+ds.id+'/songs',{name:'演示曲目 '+(index+1),songGroupKey:'local-demo-'+index,split:['train','val','test'][index]});
   const text=tonics.map((tonic,i)=>'<text x="40" y="'+(80+i*120)+'" font-size="28">'+(i===0?'Original: ':'Play: ')+tonic+'</text>').join('');
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="white"/><text x="40" y="30" font-size="18">Local sample score '+(index+1)+'</text>'+text+
     [0,1,2].map(i=>[0,1,2,3,4].map(j=>'<path d="M40 '+(100+i*120+j*6)+'H750" stroke="#737373" fill="none"/>').join('')).join('')+'</svg>';
   const withTime=svg.replace("</svg>", [[4,4],[6,8],[3,4]].map((pair,i)=>'<text x="350" y="'+(80+i*120)+'" font-size="28">'+pair.join("/")+'</text>').join("")+"</svg>");
   const image=await sharp(Buffer.from(withTime)).png().toBuffer();
   const page=await api('/songs/'+song.id+'/pages',image,'POST',{'Content-Type':'image/png','X-File-Name':'sample-'+(index+1)+'.png'});
   const boxes=tonics.map((tonic,i)=>({id:'key-'+i,classKey:'key_signature',parentSystemId:null,readingOrder:i,x:30,y:45+i*120,width:250,height:45,metadata:{scope:'page',rawText:(i===0?'Original: ':'Play: ')+tonic}}));
   await api('/pages/'+page.image.id,{version:page.image.version,annotationFormat:'layout-v2',boxes:[...boxes,...[[4,4],[6,8],[3,4]].map((pair,i)=>({id:'time-'+i,classKey:'time_signature',parentSystemId:null,readingOrder:i+3,x:340,y:45+i*120,width:180,height:45,metadata:{scope:'page',rawText:pair.join('/')}}))]},'PUT');
 }
 const keys=await api('/key-signatures/datasets',{name:'调号验收样例',description:'9 张调号切图，可验收筛选分页、快捷键、保存跳转和补充导入。',sourceDatasetId:ds.id});
 const list=await api('/key-signatures/datasets/'+keys.id+'/records',undefined,'GET');
 for(const [i,r]of list.items.slice(0,2).entries())
   await api('/key-signatures/datasets/'+keys.id+'/records/'+r.id,{version:r.version,tonic:['C','G'][i],kind:i?'play':'original'},'PUT');
 const times=await api('/time-signatures/datasets',{name:'拍号验收样例',description:'常用拍号及自定义分子分母标注。',sourceDatasetId:ds.id});
 console.log('Local time list: '+origin+'/time-signatures/datasets/'+times.id);
 const rhythm=await seedRhythmDemo(api);
 console.log('Local rhythm list: '+origin+'/localization/datasets/'+rhythm.id);
 console.log('Local key list: '+origin+'/key-signatures/datasets/'+keys.id);
}
if(!previous){try{await seed();}catch(error){console.error('LOCAL_SEED_FAILED',error.message);}}
console.log('Local acceptance server: '+origin+'/__test-login');
console.log('Sample account: admin / test-admin-12345');
console.log('Local database and images are retained across restarts.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await nextApp.close();await f.close();process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
