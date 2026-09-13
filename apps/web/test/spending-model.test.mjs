import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewSpending, spendingReviewCurrent, spendingMoney, spendingPage, revokeSpending, budgetCommand, canSelectSpending, spendingWorkStatus, spendingAllowanceStatus, spendingAudioSummary, spendingModelSettings, spendingOperationLabel } from '../src/spending-model.ts';
import { pendingCommandsFor } from '../src/pending-command.ts';
const hash = letter=>letter.repeat(64);
const candidate = (index,extra={})=>({ candidateId:`candidate-${index}`,nodeId:`node-${index}`,specDigest:hash('a'),alias:`Frame ${index}`,operation:'image',
  profileId:'image-profile',profileRevision:'version-1',profileDigest:hash('b'),profileDefinitionDigest:hash('c'),estimatedMicros:'100001',selectionCurrent:true,suggestedForIssue:true,
  providerDisplay:{id:'image-profile',revision:'version-1',adapter:'openai-image',model:'gpt-image-2',settings:{width:1024,height:1024,quality:'medium'},definitionDigest:hash('c')},...extra });
const state = (extra={})=>({projectId:'project',candidates:[candidate(1),candidate(2)],...extra});
const audioCandidate = (operation='speech',extra={})=>candidate(1,{operation,profileId:'audio-profile',profileRevision:'v1',unavailableCode:null,
  providerDisplay:{id:'audio-profile',revision:'v1',adapter:operation==='speech'?'openai-speech':'openai-transcription',model:operation==='speech'?'gpt-4o-mini-tts-2025-12-15':'whisper-1',settings:{},definitionDigest:hash('c')},
  audioDisplay:operation==='speech'?{operation,voice:'coral',textBytes:52,instructionsPresent:true}:{operation,language:null,timing:'word'},audioUnavailableCode:null,...extra});
test('fixed speech and transcription cost reviews preserve exact summaries without changing approval payloads',()=>{
  for(const operation of ['speech','transcription']) {
    const current=audioCandidate(operation), source=state({candidates:[current]});
    assert.equal(canSelectSpending(current),true);
    const review=reviewSpending(source,[current.candidateId],'audio-exact',1000);
    assert.deepEqual(review.audioDisplays,[current.audioDisplay]); assert.notEqual(review.audioDisplays[0],current.audioDisplay);
    assert.equal(review.body.maxAttempts,1); assert.equal(review.body.maxEstimatedMicros,current.estimatedMicros);
    assert.deepEqual(Object.keys(review.command.body).sort(),['expiresAt','maxAttempts','maxEstimatedMicros','profileDefinitionDigest','profileDigest','selections']);
    assert.equal(spendingReviewCurrent(review,source,1001),true);
    current.audioDisplay=operation==='speech'?{...current.audioDisplay,voice:'onyx'}:{...current.audioDisplay,language:'en'};
    assert.equal(spendingReviewCurrent(review,source,1001),false);
    assert.equal(review.audioDisplays[0][operation==='speech'?'voice':'language'],operation==='speech'?'coral':null);
  }
});
test('unsupported or mismatched audio options stay unselectable even with optimistic selection flags',()=>{
  for(const operation of ['speech','transcription']) for(const change of [
    {audioDisplay:null}, {audioUnavailableCode:'AUDIO_OPERATION_UNSUPPORTED'}, {audioUnavailableCode:'AUDIO_PROFILE_UNAVAILABLE'},
    {providerDisplay:{...audioCandidate(operation).providerDisplay,adapter:'openai-image'}}, {providerDisplay:null},
    {audioDisplay:operation==='speech'?{operation,voice:'/private/key',textBytes:1,instructionsPresent:false}:{operation,language:'https://private.example',timing:'word'}},
    {audioDisplay:operation==='speech'?{operation,voice:'coral',textBytes:0,instructionsPresent:false}:{operation,language:null,timing:'segment'}},
    {audioDisplay:audioCandidate(operation==='speech'?'transcription':'speech').audioDisplay}, {matchingAllowanceCount:1},
    {suggestedForIssue:false,workState:'uncertain'}, {unavailableCode:'RESTORED_AUTHORITY_REQUIRES_NEW'}]) {
    const current=audioCandidate(operation,change); assert.equal(canSelectSpending(current),false);
    assert.throws(()=>reviewSpending(state({candidates:[current]}),[current.candidateId],'bad-audio'));
  }
  assert.match(spendingWorkStatus(audioCandidate('speech',{audioUnavailableCode:'AUDIO_PROFILE_UNAVAILABLE'})),/model details unavailable/);
  assert.match(spendingWorkStatus(audioCandidate('transcription',{audioUnavailableCode:'AUDIO_OPERATION_UNSUPPORTED'})),/unsupported or unavailable/);
});
test('audio summary wording distinguishes an automatic language choice, fixed output and optional instructions',()=>{
  assert.equal(spendingAudioSummary(audioCandidate()),'Voice: coral · Delivery instructions included');
  assert.equal(spendingAudioSummary({audioDisplay:{...audioCandidate().audioDisplay,instructionsPresent:false}}),'Voice: coral');
  assert.equal(spendingAudioSummary(audioCandidate('transcription')),'Language: automatic detection · Word timestamps');
  assert.equal(spendingAudioSummary({audioDisplay:{operation:'transcription',language:'fr',timing:'word'}}),'Language: fr · Word timestamps');
  assert.equal(spendingModelSettings(audioCandidate().providerDisplay),'Speech recording · WAV · normal speed');
  assert.equal(spendingModelSettings(audioCandidate('transcription').providerDisplay),'Transcription · word timestamps');
  assert.equal(spendingOperationLabel('speech'),'speech recording'); assert.equal(spendingOperationLabel('image'),'keyframe');
});
test('mixed audio voices remain separately frozen while mixed operations and profiles cannot share cost review',()=>{
  const a=audioCandidate(), b=audioCandidate('speech',{candidateId:'candidate-2',nodeId:'node-2',audioDisplay:{...a.audioDisplay,voice:'onyx'}});
  const review=reviewSpending(state({candidates:[a,b]}),[a.candidateId,b.candidateId],'two-voices',1000);
  assert.deepEqual(review.audioDisplays.map(row=>row.voice),['coral','onyx']); assert.equal(review.body.maxAttempts,2);
  const asr=audioCandidate('transcription',{candidateId:'candidate-2',nodeId:'node-2'});
  assert.throws(()=>reviewSpending(state({candidates:[a,asr]}),[a.candidateId,asr.candidateId],'mixed'));
});
test('an uncertain audio allowance request replays its captured selection after model options change',async()=>{
  const api={}, registry=pendingCommandsFor(api,'spending'), current=audioCandidate('transcription');
  const review=reviewSpending(state({candidates:[current]}),[current.candidateId],'one-audio-command',1000);
  await registry.run('project',review.command,async()=>{throw new Error('lost response');},()=>true);
  current.specDigest=hash('e'); current.audioDisplay.language='zh';
  const restored=pendingCommandsFor(api,'spending').snapshot('project').command;
  assert.deepEqual(restored,review.command); assert.equal(restored.body.selections[0].specDigest,hash('a'));
  assert.equal(spendingReviewCurrent(review,state({candidates:[current]}),1001),false);
  await registry.run('project',restored,async command=>{assert.equal(command.key,'one-audio-command');return {allowance:{id:'saved'}};},()=>true);
  assert.equal(registry.snapshot('project').command,null);
});
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
