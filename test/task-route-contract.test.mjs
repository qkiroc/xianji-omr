import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {TASK_COMMANDS} from '../tools/cli/src/tasks.mjs';

async function loadModule(path){
 const url=new URL(path,import.meta.url);
 let source=await readFile(url,'utf8');
 source=source.replace(/import express from ['"]express['"];/,"const express={raw:()=>()=>{}};")
   .replace(/import sharp from ['"]sharp['"];/,"const sharp=()=>{};")
   .replace(/from (['"])([^'"]+)\1/g,(match,_quote,name)=>name.startsWith('.')?'from '+JSON.stringify(new URL(name,url).href):match);
 return import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
}
test('every key annotation and scoped layout model API has exactly one CLI command',async()=>{
 const {registerKeySignatures,registerTimeSignatures}=await loadModule('../server/src/crop-labels.ts');
 const {registerTraining}=await loadModule('../server/src/training.ts');
 const actual=[];
 const router=Object.fromEntries(['get','post','put'].map(method=>[method,(path,..._handlers)=>actual.push(method.toUpperCase()+' /api/v2'+path)]));
 registerKeySignatures(router,{pool:{},storage:{}});
 registerTimeSignatures(router,{pool:{},storage:{}});
 registerTraining(router,{pool:{},storage:{},config:{}});
 const expected=TASK_COMMANDS.map(c=>c.method+' '+c.path);
 assert.equal(actual.length,34);
 assert.deepEqual(actual.sort(),expected.sort());
});