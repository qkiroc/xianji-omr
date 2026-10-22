import {symlink,rename,readlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const audit=(event,details={})=>console.log(JSON.stringify({event,...details}));
export async function releaseSupportsSchema(release,schema){
  try{
    const c=JSON.parse(await readFile(join(release,'server/compatibility.json'),'utf8'));
    return Number.isInteger(schema)&&Number.isInteger(c.schemaMin)&&Number.isInteger(c.schemaMax)&&c.schemaMin>=0&&c.schemaMax>=c.schemaMin&&schema>=c.schemaMin&&schema<=c.schemaMax;
  }catch{return false;}
}
export async function atomicLink(target,link){
  const pending=link+'.'+randomUUID();await symlink(target,pending);await rename(pending,link);
}
export async function activateRelease({root,release,version,restart,health,stop=async()=>{},compatible=async()=>true}){
  const current=join(root,'current');let previous;
  try{previous=await readlink(current);}catch(e){if(e.code!=='ENOENT')throw e;}
  await atomicLink(release,current);
  try{await restart();await health(version);audit('release_healthy',{release:version});}
  catch(error){
    audit('release_health_failed',{release:version});
    if(previous&&await compatible(previous)){
      await atomicLink(previous,current);await restart();
      const previousVersion=(await readFile(join(previous,'server/RELEASE'),'utf8')).trim();
      await health(previousVersion);audit('code_rollback_verified',{release:previousVersion});
    }else{await stop();audit('code_rollback_unavailable_service_stopped');}
    // Never reverse migrations or restore over a live database automatically.
    throw Error('RELEASE_FAILED_DATABASE_NOT_ROLLED_BACK',{cause:error});
  }
}
