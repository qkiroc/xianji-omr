import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,writeFile,mkdir,lstat,unlink} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function assetPath(path){
 if(typeof path!=='string'||path.includes('\\')||path.includes('\0')||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..')||/^[a-z]:/i.test(path))throw Error('Unsafe archive path');
 if(!(path==="downloads/audition-library-20261024-201804.json"||path.startsWith('.artifacts/synthetic-renderer/'))||path.split('/').some(p=>['node_modules','.git','cli-config','cloud-secrets'].includes(p)))throw Error('Archive path outside synthetic inputs');
 return path;
}
export function sealFiles(files,keyHex){
 const key=Buffer.from(keyHex,'hex');if(key.length!==32||!/^[a-f0-9]{64}$/i.test(keyHex))throw Error('Invalid asset key');
 const entries=files.map(({path,bytes})=>{if(/omr_cli_[a-f0-9]{64}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString()))throw Error('Credential material is not allowed in the asset package');return{path:assetPath(path),sha256:digest(bytes),data:bytes.toString('base64')};});
 if(new Set(entries.map(e=>e.path)).size!==entries.length)throw Error('Duplicate archive path');
 const plain=Buffer.from(JSON.stringify({version:1,files:entries}));
 if(/omr_cli_[a-f0-9]{64}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(plain.toString()))throw Error('Credential material is not allowed in the asset package');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('xianji-synthetic-cloud-v1'));
 const ciphertext=Buffer.concat([cipher.update(gzipSync(plain,{level:9})),cipher.final()]);
 return Buffer.from(JSON.stringify({version:1,algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}));
}
export function openFiles(encrypted,keyHex){
 const key=Buffer.from(keyHex,'hex');if(key.length!==32||!/^[a-f0-9]{64}$/i.test(keyHex))throw Error('Invalid asset key');
 const envelope=JSON.parse(encrypted.toString());if(envelope.version!==1||envelope.algorithm!=='aes-256-gcm')throw Error('Unsupported encrypted archive');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));decipher.setAAD(Buffer.from('xianji-synthetic-cloud-v1'));decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
 const compressed=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
 const payload=JSON.parse(gunzipSync(compressed,{maxOutputLength:512*1024*1024}).toString());if(payload.version!==1||!Array.isArray(payload.files)||payload.files.length>10000)throw Error('Invalid archive payload');
 const files=payload.files.map(e=>{const path=assetPath(e.path),bytes=Buffer.from(e.data,'base64');if(digest(bytes)!==e.sha256)throw Error('Archive checksum mismatch');return{path,bytes};});
 if(new Set(files.map(e=>e.path)).size!==files.length)throw Error('Duplicate archive path');return files;
}
export async function restoreFiles(workspace,files){
 workspace=resolve(workspace);
 for(const{path,bytes}of files){assetPath(path);const target=resolve(workspace,...path.split('/'));if(!target.startsWith(workspace+sep))throw Error('Archive destination outside workspace');
  let cursor=workspace;for(const segment of path.split('/')){cursor=join(cursor,segment);try{if((await lstat(cursor)).isSymbolicLink())throw Error('Archive destination is a symlink');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);
 }
}
export async function readParts(directory,indexFile='index.json'){
 const index=JSON.parse(await readFile(join(directory,indexFile),'utf8'));if(index.version!==1||!Array.isArray(index.parts))throw Error('Invalid asset index');const chunks=[];
 for(const p of index.parts){if(!/^[a-z0-9._-]+$/i.test(p.name)||p.name.includes('..'))throw Error('Unsafe asset part');const b=await readFile(join(directory,p.name));if(digest(b)!==p.sha256)throw Error('Asset part checksum mismatch');chunks.push(b);}
 const combined=Buffer.concat(chunks);if(digest(combined)!==index.sha256)throw Error('Asset archive checksum mismatch');return combined;
}
export async function writeParts(directory,encrypted){
 await mkdir(directory,{recursive:true});let old;try{old=JSON.parse(await readFile(join(directory,'index.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}const parts=[];for(let start=0,i=1;start<encrypted.length;start+=192000,i++){const bytes=encrypted.subarray(start,start+192000),name='materials-'+String(i).padStart(3,'0')+'.enc';await writeFile(join(directory,name),bytes);parts.push({name,bytes:bytes.length,sha256:digest(bytes)});}
 for(const p of old?.parts||[]){if(!/^materials-[0-9]+\.enc$/.test(p.name))throw Error('Unsafe old asset part');if(!parts.some(n=>n.name===p.name))await unlink(join(directory,p.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 const index={version:1,encryption:'AES-256-GCM',sha256:digest(encrypted),bytes:encrypted.length,parts};await writeFile(join(directory,'index.json'),JSON.stringify(index,null,2));return index;
}

