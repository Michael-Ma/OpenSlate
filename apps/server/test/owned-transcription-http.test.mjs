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
import { ExternalAllowanceService } from '../dist/application/external-allowances.js';
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
    ...(options.spending ? { allowanceRoutes: { service: f.production, allowances: new ExternalAllowanceService(f.store) } } : {}) });
  registerNarrationRoutes(f.app, { production: f.production, narration: f.narration, canonical: f.canonical,
    uploadDirectory: join(f.root, 'uploads'), ...(options.available === false ? {} : { ownedTranscription: f.service }) });
  await f.app.ready(); t.after(() => f.app.close()); f.base = `/api/projects/${f.project.id}/narration`;
  f.request = (suffix = '', payload, extras = {}) => f.app.inject({ method: payload === undefined ? 'GET' : 'POST', url: `${f.base}${suffix}`,
    ...(payload === undefined ? {} : { payload }), ...extras,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key(), ...extras.headers } });
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
  f.media.describeTranscriptionAudio = f.media.deriveTranscriptionAudio = () => { throw Error('HTTP proposal/review cannot prepare provider audio'); };
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

test('authenticated options and proposal reads create no request, session, hold, authority or media work', async t => {
  const f = await setup(t), before = allRows(f), calls = f.provider.acceptedCount();
  for (const path of ['/transcription-options', PROPOSALS]) {
    assert.equal((await f.request(path, undefined, { headers: { authorization: '' } })).statusCode, 403);
    assert.equal((await f.request(path, undefined, { headers: { origin: 'https://foreign.example' } })).statusCode, 403);
    const res = await f.request(path); assert.equal(res.statusCode, 200, res.body);
    assert.ok(!res.body.includes(f.root)); assert.ok(!res.body.includes('OPENSLATE_OPENAI_API_KEY')); assert.ok(res.rawPayload.length <= 64 * 1024);
  }
  assert.deepEqual(allRows(f), before); assert.equal(f.provider.acceptedCount(), calls); noSpending(f);
});

test('HTTP upload-first preparation creates only its exact ungranted proposal without any script or canonical acceptance', async t => {
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

test('strict authenticated HTTP rejects forged authority, malformed input and foreign or stale sessions before writes', async t => {
  const f = await setup(t), session = await f.session(), input = f.prepareBody(session), before = allRows(f);
  for (const patch of [{ actor: actor(session) }, { principalId: 'local-user' }, { requestId: session.requestId }, { key: 'body-key' }, { path: f.originalPath },
    { sourceRecordDigest: 'bad' }, { expectedHeadVersion: -1 }, { target: { kind: 'recording', segmentId: 'inferred' } }])
    assert.equal((await f.request(PROPOSALS, { ...input, ...patch })).statusCode, 400);
  assert.equal((await f.request(PROPOSALS, input, { headers: { authorization: '' } })).statusCode, 403);
  assert.equal((await f.request(PROPOSALS, input, { headers: { origin: 'https://foreign.example' } })).statusCode, 403);
  assert.equal((await f.request(PROPOSALS, input, { headers: { 'idempotency-key': '' } })).statusCode, 400);
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

test('human HTTP review appends one reviewed transcription while retaining the full active plan and existing outputs', async t => {
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
  for (const patch of [{ actor: actor(session) }, { requestId: session.requestId }, { key: 'body-key' }, { proposalDigest: 'bad' }])
    assert.equal((await f.request(REVIEWS, { ...input, ...patch })).statusCode, 400);
  const other = f.production.createProject('Other'); assert.equal((await f.request(REVIEWS, input, { url: `/api/projects/${other.id}/narration${REVIEWS}` })).json().error.code, 'NARRATION_SESSION_STALE');
  await f.session({ continuationSessionId: session.id }); assert.equal((await f.request(REVIEWS, input, { headers })).json().error.code, 'NARRATION_SESSION_STALE'); noSpending(f);
});

for (const boundary of ['event', 'command']) test(`review ${boundary} failure rolls back publication and exact retry creates one receipt`, async t => {
  const f = await setup(t), session = await f.session(), { proposal } = await f.propose(session), input = f.reviewBody(session, proposal), headers = { 'idempotency-key': `rollback-${boundary}` };
  const before = allRows(f); let intercepted = 0, restore;
  if (boundary === 'event') {
    const original = f.store.appendEvent.bind(f.store); f.store.appendEvent = (...args) => { if (args[1] === 'narration.transcription_reviewed') { intercepted++; throw Error('INJECTED_HTTP_REVIEW_EVENT'); } return original(...args); };
    restore = () => { f.store.appendEvent = original; };
  } else {
    f.store.db.exec("CREATE TEMP TRIGGER fail_owned_http_command BEFORE INSERT ON commands WHEN NEW.actor_scope LIKE '%:owned-transcription-review' BEGIN SELECT RAISE(ABORT,'INJECTED_HTTP_REVIEW_COMMAND'); END");
    restore = () => f.store.db.exec('DROP TRIGGER fail_owned_http_command');
  }
  let response; try { response = await f.request(REVIEWS, input, { headers }); } finally { restore(); }
  assert.equal(response.statusCode, 500, response.body); if (boundary === 'event') assert.equal(intercepted, 1); assert.deepEqual(allRows(f), before);
  response = await f.request(REVIEWS, input, { headers }); assert.equal(response.statusCode, 200, response.body);
  assert.equal(rows(f, 'owned_transcription_review').length, 1); assert.equal(rows(f, 'owned_transcription_application').length, 1);
  const saved = allRows(f); assert.deepEqual((await f.request(REVIEWS, input, { headers })).json(), response.json()); assert.deepEqual(allRows(f), saved); noSpending(f);
});

test('explicit current request continuation transfers only named holds and session replay keeps its original identity', async t => {
  const f = await setup(t), old = await f.session(), oldHolds = rows(f, 'hold').filter(hold => hold.ownerId === old.requestId);
  const current = f.production.beginRequest(f.project.id, 'local-user', 'Transcribe this uploaded recording.'), currentHolds = rows(f, 'hold').filter(hold => hold.ownerId === current.requestId);
  assert.ok(oldHolds.some(hold => hold.active)); assert.ok(currentHolds.some(hold => hold.active));
  const beforeRead = allRows(f), view = await f.request(); assert.equal(view.statusCode, 200, view.body);
  assert.deepEqual(view.json().continuationRequest, { id: current.requestId, text: 'Transcribe this uploaded recording.' });
  await f.request('/transcription-options'); await f.request(PROPOSALS); assert.deepEqual(allRows(f), beforeRead);
  const missing = await f.request('/sessions', { continuationRequestId: current.requestId }); assert.notEqual(missing.statusCode, 200);
  const input = { continuationSessionId: old.id, continuationRequestId: current.requestId }, headers = { 'idempotency-key': 'continue-current-request' };
  const response = await f.request('/sessions', input, { headers }); assert.equal(response.statusCode, 200, response.body); const next = response.json().session;
  for (const hold of oldHolds) assert.equal(f.store.get('hold', hold.id).active, hold.active, 'unselected previous session holds stay untouched');
  for (const hold of currentHolds) assert.equal(f.store.get('hold', hold.id).active, false);
  const transferred = rows(f, 'request_continuation').filter(row => row.toRequestId === next.requestId); assert.equal(transferred.length, 1); assert.equal(transferred[0].fromRequestId, current.requestId);
  f.production.beginRequest(f.project.id, 'local-user', 'Later independent request.'); const beforeReplay = allRows(f);
  const replay = await f.request('/sessions', input, { headers }); assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().session.id, next.id); assert.equal(replay.json().session.requestId, next.requestId); assert.equal(replay.json().session.state, 'stale');
  assert.deepEqual(allRows(f), beforeReplay); assert.equal((await f.request('/sessions', { ...input, text: 'Different intent' }, { headers })).json().error.code, 'IDEMPOTENCY_CONFLICT');
});

for (const invalid of ['foreign', 'wrong-principal', 'read-only', 'shot-scope', 'superseded'])
test(`explicit request continuation rejects ${invalid} authority without transferring holds`, async t => {
  const f = await setup(t, { plan: true }), old = await f.session(); let prior;
  if (invalid === 'foreign') { const other = f.production.createProject('Foreign'); prior = f.production.beginRequest(other.id, 'local-user', 'Foreign request.'); }
  else prior = f.production.beginRequest(f.project.id, invalid === 'wrong-principal' ? 'different-user' : 'local-user', 'Explicit continuation candidate.',
    { editing: invalid !== 'read-only', ...(invalid === 'shot-scope' ? { scopeIds: [f.store.getProject(f.project.id).shots[0].id] } : {}) });
  if (invalid === 'superseded') f.production.beginRequest(f.project.id, 'local-user', 'Newer current request.');
  const before = allRows(f), response = await f.request('/sessions', { continuationSessionId: old.id, continuationRequestId: prior.requestId });
  assert.notEqual(response.statusCode, 200, response.body); assert.deepEqual(allRows(f), before);
});

for (const action of ['prepare', 'review']) test(`real HTTP disconnect cancels original ${action} before publication and drains the handler`, { timeout: 15000 }, async t => {
  const f = await setup(t), session = await f.session(), proposal = action === 'review' ? (await f.propose(session)).proposal : null;
  const body = action === 'prepare' ? f.prepareBody(session) : f.reviewBody(session, proposal), path = action === 'prepare' ? PROPOSALS : REVIEWS;
  const entered = latch(), released = latch(), finished = latch(), original = f.media.verifiedSource.bind(f.media), run = f.service[action].bind(f.service); let capturedSignal;
  f.media.verifiedSource = async (...args) => { const verified = await original(...args); capturedSignal = args[1]?.signal; entered.release(); await released.promise; return verified; };
  f.service[action] = async (...args) => { try { return await run(...args); } finally { finished.release(); } };
  const before = allRows(f), address = await f.app.listen({ host: '127.0.0.1', port: 0 }), payload = JSON.stringify(body);
  const request = httpRequest(`${address}${f.base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`,
    'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), 'idempotency-key': `disconnect-${action}` } });
  request.on('error', () => {}); request.on('response', response => response.resume()); request.end(payload);
  try {
    await entered.promise; assert.ok(capturedSignal instanceof AbortSignal); const aborted = capturedSignal.aborted ? Promise.resolve() : new Promise(resolve => capturedSignal.addEventListener('abort', resolve, { once: true }));
    request.destroy(); await aborted; assert.equal(capturedSignal.aborted, true);
  } finally { request.destroy(); released.release(); await finished.promise; }
  assert.deepEqual(allRows(f), before); assert.equal(rows(f, 'owned_transcription_review').length, 0); noSpending(f);
});

test('options report exact supported saved profile and proposal list guards its bounded page identity', async t => {
  const f = await setup(t), session = await f.session(), first = await f.propose(session), second = await f.propose(session, { language: 'en' });
  const before = allRows(f), options = await f.request('/transcription-options'); assert.equal(options.statusCode, 200, options.body);
  assert.deepEqual(options.json().profiles, [{ id: f.profile.id, revision: f.profile.revision, provider: 'OpenAI', model: 'whisper-1', estimatedMicros: '100', currency: 'USD' }]);
  assert.ok(options.json().languages.includes('auto')); assert.ok(options.json().languages.includes('en')); assert.equal(options.json().timing, 'word');
  assert.equal(options.json().capabilities.configured, true); assert.equal(options.json().capabilities.directorToolAvailable, false);
  const response = await f.request(PROPOSALS), page = response.json(); assert.equal(response.statusCode, 200, response.body);
  assert.equal(page.coverage.total, 2); assert.equal(page.coverage.nextOffset, null);
  assert.deepEqual(new Set(page.proposals.map(item => item.id)), new Set([first.proposal.id, second.proposal.id]));
  for (const item of page.proposals) { assert.equal(item.unavailableCode, null); assert.equal(item.proposal.proposalDigest, digest(f.store.get('owned_transcription_proposal', item.id))); }
  const detail = await f.request(`${PROPOSALS}/${first.proposal.id}`); assert.equal(detail.statusCode, 200, detail.body);
  assert.deepEqual(detail.json().proposal, first.response.json().proposal); assert.deepEqual(detail.json().eligibility, { current: true, code: null });
  assert.equal(detail.json().application, null); assert.equal(detail.json().execution.state, 'not_applied');
  for (const query of ['?offset=-1', '?offset=10000000', '?expectedDigest=bad', '?path=/tmp/file', '?actor=human']) assert.equal((await f.request(`${PROPOSALS}${query}`)).statusCode, 400);
  assert.equal((await f.request('/transcription-options?actor=human')).statusCode, 400);
  assert.equal((await f.request(`${PROPOSALS}/${first.proposal.id}?actor=human`)).statusCode, 400); assert.deepEqual(allRows(f), before);
  await f.propose(session, { language: 'fr' });
  const stale = await f.request(`${PROPOSALS}?offset=1&expectedDigest=${page.coverage.dataDigest}`); assert.equal(stale.statusCode, 409, stale.body);
});

test('unconfigured owned service stays readable and refuses preparation without authority or media work', async t => {
  const f = await setup(t, { available: false }), session = await f.session(), before = allRows(f), options = await f.request('/transcription-options');
  assert.equal(options.statusCode, 200, options.body); assert.equal(options.json().capabilities.configured, false);
  assert.equal((await f.request(PROPOSALS)).statusCode, 200);
  const response = await f.request(PROPOSALS, f.prepareBody(session)); assert.equal(response.json().error.code, 'NARRATION_MEDIA_UNAVAILABLE');
  assert.deepEqual(allRows(f), before); noSpending(f);
});

test('quarantined restoration retains read-only recording options and proposal history while all related writes stay blocked', async t => {
  const f = await setup(t), session = await f.session(), { proposal } = await f.propose(session);
  installRecoveryQuarantine(f.store, { restoreId: key(), backupId: key(), backupManifestSha256: 'a'.repeat(64), sourceDatabaseSha256: 'b'.repeat(64),
    originalDataRoot: f.root, backupCreatedAt: '2026-09-12T00:00:00.000Z', restoredAt: '2026-09-13T00:00:00.000Z' });
  const before = allRows(f), changes = f.store.db.prepare('SELECT total_changes() n').get().n;
  for (const path of ['', '/transcription-options', PROPOSALS, `${PROPOSALS}/${proposal.id}`]) {
    const response = await f.request(path); assert.equal(response.statusCode, 200, response.body);
  }
  for (const [path, body] of [[PROPOSALS, f.prepareBody(session)], [REVIEWS, f.reviewBody(session, proposal)], ['/sessions', { continuationSessionId: session.id }]]) {
    const response = await f.request(path, body); assert.equal(response.json().error.code, 'INSTALLATION_QUARANTINED');
  }
  assert.deepEqual(allRows(f), before); assert.equal(f.store.db.prepare('SELECT total_changes() n').get().n, changes); noSpending(f);
});

test('spending eligibility follows only the exact reviewed section while same-head unrelated edits remain selectable', async t => {
  const f = await setup(t, { section: true, spending: true }), session = await f.session(), { proposal } = await f.propose(session);
  const reviewed = await f.review(session, proposal); assert.equal(reviewed.statusCode, 200, reviewed.body);
  const { candidateId } = reviewed.json().receipt, head = f.store.getProject(f.project.id).headVersion;
  async function spending() {
    const before = allRows(f), response = await f.request('', undefined, { url: `/api/projects/${f.project.id}/spending?focusCandidateId=${candidateId}` });
    assert.equal(response.statusCode, 200, response.body); assert.deepEqual(allRows(f), before); noSpending(f);
    assert.deepEqual(response.json().focus, { candidateId, found: true });
    const selection = response.json().candidates.find(value => value.candidateId === candidateId); assert.ok(selection); return selection;
  }
  let selection = await spending(); assert.equal(selection.selectionCurrent, true); assert.equal(selection.suggestedForIssue, true); assert.equal(selection.unavailableCode, null);
  editSection(f, session, 1); assert.equal(f.store.getProject(f.project.id).headVersion, head);
  selection = await spending(); assert.equal(selection.selectionCurrent, true); assert.equal(selection.suggestedForIssue, true); assert.equal(selection.unavailableCode, null);
  editSection(f, session, 0); assert.equal(f.store.getProject(f.project.id).headVersion, head);
  selection = await spending(); assert.equal(selection.selectionCurrent, false); assert.equal(selection.suggestedForIssue, false);
  assert.equal(selection.unavailableCode, 'SUBMISSION_PREPARATION_OBSOLETE'); assert.equal(selection.matchingAllowanceCount, 0);
});
