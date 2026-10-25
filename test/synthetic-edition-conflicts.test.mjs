import test from 'node:test';
import assert from 'node:assert/strict';
import {editionConflict,isEditionConflict,recordPreservedEdition,replacementIsTerminal} from '../tools/synthetic/edition-conflicts.mjs';
test('only identified record conflicts are isolated',()=>{
 assert.ok(isEditionConflict(editionConflict('edited',{pageId:'p'})));
 for(const status of [401,403,500,503])assert.ok(!isEditionConflict({status}));
 assert.ok(!isEditionConflict(Error('corrupt render')));assert.ok(!isEditionConflict({status:404,apiPath:'/api/v2/datasets/missing'}));
 assert.ok(isEditionConflict({status:404,apiPath:'/api/v2/pages/missing'}));assert.ok(isEditionConflict({status:409}));
});
test('preserved editions survive checkpoint reload without duplicate records or completed counts',()=>{
 const item={sourceId:'song',title:'Song',profileId:'profile',phase:'repair-existing'},state={phase:'preserved',songId:'remote',conflict:{reason:'modified',oldPageIds:['old'],newPageIds:[]}},report={completed:[]};
 assert.ok(recordPreservedEdition(report,item,state));const restored=JSON.parse(JSON.stringify(report));recordPreservedEdition(restored,item,state);
 assert.equal(restored.preservedEditions.length,1);assert.equal(restored.completed.length,0);assert.equal(restored.preservedEditions[0].songId,'remote');
 assert.equal(recordPreservedEdition(restored,item,{phase:'complete'}),false);
});
test('both completed and preserved transactions are terminal for recovery and checkpoint packing',()=>{
 for(const phase of ['complete','preserved'])assert.ok(replacementIsTerminal({phase}));
 for(const phase of ['upload','cleanup','reorder'])assert.ok(!replacementIsTerminal({phase}));assert.ok(!replacementIsTerminal(null));
});
