import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { FakeWorkflowDirector } from '../dist/application/fake-director.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createApp } from '../dist/app.js';
import { projectFixture } from './execution-fixture.mjs';

function writable(path) {
  chmodSync(path, 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}

function fixture(t, { toolContract = '6.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-fake-confirm-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), service = new ProductionService(store, engine);
  let project = service.createProject('Scripted video confirmation');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.insert('project_revision', project.revisionId, project.id, { project });
  const token = 'fake_confirmation_fixture_token', app = createApp({ service, localToken: token });
  const http = (method, path, payload) => app.inject({ method, url: `/api/projects/${project.id}${path}`,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, ...(payload ? { payload } : {}) });
  const finish = async () => { for (let i = 0; i < 6; i++) { await engine.runReady(); await engine.reconcile(); } };
  const readyScene = async (sceneId = 'scene-0', { open = true } = {}) => {
    const view = (await http('GET', `/scenes/${sceneId}/generation`)).json();
    const press = await http('POST', `/scenes/${sceneId}/generate`, { kind: 'image', headVersion: view.headVersion,
      revisionId: view.revisionId, reviewedHoldDigest: view.reviewedHoldDigest,
      reviewedControlAuthorityId: view.reviewedControlAuthorityId, reviewedFrames: [] });
    assert.equal(press.statusCode, 200, press.body);
    await finish();
    if (open) for (const row of (await http('GET', `/scenes/${sceneId}/generation`)).json().rows) {
      const viewed = await http('POST', `/shots/${row.shotId}/frame-views`, { artifactId: row.image.artifactId, sha256: row.image.sha256 });
      assert.equal(viewed.statusCode, 200, viewed.body);
    }
  };
  const run = async ({ scope = ['scene-0'], text = 'Make video for this scene', editing = true, review = false } = {}) => {
    const human = service.beginRequest(project.id, 'local-user', text, { source: review ? 'app' : 'user', editing, scopeIds: scope });
    if (review) store.insert('keyframe_review_request', human.requestId, project.id, { requestId: human.requestId, sceneId: 'scene-0' });
    const bridge = service.openEpoch(project.id, human);
    const turn = { id: randomUUID(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, state: 'running' };
    store.insert('director_turn', turn.id, project.id, turn);
    const prepare = createDirectorInput(service, { repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)),
      snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3196', defaultToolContract: toolContract });
    const input = prepare(turn, human, bridge), before = mediaState();
    const result = await new FakeWorkflowDirector(service).start(input);
    await finish();
    assert.deepEqual(mediaState(), before, 'offering a choice cannot create grants, attempts, candidates, confirmations or charges');
    return { result, turn, bridge, notes: service.snapshot(project.id).notes };
  };
  const mediaState = () => ({ accepted: provider.acceptedCount(), attempts: engine.attempts(project.id),
    candidates: store.list('candidate', project.id), grants: store.list('grant', project.id),
    confirmations: store.list('scene_confirmation', project.id), budget: engine.budget(project.id), outputs: engine.outputs(project.id) });
  t.after(async () => { await app.close(); store.close(); provider.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  return { store, service, project, readyScene, run };
}

test('V6 scripted video request offers an in-scope ready scene confirmation in chat without spending', async t => {
  const f = fixture(t); await f.readyScene(); await f.readyScene('scene-1');
  const { result, turn, notes } = await f.run();
  assert.equal(result.status, 'completed');
  assert.match(result.text, /confirm video in the chat or in Keyframes/);
  assert.match(result.text, /No video has started/);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].anchor, { sceneId: 'scene-0' });
  assert.deepEqual(notes[0].choices, [{ kind: 'confirm_video', sceneId: 'scene-0' }, { kind: 'reply' }]);
  assert.equal(notes[0].state, 'open'); assert.equal(notes[0].blocking, false);
  const calls = f.store.list('tool_invocation', f.project.id).filter(call => call.requestId === turn.requestId);
  assert.deepEqual(calls.map(call => call.tool), ['read_context', 'record_notes']);
  assert.ok(calls.every(call => call.state === 'succeeded'));
});

test('V6 project-scoped scripted video request offers a separate choice for every ready scene', async t => {
  const f = fixture(t); await f.readyScene(); await f.readyScene('scene-1');
  const { notes } = await f.run({ scope: [f.project.id] });
  assert.deepEqual(notes.map(note => note.anchor), [{ sceneId: 'scene-0' }, { sceneId: 'scene-1' }]);
  assert.deepEqual(notes.map(note => note.choices[0]), [{ kind: 'confirm_video', sceneId: 'scene-0' }, { kind: 'confirm_video', sceneId: 'scene-1' }]);
});

test('V6 keyframe-review turn can offer a ready scene confirmation while its epoch remains read-only', async t => {
  const f = fixture(t); await f.readyScene();
  const { bridge, notes } = await f.run({ editing: false, review: true, scope: ['shot-0'] });
  assert.equal(f.store.get('epoch', bridge.actor.epochId).state, 'read_only');
  assert.deepEqual(notes[0].anchor, { shotIds: ['shot-0'] });
  assert.deepEqual(notes[0].choices[0], { kind: 'confirm_video', sceneId: 'scene-0' });
  assert.equal(notes.length, 1);
});

for (const state of ['missing', 'unopened']) test(`V6 scripted video request with ${state} frames keeps the existing review without a confirmation choice`, async t => {
  const f = fixture(t);
  if (state === 'unopened') await f.readyScene('scene-0', { open: false });
  const { result, notes } = await f.run();
  assert.match(result.text, /Scripted demo review/);
  assert.equal(notes.length, 2); assert.ok(notes.every(note => note.choices.every(choice => choice.kind !== 'confirm_video')));
});

test('V5 ready-scene request preserves its historical scripted review choices', async t => {
  const f = fixture(t, { toolContract: '5.0.0' }); await f.readyScene();
  const { notes } = await f.run();
  assert.equal(notes.length, 2); assert.ok(notes.every(note => note.choices.every(choice => choice.kind !== 'confirm_video')));
});

test('ordinary read-only chat cannot offer the new video confirmation choice', async t => {
  const f = fixture(t); await f.readyScene();
  const { notes } = await f.run({ editing: false });
  assert.equal(notes.length, 2); assert.ok(notes.every(note => note.choices.every(choice => choice.kind !== 'confirm_video')));
});

for (const text of ['ok', 'go ahead']) test(`ambiguous scripted chat reply ${JSON.stringify(text)} never confirms or starts video`, async t => {
  const f = fixture(t); await f.readyScene();
  const { notes } = await f.run({ text });
  assert.ok(notes.every(note => note.choices.every(choice => choice.kind !== 'confirm_video')));
  assert.equal(f.store.list('scene_confirmation', f.project.id).length, 0);
});
