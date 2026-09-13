import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSpending, spendingReviewCurrent, spendingMoney, spendingPage, revokeSpending, budgetCommand, canSelectSpending, spendingWorkStatus, spendingAllowanceStatus } from '../src/spending-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';
const hash = letter=>letter.repeat(64);
const candidate = (index,extra={})=>({ candidateId:`candidate-${index}`,nodeId:`node-${index}`,specDigest:hash('a'),alias:`Frame ${index}`,operation:'image',
  profileId:'image-profile',profileRevision:'version-1',profileDigest:hash('b'),profileDefinitionDigest:hash('c'),estimatedMicros:'100001',selectionCurrent:true,suggestedForIssue:true,
  providerDisplay:{id:'image-profile',revision:'version-1',adapter:'openai-image',model:'gpt-image-2',settings:{width:1024,height:1024,quality:'medium'},definitionDigest:hash('c')},...extra });
const state = (extra={})=>({projectId:'project',candidates:[candidate(1),candidate(2)],...extra});
test('restored work cannot be selected or retain a pending cost review while historical allowances remain revocable',()=>{
  const source=state(), review=reviewSpending(source,['candidate-1'],'before-restore',1000);
  const restored=candidate(1,{selectionCurrent:false,suggestedForIssue:false,unavailableCode:'RESTORED_AUTHORITY_REQUIRES_NEW',workState:'unattempted',matchingAllowanceCount:0});
  assert.equal(canSelectSpending(restored),false);
  assert.throws(()=>reviewSpending(state({candidates:[restored]}),['candidate-1'],'after-restore',1001));
  assert.equal(spendingReviewCurrent(review,state({candidates:[restored]}),1001),false);
  assert.equal(canSelectSpending({...restored,selectionCurrent:true,suggestedForIssue:true}),false);
  assert.match(spendingWorkStatus(restored),/new take with fresh approval/);
  assert.match(spendingWorkStatus({...restored,workState:'uncertain'}),/existing evidence can be recovered/);
  assert.match(spendingWorkStatus({...restored,workState:'completed'}),/Completed/);
  assert.equal(spendingAllowanceStatus({status:'restored_history'}),'Restored history · cannot start new work');
  assert.equal(spendingAllowanceStatus({status:'revoked',restoredHistory:true}),'revoked');
  assert.deepEqual(revokeSpending('project','old-allowance','fresh-command'),{path:'/api/projects/project/spending/allowances/old-allowance/revoke',key:'fresh-command',body:{}});
});
test('a plan shrink keeps navigation back from an empty later page',()=>{
  assert.deepEqual(spendingPage({offset:100,returned:0,total:2,nextOffset:null},100),{visible:true,previousOffset:0,label:'No work on this page'});
  assert.equal(spendingPage({offset:0,returned:2,total:2,nextOffset:null},100).visible,false);
});
test('budget review pins its displayed cap/revision and parses decimal USD without rounding or ambiguous input',()=>{
  const budget={capMicros:'1000000',revision:4};
  const command=budgetCommand('project',budget,'12.000001','budget-once');
  budget.capMicros='9';budget.revision=5;
  assert.deepEqual(command,{path:'/api/projects/project/spending/budget',key:'budget-once',body:{expectedRevision:4,expectedCapMicros:'1000000',capMicros:'12000001'}});
  assert.equal(budgetCommand('project',budget,'0','zero').body.capMicros,'0');
  for(const value of ['1e3','-1','1.0000001','1,000','$2','01','', '9223372036854.775808']) assert.throws(()=>budgetCommand('project',budget,value,'bad'));
});
test('spending review freezes exact choices, one start per selection, micro-dollar total and one-day expiry',()=>{
  const source=state(), review=reviewSpending(source,['candidate-2','candidate-1'],'issue-once',0);
  assert.equal(review.body.maxAttempts,2); assert.equal(review.body.maxEstimatedMicros,'200002'); assert.equal(review.body.expiresAt,'1970-01-02T00:00:00.000Z');
  assert.deepEqual(review.body.selections.map(row=>row.candidateId),['candidate-2','candidate-1']);
  source.candidates[0].specDigest=hash('d'); review.body.selections[0].specDigest=hash('e');
  assert.equal(review.command.body.selections[0].specDigest,hash('a')); assert.equal(review.command.body.selections[1].specDigest,hash('a'));
  assert.equal(spendingMoney('200002'),'$0.200002 USD'); assert.equal(spendingMoney('9223372036854775807'),'$9223372036854.775807 USD');
});
test('review excludes unavailable, mixed-profile, already covered, repeated and stale selections',()=>{
  for(const extra of [{selectionCurrent:false},{suggestedForIssue:false},{profileDefinitionDigest:hash('d')},{estimatedMicros:'100002'},
    {profileDigest:null},{operation:'speech'},{matchingAllowanceCount:1},{providerDisplay:null},{profileRevision:'other-version'},
    {providerDisplay:{...candidate(1).providerDisplay,definitionDigest:hash('d')}}]) assert.throws(()=>reviewSpending(state({candidates:[candidate(1),candidate(2,extra)]}),['candidate-1','candidate-2'],'k'));
  assert.throws(()=>reviewSpending(state(),['candidate-1','candidate-1'],'k'));
  const source=state(), review=reviewSpending(source,['candidate-1'],'k',1000);
  assert.equal(spendingReviewCurrent(review,source,1001),true);
  assert.equal(spendingReviewCurrent(review,{...source,projectId:'other'},1001),false);
  assert.equal(spendingReviewCurrent(review,source,86_401_000),false);
  for(const extra of [{specDigest:hash('d')},{profileDefinitionDigest:hash('d')},{estimatedMicros:'9'},{matchingAllowanceCount:1},{selectionCurrent:false}])
    assert.equal(spendingReviewCurrent(review,state({candidates:[candidate(1,extra)]}),1001),false);
});
test('lost allowance response survives remount with the exact request and expiry, independent of media uploads',async()=>{
  const api={}, registry=pendingCommandsFor(api,'spending'), review=reviewSpending(state(),['candidate-1'],'approval-key'); let calls=0;
  await registry.run('project',review.command,async()=>{calls++;throw new Error('uncertain');},()=>true);
  const remount=pendingCommandsFor(api,'spending'), retained=remount.snapshot('project').command;
  assert.notEqual(pendingCommandsFor(api),registry); assert.equal(pendingCommandsFor({},'spending').snapshot('project').command,null);
  assert.deepEqual(retained.body,review.command.body); assert.equal(retained.key,'approval-key');
  assert.equal(await remount.run('project',reviewSpending(state(),['candidate-2'],'new-key').command,async()=>{calls++;},()=>true),false);
  await remount.run('project',retained,async command=>{calls++;assert.equal(command,retained);return {allowance:{id:'saved'}};},()=>true);
  assert.equal(calls,2); assert.equal(remount.snapshot('project').command,null);
  assert.deepEqual(revokeSpending('project','saved','revoke-key'),{path:'/api/projects/project/spending/allowances/saved/revoke',key:'revoke-key',body:{}});
});
