// Replay reads after temporary transport/service failures. Writes other than rate-limited
// requests are recovered through the existing transaction checkpoint, never blindly replayed.
export function isTransientServiceError(error){return [408,425,429,500,502,503,504].includes(error.status)||error.code==='NETWORK'&&error.exit!==130;}
export function serviceFailureDisposition(error,previousPauses=0){const transient=isTransientServiceError(error),count=transient?previousPauses+1:previousPauses;return{status:transient&&count<=3?'paused':'blocked',consecutiveServicePauses:count};}
export function resilientRequest(raw,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,random=Math.random,log=value=>console.log(JSON.stringify(value)),maxAttempts=12,maxElapsedMs=300000}={}){
 return async(path,options={})=>{
  const method=(options.method||'GET').toUpperCase(),started=now();
  for(let attempt=0;;attempt++){
   try{return await raw(path,options);}catch(error){
    error.apiPath=path;error.apiMethod=method;
    const safeToReplay=method==='GET'||method==='HEAD'||error.status===429;
    if(!safeToReplay||!isTransientServiceError(error)||attempt+1>=maxAttempts||now()-started>=maxElapsedMs)throw error;
    const delay=Math.min(30000,1000*2**Math.min(attempt,5))+Math.floor(random()*300);
    if(now()-started+delay>maxElapsedMs)throw error;
    log({event:'platform-request-retry',method,path,status:error.status,code:error.code,attempt:attempt+1,nextDelayMs:delay});await sleep(delay);
   }
  }
 };
}
