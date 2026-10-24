import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {githubEnvironment,readOmrCredential,configureCloud} from '../tools/synthetic/configure-cloud.mjs';
async function withConfig(value,callback){const old=process.env.XDG_CONFIG_HOME;try{if(value===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=value;await callback();}finally{if(old===undefined)delete process.env.XDG_CONFIG_HOME;else process.env.XDG_CONFIG_HOME=old;}}
test('OMR credential reads restore an existing GitHub config directory',()=>withConfig('github-user-config',async()=>{
 const gh=githubEnvironment(),workspace=resolve('.test-data/config-user');
 const result=await readOmrCredential(workspace,'http://example.invalid',async origin=>{assert.equal(origin,'http://example.invalid');assert.equal(process.env.XDG_CONFIG_HOME,join(workspace,'.artifacts/cli-config'));return{token:'test-omr-token'};});
 assert.equal(result.token,'test-omr-token');assert.equal(process.env.XDG_CONFIG_HOME,'github-user-config');assert.equal(gh.XDG_CONFIG_HOME,'github-user-config');
}));
test('missing XDG_CONFIG_HOME remains absent after an OMR credential read',()=>withConfig(undefined,async()=>{const gh=githubEnvironment();await readOmrCredential(resolve('.test-data/config-user'),'http://example.invalid',async()=>({token:'test'}));assert.equal(process.env.XDG_CONFIG_HOME,undefined);assert.equal(gh.XDG_CONFIG_HOME,undefined);}));
test('failed OMR credential reads also restore GitHub configuration',()=>withConfig('github-user-config',async()=>{await assert.rejects(readOmrCredential(resolve('.test-data/config-user'),'http://example.invalid',async()=>{throw Error('read failed');}),/read failed/);assert.equal(process.env.XDG_CONFIG_HOME,'github-user-config');}));
test('cloud setup keeps the same GitHub environment for authentication, Secrets and dispatch',()=>withConfig('github-user-config',async()=>{
 const parent=resolve('.test-data');await mkdir(parent,{recursive:true});const workspace=await mkdtemp(join(parent,'cloud-auth-'));assert.ok(workspace.startsWith(parent+sep));
 try{
  await mkdir(join(workspace,'.artifacts/cloud-secrets'),{recursive:true});await mkdir(join(workspace,'.artifacts/synthetic-renderer/audition-195-batch'),{recursive:true});await writeFile(join(workspace,'.artifacts/cloud-secrets/material-key'),'ab'.repeat(32));await writeFile(join(workspace,'.artifacts/synthetic-renderer/audition-195-batch/plan.json'),JSON.stringify({origin:'http://example.invalid'}));
  const commands=[];
  await configureCloud(workspace,{log:()=>{},spawnSync:(_gh,args,options)=>{assert.equal(options.env.XDG_CONFIG_HOME,'github-user-config');assert.equal(options.env.GH_HOST,'github.com');commands.push(args.join(' '));return{status:0,stdout:args[0]==='api'?'test-user\n':''};},readCredential:async()=>{assert.equal(process.env.XDG_CONFIG_HOME,join(workspace,'.artifacts/cli-config'));return{token:'test-omr-token'};},execute:async(_gh,args,environment,input)=>{assert.equal(environment.XDG_CONFIG_HOME,'github-user-config');assert.equal(process.env.XDG_CONFIG_HOME,'github-user-config');assert.ok(!args.includes('test-omr-token'));if(args[0]==='secret')assert.ok(input);commands.push(args.join(' '));}});
  assert.ok(commands.includes('api user --hostname github.com --jq .login'));assert.equal(commands.filter(s=>s.startsWith('secret set ')).length,2);assert.ok(commands.at(-1).startsWith('workflow run synthetic-corpus.yml'));
 }finally{await rm(workspace,{recursive:true,force:true});}
}));

