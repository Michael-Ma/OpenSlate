import test from 'node:test';
import assert from 'node:assert/strict';
import { providerEstimate, providerExecutionStatus, providerSelectionForKind, projectCreationCommand } from '../src/provider-model.ts';
import { canSelectSpending, isCodexSpending, reviewSpending, spendingReviewCurrent, spendingEstimate, spendingAllowanceUsage, spendingModelSettings, spendingWorkStatus } from '../src/spending-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';
const hash = letter => letter.repeat(64);
const usage = () => ({ kind:'codex_subscription',unit:'native_turn',quotaEstimateAvailable:false });
const display = () => ({ id:'codex-image-v1',revision:'v1',adapter:'codex-image',model:'codex-image-generation',definitionDigest:hash('c'),
  settings:{runtimeVersion:'0.153.4',directorModel:'gpt-6-astra',width:1024,height:1024},usage:usage() });
const candidate = (n=1) => ({candidateId:`candidate-${n}`,nodeId:`node-${n}`,specDigest:hash('a'),alias:`Keyframe ${n}`,shotId:null,operation:'image',
  profileId:'codex-image-v1',profileRevision:'v1',profileDigest:hash('b'),profileDefinitionDigest:hash('c'),estimatedMicros:'0',selectionCurrent:true,
  suggestedForIssue:true,unavailableCode:null,workState:'unattempted',latestAttempt:null,matchingAllowanceCount:0,providerDisplay:display()});
const provider = () => ({id:'codex-image-v1',label:'Codex image',profile:{kind:'image',adapter:'codex-image',configuration:{model:'codex-image-generation'}},
  usage:usage(),estimatedCost:{currency:'USD',unitMicros:'0',basis:'host_configured',actualVendorPriceVerified:false},
  readiness:{configurationValid:true,registered:true,mediaTools:{required:true,available:true},credential:{required:false,present:null,backendUnavailable:false,apiValidated:false},
    nativeAccess:{configured:true,authentication:'checked_before_dispatch',quota:'unverified'},spendingPermissionRequired:true,enabledByHost:true,realExecutionEnabled:true}});
const state = (candidates=[candidate(1),candidate(2)]) => ({projectId:'project',candidates});

test('Codex review retains exact zero-USD schema while bounding starts to the selected work',()=>{
  const current=state(), review=reviewSpending(current,['candidate-2','candidate-1'],'codex-once',1000);
  assert.equal(review.body.maxAttempts,2);assert.equal(review.body.maxEstimatedMicros,'0');
  assert.deepEqual(Object.keys(review.body).sort(),['expiresAt','maxAttempts','maxEstimatedMicros','profileDefinitionDigest','profileDigest','selections']);
  assert.deepEqual(review.command.body,review.body);assert.deepEqual(review.body.selections.map(row=>row.candidateId),['candidate-2','candidate-1']);
  assert.deepEqual(review.providerDisplay,display());assert.equal(spendingReviewCurrent(review,current,1001),true);
  current.candidates[0].providerDisplay.settings.directorModel='other';
  assert.equal(spendingReviewCurrent(review,current,1001),false);assert.equal(review.providerDisplay.settings.directorModel,'gpt-6-astra');
  assert.equal(review.command.body.maxAttempts,2);assert.equal(review.command.body.maxEstimatedMicros,'0');
});
test('Codex cannot use missing quota metadata, dollar estimates, restored or covered selections',()=>{
  const original=candidate();
  for(const patch of [{estimatedMicros:'1'},{providerDisplay:{...display(),usage:undefined}},
    {providerDisplay:{...display(),usage:{...usage(),quotaEstimateAvailable:true}}},
    {providerDisplay:{...display(),usage:{...usage(),unit:'image'}}},{matchingAllowanceCount:1},
    {unavailableCode:'RESTORED_AUTHORITY_REQUIRES_NEW'},{operation:'speech'},{selectionCurrent:false}]) {
    const changed={...original,...patch};assert.equal(canSelectSpending(changed),false);
    assert.throws(()=>reviewSpending(state([changed]),[changed.candidateId],'invalid',1000));
  }
  const a=candidate(),b=candidate(2);b.providerDisplay={...b.providerDisplay,adapter:'openai-image',settings:{width:1024,height:1024,quality:'medium'}};
  b.profileId='api';b.profileDefinitionDigest=hash('d');b.providerDisplay.id='api';b.providerDisplay.definitionDigest=hash('d');
  assert.throws(()=>reviewSpending(state([a,b]),[a.candidateId,b.candidateId],'no-fallback',1000));
});
test('Codex history describes consumed permissions without inventing measured quota or dollar spending',()=>{
  const allowance={providerDisplay:display(),usedAttempts:1,maxAttempts:2,usedEstimatedMicros:'0',maxEstimatedMicros:'0'};
  assert.equal(spendingAllowanceUsage(allowance),'1 / 2 Codex start permissions used · quota use is not measured');
  assert.match(spendingEstimate(display(),'0'),/Codex subscription quota.*not estimated/);
  assert.doesNotMatch(spendingEstimate(display(),'0'),/\$|free/i);
  assert.match(spendingModelSettings(display()),/requested 1024 × 1024.*may differ/);
  assert.equal(spendingWorkStatus(candidate()),'Available for Codex usage review');
  assert.equal(isCodexSpending(null),false);
  const old={...allowance,providerDisplay:{adapter:'openai-image'},usedEstimatedMicros:'123',maxEstimatedMicros:'999'};
  assert.equal(spendingAllowanceUsage(old),'1 / 2 starts used · $0.000123 USD / $0.000999 USD configured estimate used');
  assert.equal(spendingEstimate(old.providerDisplay,'0'),'$0.00 USD configured estimate / attempt');
});
test('native setup never presents Codex authentication or quota as currently verified',()=>{
  const current=provider();assert.match(providerEstimate(current),/Codex subscription quota.*not estimated/);
  assert.match(providerExecutionStatus(current),/authentication is checked before each start.*Quota is unverified/);
  assert.doesNotMatch(providerExecutionStatus(current),/Provider ready/);
  assert.match(providerExecutionStatus({...current,readiness:{...current.readiness,realExecutionEnabled:false}}),/setup is incomplete/);
  assert.match(providerExecutionStatus({...current,readiness:{...current.readiness,realExecutionEnabled:false,enabledByHost:false}}),/disabled/);
  assert.equal(providerExecutionStatus({...current,projectExecution:{compatible:false,message:'Saved execution is incompatible'}}),'Saved execution is incompatible');
  const missing={...current,usage:undefined,estimatedCost:null};assert.match(providerEstimate(missing),/not estimated/);
  const api={...current,profile:{kind:'image',adapter:'openai-image'},usage:undefined};
  assert.equal(providerEstimate(api),'Configured estimate: $0.00 USD / attempt');
  assert.equal(providerExecutionStatus(api),'Provider ready · generation permission and a spending allowance are still required.');
});
test('choosing Codex image preserves other provider selections and exact project catalog binding',()=>{
  const catalog={catalogDigest:hash('a'),defaults:['fake-image','video'],profiles:[{id:'fake-image',profile:{kind:'image'}},provider(),{id:'video',profile:{kind:'video'}}]};
  const selection=providerSelectionForKind(catalog,null,'image','codex-image-v1');
  assert.deepEqual(selection.profileIds,['codex-image-v1','video']);
  assert.deepEqual(projectCreationCommand('Project','create-once',selection).body,{name:'Project',expectedCatalogDigest:hash('a'),profileIds:['codex-image-v1','video']});
  assert.throws(()=>providerSelectionForKind({...catalog,catalogDigest:hash('b')},selection,'image','fake-image'));
});
test('unknown Codex approval delivery replays the captured finite allowance without substituting API work',async()=>{
  const api={},registry=pendingCommandsFor(api,'spending'),original=state(),review=reviewSpending(original,['candidate-1'],'once',1000);
  await registry.run('project',review.command,async()=>{throw new Error('lost response');},()=>true);
  original.candidates[0].providerDisplay.adapter='openai-image';original.candidates[0].profileDefinitionDigest=hash('d');
  assert.equal(spendingReviewCurrent(review,original,1001),false);
  const restored=pendingCommandsFor(api,'spending').snapshot('project').command;
  assert.deepEqual(restored,review.command);assert.equal(restored.body.maxAttempts,1);assert.equal(restored.body.maxEstimatedMicros,'0');
  assert.equal(restored.body.profileDefinitionDigest,hash('c'));
  await registry.run('project',restored,async()=>({allowance:{id:'saved'}}),()=>false);
  assert.equal(registry.snapshot('project').command,null);
});
