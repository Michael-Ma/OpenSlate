import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { ExecutionRegistry, FakeProvider, registerExecutionProvider } from '../../../packages/providers/dist/index.js';
import { compilePlan, composeScenePlan, DEFAULT_PROFILES, digest, shotIntentDigest } from '../../../packages/core/dist/index.js';
import { projectFixture } from './execution-fixture.mjs';

function fixture(t, external = false) {
  const directory = mkdtempSync(join(tmpdir(), 'openslate-undercoverage-'));
  const store = new Store(join(directory, 'store.sqlite')), fake = new FakeProvider(join(directory, 'fake.sqlite'));
  let admissions = 0, submits = 0;
  const profiles = structuredClone(DEFAULT_PROFILES), video = profiles.find(profile => profile.kind === 'video');
  video.maxFrames = 180;
  let provider = fake;
  if (external) {
    Object.assign(video, { adapter: 'offline-video', executionVersion: '1', configuration: { model: 'offline-video', settings: {} } });
    const port = registerExecutionProvider({
      async submit() { submits++; throw new Error('Short video must never submit'); },
      async poll() { throw new Error('Short video must never poll'); },
      async lookup() { throw new Error('Short video must never reconcile'); },
    }, { adapter: 'offline-video', version: '1' });
    provider = new ExecutionRegistry([fake, port]);
  }
  const engine = new Engine(store, provider, { artifactDir: join(directory, 'artifacts'), profiles,
    externalAdmission: { authorize() { admissions++; return {}; } } });
  const service = new ProductionService(store, engine), created = service.createProject('Deferred video fixture');
  const lockId = randomUUID();
  store.insert('capability_lock', lockId, created.id, { ...store.get('capability_lock', created.capabilityLockId), id: lockId, profiles });
  const shape = projectFixture(created.id, 1);
  const project = { ...created, ...shape, capabilityLockId: lockId,
    shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) };
  const saved = store.saveProject({ ...project, headVersion: 0 }, 0);
  const logicalIds = {};
  t.after(() => { store.close(); fake.close(); rmSync(directory, { recursive: true, force: true }); });
  const source = current => 'definePlan({baseRevision:' + JSON.stringify(current.revisionId) + '},p=>{'
    + 'const shot=p.shot("shot-0");const image=p.image("image",{intent:shot,profile:"fake-image-v1",prompt:' + JSON.stringify(current.shots[0].imagePrompt) + '});'
    + 'const review=p.humanReview("review",{shots:[{intent:shot,keyframe:image,videoProfile:"fake-video-v1",motionPrompt:' + JSON.stringify(current.shots[0].videoPrompt) + ',seconds:6}]});'
    + 'return p.video("video",{intent:shot,profile:"fake-video-v1",firstFrame:p.approvedImage(image,review),prompt:' + JSON.stringify(current.shots[0].videoPrompt) + ',seconds:6});});';
  const install = current => {
    const compiled = compilePlan(source(current), { project: current, profiles, logicalIds, allocateId: randomUUID }), grants = {};
    for (const node of compiled.nodes) grants[node.id] = engine.createGrant(current.id, 'shot-0', node.kind, 'initial-fixture').id;
    const id = randomUUID(); store.transaction(() => { engine.installPlan(current.id, id, compiled, grants); store.saveProject({ ...current, activePlanId: id }, current.headVersion); });
    return compiled;
  };
  return { store, engine, fake, service, profiles, project: saved, logicalIds, install,
    counts: () => ({ admissions, submits }) };
}

test('short symbolic video cannot reach external admission, reservation, attempt or provider submission', async t => {
  const f = fixture(t, true), project = f.store.getProject(f.project.id), shot = project.shots[0];
  shot.desiredFrames = 240; shot.promptIntent.video = shotIntentDigest(shot, 'video');
  const saved = f.store.saveProject(project, project.headVersion), compiled = f.install(saved);
  const video = compiled.nodes.find(node => node.kind === 'video');
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  const result = await f.engine.runReady();
  assert.equal(result.dispatched, 0); assert.ok(result.blocked.some(item => item.nodeId === video.id && item.code === 'TIMING_REQUIRED'), JSON.stringify(result.blocked));
  assert.equal(f.engine.attempts(project.id).filter(attempt => attempt.nodeId === video.id).length, 0);
  assert.equal(f.store.list('reservation', project.id).length, 1, 'Only the completed fake image reserved work');
  assert.deepEqual(f.counts(), { admissions: 0, submits: 0 }); assert.equal(f.fake.acceptedCount(), 1);
});

test('image-only scene publication creates no new video grant or candidate for the retained short recipe', async t => {
  const f = fixture(t), base = f.install(f.project), project = f.store.getProject(f.project.id), shot = project.shots[0];
  shot.desiredFrames = 240; shot.imagePrompt = 'New frame for the longer shot'; shot.videoPrompt = 'Longer move'; shot.revisionId = randomUUID();
  shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') };
  project.revisionId = randomUUID(); const saved = f.store.saveProject(project, project.headVersion);
  const compiled = composeScenePlan(base, [{ shotId: shot.id, kind: 'image', profileId: 'fake-image-v1' }], { project: saved, profiles: f.profiles, logicalIds: f.logicalIds, allocateId: randomUUID });
  const actor = f.service.beginRequest(project.id, 'local-user', 'Create this scene’s keyframes', { editing: true, scopeIds: [shot.sceneId] });
  f.service.authorize(project.id, actor, [{ scopeId: shot.id, kind: 'image' }], 'image-only');
  const oldVideoGrants = f.store.list('grant', project.id).filter(grant => grant.kind === 'video').length;
  f.store.transaction(() => f.service.applyCompiledSceneGeneration(project.id, actor, compiled, f.logicalIds, saved.headVersion,
    digest(f.store.get('capability_lock', saved.capabilityLockId)), 'image'));
  const video = compiled.nodes.find(node => node.kind === 'video');
  assert.equal(f.store.get('node_binding', video.id).candidateId, null);
  assert.equal(f.store.list('grant', project.id).filter(grant => grant.kind === 'video').length, oldVideoGrants);
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  assert.equal(f.engine.attempts(project.id).filter(attempt => attempt.nodeId === video.id).length, 0);
  assert.equal(f.fake.acceptedCount(), 1);
});
