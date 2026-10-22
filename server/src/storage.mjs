// Lazy SDK loading keeps startup/health independent from OSS metadata access.
// No default credential chain: only explicitly selected ECS RAM Role / STS / AK.
export function ossStorage(o){
 let provider;
 async function client(){
  const {default:OSS}=await import('ali-oss');
  let auth;
  if(o.authMode==='ram'){
   if(!provider){const {default:C}=await import('@alicloud/credentials');provider=new C.default({type:'ecs_ram_role',disableIMDSv1:true,...(o.roleName?{roleName:o.roleName}:{})})}
   const c=await provider.getCredential();auth={accessKeyId:c.accessKeyId,accessKeySecret:c.accessKeySecret,stsToken:c.securityToken};
  }else auth={accessKeyId:o.accessKeyId,accessKeySecret:o.accessKeySecret,...(o.securityToken?{stsToken:o.securityToken}:{})};
  return new OSS({region:o.region,endpoint:o.endpoint,bucket:o.bucket,timeout:20000,secure:true,...auth});
 }
 return {async put(key,data,mime){await(await client()).put(key,data,{headers:{'Content-Type':mime}})},async putStream(key,stream,mime){await(await client()).putStream(key,stream,{headers:{'Content-Type':mime}})},async getStream(key){return(await(await client()).getStream(key)).stream},async get(key){return(await(await client()).get(key)).content},async delete(key){await(await client()).delete(key)}};
}
