import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { compilePlan, composeScenePlan, DEFAULT_PROFILES, planSourceBaseRevision, shotIntentDigest } from '@openslate/core';
import { Store } from '../dist/persistence/store.js';
import { projectFixture, sourceFor } from './execution-fixture.mjs';
import { composeNarrationSpeechPlan } from '../dist/narration/narration-speech-composition.js';

// Shape of a scene-local refresh after several accepted prompt proposals: the
// source header is current, one picture branch is refreshed and another stays old.
function fixture(t, versioned = false) {
  const store = new Store(':memory:'); t.after(() => store.close());
  const original = projectFixture('project', 2); store.createProject(original);
  store.put('project_revision', original.revisionId, original.id, { project: original });
  const context = { project: original, profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID };
  const source = versioned ? sourceFor(original).replace('p.shot("shot-0")', `p.shot(${JSON.stringify(`shot-0@${original.shots[0].revisionId}`)})`) : sourceFor(original);
  const base = compilePlan(source, context);
  const current = structuredClone(original); current.revisionId = randomUUID();
  for (const shot of current.shots) {
    shot.revisionId = randomUUID(); shot.imagePrompt = `Accepted picture ${shot.id}`;
    shot.videoPrompt = `Accepted motion ${shot.id}`; shot.action = 'Cross a new location';
    shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') };
  }
  const saved = store.saveProject(current, 0); store.put('project_revision', saved.revisionId, saved.id, { project: saved });
  const hybrid = structuredClone(saved); hybrid.shots[0] = structuredClone(original.shots[0]);
  const mixed = composeScenePlan(base, [{ shotId: 'shot-1', kind: 'image', profileId: 'fake-image-v1' }], { ...context, project: hybrid });
  const later = store.saveProject({ ...saved, revisionId: randomUUID(), name: 'Later unrelated title' }, saved.headVersion);
  store.put('project_revision', later.revisionId, later.id, { project: later });
  return { store, original, current: later, context: { ...context, project: later }, mixed };
}

for (const versioned of [false, true]) test(`requested voice can append after scene keyframes preserve ${versioned ? 'versioned ' : ''}historical picture branches`, async t => {
  const f = fixture(t, versioned), before = structuredClone(f.current), originalPlan = structuredClone(f.mixed);
  const compiled = await composeNarrationSpeechPlan(f.store, f.mixed, { alias: 'requested-voice', profileId: 'fake-speech-v1',
    text: 'The requested current voice line.', voice: 'stock', instructions: '' }, f.context);
  assert.deepEqual(compiled.nodes.filter(node => node.kind !== 'speech'), f.mixed.nodes);
  assert.deepEqual(compiled.gates, f.mixed.gates);
  assert.equal(planSourceBaseRevision(compiled), planSourceBaseRevision(f.mixed), 'standalone speech retains the preserved source identity');
  assert.equal(compiled.nodes.find(node => node.kind === 'speech').args.text, 'The requested current voice line.');
  assert.deepEqual(f.current, before); assert.deepEqual(f.mixed, originalPlan);
});

test('speech append still refuses an altered preserved recipe without historical proof', async t => {
  const f = fixture(t);
  f.mixed.nodes.find(node => node.kind === 'video' && node.shotId === 'shot-0').args.prompt = 'Unproved historical motion';
  await assert.rejects(composeNarrationSpeechPlan(f.store, f.mixed, { alias: 'requested-voice', profileId: 'fake-speech-v1',
    text: 'The requested current voice line.', voice: 'stock', instructions: '' }, f.context));
  assert.equal(f.store.list('attempt', f.current.id).length, 0);
});

test('mixed picture speech still requires the exact immutable source revision', async t => {
  const f = fixture(t), sourceRevision = planSourceBaseRevision(f.mixed);
  f.store.db.prepare("DELETE FROM entities WHERE kind='project_revision' AND id=?").run(sourceRevision);
  await assert.rejects(composeNarrationSpeechPlan(f.store, f.mixed, { alias: 'requested-voice', profileId: 'fake-speech-v1',
    text: 'Current voice line.', voice: 'stock', instructions: '' }, f.context), { code: 'NARRATION_PLAN_REBASE_REQUIRED' });
  assert.equal(f.store.list('attempt', f.current.id).length, 0);
});

test('mixed picture speech cannot borrow duplicate history to hide a forged pinned source shot', async t => {
  const f = fixture(t), sourceRevision = planSourceBaseRevision(f.mixed);
  const source = f.store.get('project_revision', sourceRevision), duplicate = structuredClone(source);
  duplicate.project.revisionId = randomUUID();
  duplicate.id = duplicate.project.revisionId;
  f.store.put('project_revision', duplicate.project.revisionId, f.current.id, duplicate);
  const shot = source.project.shots[1]; shot.action = 'Forged action under the same pinned revision';
  shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') };
  f.store.db.prepare("UPDATE entities SET body=? WHERE kind='project_revision' AND id=?").run(JSON.stringify(source), sourceRevision);
  await assert.rejects(composeNarrationSpeechPlan(f.store, f.mixed, { alias: 'requested-voice', profileId: 'fake-speech-v1',
    text: 'Current voice line.', voice: 'stock', instructions: '' }, f.context), { code: 'PLAN_COMPOSITION_STALE' });
  assert.equal(f.store.list('attempt', f.current.id).length, 0);
});
