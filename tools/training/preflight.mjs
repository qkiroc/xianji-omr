import {credentials,makeAPI} from './sync-confirmed.mjs';
import {normalizeOrigin,requireTransport} from '../cli/src/credentials.mjs';
try {
 const origin=normalizeOrigin(process.argv[2]||'http://116.62.12.100:8790');
 const credential=await credentials(origin);requireTransport(origin,credential.allowInsecureHttp);
 const response=await makeAPI(origin,credential.token)('/api/v2/training/runs');
 if(!Array.isArray(await response.json()))throw Error('Invalid platform response');
 console.log(JSON.stringify({event:'platform-ready',origin}));
} catch(error) {
 console.error(JSON.stringify({event:'preflight-failed',error:error.message,hint:'Deploy schema10 training code to the platform and verify CLI authorization before installing or training.'}));process.exitCode=1;
}
