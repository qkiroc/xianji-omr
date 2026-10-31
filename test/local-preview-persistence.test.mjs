import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fixture} from './fixture.mjs';
import {localizationSetup} from './localization-helpers.mjs';
import {request,json} from './cli-helpers.mjs';
import {localStorage} from '../tools/dev/storage.mjs';

test('local preview restart reuses records, login credentials and original image bytes',async t=>{
 const base=process.env.OMR_TEST_TMP_DIR||join(process.cwd(),'.test-data','preview-persistence');await mkdir(base,{recursive:true});
 const root=await mkdtemp(join(base,'preview-files-'));
 const storage=await localStorage(root);let active;
 t.after(async()=>{if(active)await active.close();});
 const first=active=await fixture({port:55474,tempRoot:base,storageBackend:storage});
 const s=await localizationSetup(first);
 const r=(await s.api('/localization/datasets/'+s.loc.id+'/import',json(s.payload))).record;
 const directory=first.dir,passwordHash=first.config.passwordHash;
 await first.close();active=null;
 const second=active=await fixture({port:55474,tempRoot:base,reuseDirectory:directory,storageBackend:await localStorage(root),passwordHash});
 const response=await request(second,'/api/v2/localization/records/'+r.id,{headers:{Authorization:'Bearer '+s.grant.token}});
 assert.equal(response.status,200);assert.equal((await response.json()).geometry.measures[0].events[0].id,'event-stable-1');
 const image=await request(second,'/api/v2/pages/'+s.page.image.id+'/content?original=1',{headers:{Authorization:'Bearer '+s.grant.token}});
 assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),s.bytes);
 const cookieSession=await request(second,'/api/session',{headers:{Cookie:s.cookie}});assert.equal(cookieSession.status,200);
});
