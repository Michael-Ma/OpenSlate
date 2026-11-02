import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMsg, nativeDiagnosticMsg, translateMsg } from '../../src/next/i18n/translate.ts';
import { errorInThread, failedTurns, modeLine, threadView } from '../../src/next/model/director.ts';
import { codexDiagnostic, codexState } from '../../src/next/model/settings-director.ts';
import { lastFerryDirector, lastFerryOverview, lastFerrySnapshot } from '../../src/next/fixtures/last-ferry.ts';

const files = ['~/.codex/AGENTS.md', '/tmp/director-home/AGENTS.override.md'];
const diagnostic = { category: 'native_instructions_unexpected', instructionFiles: files, message: 'PRIVATE_NATIVE_OUTPUT', contents: 'PRIVATE_INSTRUCTIONS' };
const copy = {
  en: `Codex loaded extra instruction files (${files.join(', ')}), so the Director did not run. Nothing was sent or charged.`,
  'zh-CN': `Codex 带进了额外的指令文件（${files.join(', ')}），导演为安全没有运行。没有发送任何内容，也没有计费。`,
};
const status = (nativeDiagnostic = diagnostic) => ({ ...lastFerryDirector, mode: 'native', status: 'error', activeRequestId: 'd1-request',
  turn: { requestId: 'd1-request', state: 'failed', errorCode: 'RUNTIME_INSTRUCTIONS_UNEXPECTED', ...(nativeDiagnostic ? { nativeDiagnostic } : {}) },
  message: 'PRIVATE_NATIVE_OUTPUT PRIVATE_INSTRUCTIONS',
});
const turn = (nativeDiagnostic) => ({ id: 'd1-turn', requestId: 'd1-request', state: 'failed', reason: 'failed', ...(nativeDiagnostic ? { nativeDiagnostic } : {}) });

test('D1 instruction diagnostics show the required English and Chinese copy using only safe file metadata', () => {
  for (const message of [nativeDiagnosticMsg(diagnostic, 'director'), nativeDiagnosticMsg(diagnostic, 'setup'),
    errorMsg('RUNTIME_INSTRUCTIONS_UNEXPECTED', { nativeDiagnostic: diagnostic, message: 'PRIVATE_NATIVE_OUTPUT' }),
    errorMsg('DIRECTOR_SETUP_REQUIRED', { nativeDiagnostic: diagnostic, message: 'PRIVATE_NATIVE_OUTPUT' })]) {
    for (const [locale, expected] of Object.entries(copy)) assert.equal(translateMsg(locale, message), expected);
    assert.doesNotMatch(JSON.stringify(message), /PRIVATE_|native_instructions/);
  }
});

test('D1 missing or malformed instruction metadata gets safe localized copy without native output or placeholders', () => {
  for (const instructionFiles of [undefined, null, 'PRIVATE_NATIVE_OUTPUT', [], ['PRIVATE_NATIVE_OUTPUT'], [{}],
    ['../AGENTS.md'], ['~/../AGENTS.md'], ['/tmp/./AGENTS.md'], ['/tmp//AGENTS.md'], ['/tmp/AGENTS.md\nPRIVATE_NATIVE_OUTPUT'],
    ['/tmp/AGENTS.md\x00'], ['/tmp/back\\slash/AGENTS.md'], ['/tmp/AGENTS.md\x85'], ['/tmp/AGENTS.md\u2028'],
    ['/tmp/AGENTS.md\u2029'], ['/tmp/AGENTS.md\u202e'], ['/tmp/AGENTS.md\u2066'], ['/tmp/'], ['/'],
    Array(1), Array(33).fill('/tmp/AGENTS.md'), [`/tmp/${'x'.repeat(4096)}`],
    ['~/.codex/AGENTS.md', 'PRIVATE_NATIVE_OUTPUT']]) {
    const message = nativeDiagnosticMsg({ ...diagnostic, instructionFiles }, 'director');
    for (const locale of Object.keys(copy)) {
      const text = translateMsg(locale, message);
      assert.match(text, locale === 'en' ? /Codex loaded extra instruction files/ : /Codex 带进了额外的指令文件/);
      assert.match(text, locale === 'en' ? /Nothing was sent or charged/ : /没有发送任何内容，也没有计费/);
      assert.doesNotMatch(text, /PRIVATE_|undefined|\[object|[{}]/);
    }
  }
});

test('D1 a legacy instruction refusal without metadata never renders raw runtime output', () => {
  for (const native of [null, { category: 'PRIVATE_NATIVE_OUTPUT' }, { category: 'native_timeout', limitMs: 5 }]) {
    const director = status(native);
    const attention = failedTurns([turn()], director).get('d1-request');
    assert.equal(attention.text, null);
    assert.equal(attention.detail.id, 'error.RUNTIME_INSTRUCTIONS_UNEXPECTED_no_files');
    assert.deepEqual(modeLine(director).message, attention.detail);
    assert.deepEqual(errorMsg('RUNTIME_INSTRUCTIONS_UNEXPECTED', { nativeDiagnostic: native }), attention.detail);
  }
});

test('D1 a refused current turn explains its cause under the matching message and suppresses the duplicate header', () => {
  const now = new Date('2026-10-26T12:00:00');
  const snapshot = { ...lastFerrySnapshot(now), turns: [turn()],
    conversation: [{ id: 'd1-message', role: 'user', requestId: 'd1-request', text: 'Make a plan.' }] };
  const director = status();
  const view = threadView(snapshot, lastFerryOverview(), director, 'zh-CN', now);
  const attention = view.entries.at(-1).attention;
  assert.equal(attention.text, null);
  assert.equal(translateMsg('zh-CN', attention.detail), copy['zh-CN']);
  assert.equal(errorInThread(snapshot, director), true);
  assert.equal(modeLine(director, undefined, { errorShown: true }), null);
  assert.equal(view.ending, null);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE_/);
});

test('D1 a persisted older refusal retains its diagnostic when the current Director belongs to another request', () => {
  const other = { ...status(), activeRequestId: 'later-request', turn: { ...status().turn, requestId: 'later-request',
    nativeDiagnostic: { category: 'native_instructions_unexpected', instructionFiles: ['/tmp/later/AGENTS.md'] } } };
  for (const director of [null, lastFerryDirector, other]) {
    const attention = failedTurns([turn(diagnostic)], director).get('d1-request');
    assert.equal(attention.text, null);
    assert.equal(translateMsg('en', attention.detail), copy.en);
    assert.doesNotMatch(JSON.stringify(attention), /later|PRIVATE_/);
  }
  assert.equal(failedTurns([turn(diagnostic), { ...turn(), id: 'retry', state: 'completed', reason: null }], null).size, 0,
    'a completed later turn clears the refused turn marker for its request');
});

test('D1 a refused turn without a conversation entry still gets the localized cause in the header', () => {
  const director = status();
  const snapshot = { conversation: [], turns: [turn()] };
  assert.equal(errorInThread(snapshot, director), false);
  const line = modeLine(director, undefined, { errorShown: false });
  assert.equal(line.tone, 'attention');
  assert.equal(translateMsg('zh-CN', line.message), copy['zh-CN']);
});

test('D1 Settings uses the same instruction diagnostic and image failures do not borrow a Director no-charge claim', () => {
  const setup = { nativeDiagnostic: diagnostic };
  assert.equal(codexState(setup), 'blocked');
  assert.equal(translateMsg('en', codexDiagnostic(setup)), copy.en);
  assert.equal(nativeDiagnosticMsg(diagnostic, 'images', true), null);
  assert.equal(nativeDiagnosticMsg({ category: 'native_timeout', limitMs: 60_000 }, 'director'), null);
});
