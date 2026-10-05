import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';

const rows = store => store.db.prepare('SELECT kind,id,body FROM entities ORDER BY kind,id').all();

test('snapshot identifies current unknown work without changing history, receipts or project authority',async t=>{
  const f=setup(t,{count:1,imagesOnly:true}),node=f.plan.nodes[0];
  f.provider.setMode(node.id,'unknown_after_accept');await f.engine.runReady();
  const attempt=f.engine.attempts(f.projectId)[0],before=rows(f.store),cursor=f.store.cursor(f.projectId);
  const view=new ProductionService(f.store,f.engine).snapshot(f.projectId);
  assert.deepEqual(view.currentAttemptIds,[attempt.id]);assert.equal(view.attempts[0].phase,'submission_unknown');
  assert.deepEqual(rows(f.store),before);assert.equal(f.store.cursor(f.projectId),cursor);assert.equal(f.provider.acceptedCount(),1);
});
test('a new candidate at the same node ID cannot inherit an earlier unknown job in the current-plan UI',async t=>{
  const f=setup(t,{count:1,imagesOnly:true}),node=f.plan.nodes[0];
  f.provider.setMode(node.id,'unknown_after_accept');await f.engine.runReady();const old=f.engine.attempts(f.projectId)[0];
  const project=f.store.getProject(f.projectId),grant=f.engine.createGrant(f.projectId,node.shotId,'image','new-human-choice','user_change');
  const nextPlan=randomUUID();f.store.transaction(()=>{f.engine.installPlan(f.projectId,nextPlan,f.plan,{[node.id]:grant.id});f.store.saveProject({...project,activePlanId:nextPlan},project.headVersion);});
  const view=new ProductionService(f.store,f.engine).snapshot(f.projectId);
  assert.equal(view.attempts.length,1);assert.equal(view.attempts[0].id,old.id);assert.equal(view.attempts[0].phase,'submission_unknown');
  assert.deepEqual(view.currentAttemptIds,[]);assert.notEqual(f.store.get('node_binding',node.id).candidateId,old.candidateId);assert.equal(f.provider.acceptedCount(),1);
});
test('unchanged plan reuse keeps the candidate job current, while retirement removes only current evidence',async t=>{
  const f=setup(t,{count:1,imagesOnly:true}),node=f.plan.nodes[0];
  f.provider.setMode(node.id,'pending');await f.engine.runReady();const attempt=f.engine.attempts(f.projectId)[0];
  const project=f.store.getProject(f.projectId),nextPlan=randomUUID();f.store.transaction(()=>{f.engine.installPlan(f.projectId,nextPlan,f.plan);f.store.saveProject({...project,activePlanId:nextPlan},project.headVersion);});
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId),[attempt.id]);
  const binding=f.store.get('node_binding',node.id);f.store.put('node_binding',node.id,f.projectId,{...binding,state:'retired'});
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId),[]);assert.equal(f.engine.attempts(f.projectId)[0].phase,'remote_pending');
});
test('missing plan and changed creative intent cannot be described as current work',async t=>{
  const f=setup(t,{count:1,imagesOnly:true});f.provider.setMode(f.plan.nodes[0].id,'pending');await f.engine.runReady();
  const project=f.store.getProject(f.projectId);project.shots[0].promptIntent.image='changed';f.store.saveProject(project,project.headVersion);
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId),[]);
  const latest=f.store.getProject(f.projectId);f.store.saveProject({...latest,activePlanId:null},latest.headVersion);
  assert.deepEqual(f.engine.currentAttemptIds(f.projectId),[]);assert.equal(f.engine.attempts(f.projectId).length,1);
});
