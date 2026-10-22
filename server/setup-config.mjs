import {open,link,unlink,chmod,chown,lstat,mkdir} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './src/config.mjs';
import {createConfigPrompt,collectConfiguration,ConfigInputError} from './config-prompts.mjs';

export async function runSetup({path='/etc/xianji-omr/config.json',uid=0,gid,input=process.stdin,output=process.stdout,signal}={}){
  const controller=new AbortController();
  const interrupt=()=>controller.abort(new ConfigInputError());
  const terminate=()=>controller.abort(new ConfigInputError('配置已中止；未写入配置文件。',143));
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  const active=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const checkAbort=()=>{if(active.aborted)throw active.reason instanceof ConfigInputError?active.reason:new ConfigInputError();};
  let prompt,temporary,created=false;
  try{
    let exists=false;try{await lstat(path);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    checkAbort();
    if(exists){await loadConfig(path);output.write('已存在有效配置，将自动读取（不显示凭证）。\n');return;}
    output.write('首次配置：请按可见提示逐项输入，不要一次粘贴多行。密码不回显，也不保存输入历史。Ctrl+C 可取消。\n');
    prompt=createConfigPrompt({input,output,signal:active});
    const config=await collectConfiguration(prompt);
    prompt.close();checkAbort();
    const group=gid??Number(execFileSync('id',['-g','xianji-omr'],{encoding:'utf8'}).trim()),directory=dirname(path);
    await mkdir(directory,{recursive:true,mode:0o750});
    await chown(directory,uid,group);await chmod(directory,0o750);checkAbort();
    temporary=path+'.tmp-'+randomUUID();
    const file=await open(temporary,'wx',0o600);created=true;
    try{await file.writeFile(JSON.stringify(config,null,2)+'\n');await file.chown(uid,group);await file.chmod(0o640);await file.sync();}finally{await file.close();}
    checkAbort();
    // Atomic publication, but never replace a file created by another process.
    await link(temporary,path);
    output.write('配置已安全保存（0640）。以后无需重复填写；不会显示凭证。\n');
  }finally{
    prompt?.close();
    if(created)await unlink(temporary).catch(()=>{});
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
  }
}

if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
  try{await runSetup();}catch(error){
    // Do not print raw fs/config errors or stack traces containing user input.
    process.stderr.write('\n'+(error instanceof ConfigInputError?error.message:'配置校验或写入失败；现有配置未被覆盖，请检查输入及文件权限。')+'\n');
    process.exitCode=error instanceof ConfigInputError?error.exitCode:1;
  }
}
