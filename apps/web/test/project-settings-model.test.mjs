import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_KINDS, directorChangeCommand, directorSetupSummary, modelApplyCommand, modelAppliedCurrent, modelContinuationSent, modelDraftIdentity, modelPreviewCommand, modelPreviewCurrent, modelSettingsContinuation, restoredModelDraft } from '../src/project-settings-model.ts';
import { activeProjectEdit, pendingCommandsFor } from '../src/pending-command.ts';
const hash = char => char.repeat(64);
function status() {
  return { version: 1, projectId: 'project', headVersion: 4, revisionId: 'revision4', capabilityLockId: 'lock4', selectionDigest: hash('a'), catalogDigest: hash('b'),
    selected: { image: 'demo-image', video: 'demo-video', speech: 'demo-speech', transcription: 'demo-transcription' },
    options: MODEL_KINDS.flatMap(kind => [{ id: `demo-${kind}`, profile: { kind, adapter: 'fake' } }, { id: `real-${kind}`, profile: { kind, adapter: kind === 'image' ? 'codex-image' : 'openai-speech' } }]) };
}
function preview(current = status(), selected = current.selected, scope = { kind: 'unfinished' }) {
  const { headVersion, revisionId, capabilityLockId, selectionDigest, catalogDigest } = current;
  return { version: 1, id: 'preview', previewDigest: hash('c'), projectId: current.projectId,
    base: { headVersion, revisionId, capabilityLockId, selectionDigest, catalogDigest }, selected, scope, changes: [], preserved: [], counts: { changed: 0, preserved: 0 }, generationApprovalRequired: false, allowanceRequired: false, notice: 'Nothing starts.' };
}
function applied() { return { receipt: { previewId: 'preview', previewDigest: hash('c'), projectId: 'project', headVersion: 5, revisionId: 'revision5', capabilityLockId: 'lock5', activePlanId: 'plan5', changedNodeIds: ['image'], requestId: null }, status: status() }; }
const uncertain = () => true;

test('scoped preview captures exact model choices and current shots without generation or spending authority', () => {
  const current = status(), selected = { ...current.selected, image: 'real-image' }, scope = { kind: 'shots', shotIds: ['shot2', 'shot1'] };
  const command = modelPreviewCommand(current, selected, scope, ['shot1', 'shot2'], 'preview-once');
  assert.deepEqual(command.body, { expectedHeadVersion: 4, expectedSelectionDigest: hash('a'), expectedCatalogDigest: hash('b'),
    profileIds: ['real-image', 'demo-video', 'demo-speech', 'demo-transcription'], scope: { kind: 'shots', shotIds: ['shot2', 'shot1'] } });
  assert.equal(command.path, '/api/projects/project/settings/models/preview');
  assert.equal(command.metadata.draftIdentity, modelDraftIdentity(selected, { kind: 'shots', shotIds: ['shot1', 'shot2'] }));
  selected.image = 'demo-image'; scope.shotIds.push('foreign'); current.headVersion = 99;
  assert.equal(command.body.expectedHeadVersion, 4); assert.equal(command.metadata.selected.image, 'real-image'); assert.equal(command.body.scope.shotIds.length, 2);
  for (const forbidden of ['grantId', 'allowanceId', 'candidateId', 'requestId', 'generate', 'approved']) assert.equal(forbidden in command.body, false);
  for (const scope of [{ kind: 'shots', shotIds: [] }, { kind: 'shots', shotIds: ['foreign'] }, { kind: 'shots', shotIds: ['shot1', 'shot1'] }]) assert.throws(() => modelPreviewCommand(status(), status().selected, scope, ['shot1'], 'key'));
  assert.throws(() => modelPreviewCommand(status(), { ...status().selected, image: 'demo-video' }, { kind: 'unfinished' }, [], 'key'));
  assert.throws(() => modelPreviewCommand(status(), { ...status().selected, image: 'unknown' }, { kind: 'unfinished' }, [], 'key'));
  assert.deepEqual(modelPreviewCommand(status(), { ...status().selected, speech: null }, { kind: 'unfinished' }, [], 'key').body.profileIds, ['demo-image', 'demo-video', 'demo-transcription']);
});

test('an exact impact preview fails closed after any verified base or form change and during failed refreshes', () => {
  const current = status(), selected = { ...current.selected, image: 'real-image' }, scope = { kind: 'shots', shotIds: ['shot1', 'shot2'] };
  const captured = { preview: preview(current, selected, scope), draftIdentity: modelDraftIdentity(selected, scope) };
  const canApply = (state = current, selection = selected, area = scope, checking = false, failed = false, head = 4) => modelPreviewCurrent(captured, state, selection, area, checking, failed, head);
  assert.equal(canApply(), true); assert.equal(canApply(current, selected, { kind: 'shots', shotIds: ['shot2', 'shot1'] }), true);
  for (const patch of [{ headVersion: 5 }, { revisionId: 'other' }, { capabilityLockId: 'other' }, { selectionDigest: hash('d') }, { catalogDigest: hash('e') }, { projectId: 'foreign' }]) assert.equal(canApply({ ...current, ...patch }), false);
  assert.equal(canApply(current, current.selected), false); assert.equal(canApply(current, selected, { kind: 'unfinished' }), false);
  assert.equal(canApply(current, selected, scope, true), false); assert.equal(canApply(current, selected, scope, false, true), false); assert.equal(canApply(current, selected, scope, false, false, 5), false);
  const command = modelApplyCommand(captured, 'apply-once');
  assert.deepEqual(command.body, { previewId: 'preview', previewDigest: hash('c') });
  captured.preview.previewDigest = hash('f'); assert.equal(command.body.previewDigest, hash('c'));
});

test('remount restores the exact reviewed scope and an uncertain apply only permits the original explicit retry', async () => {
  const api = {}, registry = pendingCommandsFor(api, 'project-model-settings'), current = status(), selected = { ...current.selected, video: 'real-video' }, scope = { kind: 'shots', shotIds: ['shot1'] };
  const command = modelPreviewCommand(current, selected, scope, ['shot1'], 'preview-once'); let calls = 0;
  await registry.run('project', command, async () => { calls++; return preview(current, selected, scope); }, uncertain);
  const remount = pendingCommandsFor(api, 'project-model-settings'), restored = restoredModelDraft(remount.snapshot('project'));
  assert.deepEqual(restored.selected, selected); assert.deepEqual(restored.scope, scope); assert.equal(restored.captured.preview.id, 'preview'); assert.equal(calls, 1);
  await remount.run('project', modelApplyCommand(restored.captured, 'apply-once'), async () => { calls++; throw Error('lost response'); }, uncertain);
  const saved = remount.snapshot('project').command;
  remount.subscribe('project', () => {}); assert.equal(calls, 2, 'reading/subscribing never retries');
  assert.equal(await remount.run('project', { ...saved, key: 'replacement' }, async () => assert.fail('cannot replace unresolved action'), uncertain), false);
  await remount.run('project', saved, async exact => { calls++; assert.equal(exact.key, 'apply-once'); assert.deepEqual(exact.body, { previewId: 'preview', previewDigest: hash('c') }); return applied(); }, uncertain);
  assert.equal(calls, 3); assert.equal(remount.snapshot('project').command, null); assert.equal(restoredModelDraft(remount.snapshot('project')), null);
  const failedPreview = modelPreviewCommand(current, selected, scope, ['shot1'], 'preview-other');
  await remount.run('project', failedPreview, async () => { throw Error('lost preview'); }, uncertain);
  const waiting = restoredModelDraft(remount.snapshot('project')); assert.deepEqual(waiting.selected, selected); assert.equal(waiting.captured, null);
});

test('director change requires an idle current selection, snapshots native setup, and never infers account readiness from a folder', () => {
  const current = { selection: { mode: 'fake' }, defaults: {}, locked: true, modelCalls: 9, selectionDigest: hash('a'), busy: false, changeAvailable: true, changeAppliesTo: 'next_turn' };
  const native = { mode: 'native', binaryPath: '/local/codex', model: 'gpt-6-astra', codexHome: '/account/chatgpt' };
  const command = directorChangeCommand('project', current, native, 'director-once');
  assert.deepEqual(command.body, { expectedSelectionDigest: hash('a'), selection: native }); assert.equal(command.path, '/api/projects/project/director/change');
  native.model = 'changed'; current.selectionDigest = hash('b'); assert.equal(command.body.selection.model, 'gpt-6-astra'); assert.equal(command.body.expectedSelectionDigest, hash('a'));
  for (const patch of [{ busy: true }, { changeAvailable: false }]) assert.throws(() => directorChangeCommand('project', { ...current, ...patch }, native, 'key'));
  assert.deepEqual(directorChangeCommand('project', current, { ...native, mode: 'fake' }, 'demo').body.selection, { mode: 'fake' });
  assert.throws(() => directorChangeCommand('project', current, { ...native, binaryPath: 'relative' }, 'key'));
  const setup = { ...current, selection: native, readiness: { status: 'ready' }, readinessSelectionDigest: hash('a') };
  assert.doesNotMatch(directorSetupSummary(setup), /passed/); setup.readinessSelectionDigest = current.selectionDigest; assert.match(directorSetupSummary(setup), /passed/);
  assert.equal(directorSetupSummary({ ...setup, busy: true }).includes('wait'), true);
  assert.equal('interrupt' in command.body, false); assert.equal('startTurn' in command.body, false);
});

test('continuation is one explicit normal message per applied change and preserves the named current request on retry', async () => {
  const messages = [{ id: 'old', state: 'superseded', editing: true, scopeIds: ['project'] }, { id: 'current', state: 'active', editing: true, scopeIds: ['project'] }, { id: 'shot-only', state: 'active', editing: true, scopeIds: ['shot'] }];
  const savedApply = applied(), api = {}, registry = pendingCommandsFor(api, 'project-model-continuation'); let calls = 0;
  const current = { ...savedApply.status, capabilityLockId: savedApply.receipt.capabilityLockId };
  savedApply.status = current;
  assert.equal(modelAppliedCurrent(savedApply, current, false, false), true);
  assert.equal(modelAppliedCurrent(savedApply, { ...current, capabilityLockId: 'later-lock' }, false, false), false);
  assert.equal(modelAppliedCurrent(savedApply, current, true, false), false);
  assert.equal(modelAppliedCurrent(savedApply, current, false, true), false);
  const command = modelSettingsContinuation('project', 'continue-once' , activeProjectEdit(messages, 'project'), savedApply.receipt);
  assert.equal(command.path, '/api/projects/project/messages'); assert.equal(command.body.continuationRequestId, 'current');
  assert.equal(command.body.editing, true); assert.deepEqual(command.body.scopeIds, ['project']); assert.match(command.body.text, /for my review/);
  assert.equal(modelContinuationSent(savedApply, registry.snapshot('project')), false); assert.equal(calls, 0);
  await registry.run('project', command, async () => { calls++; throw Error('lost response'); }, uncertain);
  messages[1].state = 'superseded'; messages.push({ id: 'later', state: 'active', editing: true, scopeIds: ['project'] });
  const remount = pendingCommandsFor(api, 'project-model-continuation'), retry = remount.snapshot('project').command;
  assert.equal(retry.body.continuationRequestId, 'current'); assert.equal(retry.key, 'continue-once'); assert.equal(modelContinuationSent(savedApply, remount.snapshot('project')), false);
  await remount.run('project', retry, async exact => { calls++; assert.equal(exact, retry); return { requestId: 'new-request' }; }, uncertain);
  assert.equal(calls, 2); assert.equal(modelContinuationSent(savedApply, remount.snapshot('project')), true);
  assert.equal(modelContinuationSent({ ...savedApply, receipt: { ...savedApply.receipt, previewId: 'later-preview' } }, remount.snapshot('project')), false);
  assert.equal('continuationRequestId' in modelSettingsContinuation('project', 'fresh', null, savedApply.receipt).body, false);
  assert.throws(() => modelSettingsContinuation('foreign', 'key', null, savedApply.receipt));
});
