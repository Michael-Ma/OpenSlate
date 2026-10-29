import { narrationServiceHarness } from './narration-service-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { installRecoveryQuarantine } from '../dist/application/installation-recovery.js';
import { ownedTranscriptionFixture, key, draft, rows, bodies } from './owned-transcription-fixture.mjs';

const token = 'offline_owned_transcription_http_token';
const PROPOSALS = '/transcription-proposals', REVIEWS = '/transcription-reviews';
const unchangedKinds = ['grant', 'candidate', 'attempt', 'reservation', 'external_allowance', 'external_allowance_consumption', 'logical_ids',
  'stage', 'hold', 'execution_control', 'node_binding', 'plan', 'narration_state', 'narration_segment', 'narration_audio', 'narration_cue',
  'narration_acceptance', 'narration_revision', 'narration_canonical'];
const allRows = f => ['projects', 'entities', 'commands', 'events'].map(table => f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const unchanged = f => canonical({ project: f.store.getProject(f.project.id), bodies: bodies(f, unchangedKinds) });
const noSpending = f => { assert.equal(rows(f, 'external_allowance').length, 0); assert.equal(rows(f, 'external_allowance_consumption').length, 0);
  assert.equal(rows(f, 'attempt').filter(attempt => attempt.request.kind === 'transcription').length, 0);
  assert.equal(rows(f, 'reservation').filter(reservation => f.store.get('attempt', reservation.attemptId)?.request.kind === 'transcription').length, 0); };
function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function setup(t, options = {}) {
  const f = await ownedTranscriptionFixture(t, options);
  if (options.outputs) { await f.engine.runReady(); await f.engine.reconcile(); }
  f.canonical = new NarrationCanonicalService(f.narration);
  f.app = createApp({ service: f.production, localToken: token,
 });
  registerNarrationRoutes(f.app, { production: f.production, narration: f.narration, canonical: f.canonical,
    uploadDirectory: join(f.root, 'uploads'), ...(options.available === false ? {} : { ownedTranscription: f.service }) });
  await f.app.ready(); t.after(() => f.app.close()); f.base = `/api/projects/${f.project.id}/narration`;
  f.testToken = token; f.request = narrationServiceHarness(f, { uploadDirectory: f.uploadDirectory ?? join(f.root ?? f.dir, 'uploads'), speech: f.speechService ?? (f.profile?.kind === 'speech' ? f.service : undefined), transcription: f.service });
  f.session = async (body = {}, commandKey = key()) => { const response = await f.request('/sessions', body, { headers: { 'idempotency-key': commandKey } });
    assert.equal(response.statusCode, 200, response.body); return response.json().session; };
  f.prepareBody = (session, patch = {}) => { const { key: _key, ...input } = f.input(); return { ...input, sessionId: session.id, ...patch }; };
  f.propose = async (session, patch = {}, commandKey = key()) => {
    const input = f.prepareBody(session, patch), response = await f.request(PROPOSALS, input, { headers: { 'idempotency-key': commandKey } });
    assert.equal(response.statusCode, 200, response.body);
    const summary = response.json().proposal, saved = f.store.get('owned_transcription_proposal', summary.id), { sessionId: _sessionId, ...serviceInput } = input;
    assert.ok(saved); assert.equal(summary.proposalDigest, digest(saved)); assert.equal(saved.inputDigest, digest({ ...serviceInput, key: commandKey }));
    return { input, response, proposal: saved, commandKey };
  };
  f.reviewBody = (session, proposal) => ({ sessionId: session.id, proposalId: proposal.id, proposalDigest: digest(proposal) });
  f.review = (session, proposal, commandKey = key()) => f.request(REVIEWS, f.reviewBody(session, proposal), { headers: { 'idempotency-key': commandKey } });
  f.media.describeTranscriptionAudio = f.media.deriveTranscriptionAudio = () => { throw Error('service proposal/review cannot prepare provider audio'); };
  return f;
}
function actor(session) { return { kind: 'human', principalId: 'local-user', requestId: session.requestId }; }
function editSection(f, session, index) {
  const view = f.narration.workspaceSnapshot(f.project.id);
  f.narration.reviseSegments(f.project.id, actor(session), view.state.version, key(),
    { update: [{ segmentId: view.segments[index].entry.segmentId, draft: draft(`Changed section ${index}.`) }] });
}
async function changeHead(f, session) {
  const project = f.store.getProject(f.project.id), prepared = await f.production.prepare(f.project.id, actor(session),
    { variant: 'project', expectedHeadVersion: project.headVersion, creative: { brief: 'A later independent project change.' } });
  f.production.apply(f.project.id, actor(session), prepared.id);
}

test('options and proposal projections create no request, session, hold, authority or media work', async t => {
  const f = await setup(t), before = allRows(f), calls = f.provider.acceptedCount();
  for (const path of ['/transcription-options', PROPOSALS]) {
    const res = await f.request(path); assert.equal(res.statusCode, 200, res.body);
    assert.ok(!res.body.includes(f.root)); assert.ok(!res.body.includes('OPENSLATE_OPENAI_API_KEY')); assert.ok(res.rawPayload.length <= 64 * 1024);
  }
  assert.deepEqual(allRows(f), before); assert.equal(f.provider.acceptedCount(), calls); noSpending(f);
});

test('service upload-first preparation creates only its exact ungranted proposal without any script or canonical acceptance', async t => {
  const f = await setup(t), session = await f.session(), before = unchanged(f), count = f.provider.acceptedCount();
  const { proposal, response } = await f.propose(session);
  assert.equal(unchanged(f), before); assert.equal(proposal.state, 'ungranted'); assert.equal(proposal.requestId, session.requestId);
  assert.equal(proposal.principalId, 'local-user'); assert.equal(proposal.epochId, null); assert.equal(rows(f, 'narration_segment').length, 0);
  assert.equal(rows(f, 'narration_acceptance').length, 0); assert.equal(f.store.getProject(f.project.id).artifacts.length, 0);
  assert.equal(rows(f, 'owned_transcription_proposal').length, 1); assert.equal(rows(f, 'owned_transcription_source').length, 1);
  assert.equal(rows(f, 'owned_transcription_review').length, 0); assert.equal(rows(f, 'owned_transcription_application').length, 0);
  assert.ok(response.json().proposal); assert.ok(!response.body.includes(f.root)); assert.ok(!response.body.includes('canonicalSource'));
  const readBefore = allRows(f), detail = await f.request(`${PROPOSALS}/${proposal.id}`), list = await f.request(PROPOSALS);
  assert.equal(detail.statusCode, 200, detail.body); assert.equal(list.statusCode, 200, list.body);
  assert.ok(!detail.body.includes(f.root)); assert.ok(!detail.body.includes('canonicalSource')); assert.deepEqual(allRows(f), readBefore);
  assert.equal(f.provider.acceptedCount(), count); noSpending(f);
});

test('service rejects foreign or stale sessions and exact source mismatches before writes', async t => {
  const f = await setup(t), session = await f.session(), input = f.prepareBody(session), before = allRows(f);
  assert.equal((await f.request(PROPOSALS, { ...input, sessionId: key() })).json().error.code, 'NARRATION_SESSION_STALE');
  for (const patch of [{ audioId: key() }, { sourceRecordDigest: 'f'.repeat(64) }, { expectedHeadVersion: input.expectedHeadVersion + 1 }, { profileId: 'fake-image-v1' }])
    assert.equal((await f.request(PROPOSALS, { ...input, ...patch })).statusCode, 409);
  assert.deepEqual(allRows(f), before);
  const other = f.production.createProject('Foreign project'), prior = allRows(f);
  assert.equal((await f.request(PROPOSALS, input, { url: `/api/projects/${other.id}/narration${PROPOSALS}` })).json().error.code, 'NARRATION_SESSION_STALE');
  assert.deepEqual(allRows(f), prior);
  f.production.beginRequest(f.project.id, 'local-user', 'Supersede the original session.'); const stale = allRows(f);
  assert.equal((await f.request(PROPOSALS, input)).json().error.code, 'NARRATION_SESSION_STALE'); assert.deepEqual(allRows(f), stale); noSpending(f);
});

test('prepare exact replay precedes later head and missing files but keeps its original session and body identity', async t => {
  const f = await setup(t), session = await f.session(), created = await f.propose(session, {}, 'prepare-once');
  await changeHead(f, session); const artifact = f.store.get('artifact', f.audio.id); await unlink(artifact.path);
  f.media.verifiedSource = () => { throw Error('exact proposal replay must not read media'); };
  const before = allRows(f), replay = await f.request(PROPOSALS, created.input, { headers: { 'idempotency-key': created.commandKey } });
  assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), created.response.json()); assert.deepEqual(allRows(f), before);
  const changed = await f.request(PROPOSALS, { ...created.input, language: 'en' }, { headers: { 'idempotency-key': created.commandKey } });
  assert.equal(changed.json().error.code, 'IDEMPOTENCY_CONFLICT');
  const next = await f.session({ continuationSessionId: session.id }); assert.notEqual(next.id, session.id);
  assert.equal((await f.request(PROPOSALS, created.input, { headers: { 'idempotency-key': created.commandKey } })).json().error.code, 'NARRATION_SESSION_STALE');
});

test('standalone and exact-section preparation remain distinct and an unrelated section edit does not invalidate review', async t => {
  const f = await setup(t, { section: true }), session = await f.session();
  const standalone = await f.propose(session, { target: { kind: 'recording' } }), section = await f.propose(session);
  assert.deepEqual(f.store.get('owned_transcription_source', standalone.proposal.sourceBinding.id).target, { kind: 'recording' });
  const source = f.store.get('owned_transcription_source', section.proposal.sourceBinding.id), view = f.narration.workspaceSnapshot(f.project.id);
  assert.equal(source.target.kind, 'section'); assert.equal(source.target.segmentId, view.segments[0].entry.segmentId);
  assert.notEqual(source.target.segmentId, view.segments[1].entry.segmentId); editSection(f, session, 1);
  const response = await f.review(session, section.proposal); assert.equal(response.statusCode, 200, response.body); noSpending(f);
});

for (const boundary of ['head', 'section']) test(`review rejects ${boundary} changed since proposal without creating authority`, async t => {
  const f = await setup(t, { section: true }), session = await f.session(), { proposal } = await f.propose(session);
  if (boundary === 'head') await changeHead(f, session); else editSection(f, session, 0);
  const before = allRows(f), detail = await f.request(`${PROPOSALS}/${proposal.id}`);
  assert.equal(detail.statusCode, 200, detail.body); assert.equal(detail.json().eligibility.current, false); assert.equal(typeof detail.json().eligibility.code, 'string');
  const response = await f.review(session, proposal);
  assert.equal(response.statusCode, 409, response.body); assert.deepEqual(allRows(f), before);
  assert.equal(rows(f, 'owned_transcription_review').length, 0); assert.equal(rows(f, 'owned_transcription_application').length, 0); noSpending(f);
});

test('human service review appends one reviewed transcription while retaining the full active plan and existing outputs', async t => {
  const f = await setup(t, { plan: true, outputs: true }), session = await f.session(), base = f.store.getProject(f.project.id);
  const oldPlan = f.store.get('plan', base.activePlanId).compiled, oldBindings = rows(f, 'node_binding'), oldGrants = rows(f, 'grant'), oldCandidates = rows(f, 'candidate');
  const narration = canonical(f.narration.workspaceSnapshot(f.project.id)), accepted = f.provider.acceptedCount(), { proposal } = await f.propose(session);
  const response = await f.review(session, proposal); assert.equal(response.statusCode, 200, response.body); const { receipt } = response.json();
  assert.equal(receipt.proposalId, proposal.id); assert.equal(receipt.proposalDigest, digest(proposal)); assert.equal(receipt.reviewId, receipt.grantId); assert.equal(receipt.applicationId, receipt.candidateId);
  const project = f.store.getProject(f.project.id), plan = f.store.get('plan', project.activePlanId).compiled;
  assert.equal(project.headVersion, base.headVersion + 1); assert.notEqual(project.activePlanId, base.activePlanId);
  assert.deepEqual(plan.nodes.filter(node => node.alias !== proposal.operation.alias), oldPlan.nodes); assert.deepEqual(plan.gates, oldPlan.gates);
  for (const prior of oldBindings) { const current = f.store.get('node_binding', prior.id); assert.deepEqual(current.outputs, prior.outputs); assert.equal(current.candidateId, prior.candidateId); }
  assert.deepEqual(rows(f, 'grant').slice(0, oldGrants.length), oldGrants); assert.deepEqual(rows(f, 'candidate').slice(0, oldCandidates.length), oldCandidates);
  assert.equal(rows(f, 'grant').length, oldGrants.length + 1); assert.equal(rows(f, 'candidate').length, oldCandidates.length + 1);
  assert.equal(rows(f, 'owned_transcription_review').length, 1); assert.equal(rows(f, 'owned_transcription_application').length, 1);
  const readBefore = allRows(f), detail = await f.request(`${PROPOSALS}/${proposal.id}`); assert.equal(detail.statusCode, 200, detail.body);
  assert.deepEqual(detail.json().application, receipt); assert.equal(detail.json().execution.state, 'ready'); assert.equal(detail.json().execution.generationCandidateId, receipt.candidateId);
  assert.deepEqual(allRows(f), readBefore);
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), narration); assert.equal(f.provider.acceptedCount(), accepted); noSpending(f);
});

test('review replay returns the exact original receipt after later state and missing files, while forged body and stale session fail', async t => {
  const f = await setup(t), session = await f.session(), { proposal } = await f.propose(session), input = f.reviewBody(session, proposal), headers = { 'idempotency-key': 'review-once' };
  const response = await f.request(REVIEWS, input, { headers }); assert.equal(response.statusCode, 200, response.body);
  await changeHead(f, session); await unlink(f.store.get('artifact', f.audio.id).path); f.media.verifiedSource = () => { throw Error('review replay cannot read media'); };
  const before = allRows(f), replay = await f.request(REVIEWS, input, { headers }); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), response.json());
  assert.deepEqual(allRows(f), before);
  assert.equal((await f.request(REVIEWS, { ...input, proposalDigest: 'f'.repeat(64) }, { headers })).json().error.code, 'IDEMPOTENCY_CONFLICT');
  const other = f.production.createProject('Other'); assert.equal((await f.request(REVIEWS, input, { url: `/api/projects/${other.id}/narration${REVIEWS}` })).json().error.code, 'NARRATION_SESSION_STALE');
  await f.session({ continuationSessionId: session.id }); assert.equal((await f.request(REVIEWS, input, { headers })).json().error.code, 'NARRATION_SESSION_STALE'); noSpending(f);
});

for (const boundary of ['event', 'command']) test(`review ${boundary} failure rolls back publication and exact retry creates one receipt`, async t => {
  const f = await setup(t), session = await f.session(), { proposal } = await f.propose(session), input = f.reviewBody(session, proposal), headers = { 'idempotency-key': `rollback-${boundary}` };
  const before = allRows(f); let intercepted = 0, restore;
  if (boundary === 'event') {
    const original = f.store.appendEvent.bind(f.store); f.store.appendEvent = (...args) => { if (args[1] === 'narration.transcription_reviewed') { intercepted++; throw Error('INJECTED_SERVICE_REVIEW_EVENT'); } return original(...args); };
    restore = () => { f.store.appendEvent = original; };
  } else {
    f.store.db.exec("CREATE TEMP TRIGGER fail_owned_service_command BEFORE INSERT ON commands WHEN NEW.actor_scope LIKE '%:owned-transcription-review' BEGIN SELECT RAISE(ABORT,'INJECTED_SERVICE_REVIEW_COMMAND'); END");
    restore = () => f.store.db.exec('DROP TRIGGER fail_owned_service_command');
  }
  let response; try { response = await f.request(REVIEWS, input, { headers }); } finally { restore(); }
  assert.equal(response.statusCode, 500, response.body); if (boundary === 'event') assert.equal(intercepted, 1); assert.deepEqual(allRows(f), before);
  response = await f.request(REVIEWS, input, { headers }); assert.equal(response.statusCode, 200, response.body);
  assert.equal(rows(f, 'owned_transcription_review').length, 1); assert.equal(rows(f, 'owned_transcription_application').length, 1);
  const saved = allRows(f); assert.deepEqual((await f.request(REVIEWS, input, { headers })).json(), response.json()); assert.deepEqual(allRows(f), saved); noSpending(f);
});

test('options report exact supported saved profile and proposal list guards its bounded page identity', async t => {
  const f = await setup(t), session = await f.session(), first = await f.propose(session), second = await f.propose(session, { language: 'en' });
  const before = allRows(f), options = await f.request('/transcription-options'); assert.equal(options.statusCode, 200, options.body);
  assert.deepEqual(options.json().profiles, [{ id: f.profile.id, revision: f.profile.revision, provider: 'OpenAI', model: 'whisper-1', estimatedMicros: '100', currency: 'USD' }]);
  assert.ok(options.json().languages.includes('auto')); assert.ok(options.json().languages.includes('en')); assert.equal(options.json().timing, 'word');
  const response = await f.request(PROPOSALS), page = response.json(); assert.equal(response.statusCode, 200, response.body);
  assert.equal(page.coverage.total, 2); assert.equal(page.coverage.nextOffset, null);
  assert.deepEqual(new Set(page.proposals.map(item => item.id)), new Set([first.proposal.id, second.proposal.id]));
  for (const item of page.proposals) { assert.equal(item.unavailableCode, null); assert.equal(item.proposal.proposalDigest, digest(f.store.get('owned_transcription_proposal', item.id))); }
  const detail = await f.request(`${PROPOSALS}/${first.proposal.id}`); assert.equal(detail.statusCode, 200, detail.body);
  assert.deepEqual(detail.json().proposal, first.response.json().proposal); assert.deepEqual(detail.json().eligibility, { current: true, code: null });
  assert.equal(detail.json().application, null); assert.equal(detail.json().execution.state, 'not_applied');
  assert.deepEqual(allRows(f), before);
  await f.propose(session, { language: 'fr' });
  const stale = await f.request(`${PROPOSALS}?offset=1&expectedDigest=${page.coverage.dataDigest}`); assert.equal(stale.statusCode, 409, stale.body);
});

test('unconfigured current transcription command refuses publication without paid work', async t => {
  const f=await setup(t,{available:false}),{key:_key,...body}=f.input();
  const response=await directTranscription(f,body);assert.equal(response.json().error.code,'NARRATION_MEDIA_UNAVAILABLE');
  for(const kind of ['owned_transcription_proposal','owned_transcription_review','owned_transcription_application','grant','candidate'])assert.equal(rows(f,kind).length,0,kind);
  noSpending(f);
});

test('quarantined restoration retains recording playback and blocks the current transcription command', async t => {
  const f=await setup(t),{key:_key,...body}=f.input();
  installRecoveryQuarantine(f.store,{restoreId:key(),backupId:key(),backupManifestSha256:'a'.repeat(64),sourceDatabaseSha256:'b'.repeat(64),originalDataRoot:f.root,backupCreatedAt:'2026-09-12T00:00:00.000Z',restoredAt:'2026-09-13T00:00:00.000Z'});
  const before=allRows(f),changes=f.store.db.prepare('SELECT total_changes() n').get().n;
  const playback=await f.app.inject({url:`${f.base}/audio/${f.audio.id}/content`,headers:{host:'127.0.0.1',authorization:`Bearer ${token}`}});
  assert.equal(playback.statusCode,200,playback.body);
  const response=await directTranscription(f,body);assert.equal(response.json().error.code,'INSTALLATION_QUARANTINED');
  assert.deepEqual(allRows(f),before);assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n,changes);noSpending(f);
});

const directTranscription = (f, body, commandKey = key(), headers = {}) => f.app.inject({ method: 'POST', url: `${f.base}/transcriptions`, payload: body,
  headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': commandKey, ...headers } });
test('direct owned transcription validates local authority and exact source before publishing once', async t => {
  const f=await setup(t),{key:_key,...body}=f.input(),before=allRows(f);
  for(const headers of [{authorization:''},{origin:'https://foreign.example'},{'idempotency-key':''}]) assert.notEqual((await directTranscription(f,body,key(),headers)).statusCode,200);
  for(const patch of [{actor:{kind:'human'}},{path:f.originalPath},{sourceRecordDigest:'bad'},{expectedHeadVersion:-1}]) assert.equal((await directTranscription(f,{...body,...patch})).statusCode,400);
  assert.deepEqual(allRows(f),before);
  const first=await directTranscription(f,body,'direct-transcription-once');assert.equal(first.statusCode,200,first.body);
  const settled=allRows(f),replay=await directTranscription(f,body,'direct-transcription-once');assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),first.json());assert.deepEqual(allRows(f),settled);
  assert.equal(rows(f,'owned_transcription_application').length,1);assert.equal(rows(f,'candidate').length,1);assert.equal(rows(f,'grant').length,1);noSpending(f);
  assert.equal((await directTranscription(f,{...body,language:'en'},'direct-transcription-once')).json().error.code,'IDEMPOTENCY_CONFLICT');
});
for (const action of ['prepare', 'review']) test(`direct transcription HTTP disconnect cancels original ${action} before publication and drains the handler`, { timeout: 15000 }, async t => {
  const f = await setup(t), {key:_key,...body}=f.input();
  const entered=latch(),released=latch(),finished=latch(),run=f.service.request.bind(f.service),prepare=f.service.prepare.bind(f.service),verify=f.media.verifiedSource.bind(f.media);
  let capturedSignal,prepared=false,gated=false;
  f.service.prepare=async(...args)=>{const result=await prepare(...args);prepared=true;return result;};
  f.service.request=async(...args)=>{try{return await run(...args);}finally{finished.release();}};
  f.media.verifiedSource=async(...args)=>{const result=await verify(...args);if(!gated&&(action==='prepare'||prepared)){gated=true;capturedSignal=args[1]?.signal;entered.release();await released.promise;}return result;};
  const address=await f.app.listen({host:'127.0.0.1',port:0}),payload=JSON.stringify(body);
  const request=httpRequest(`${address}${f.base}/transcriptions`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','content-length':Buffer.byteLength(payload),'idempotency-key':`disconnect-${action}`}});
  request.on('error',()=>{});request.on('response',response=>response.resume());request.end(payload);
  try { await entered.promise;assert.ok(capturedSignal instanceof AbortSignal);const aborted=capturedSignal.aborted?Promise.resolve():new Promise(resolve=>capturedSignal.addEventListener('abort',resolve,{once:true}));request.destroy();await aborted;assert.equal(capturedSignal.aborted,true); }
  finally {request.destroy();released.release();await finished.promise;}
  for(const kind of ['owned_transcription_review','owned_transcription_application','grant','candidate'])assert.equal(rows(f,kind).length,0,kind);
  noSpending(f);
});
