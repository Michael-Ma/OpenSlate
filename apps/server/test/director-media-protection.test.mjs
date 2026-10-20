import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PROFILES, digest, toolCatalog, toolHandlerId } from '@openslate/core';
import { fixture } from './helpers/generation-fixture.mjs';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { directorMappedSpeechFixture } from './helpers/director-mapped-speech-fixture.mjs';

function director(f, version = '5.0.0') {
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Revise the film', { scopeIds: [f.project.id] });
  const { actor } = f.service.openEpoch(f.project.id, human);
  if (version) {
    // A synthetic immutable application-owned lock isolates the server policy from skill snapshots.
    const body = { id: randomUUID(), compatibility: { toolContract: version }, skills: [],
      bindings: [{ kind: 'handler', id: toolHandlerId(version), digest: toolCatalog(version).digest }] };
    const lock = { ...body, lockDigest: digest(body) };
    f.store.insert('director_skill_lock', lock.id, f.project.id, { projectId: f.project.id, lock });
    f.store.insert('director_epoch_lock', actor.epochId, f.project.id, { projectId: f.project.id, epochId: actor.epochId, requestId: actor.requestId, lockId: lock.id });
  }
  return actor;
}
function output(f, kind, { retained = false, shotId = 'shot-0', state = 'active', planId } = {}) {
  let project = f.store.getProject(f.project.id);
  if (!project.activePlanId) project = f.store.saveProject({ ...project, activePlanId: randomUUID() }, project.headVersion);
  const id = randomUUID(), artifact = { artifactId: randomUUID(), sha256: 'a'.repeat(64), kind: { image: 'image', video: 'video', speech: 'audio' }[kind] };
  const outputs = { [{ image: 'image', video: 'video', speech: 'audio' }[kind]]: artifact };
  const binding = { id, projectId: project.id, planId: planId ?? project.activePlanId,
    node: { id, kind, shotId, args: {}, inputs: [] }, state, candidateId: null,
    outputs: retained ? {} : outputs, ...(retained ? { retainedTake: { candidateId: null, outputs } } : {}) };
  f.store.insert('node_binding', id, project.id, binding);
  return binding;
}
function acceptedCue(f) {
  const project = f.store.getProject(f.project.id), cue = { id: randomUUID(), meaning: 'Accepted line', durationFrames: 150, placementFrames: 0,
    audio: { artifactId: randomUUID(), sha256: 'b'.repeat(64), kind: 'audio' }, accepted: true, measured: true };
  project.cues.push(cue);
  Object.assign(project.shots[0], { cueId: cue.id, narrationTimingMode: 'within_shot', narration: { mode: 'generated', text: 'Accepted line', voice: 'stock' }, narrationPending: false });
  f.store.saveProject(project, project.headVersion);
}
const proposal = (f, creative) => ({ variant: 'project', expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative });
const change = (f, field, value) => proposal(f, { updateShots: [{ id: 'shot-0', [field]: value, reauthorPrompts: true }] });
const prepare = (f, actor, field, value) => f.service.prepare(f.project.id, actor, change(f, field, value));
function requiresProposal(field) {
  return error => {
    assert.equal(error.code, 'PROPOSAL_REQUIRED');
    assert.match(error.message, new RegExp(field));
    assert.match(error.message, /propose_change/); assert.match(error.message, /Plan/);
    return true;
  };
}

for (const retained of [false, true]) {
  for (const [kind, fields] of [['image', { purpose: 'New purpose', action: 'New action', framing: 'Close up', imagePrompt: 'New image' }],
    ['video', { purpose: 'New purpose', action: 'New action', framing: 'Close up', motion: 'Pan left', videoPrompt: 'New video', desiredFrames: 240 }]]) {
    for (const [field, value] of Object.entries(fields)) test(`current Director cannot directly change ${field} with a ${retained ? 'retained' : 'current'} ${kind} output`, async t => {
      const f = fixture(t); output(f, kind, { retained }); const actor = director(f), before = f.store.getProject(f.project.id);
      await assert.rejects(prepare(f, actor, field, value), requiresProposal(field));
      assert.deepEqual(f.store.getProject(f.project.id), before); assert.equal(f.store.list('prepared', f.project.id).length, 0);
      assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list('grant', f.project.id).length, 0);
    });
  }
  test(`current Director cannot directly change narration with a ${retained ? 'retained' : 'current'} voice line`, async t => {
    const f = fixture(t); output(f, 'speech', { retained }); const actor = director(f);
    await assert.rejects(prepare(f, actor, 'narration', { mode: 'generated', text: 'New line', voice: 'stock' }), requiresProposal('narration'));
  });
}

for (const mode of ['generated', 'none']) test(`accepted narration requires a proposal before changing it to ${mode}`, async t => {
  const f = fixture(t); acceptedCue(f); const actor = director(f);
  await assert.rejects(prepare(f, actor, 'narration', { mode, text: mode === 'none' ? '' : 'New line', voice: 'stock' }), requiresProposal('narration'));
});

test('a global script edit cannot invalidate a shot accepted cue without a proposal', async t => {
  const f = fixture(t); acceptedCue(f); const actor = director(f);
  await assert.rejects(f.service.prepare(f.project.id, actor, proposal(f, { narrationScript: 'Replacement script' })), requiresProposal('narrationScript'));
});

test('apply rechecks media that finishes after direct preparation and returns actionable tool refusal', async t => {
  const f = fixture(t), actor = director(f), tools = new ToolInvocationService(f.service);
  const started = output(f, 'video'), binding = { ...started, outputs: {} };
  f.store.put('node_binding', binding.id, f.project.id, binding);
  const prepared = await tools.invoke(f.project.id, actor, 'prepare-before-finish', 'prepare_change', change(f, 'motion', 'Pan left'));
  f.store.put('node_binding', started.id, f.project.id, started);
  const before = f.store.getProject(f.project.id);
  await assert.rejects(tools.invoke(f.project.id, actor, 'prepare-after-finish', 'prepare_change', change(f, 'motion', 'Pan left')), requiresProposal('motion'));
  await assert.rejects(tools.invoke(f.project.id, actor, 'apply-after-finish', 'apply_change', { preparedId: prepared.preparedId }), requiresProposal('motion'));
  assert.deepEqual(f.store.getProject(f.project.id), before);
  const refusal = f.store.list('tool_invocation', f.project.id).find(call => call.callId === 'apply-after-finish');
  assert.equal(refusal.state, 'failed'); assert.equal(refusal.error.code, 'PROPOSAL_REQUIRED');
});

for (const retained of [false, true]) test(`project-level speech ${retained ? 'retained' : 'current'} output uses its real compact shot mapping`, async t => {
  const f = await directorMappedSpeechFixture(t), artifact = { artifactId: randomUUID(), sha256: 'c'.repeat(64), kind: 'audio' };
  assert.equal(f.binding.node.shotId, null); assert.deepEqual(f.shotScopes, ['shot-0']);
  f.store.put('node_binding', f.binding.id, f.project.id, { ...f.binding, outputs: retained ? {} : { audio: artifact },
    ...(retained ? { retainedTake: { candidateId: f.binding.candidateId, outputs: { audio: artifact } } } : {}) });
  const actor = director(f);
  await assert.rejects(prepare(f, actor, 'narration', { mode: 'generated', text: 'Replacement words', voice: 'stock' }), requiresProposal('narration'));
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test('a first mapped paid voice attempt in flight requires the person proposal decision', async t => {
  const f = await directorMappedSpeechFixture(t, { admit: true }), actor = director(f);
  assert.deepEqual(f.binding.outputs, {}); assert.ok(f.attempt); assert.equal(f.attempt.phase, 'submitting');
  await assert.rejects(prepare(f, actor, 'narration', { mode: 'generated', text: 'Replacement words', voice: 'stock' }), requiresProposal('narration'));
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

for (const [kind, field, value] of [['image', 'framing', 'Close up'], ['video', 'motion', 'Pan left']]) test(`a first paid ${kind} attempt in flight requires a proposal`, async t => {
  const f = fixture(t), started = output(f, kind), binding = { ...started, outputs: {}, node: { ...started.node, specDigest: 'running-spec' } };
  f.store.put('node_binding', binding.id, f.project.id, binding);
  f.store.insert('attempt', randomUUID(), f.project.id, { nodeId: binding.id, candidateId: null, workKey: 'synthetic-running-paid-work', ordinal: 1,
    specDigest: 'running-spec', phase: 'remote_pending', request: { kind, profileId: 'fake', args: {}, inputs: [] }, outputs: {} });
  const actor = director(f);
  await assert.rejects(prepare(f, actor, field, value), requiresProposal(field));
});

for (const [kind, field, value] of [['image', 'referenceArtifactIds', ['another-reference']], ['video', 'referenceArtifactIds', ['another-reference']], ['video', 'cueId', 'other-cue']])
  test(`publication names changed ${field} in ${kind} intent when a paid result arrives`, async t => {
    const f = fixture(t), actor = director(f), started = output(f, kind); f.store.put('node_binding', started.id, f.project.id, { ...started, outputs: {} });
    if (field === 'cueId') {
      const current = f.store.getProject(f.project.id); current.cues.push({ id: 'other-cue', meaning: 'Other cue', durationFrames: 180, placementFrames: 0,
        audio: { artifactId: randomUUID(), sha256: 'd'.repeat(64), kind: 'audio' }, accepted: true, measured: true });
      f.store.saveProject(current, current.headVersion);
    }
    const prepared = await f.service.prepare(f.project.id, actor, proposal(f, { story: 'A different saved story' }));
    // The frozen tool schema excludes these update fields today. Exercise the publication
    // kernel directly with the derived prepared shot data to protect intent-field completeness.
    prepared.next.shots[0][field] = value;
    f.store.put('prepared', prepared.id, f.project.id, prepared); f.store.put('node_binding', started.id, f.project.id, started);
    assert.throws(() => f.service.apply(f.project.id, actor, prepared.id), requiresProposal(field));
  });

for (const version of ['1.0.0', '4.0.0', null]) test(`legacy ${version ?? 'unbound'} Director retains the prior direct-edit behavior`, async t => {
  const f = fixture(t); output(f, 'image'); output(f, 'video'); const actor = director(f, version);
  const prepared = await prepare(f, actor, 'framing', 'Close up'); f.service.apply(f.project.id, actor, prepared.id);
  assert.equal(f.store.getProject(f.project.id).shots[0].framing, 'Close up');
});

test('current Director passes through pure text, new writing and fields with no affected output', async t => {
  const f = fixture(t); output(f, 'image'); const actor = director(f);
  const prepared = await f.service.prepare(f.project.id, actor, proposal(f, { brief: 'Short film brief', story: 'A longer story',
    updateShots: [{ id: 'shot-0', motion: 'Pan left', videoPrompt: 'New video', desiredFrames: 240, narration: { mode: 'generated', text: 'First line', voice: 'stock' }, reauthorPrompts: true }] }));
  f.service.apply(f.project.id, actor, prepared.id);
  const project = f.store.getProject(f.project.id);
  assert.equal(project.brief, 'Short film brief'); assert.equal(project.shots[0].motion, 'Pan left'); assert.equal(project.shots[0].narration.text, 'First line');
});

test('same shot values and unrelated, retired or historical media do not require proposals', async t => {
  const f = fixture(t); output(f, 'image'); output(f, 'video', { shotId: 'shot-1' }); output(f, 'video', { state: 'retired' }); output(f, 'video', { planId: 'historical-plan' });
  const actor = director(f), original = f.store.getProject(f.project.id).shots[0];
  const prepared = await f.service.prepare(f.project.id, actor, proposal(f, { updateShots: [{ id: 'shot-0', imagePrompt: original.imagePrompt, motion: 'New movement', reauthorPrompts: true }] }));
  f.service.apply(f.project.id, actor, prepared.id); assert.equal(f.store.getProject(f.project.id).shots[0].motion, 'New movement');
});

for (const [frames, code] of [[89, 'VALIDATION_ERROR'], [451, 'VALIDATION_ERROR'], [119, 'PROFILE_INCOMPATIBLE']]) test(`held publication refuses ${frames} frames with ${code}`, t => {
  const f = fixture(t), actor = director(f), patch = { updateShots: [{ id: 'shot-0', desiredFrames: frames, reauthorPrompts: true }] };
  assert.throws(() => f.service.validateHeldCreativePatch(f.project.id, actor, patch), error => {
    assert.equal(error.code, code); assert.match(error.message, /patch\.updateShots\[0\]\.desiredFrames/); return true;
  });
});

test('held publication honors the locked video maximum in addition to the person bounds', t => {
  const profiles = DEFAULT_PROFILES.map(profile => profile.kind === 'video' ? { ...profile, maxFrames: 240 } : profile), f = fixture(t, { profiles });
  const actor = director(f), patch = { updateShots: [{ id: 'shot-0', desiredFrames: 270, reauthorPrompts: true }] };
  assert.throws(() => f.service.validateHeldCreativePatch(f.project.id, actor, patch), { code: 'PROFILE_INCOMPATIBLE' });
});

test('held publication checks accepted narration duration before recording a proposal', t => {
  const f = fixture(t); acceptedCue(f); const actor = director(f), patch = { updateShots: [{ id: 'shot-0', desiredFrames: 120, reauthorPrompts: true }] };
  assert.throws(() => f.service.validateHeldCreativePatch(f.project.id, actor, patch), { code: 'SHOT_SHORTER_THAN_NARRATION' });
  f.service.validateHeldCreativePatch(f.project.id, actor, { updateShots: [{ id: 'shot-0', desiredFrames: 150, reauthorPrompts: true }] });
});
