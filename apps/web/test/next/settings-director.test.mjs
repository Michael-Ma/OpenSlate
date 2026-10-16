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

test('the review switch (D4) always shows the saved setting and can always be turned off', () => {
  const read = (enabled) => ({ data: { enabled }, status: null, error: null });
  const view = (v) => [v.on, v.disabled, v.reason && en(v.reason), en(v.note)];
  const codexNote = 'When keyframes come back, the Director looks at them and leaves notes, like “the coat came out maroon”. Each batch uses more of your Codex plan.';
  const demoNote = "With the Demo Director, reviews are scripted notes: free, and it doesn't look at the pictures.";
  assert.deepEqual(view(reviewSwitch(read(true), setup())), [true, false, null, codexNote]);
  assert.deepEqual(view(reviewSwitch(read(false), setup())), [false, false, null, codexNote]);
  // The server reviews every film's batches, the Demo Director's too (scripted, free): show it and let it be changed.
  assert.deepEqual(view(reviewSwitch(read(true), setup({ selection: { mode: 'fake' } }))), [true, false, null, demoNote]);
  assert.deepEqual(view(reviewSwitch(read(false), setup({ selection: { mode: 'fake' } }))), [false, false, null, demoNote]);
  assert.deepEqual(reviewRequest(false, 12), { path: '/settings/director-review', body: { enabled: false, expectedHeadVersion: 12 } });
});

test('Codex missing or failing its check: the switch says it needs the Codex Director; off it stays off, on it can be turned off', () => {
  const read = (enabled) => ({ data: { enabled }, status: null, error: null });
  const missing = setup({ selection: { mode: 'native', model: 'gpt-6-astra' }, defaults: { binaryPath: '', model: 'gpt-6-astra' }, modelCatalogStatus: 'unchecked' });
  const blocked = setup({ modelCatalogStatus: 'blocked' });
  for (const state of [missing, blocked]) {
    const on = reviewSwitch(read(true), state);
    assert.deepEqual([on.on, on.disabled, en(on.reason)], [true, false, 'Needs the Codex Director.']);
    const off = reviewSwitch(read(false), state);
    assert.deepEqual([off.on, off.disabled, en(off.reason)], [false, true, 'Needs the Codex Director.']);
  }
  // Not checked yet is not a failure.
  assert.deepEqual([reviewSwitch(read(false), setup({ modelCatalogStatus: 'unchecked' })).disabled], [false]);
});

test('the review switch before its read, after a failed read, and on a server without the route', () => {
  assert.equal(en(reviewSwitch({ data: null, status: 500, error: 'INTERNAL_ERROR' }, setup()).reason), "Couldn't read this setting.");
  const older = reviewSwitch({ data: null, status: 404, error: 'REQUEST_FAILED' }, setup());
  assert.deepEqual([older.on, older.disabled, en(older.reason)], [false, true, "This studio can't do this yet; it arrives with a later update."]);
  const loading = reviewSwitch({ data: null, status: null, error: null }, null);
  assert.deepEqual([loading.on, loading.disabled, loading.reason], [false, true, null]);
});

test('Settings retains an attempted Codex version diagnosis with expected, found, program and supported install in both languages', async () => {
  const { codexDiagnostic } = await import('../../src/next/model/settings-director.ts');
  const diagnostic = { code: 'DIRECTOR_CODEX_VERSION_MISMATCH', expectedVersion: '0.153.4', foundVersion: '0.162.0-alpha.4',
    binaryPath: '/Applications/ChatGPT.app/codex', installPath: '/Users/fixture/.local/share/openslate-codex/node_modules/.bin/codex' };
  assert.equal(codexDiagnostic(setup()), null);
  // The attempted setup may have failed before saving: the film can still be using the demo.
  const failed = setup({ selection: { mode: 'fake' }, codexDiagnostic: diagnostic });
  assert.equal(codexState(failed), 'blocked');
  assert.equal(directorRow(failed).choices[0].ready, false);
  const message = codexDiagnostic(failed);
  for (const locale of ['en', 'zh-CN']) {
    const text = translateMsg(locale, message);
    for (const value of [diagnostic.expectedVersion, diagnostic.foundVersion, diagnostic.binaryPath, diagnostic.installPath]) assert.ok(text.includes(value), text);
    assert.ok(!text.includes('{'));
  }
  assert.match(translateMsg('en', message), /Select that program/);
  assert.match(translateMsg('zh-CN', message), /请选择该程序/);
});

test('unknown native version output gets localized guidance without echoing arbitrary child diagnostics', async () => {
  const { errorMsg } = await import('../../src/next/i18n/translate.ts');
  const details = { expectedVersion: '0.153.4', foundVersion: null, binaryPath: '/opt/codex', installPath: '/opt/openslate-codex' };
  const message = errorMsg('DIRECTOR_CODEX_VERSION_MISMATCH', details);
  assert.match(translateMsg('en', message), /could not be recognized/);
  assert.match(translateMsg('zh-CN', message), /无法识别/);
  assert.deepEqual(errorMsg('DIRECTOR_CODEX_VERSION_MISMATCH', { ...details, foundVersion: 'PRIVATE_CHILD_OUTPUT' }), { id: 'error.DIRECTOR_CODEX_VERSION_MISMATCH' });
  assert.deepEqual(errorMsg('DIRECTOR_CODEX_VERSION_MISMATCH', { ...details, binaryPath: '/opt/codex\nPRIVATE' }), { id: 'error.DIRECTOR_CODEX_VERSION_MISMATCH' });
});
