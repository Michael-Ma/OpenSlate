import test from 'node:test';
import assert from 'node:assert/strict';
import { providerEstimate, providerExecutionStatus, providerSelectionForKind, projectCreationCommand } from '../src/provider-model.ts';
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

test('configured providers require no separate key or usage approval while setup failures remain actionable',()=>{
  const current=provider();assert.equal(providerEstimate(current),'Uses your Codex subscription');
  assert.match(providerExecutionStatus(current),/Codex configured.*sign-in is checked when used/);
  assert.doesNotMatch(providerExecutionStatus(current),/approval|allowance|quota.*verified/i);
  assert.match(providerExecutionStatus({...current,readiness:{...current.readiness,realExecutionEnabled:false}}),/setup is incomplete/);
  assert.match(providerExecutionStatus({...current,readiness:{...current.readiness,realExecutionEnabled:false,enabledByHost:false}}),/disabled/);
  assert.equal(providerExecutionStatus({...current,projectExecution:{compatible:false,message:'Saved execution is incompatible'}}),'Saved execution is incompatible');
  const missing={...current,usage:undefined,estimatedCost:null};assert.equal(providerEstimate(missing),'Uses your Codex subscription');
  const api={...current,profile:{kind:'image',adapter:'openai-image'},usage:undefined};
  assert.equal(providerEstimate(api),'Configured estimate: $0.00 USD / attempt');
  assert.equal(providerExecutionStatus(api),'Provider configured · ready for scene generation.');
});
test('choosing Codex image preserves other provider selections and exact project catalog binding',()=>{
  const catalog={catalogDigest:hash('a'),defaults:['fake-image','video'],profiles:[{id:'fake-image',profile:{kind:'image'}},provider(),{id:'video',profile:{kind:'video'}}]};
  const selection=providerSelectionForKind(catalog,null,'image','codex-image-v1');
  assert.deepEqual(selection.profileIds,['codex-image-v1','video']);
  assert.deepEqual(projectCreationCommand('Project','create-once',selection).body,{name:'Project',expectedCatalogDigest:hash('a'),profileIds:['codex-image-v1','video']});
  assert.throws(()=>providerSelectionForKind({...catalog,catalogDigest:hash('b')},selection,'image','fake-image'));
});
