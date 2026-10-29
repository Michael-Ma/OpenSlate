import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './request-fixture.mjs';
import { historicalBudget } from './project-budget-fixture.mjs';

test('historical budget receipts remain immutable and validate exact human purpose',t=>{
 const f=fixture(t),audit=historicalBudget(f.service,f.project.id);
 assert.deepEqual(f.store.get('project_budget_revision',audit.id),audit);
 assert.throws(()=>f.store.put('project_budget_revision',audit.id,f.project.id,{...audit,capMicros:'1'}));
 const foreign=f.service.createProject('Foreign');
 assert.throws(()=>f.store.insert('project_budget_revision',audit.id+'-foreign',foreign.id,{...audit,id:audit.id+'-foreign',projectId:foreign.id}));
});
test('retained execution budget keeps unknown reservations when a historical cap is lowered',async t=>{
 const { setup }=await import('./execution-fixture.mjs');
 const f=setup(t,{imagesOnly:true,count:1});
 f.provider.setMode(f.plan.nodes.find(node=>node.kind==='image').id,'unknown_after_accept');
 await f.engine.runReady();
 const before=f.engine.budget(f.projectId),reservations=f.store.list('reservation',f.projectId),attempts=f.engine.attempts(f.projectId);
 assert.equal(attempts[0].phase,'submission_unknown');assert.equal(reservations.length,1);
 f.engine.setBudget(f.projectId,'0');
 assert.equal(f.engine.budget(f.projectId).capMicros,'0');
 assert.equal(f.engine.budget(f.projectId).committedMicros,before.committedMicros);
 assert.deepEqual(f.store.list('reservation',f.projectId),reservations);assert.deepEqual(f.engine.attempts(f.projectId),attempts);
});
