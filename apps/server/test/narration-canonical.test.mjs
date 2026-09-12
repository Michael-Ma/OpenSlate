import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, chmod, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService } from '../dist/media/index.js';
import { NarrationService, NarrationCanonicalService } from '../dist/narration/index.js';
import { seedFixture } from '../dist/demo.js';
import { FakeProvider } from '@openslate/providers';

const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
let inputs, wav;
before(async () => { inputs = await mkdtemp(join(tmpdir(), 'openslate-canonical-input-')); wav = join(inputs, 'recording.wav'); await promisify(execFile)(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=44100:duration=14', '-c:a', 'pcm_s16le', wav], { timeout: 15000 }); });
after(async () => rm(inputs, { recursive: true, force: true }));
const code = expected => error => error?.code === expected;
const draft = (meaning, kind = 'uploaded') => ({ text: meaning, meaning, textKind: 'draft', language: 'en', source: kind === 'generated' ? { kind, voice: 'declared-external', profileRevisionId: 'external-unverified' } : { kind } });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-canonical-'));
  const store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') }), production = new ProductionService(store, engine);
  const project = seedFixture(production, dir), human = production.beginRequest(project.id, 'human', 'Use the accepted narration for this project');
  const actor = production.openEpoch(project.id, human).actor;
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration);
  const f = { dir, store, provider, engine, production, project, human, actor, media, narration, canonical };
  f.view = () => narration.snapshot(project.id, human);
  f.revise = patch => narration.reviseSegments(project.id, actor, f.view().state.version, randomUUID(), patch);
  f.place = placements => narration.placeSegments(project.id, actor, f.view().state.version, randomUUID(), placements);
  f.approve = segmentId => {
    let segment = f.view().segments.find(segment => segment.entry.segmentId === segmentId);
    narration.accept(project.id, human, f.view().state.version, randomUUID(), 'script', [segment.script.id]);
    narration.acceptAudio(project.id, human, f.view().state.version, randomUUID(), [{ segmentRevisionId: segment.script.id, audioId: segment.audio.id }]);
    segment = f.view().segments.find(segment => segment.entry.segmentId === segmentId);
    narration.accept(project.id, human, f.view().state.version, randomUUID(), 'timing', [segment.cue.id]);
  };
  f.cue = (segmentId, startSample, endSample) => narration.recordHumanCue(project.id, human, f.view().state.version, randomUUID(), { segmentId, startSample, endSample });
  f.prepare = (shotMappings = [], extra = {}) => canonical.prepare(project.id, actor, { expectedHeadVersion: store.getProject(project.id).headVersion, expectedNarrationVersion: f.view().state.version, shotMappings, key: randomUUID(), ...extra });
  f.apply = prepared => canonical.apply(project.id, actor, prepared.id);
  t.after(async () => { if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return f;
}
async function ready(f, mixed = false) {
  f.revise({ add: f.project.cues.map((cue, index) => draft(cue.meaning, mixed && index ? 'generated' : 'uploaded')) });
  const upload = await f.narration.importAudio(f.project.id, f.human, { path: wav, declaredOrigin: 'uploaded', key: 'uploaded' });
  const generated = mixed ? await f.narration.importAudio(f.project.id, f.human, { path: wav, declaredOrigin: 'generated', key: 'declared-generated' }) : upload;
  const ids = f.view().segments.map(segment => segment.entry.segmentId);
  for (const [index, segmentId] of ids.entries()) {
    f.narration.bindAudio(f.project.id, f.actor, f.view().state.version, randomUUID(), segmentId, (index ? generated : upload).id);
    f.cue(segmentId, (index * 6 + 1) * 48000, (index * 6 + 7) * 48000); f.approve(segmentId);
  }
  f.place(ids.map((segmentId, index) => ({ segmentId, atSample: index * 6 * 48000 })));
  return { ids, mappings: ids.map((segmentId, index) => ({ shotId: f.project.shots[index].id, segmentId })), upload, generated };
}
async function unknownPlan(f) {
  const p = f.store.getProject(f.project.id), q = JSON.stringify;
  const source = `definePlan({baseRevision:${q(p.revisionId)}},p=>{${p.shots.map((shot, index) => `const shot${index}=p.shot(${q(shot.id)}); const ref${index}=p.asset(${q(shot.referenceArtifactIds[0])}); const frame${index}=p.image("frame-${index}",{intent:shot${index},profile:"fake-image-v1",references:[ref${index}],prompt:${q(shot.imagePrompt)}});`).join('\n')}return frame0;});`;
  f.production.authorize(p.id, f.human, p.shots.map(shot => ({ scopeId: shot.id, kind: 'image' })), 'initial', 'initial_slot');
  const prepared = await f.production.prepare(p.id, f.actor, { variant: 'plan', expectedHeadVersion: p.headVersion, source });
  f.production.apply(p.id, f.actor, prepared.id);
  const first = f.store.list('node_binding', p.id).find(binding => binding.node.alias === 'frame-0');
  f.provider.setMode(first.id, 'unknown_after_accept'); await f.engine.runReady();
  assert.ok(f.engine.attempts(p.id).some(attempt => attempt.phase === 'submission_unknown'));
}

test('accepted mixed narration commits canonical cues and exact source-local trims with human provenance', async t => {
  const f = await fixture(t), { mappings } = await ready(f, true);
  const before = f.store.getProject(f.project.id), prepared = f.prepare(mappings), receipt = await f.apply(prepared);
  const current = f.store.getProject(f.project.id), saved = f.canonical.current(f.project.id, f.human);
  assert.equal(current.narration.source, 'mixed'); assert.equal(current.headVersion, before.headVersion + 1);
  assert.equal(saved.id, receipt.canonicalId); assert.equal(saved.segments.length, 2);
  assert.deepEqual(saved.segments.map(segment => [segment.audioPlacement.startSample, segment.audioPlacement.durationSamples, segment.audioPlacement.atSample]), [[48000, 288000, 0], [336000, 288000, 288000]]);
  assert.ok(saved.segments.every(segment => segment.provenance.originEvidence === 'human_declared_supplied_recording'));
  assert.deepEqual(saved.segments.map(segment => segment.provenance.declaredOrigin), ['uploaded', 'generated']);
  assert.ok(saved.segments.every(segment => segment.cue.accepted && segment.cue.measured));
  assert.deepEqual(current.shots.map(shot => shot.promptIntent), before.shots.map(shot => shot.promptIntent), 'equal consumed meaning/duration keeps authored prompts bound');
  for (const segment of saved.segments) {
    const artifact = f.store.get('artifact', segment.cue.audio.artifactId); assert.equal(artifact.fixture, false); assert.equal(artifact.attemptId, null);
    assert.equal(createHash('sha256').update(await readFile(artifact.path)).digest('hex'), segment.cue.audio.sha256);
  }
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.engine.attempts(f.project.id).length, 0);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active));
});

test('canonical apply is idempotent after lost response and survives a reopened SQLite connection', async t => {
  const f = await fixture(t), { mappings } = await ready(f); const prepared = f.prepare(mappings), receipt = await f.apply(prepared);
  const count = f.store.list('artifact', f.project.id).length, version = f.store.getProject(f.project.id).headVersion;
  const reopened = new Store(f.store.path);
  try {
    const production = new ProductionService(reopened, f.engine), adapter = new NarrationCanonicalService(new NarrationService(production, f.media));
    assert.deepEqual(await adapter.apply(f.project.id, f.actor, prepared.id), receipt);
    assert.deepEqual(adapter.current(f.project.id, f.human), f.canonical.current(f.project.id, f.human));
    assert.equal(reopened.getProject(f.project.id).headVersion, version); assert.equal(reopened.list('artifact', f.project.id).length, count);
    assert.equal(reopened.list('narration_canonical', f.project.id).length, 1);
  } finally { reopened.close(); }
});

test('placement-only changes preserve both shot revisions and video prompt bindings', async t => {
  const f = await fixture(t), { mappings, ids } = await ready(f); await f.apply(f.prepare(mappings));
  const before = f.store.getProject(f.project.id), prior = f.canonical.current(f.project.id, f.human);
  f.place([{ segmentId: ids[1], atSample: 288799 }]); const prepared = f.prepare(); await f.apply(prepared);
  const after = f.store.getProject(f.project.id), next = f.canonical.current(f.project.id, f.human);
  assert.deepEqual(after.shots, before.shots); assert.ok(prepared.shotImpact.every(impact => impact.visual === 'reuse'));
  assert.notEqual(next.id, prior.id); assert.equal(next.segments[1].audioPlacement.atSample, 288799);
  assert.equal(next.segments[1].audioPlacement.startSample, prior.segments[1].audioPlacement.startSample);
});

test('one changed meaning invalidates only its video intent while unknown jobs, liabilities and unrelated bindings survive', async t => {
  const f = await fixture(t); await unknownPlan(f); const { mappings, ids } = await ready(f); await f.apply(f.prepare(mappings));
  const before = f.store.getProject(f.project.id), attempts = f.engine.attempts(f.project.id), reservations = f.store.list('reservation', f.project.id), bindings = f.store.list('node_binding', f.project.id), candidates = f.store.list('candidate', f.project.id), holds = f.store.list('hold', f.project.id);
  f.revise({ update: [{ segmentId: ids[0], draft: draft('Focus on the hand-stitched welt') }] }); f.cue(ids[0], 48000, 336000); f.approve(ids[0]);
  const prepared = f.prepare(), receipt = await f.apply(prepared), after = f.store.getProject(f.project.id);
  assert.equal(after.shots[0].promptIntent.video, ''); assert.equal(after.shots[0].promptIntent.image, before.shots[0].promptIntent.image);
  assert.equal(after.shots[0].videoPrompt, before.shots[0].videoPrompt); assert.notEqual(after.shots[0].revisionId, before.shots[0].revisionId);
  assert.deepEqual(after.shots[1], before.shots[1]); assert.equal(after.activePlanId, before.activePlanId); assert.equal(receipt.requiresMatchingPlan, true);
  assert.deepEqual(f.engine.attempts(f.project.id), attempts); assert.deepEqual(f.store.list('reservation', f.project.id), reservations);
  assert.deepEqual(f.store.list('node_binding', f.project.id), bindings); assert.deepEqual(f.store.list('candidate', f.project.id), candidates);
  assert.deepEqual(f.store.list('hold', f.project.id), holds); assert.equal(f.provider.acceptedCount(), 2);
});

test('removed segments require explicit mapping decisions and do not change the other shot', async t => {
  const f = await fixture(t), { mappings, ids } = await ready(f); await f.apply(f.prepare(mappings)); const before = f.store.getProject(f.project.id);
  f.revise({ remove: [ids[0]] });
  assert.throws(() => f.prepare(), code('NARRATION_MAPPING_REQUIRED'));
  const prepared = f.prepare([{ shotId: before.shots[0].id, segmentId: null }]); await f.apply(prepared);
  const after = f.store.getProject(f.project.id); assert.equal(after.shots[0].cueId, null); assert.equal(after.shots[0].promptIntent.video, '');
  assert.deepEqual(after.shots[1], before.shots[1]); assert.equal(f.canonical.current(f.project.id, f.human).shotMappings.length, 1);
});

test('unaccepted or fabricated projection fields cannot become canonical authority', async t => {
  const f = await fixture(t); f.revise({ add: [draft('Still a draft')] });
  assert.throws(() => f.prepare(), code('NARRATION_NOT_READY'));
  assert.throws(() => f.prepare([], { projection: { accepted: true } }), code('NARRATION_INVALID_INPUT'));
  assert.throws(() => f.narration.accept(f.project.id, f.actor, f.view().state.version, 'forged', 'script', [f.view().segments[0].script.id]), code('ACTOR_DENIED'));
  assert.equal(f.store.list('narration_canonical', f.project.id).length, 0);
});

test('stale narration during real file verification cannot commit metadata or project state', async t => {
  const f = await fixture(t), { mappings, ids } = await ready(f), before = f.store.getProject(f.project.id), artifactCount = f.store.list('artifact', f.project.id).length;
  const prepared = f.prepare(mappings), pending = f.apply(prepared);
  f.place([{ segmentId: ids[1], atSample: 320000 }]);
  await assert.rejects(pending, code('REVISION_CONFLICT')); assert.deepEqual(f.store.getProject(f.project.id), before);
  assert.equal(f.store.list('artifact', f.project.id).length, artifactCount); assert.equal(f.store.list('narration_canonical', f.project.id).length, 0);
});

test('project-head and actor fences reject stale, cross-request and shot-only canonical commits', async t => {
  const f = await fixture(t), { mappings } = await ready(f), prepared = f.prepare(mappings);
  const before = f.store.getProject(f.project.id); f.store.saveProject({ ...before, name: 'Concurrent trusted change' }, before.headVersion);
  await assert.rejects(f.apply(prepared), code('REVISION_CONFLICT'));
  const next = f.prepare(mappings), pending = f.apply(next);
  const human = f.production.beginRequest(f.project.id, 'human', 'A new shot-only request', { scopeIds: [f.project.shots[0].id] });
  await assert.rejects(pending, code('EPOCH_REVOKED'));
  assert.throws(() => f.canonical.prepare(f.project.id, human, { expectedHeadVersion: f.store.getProject(f.project.id).headVersion, expectedNarrationVersion: f.view().state.version, shotMappings: mappings, key: 'scoped' }), code('SCOPE_DENIED'));
  assert.equal(f.store.list('narration_canonical', f.project.id).length, 0);
});

test('accepted source corruption rejects the whole commit without usable artifact metadata', async t => {
  const f = await fixture(t), { mappings, upload } = await ready(f), prepared = f.prepare(mappings), before = f.store.getProject(f.project.id);
  const path = join(f.media.rootDir, 'blobs', `${upload.media.sha256}.wav`); await chmod(path, 0o600); await writeFile(path, 'corrupt');
  await assert.rejects(f.apply(prepared), code('MEDIA_INTEGRITY_ERROR'));
  assert.deepEqual(f.store.getProject(f.project.id), before); assert.equal(f.store.list('narration_canonical', f.project.id).length, 0);
});

test('preparation keys replay exactly and reject conflicting mappings and foreign shot references', async t => {
  const f = await fixture(t), { mappings } = await ready(f), prepared = f.prepare(mappings, { key: 'same' });
  assert.deepEqual(f.prepare(mappings, { key: 'same' }), prepared);
  assert.throws(() => f.prepare([], { key: 'same' }), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => f.prepare([{ shotId: randomUUID(), segmentId: mappings[0].segmentId }]), code('SCOPE_DENIED'));
  assert.throws(() => f.prepare([{ shotId: mappings[0].shotId, segmentId: randomUUID() }]), code('NARRATION_MAPPING_REQUIRED'));
});

test('a changed trim length revises only the mapped shot duration and video intent', async t => {
  const f = await fixture(t), { mappings, ids } = await ready(f); await f.apply(f.prepare(mappings));
  const before = f.store.getProject(f.project.id);
  f.cue(ids[0], 48000, 288000); f.approve(ids[0]); await f.apply(f.prepare());
  const after = f.store.getProject(f.project.id);
  assert.equal(after.shots[0].desiredFrames, 150); assert.equal(after.shots[0].promptIntent.video, '');
  assert.equal(after.shots[0].promptIntent.image, before.shots[0].promptIntent.image);
  assert.deepEqual(after.shots[1], before.shots[1]);
  assert.equal(f.canonical.current(f.project.id, f.human).segments[0].audioPlacement.durationSamples, 240000);
});

test('trusted workspace reads do not create requests or holds, and malformed mappings fail closed', async t => {
  const f = await fixture(t), { mappings } = await ready(f); await f.apply(f.prepare(mappings));
  const cursor = f.store.cursor(f.project.id), messages = f.store.list('message', f.project.id), holds = f.store.list('hold', f.project.id);
  assert.deepEqual(f.narration.workspaceSnapshot(f.project.id), f.view());
  assert.deepEqual(f.canonical.workspaceCurrent(f.project.id), f.canonical.current(f.project.id, f.human));
  assert.equal(f.store.cursor(f.project.id), cursor); assert.deepEqual(f.store.list('message', f.project.id), messages); assert.deepEqual(f.store.list('hold', f.project.id), holds);
  for (const bad of [[null], [mappings[0], mappings[0]], [{ shotId: '', segmentId: null }], [{ shotId: mappings[0].shotId, segmentId: '' }], [{ shotId: mappings[0].shotId, unexpected: null }]]) {
    assert.throws(() => f.prepare(bad), code('NARRATION_INVALID_INPUT'));
  }
  assert.throws(() => f.narration.workspaceSnapshot(randomUUID()), code('NOT_FOUND'));
});

test('artifact metadata conflicts roll back the entire canonical transaction', async t => {
  const f = await fixture(t), { mappings, upload } = await ready(f), prepared = f.prepare(mappings), before = f.store.getProject(f.project.id);
  f.store.insert('artifact', upload.id, f.project.id, { artifact: { artifactId: upload.id, sha256: '0'.repeat(64), kind: 'audio' }, path: '/unused', mimeType: 'audio/wav' });
  await assert.rejects(f.apply(prepared), code('NARRATION_INTEGRITY_ERROR'));
  assert.deepEqual(f.store.getProject(f.project.id), before); assert.equal(f.store.list('narration_canonical', f.project.id).length, 0);
  assert.equal(f.store.list('narration_commit_receipt', f.project.id).length, 0);
});
