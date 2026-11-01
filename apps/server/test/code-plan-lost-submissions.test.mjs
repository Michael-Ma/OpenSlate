import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { digest } from '@openslate/core';
import { realCodeFixture, videoProfile } from './code-plan-providers-fixture.mjs';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { ViggleH3Execution } from '../dist/execution/viggle-h3-execution.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';

const kind = 'viggle_h3_submission_settlement';
const source = `export default async function(ctx){await ctx.video({model:'${videoProfile.id}',prompt:'Camera follows the walking person',durationSeconds:3,aspectRatio:'16:9'});}`;
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const list = (items = [], has_more = false) => json({ items, has_more, ignored: { message: 'never retain this' } });
const task = (id, milliseconds) => ({ id, created_at: new Date(Math.floor(milliseconds / 1000) * 1000).toISOString().replace('.000Z', 'Z'), status: 'queued' });
const reset = () => new TypeError('do not persist this message or https://secret.invalid', {
  cause: Object.assign(new Error('private cause message'), { code: 'ECONNRESET', syscall: 'read' }),
});
async function fixture(t, response = () => list()) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await realCodeFixture(t), working = f.viggleFetch;
  f.count = { posts: 0, lists: 0 }; f.listLimits = [];
  f.viggleFetch = async (url, init) => {
    if (init.method === 'POST') { if (++f.count.posts === 1) throw reset(); return working(url, init); }
    if (url.includes('?')) {
      f.count.lists++; f.listLimits.push(Number(new URL(url).searchParams.get('limit')));
      return response(f, f.count.lists);
    }
    return working(url, init);
  };
  f.step = () => f.plans.steps(f.project.id).filter(row => row.kind === 'video').at(-1);
  f.attempt = () => f.store.get('attempt', f.step().attemptId);
  f.settlement = () => f.store.list(kind, f.project.id)[0];
  f.advance = async ms => { t.mock.timers.tick(ms); await f.tick(); };
  f.start = async () => { await f.submit(source); await f.tick(); };
  return f;
}
function consent(f) {
  assert.equal(f.attempt().phase, 'failed');
  assert.deepEqual(f.execution.failure(f.attempt().id), { code: 'SUBMISSION_RESPONSE_LOST', retry: 'consent', mayHaveCharged: true });
  assert.equal(f.execution.liability(f.attempt().id), 'charged'); assert.equal(f.count.posts, 1);
  assert.equal(f.attempt().taskId, null);
}

test('lost create with two empty windows releases liability and automatically creates exactly one retry task', async t => {
  const f = await fixture(t); await f.start(); const original = f.attempt().id;
  assert.equal(f.attempt().phase, 'submission_unknown'); assert.equal(f.count.lists, 0);
  await f.advance(9999); assert.equal(f.count.lists, 0);
  await f.advance(1); assert.equal(f.count.lists, 1); assert.equal(f.settlement().checks[0].result, 'clear');
  await f.advance(19999); assert.equal(f.count.lists, 1); assert.equal(f.count.posts, 1);
  await f.advance(1); assert.equal(f.count.lists, 2);
  assert.equal(f.execution.liability(original), 'released');
  assert.deepEqual(f.execution.failure(original), { code: 'VIGGLE_H3_NO_TASK_CREATED', retry: 'safe', mayHaveCharged: false });
  assert.equal(f.plans.view(f.project.id).spentMicros, '0');
  const bridge = f.mediaRuntime.registry.resolve({ adapter: 'viggle-h3', version: '1' });
  assert.equal((await bridge.lookup(original)).type, 'rejected', 'settled evidence replays after the attempt becomes terminal');
  const row = f.store.get('viggle_h3_execution_submit', original);
  assert.deepEqual(Object.fromEntries(Object.entries(row.observation.error).filter(([key]) => ['errorName', 'causeCode', 'causeName', 'causeSyscall'].includes(key))),
    { errorName: 'TypeError', causeCode: 'ECONNRESET', causeName: 'Error', causeSyscall: 'read' });
  assert.equal(JSON.stringify(row).includes('private'), false); assert.equal(JSON.stringify(row).includes('https:'), false);
  await f.advance(500); await f.finish();
  assert.equal(f.step().state, 'succeeded'); assert.equal(f.count.posts, 2); assert.equal(f.calls.video, 1);
  assert.equal(f.plans.view(f.project.id).spentMicros, '60000');
  await f.restart(); await f.tick(); assert.equal(f.count.posts, 2); assert.equal(f.count.lists, 2);
});

for (const inCheck of [1, 2]) test(`a stranger in check ${inCheck} retains possible charges without adoption or automatic create`, async t => {
  const f = await fixture(t, (f, count) => list(count === inCheck ? [task('vid_other_studio', Date.now() - 60000)] : []));
  await f.start(); await f.advance(10000); if (inCheck === 2) await f.advance(20000);
  consent(f); assert.equal(f.count.lists, inCheck); assert.equal(f.settlement().checks.at(-1).result, 'stranger');
  await f.restart(); await f.advance(120000); consent(f); assert.equal(f.count.lists, inCheck);
});

test('a task from another project in this installation is an owned sibling, not a stranger', async t => {
  const f = await fixture(t, () => list([task('vid_sibling', Date.now())]));
  const catalog = f.mediaRuntime.providerCatalog;
  const sibling = f.service.createProject('Sibling film', catalog.select(catalog.digest, [videoProfile.id]), 'graph');
  f.store.saveProject({ ...sibling, planMode: 'code' }, sibling.headVersion);
  const working = f.viggleFetch;
  f.viggleFetch = async () => json({ id: 'vid_sibling', status: 'queued' });
  await f.plans.submit(sibling.id, { source, author: 'user', basedOnVersion: null, invocationId: 'sibling' });
  await f.tick();
  f.viggleFetch = (url, init) => url.endsWith('/vid_sibling') ? Promise.resolve(json({ id: 'vid_sibling', status: 'processing' })) : working(url, init);
  assert.equal(f.store.list('viggle_h3_execution_submit', sibling.id)[0].observation.taskId, 'vid_sibling');
  await f.start(); await f.advance(10000); await f.advance(20000);
  assert.equal(f.execution.liability(f.attempt().id), 'released'); assert.ok(f.settlement().checks.every(row => row.result === 'clear'));
  assert.deepEqual(f.settlement().checks[0].ownedTaskIds, ['vid_sibling']); assert.equal(f.count.posts, 1);
});

for (const mode of ['list error', 'malformed list', 'unexhausted limit']) test(`${mode} stays consent-only`, async t => {
  const f = await fixture(t, (_f, count) => {
    if (mode === 'list error') throw Error('private list error');
    if (mode === 'malformed list') return json({ has_more: false, items: [{ id: 'vid_bad', created_at: 'invalid' }] });
    // The only visible recent task is our sibling. More unseen tasks keep coverage uncertain.
    return list([task('vid_offline_h3', Date.now())], true);
  });
  if (mode === 'unexhausted limit') {
    f.count.posts = 1; await f.start(); await f.finish();
    f.count.posts = 0;
    await f.submit(source.replace('Camera follows', 'Different camera follows')); await f.tick();
  } else await f.start();
  await f.advance(10000); consent(f);
  assert.equal(f.count.lists, mode === 'unexhausted limit' ? 3 : 1);
  if (mode === 'unexhausted limit') assert.deepEqual(f.listLimits, [12, 24, 36]);
});

test('older tasks exhaust the skew window even when the account has more historical pages', async t => {
  const f = await fixture(t, () => list([task('vid_old_studio', Date.now() - 120000)], true));
  await f.start(); await f.advance(10000); await f.advance(20000);
  assert.equal(f.execution.liability(f.attempt().id), 'released'); assert.equal(f.count.lists, 2);
});

for (const found of ['old boundary', 'stranger']) test(`an expanded account prefix finds the ${found}`, async t => {
  const f = await fixture(t, (f, count) => {
    const own = task('vid_offline_h3', Date.now());
    if (f.listLimits.at(-1) === 12) return list([own], true);
    return list([own, task(found === 'stranger' ? 'vid_external' : 'vid_old', Date.now() - (found === 'stranger' ? 0 : 180000))], true);
  });
  f.count.posts = 1; await f.start(); await f.finish(); f.count.posts = 0;
  await f.submit(source.replace('Camera follows', 'Another camera follows')); await f.tick(); await f.advance(10000);
  if (found === 'stranger') { consent(f); assert.deepEqual(f.listLimits, [12, 24]); }
  else {
    await f.advance(20000); assert.equal(f.execution.liability(f.attempt().id), 'released');
    assert.deepEqual(f.listLimits, [12, 24, 12, 24]);
  }
});

test('restart between clear checks preserves timing, evidence and release result', async t => {
  const f = await fixture(t); await f.start(); await f.advance(10000);
  const first = structuredClone(f.settlement()); await f.restart(); await f.tick();
  assert.deepEqual(f.settlement(), first); assert.equal(f.count.lists, 1);
  await f.advance(20000); assert.equal(f.execution.liability(f.attempt().id), 'released'); assert.equal(f.count.posts, 1);
  const destination = `${f.root}-backup`; t.after(() => rmSync(destination, { recursive: true, force: true }));
  await f.store.db.backup(join(f.root, 'openslate.sqlite')); await f.fake.db.backup(join(f.root, 'fake-provider.sqlite'));
  const exported = await createInstallationBackup({ sourceRoot: f.root, destination });
  await inspectInstallationBackup({ directory: exported.directory });
  const row = f.settlement();
  assert.throws(() => f.store.put(kind, row.id, row.projectId, { ...row, checks: [] }), { code: 'VIGGLE_H3_EXECUTION_CONFLICT' });
});

test('a restart after interrupted check publication resumes an expired claim and still requires two separated reads', async t => {
  const f = await fixture(t); await f.start();
  const put = f.store.put.bind(f.store);
  f.store.put = (...args) => { if (args[0] === kind && args[3].checks.length) throw Error('worker interrupted before check publication'); return put(...args); };
  await f.advance(10000); f.store.put = put;
  const claimed = f.settlement(); assert.equal(claimed.checks.length, 0); assert.ok(claimed.claimId);
  await f.restart(); await f.tick(); assert.equal(f.count.lists, 1);
  await f.advance(claimed.claimMs); assert.equal(f.count.lists, 2); assert.equal(f.settlement().checks.length, 1);
  await f.tick(); assert.equal(f.count.lists, 2, 'missed checks must not run back-to-back');
  await f.advance(20000); assert.equal(f.execution.liability(f.attempt().id), 'released'); assert.equal(f.count.posts, 1);
});

for (const status of [200, 400, 500]) test(`an HTTP ${status} response skips settlement`, async t => {
  const f = await fixture(t); f.viggleFetch = async (_url, init) => { assert.equal(init.method, 'POST'); f.count.posts++;
    return new Response(JSON.stringify({ unexpected: true }), { status, headers: { 'content-type': 'application/json' } }); };
  await f.start(); consent(f); assert.equal(f.settlement(), undefined); assert.equal(f.count.lists, 0);
  const original = structuredClone(f.attempt()); await f.restart(); await f.advance(120000); assert.deepEqual(f.attempt(), original);
});

test('a terminal no-status failure from before N8 stays unchanged without list calls', async t => {
  const f = await fixture(t); await f.start();
  const attempt = f.attempt(), record = f.store.get('code_plan_execution', attempt.id);
  const outcome = { type: 'failed', taskId: null, failureId: 'SUBMISSION_RESPONSE_LOST', technical: true, retryAllowed: false };
  f.store.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, attempt.id);
  f.store.put('code_plan_execution', attempt.id, f.project.id, { ...record, liability: 'charged', outcome, outcomeDigest: digest(outcome) });
  f.store.put('attempt', attempt.id, f.project.id, { ...attempt, phase: 'failed', failure: { id: outcome.failureId, technical: true, retryAllowed: false, source: 'viggle-h3_provider' } });
  await f.restart(); await f.advance(120000); consent(f);
  const bridge = f.mediaRuntime.registry.resolve({ adapter: 'viggle-h3', version: '1' });
  assert.deepEqual(await bridge.lookup(attempt.id), outcome); assert.equal(f.count.lists, 0); assert.equal(f.settlement(), undefined);
});

test('injected settlement intervals drive actual reads and invalid intervals are refused', async t => {
  const f = await fixture(t); const bridge = f.mediaRuntime.registry.resolve({ adapter: 'viggle-h3', version: '1' });
  const options = { store: f.store, outputStore: f.mediaRuntime.outputStore, artifactRoot: `${f.root}/artifacts`,
    credentials: new EnvironmentMediaCredentials(() => 'synthetic-fixture-key'), downloader: {},
    fetch: (...args) => f.viggleFetch(...args), now: () => Date.now(), settlementTiming: { firstMs: 100, secondMs: 300 } };
  const custom = new ViggleH3Execution(options);
  bridge.submit = custom.submit.bind(custom); bridge.lookup = custom.lookup.bind(custom);
  await f.start(); await f.advance(99); assert.equal(f.count.lists, 0);
  await f.advance(1); assert.equal(f.count.lists, 1);
  await f.advance(200); assert.equal(f.count.lists, 2); assert.equal(f.execution.liability(f.attempt().id), 'released');
  for (const timing of [{ firstMs: 0, secondMs: 30 }, { firstMs: 30, secondMs: 30 }, { firstMs: 10, secondMs: 600001 }])
    assert.throws(() => new ViggleH3Execution({ ...options, settlementTiming: timing }), { code: 'VIGGLE_H3_EXECUTION_CONFLICT' });
});
