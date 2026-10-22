export class ApiError extends Error{constructor(message,status,details){super(message);this.status=status;this.details=details}}
export async function api(path,options={}){let response;try{response=await fetch('/api'+path,options)}catch{throw new ApiError('网络不可用，修改未保存到云端',0)}const value=await response.json().catch(()=>({}));if(!response.ok){if(response.status===401)document.getElementById('loginDialog').showModal();throw new ApiError(value.error||'请求失败',response.status,value.details)}return value}
export const body=(value,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export const uid=()=>crypto.randomUUID?.()||'local-'+Date.now()+'-'+Math.random().toString(36).slice(2);
export const clone=value=>JSON.parse(JSON.stringify(value));
export async function toDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader;reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)})}
export function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
