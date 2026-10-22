import {mkdir,lstat,open,rename,unlink,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fail} from './input.mjs';
export function normalizeOrigin(value){let u;try{u=new URL(value)}catch{fail('ORIGIN','请指定有效--origin')};if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))fail('ORIGIN','平台地址必须是http/https origin');return u.origin}
export const loopback=origin=>['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
export function requireTransport(origin,allow){if(origin.startsWith('http:')&&!loopback(origin)&&!allow)fail('HTTP_REQUIRES_OPT_IN','远程HTTP明文传输：请显式使用--allow-insecure-http',2);if(origin.startsWith('http:')&&!loopback(origin))process.stderr.write('警告：HTTP明文传输，登录/授权码/Bearer可能被监听或篡改；PKCE不替代HTTPS。\n')}
function file(origin){const root=process.env.XDG_CONFIG_HOME|| (process.platform==='win32'?process.env.APPDATA:undefined)||join(homedir(),'.config');return join(root,'xianji-omr',createHash('sha256').update(origin).digest('hex')+'.json')}
async function safe(path,dir=false){const s=await lstat(path);if(s.isSymbolicLink()||!(dir?s.isDirectory():s.isFile())||(process.platform!=='win32'&&((s.mode&0o077)||s.uid!==process.getuid())))fail('CONFIG_PERMISSIONS','CLI配置权限或文件类型不安全',7)}
export async function readCredential(origin){const path=file(origin);try{await safe(dirname(path),true);await safe(path);const v=JSON.parse(await readFile(path,'utf8'));if(v.origin!==origin||!/^omr_cli_[a-f0-9]{64}$/.test(v.token))fail('CONFIG','CLI配置无效',7);return v}catch(e){if(e.code==='ENOENT')return null;throw e}}
export async function credentialLock(origin,fn,suffix='.lock'){const path=file(origin),dir=dirname(path);await mkdir(dir,{recursive:true,mode:0o700});await safe(dir,true);const lock=path+suffix;let fd;try{fd=await open(lock,'wx',0o600)}catch{fail('CONFIG_BUSY','同一平台另有CLI配置操作；请稍后重试',7)}try{return await fn(path)}finally{await fd.close();await unlink(lock).catch(()=>{})}}
export async function saveCredential(origin,value){return credentialLock(origin,async path=>{try{await safe(path)}catch(e){if(e.code!=='ENOENT')throw e}const temp=path+'.'+randomUUID()+'.part';let f;try{f=await open(temp,'wx',0o600);await f.writeFile(JSON.stringify({...value,origin}));await f.sync();await f.close();f=null;await rename(temp,path)}finally{await f?.close();await unlink(temp).catch(()=>{})}})}
export async function forgetCredential(origin){await credentialLock(origin,path=>unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e}))}
