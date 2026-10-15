import test from 'node:test';
import assert from 'node:assert/strict';
import { translateMsg } from '../../src/next/i18n/translate.ts';
import { codexState, directorRequest, directorRow, draftFrom, draftProblems, reviewRequest, reviewSwitch, selectionFor } from '../../src/next/model/settings-director.ts';

const en = (m) => translateMsg('en', m);
const setup = (patch = {}) => ({
  selection: { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' }, selectionDigest: 'd'.repeat(64),
  busy: false, changeAvailable: true, changeAppliesTo: 'next_turn', defaults: { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' },
  locked: true, modelCalls: 3, modelChoices: [{ id: 'gpt-6-astra', label: 'gpt-6-astra' }, { id: 'gpt-6-astra-mini', label: 'gpt-6-astra-mini' }],
  modelCatalogStatus: 'ready', modelCatalogCheckedAt: '2026-10-15T10:00:00Z', ...patch,
});

test('the Director row offers each Codex model and the demo, with what each costs', () => {
  const row = directorRow(setup());
  assert.equal(row.selected, 'native:gpt-6-astra');
  assert.deepEqual(row.choices.map((c) => c.value), ['native:gpt-6-astra', 'native:gpt-6-astra-mini', 'fake']);
  assert.deepEqual(row.choices.map((c) => en(c.estimate)), ['uses your Codex plan', 'uses your Codex plan', 'free stand-in, scripted']);
  assert.ok(row.choices.every((c) => c.ready));
  assert.equal(row.locked, null);
});

test('before a check the current model is still offered; no Codex makes the Codex choices unavailable', () => {
  const unchecked = directorRow(setup({ modelChoices: [], modelCatalogStatus: 'unchecked', selection: { mode: 'fake' } }));
  assert.equal(unchecked.selected, 'fake');
  assert.deepEqual(unchecked.choices.map((c) => c.value), ['native:gpt-6-astra', 'fake']);
  const missing = directorRow(setup({ modelChoices: [], selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'gpt-6-astra' }, modelCatalogStatus: 'unchecked' }));
  assert.equal(missing.choices[0].ready, false);
  assert.equal(en(missing.choices[0].reason), 'Codex not found');
  assert.equal(en(directorRow(setup({ modelCatalogStatus: 'blocked' })).choices[0].reason), 'Codex needs attention');
  assert.equal(en(directorRow(setup({ busy: true, changeAvailable: false })).locked), "Wait for the Director's current turn to finish.");
});

test('Codex state comes from the last setup check', () => {
  assert.equal(codexState(setup()), 'ready');
  assert.equal(codexState(setup({ modelCatalogStatus: 'unchecked' })), 'unchecked');
  assert.equal(codexState(setup({ modelCatalogStatus: 'blocked' })), 'blocked');
  assert.equal(codexState(setup({ selection: { mode: 'fake' }, defaults: { binaryPath: '', model: 'm' }, modelCatalogStatus: 'unchecked' })), 'missing');
  assert.equal(codexState(setup({ modelCatalogStatus: 'unchecked', readiness: { status: 'ready' } })), 'ready');
});

test('switching from the row keeps the known program and Codex home', () => {
  assert.deepEqual(selectionFor(setup(), 'fake'), { mode: 'fake' });
  assert.deepEqual(selectionFor(setup({ selection: { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-6-astra', codexHome: '/Users/m/.codex' } }), 'native:gpt-6-astra-mini'),
    { mode: 'native', binaryPath: '/opt/codex', model: 'gpt-6-astra-mini', codexHome: '/Users/m/.codex' });
  assert.deepEqual(selectionFor(setup({ selection: { mode: 'fake' } }), 'native:gpt-6-astra'), { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' });
});

test('after the first conversation a save is a change bound to the selection shown; before it, the first setup', () => {
  const selection = { mode: 'native', binaryPath: ' /usr/local/bin/codex ', model: 'gpt-6-astra', codexHome: '' };
  assert.deepEqual(directorRequest(setup(), selection), { path: '/director/change', body: { expectedSelectionDigest: 'd'.repeat(64), selection: { mode: 'native', binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra' } } });
  assert.deepEqual(directorRequest(setup({ locked: false }), { mode: 'fake', model: 'x' }), { path: '/director/setup', body: { mode: 'fake' } });
});

test('the Codex form refuses what the server would refuse', () => {
  const draft = draftFrom(setup());
  assert.deepEqual(draft, { binaryPath: '/usr/local/bin/codex', model: 'gpt-6-astra', codexHome: '' });
  assert.deepEqual(draftProblems(draft), []);
  assert.deepEqual(draftProblems({ binaryPath: 'codex', model: 'gpt 6', codexHome: '~/.codex' }).map((p) => p.field), ['binaryPath', 'model', 'codexHome']);
  assert.equal(en(draftProblems({ ...draft, binaryPath: 'codex' })[0].problem), 'Use the full path, starting with /.');
  // No Codex found on this computer: the empty field says so, so Save is never off without a reason.
  assert.deepEqual(draftProblems({ ...draft, binaryPath: ' ' }).map((p) => [p.field, en(p.problem)]), [['binaryPath', 'No Codex program found. Enter its full path, starting with /.']]);
  assert.equal(en(draftProblems({ ...draft, model: '' })[0].problem), 'Choose a Codex model.');
});

test('the review switch (D4) is off with a reason until its route exists and the Codex Director is set', () => {
  const on = reviewSwitch({ data: { enabled: true }, status: null, error: null }, setup());
  assert.deepEqual(on, { on: true, disabled: false, reason: null });
  const missing = reviewSwitch({ data: null, status: 404, error: 'REQUEST_FAILED' }, setup());
  assert.equal(missing.disabled, true);
  assert.equal(en(missing.reason), "This studio can't do this yet; it arrives with a later update.");
  const demo = reviewSwitch({ data: { enabled: true }, status: null, error: null }, setup({ selection: { mode: 'fake' } }));
  assert.deepEqual([demo.on, demo.disabled, en(demo.reason)], [false, true, 'Needs the Codex Director.']);
  assert.equal(en(reviewSwitch({ data: null, status: 500, error: 'INTERNAL_ERROR' }, setup()).reason), "Couldn't read this setting.");
  assert.deepEqual(reviewSwitch({ data: null, status: null, error: null }, null), { on: false, disabled: true, reason: null });
  assert.deepEqual(reviewRequest(false, 12), { path: '/settings/director-review', body: { enabled: false, expectedHeadVersion: 12 } });
});
