import {createInterface} from 'node:readline';
import {Writable} from 'node:stream';
import {hashPassword,validateConfig} from './src/config.mjs';

export class ConfigInputError extends Error {
  constructor(message='配置已取消；未写入配置文件。',exitCode=130){super(message);this.exitCode=exitCode;}
}

export function createConfigPrompt({input=process.stdin,output=process.stdout,signal}={}){
  if(!input.isTTY||!output.isTTY)throw new ConfigInputError('首次配置需要可读写的交互终端；不要盲输或从命令行传递密码。',1);
  let muted=true,closed=false,pending;
  const writer=new Writable({write(chunk,encoding,next){if(!muted)output.write(chunk);next();}});
  Object.defineProperty(writer,'columns',{get:()=>output.columns||80});
  const rl=createInterface({input,output:writer,terminal:true,historySize:0,removeHistoryDuplicates:true});
  function close(error){
    if(closed)return;closed=true;muted=true;rl.history.length=0;
    const active=pending;pending=undefined;
    rl.close();signal?.removeEventListener('abort',abort);
    if(active)active.reject(error||new ConfigInputError('输入已关闭；未写入配置文件。',1));
  }
  function abort(){close(signal?.reason instanceof ConfigInputError?signal.reason:new ConfigInputError());}
  rl.on('SIGINT',()=>close(new ConfigInputError()));
  rl.on('close',()=>{if(!closed)close(new ConfigInputError('输入已关闭；未写入配置文件。',1));});
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  return {
    ask(label,fallback='',secret=false){
      if(closed)return Promise.reject(new ConfigInputError('输入已关闭；未写入配置文件。',1));
      if(pending)return Promise.reject(new Error('CONFIG_QUESTION_ALREADY_PENDING'));
      return new Promise((resolve,reject)=>{
        pending={reject};
        // Keep both the prompt and its redraw under readline's ownership.
        // Writing a label first and question('') erases the label on real terminals.
        rl.line='';rl.cursor=0;rl.history.length=0;muted=false;
        rl.question(label+(fallback&&!secret?` [${fallback}]`:'')+': ',answer=>{
          pending=undefined;muted=true;rl.pause();rl.history.length=0;
          if(secret)output.write('\n');
          resolve(answer||fallback);
        });
        muted=secret;
      });
    },
    close(){close();},
  };
}


export async function collectConfiguration(p){
 const host=await p.ask('PostgreSQL 主机（ECS可达内网优先）','pgm-2ze5en6164xx9e2l.pg.rds.aliyuncs.com'),port=Number(await p.ask('PG端口','5432')),password=await p.ask('专用xianji_omr账号密码','',true);
 const sslMode=await p.ask('数据库TLS verify-full / disable','verify-full'),caFile=sslMode==='verify-full'?await p.ask('RDS CA绝对路径（系统信任可留空）'):'';
 const username=await p.ask('管理员登录名','admin'),login=await p.ask('管理员密码（12–256字符）','',true);
 if(login.length<12||login.length>256||await p.ask('再次输入管理员密码','',true)!==login)throw new ConfigInputError('密码长度或确认不符',1);
 const listen=await p.ask('监听地址 0.0.0.0 / 127.0.0.1','0.0.0.0'),appPort=Number(await p.ask('HTTP端口（禁止8787）','8790')),origin=await p.ask('浏览器访问Origin（如 https://omr.example.com 或 http://ECS地址:8790）');
 const bucket=await p.ask('OSS Bucket','xianji-source'),region=await p.ask('OSS Region','oss-cn-beijing'),endpoint=await p.ask('OSS HTTPS endpoint','https://oss-cn-beijing-internal.aliyuncs.com'),prefix=await p.ask('对象前缀（必须位于omr/）','omr/'),authMode=await p.ask('OSS认证 ram / sts / ak（优先RAM Role）','ram');
 const oss={bucket,region,endpoint,prefix,authMode};
 if(authMode==='ram')oss.roleName=await p.ask('RAM Role名称（可留空自动发现）');
 else {oss.accessKeyId=await p.ask('AccessKey ID','',true);oss.accessKeySecret=await p.ask('AccessKey Secret','',true);if(authMode==='sts')oss.securityToken=await p.ask('STS SecurityToken（到期需更新）','',true)}
 return validateConfig({host:listen,port:appPort,origin,secureCookie:origin.startsWith('https://'),username,passwordHash:hashPassword(login),database:{host,port,database:'xianji_omr',user:'xianji_omr',password,sslMode,...(caFile?{caFile}:{})},oss});
}
