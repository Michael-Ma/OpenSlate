import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmationFixture } from './helpers/confirmation-fixture.mjs';

const latest = f => f.store.list('scene_confirmation', f.project.id).at(-1);
const edit = (f, kind, id, field, value) => f.call('POST', '/storyboard', { kind, id, field, value,
  expectedHeadVersion: f.store.getProject(f.project.id).headVersion }).then(f.ok);
async function attached(f) {
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile(); await f.runner.advance();
  assert.equal(latest(f).steps[0].step, 'accept');
  assert.equal(f.calls.speech, 1);
}
function legacy(f, run) {
  for (const step of run.steps) { delete step.intentDigest; delete step.profileId; delete step.profileRevisionId; }
  f.store.put('scene_confirmation', run.id, f.project.id, run);
}

test('R4 a legacy accept-only checkpoint refuses changed own words without overwriting them', async t => {
  const f = await confirmationFixture(t); await attached(f);
  let run = latest(f);
  f.store.put('scene_confirmation', run.id, f.project.id, { ...run, state: 'blocked', blocker: { code: 'synthetic-interrupted', shotId: 'shot-0' } });
  await f.make(); run = latest(f);
  assert.equal(run.steps[0].step, 'accept');
  assert.equal(run.steps[0].speechResult, undefined, 'this valid checkpoint was created from an already attached recording');
  legacy(f, run);
  await edit(f, 'narration', 'shot-0', 'text', 'Keep the newer human words');
  await f.runner.advance();
  assert.equal(f.store.getProject(f.project.id).shots[0].narration.text, 'Keep the newer human words');
  assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, true);
  assert.equal(latest(f).state, 'blocked');
  assert.ok(['NARRATION_SPEECH_STALE', 'SCENE_REVIEW_STALE'].includes(latest(f).blocker.code));
  assert.equal(f.canonical.workspaceCurrent(f.project.id), null);
  assert.equal(f.calls.speech, 1);
});

test('R4 a legacy paid attach recovers original pins and stores through an unrelated sibling edit', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  const run = latest(f); assert.equal(run.steps[0].step, 'attach'); legacy(f, run);
  await edit(f, 'shot', 'shot-1', 'motion', 'A different sibling motion');
  await f.runner.advance();
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1);
  assert.equal(latest(f).steps[0].step, 'accept');
  assert.equal(f.calls.speech, 1);
});

test('R4 a legacy paid attach refuses changed own words using immutable publication evidence', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  const run = latest(f); legacy(f, run);
  await edit(f, 'narration', 'shot-0', 'text', 'New words after the older paid take');
  await f.runner.advance();
  assert.equal(latest(f).state, 'blocked');
  assert.equal(latest(f).blocker.code, 'NARRATION_SPEECH_STALE');
  assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  assert.equal(f.store.getProject(f.project.id).shots[0].narration.text, 'New words after the older paid take');
  assert.equal(f.calls.speech, 1);
});

test('R4 an uncommitted attach checkpoint rebases an unrelated narration version after restart', async t => {
  const f = await confirmationFixture(t);
  await f.make(); await f.runner.advance(); await f.engine.runReady(); await f.engine.reconcile();
  const attach = f.narration.attachGeneratedAudio.bind(f.narration);
  f.narration.attachGeneratedAudio = async () => { throw Error('crash before attachment storage'); };
  await assert.rejects(f.runner.advanceOne(latest(f)), /crash before attachment storage/);
  assert.ok(latest(f).steps[0].attachInput);
  assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  f.narration.attachGeneratedAudio = attach;
  const before = f.narration.workspaceSnapshot(f.project.id).state.version;
  await f.setupNarration('/shots/shot-1/initialize', { expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
    mode: 'generated', text: 'A new sibling voice line', voice: 'cedar' }).then(f.ok);
  assert.ok(f.narration.workspaceSnapshot(f.project.id).state.version > before);
  await f.restart(); await f.runner.advance();
  assert.equal(f.store.list('narration_audio', f.project.id).length, 1, 'an unrelated section does not strand this paid take');
  assert.equal(latest(f).steps[0].step, 'accept');
  assert.equal(f.calls.speech, 1);
});

test('R4 an uncommitted accept checkpoint rebases an unrelated film head after restart', async t => {
  const f = await confirmationFixture(t); await attached(f);
  const workspace = f.runner.workspace.bind(f.runner);
  f.runner.workspace = () => ({ ...workspace(), accept: async () => { throw Error('crash before acceptance preparation'); } });
  await assert.rejects(f.runner.advanceOne(latest(f)), /crash before acceptance preparation/);
  assert.ok(latest(f).steps[0].acceptInput);
  f.runner.workspace = workspace;
  await edit(f, 'shot', 'shot-1', 'motion', 'An unrelated head move');
  await f.restart(); await f.runner.advance();
  assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, false, 'an unrelated head move does not strand this exact acceptance');
  assert.equal(latest(f).steps[0].step, 'done');
  assert.equal(f.calls.speech, 1);
});

test('R4 a prepared uncommitted accept rebases after an unrelated head move without losing that edit', async t => {
  const f = await confirmationFixture(t); await attached(f);
  const apply = f.canonical.apply.bind(f.canonical);
  f.canonical.apply = async () => { throw Error('crash after acceptance preparation'); };
  await assert.rejects(f.runner.advanceOne(latest(f)), /crash after acceptance preparation/);
  assert.ok(latest(f).steps[0].acceptInput);
  assert.equal(f.store.list('narration_commit_receipt', f.project.id).length, 0);
  assert.equal(f.store.list('narration_prepared', f.project.id).length, 1);
  f.canonical.apply = apply;
  await edit(f, 'shot', 'shot-1', 'motion', 'Preserve this sibling change while accepting');
  await f.restart(); await f.runner.advance();
  assert.equal(f.store.getProject(f.project.id).shots[0].narrationPending, false);
  assert.equal(f.store.getProject(f.project.id).shots[1].motion, 'Preserve this sibling change while accepting');
  assert.equal(latest(f).steps[0].step, 'done');
  assert.equal(f.calls.speech, 1);
});
