import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMsg, nativeDiagnosticMsg, translateMsg } from '../../src/next/i18n/translate.ts';
import { cardStatus } from '../../src/next/model/keyframes.ts';
import { inspectorView } from '../../src/next/model/inspector.ts';
import { codexDiagnostic, codexState, directorRow } from '../../src/next/model/settings-director.ts';
import { computerView } from '../../src/next/model/settings-computer.ts';
import { setUpDirector, shownRefusal } from '../../src/next/model/start-commands.ts';
import { lastFerryOverview, shotId } from '../../src/next/fixtures/last-ferry.ts';

const en = message => translateMsg('en', message);
const categories = {
  native_timeout: [/within 60 s/, /60 秒/],
  native_spawn_failed: [/could not start/, /无法启动/],
  native_auth_required: [/sign in/, /登录/],
  native_protocol: [/could not read/, /无法读取/],
  native_rate_limited: [/account or usage limit/, /账号或用量限制/],
  native_unknown: [/could not/, /无法|未能/],
};
const diagnostic = (category = 'native_timeout') => ({ category, ...(category === 'native_timeout' ? { limitMs: 60_000 } : {}), message: 'PRIVATE_CHILD_OUTPUT /auth/token' });
const failed = patch => ({ code: 'LOCAL_NATIVE_UNAVAILABLE', technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: 'now', nativeDiagnostic: diagnostic(), ...patch });
const setup = patch => ({
  selection: { mode: 'fake' }, selectionDigest: 'd', defaults: { binaryPath: '/codex', model: 'm' }, busy: false,
  changeAvailable: true, changeAppliesTo: 'next_turn', locked: false, modelCalls: 0, modelChoices: [{ id: 'm', label: 'm' }],
  modelCatalogStatus: 'ready', modelCatalogCheckedAt: null, ...patch,
});

for (const [category, [english, chinese]] of Object.entries(categories)) {
  test(`B25 ${category} gives plain setup and image messages in both languages`, () => {
    const native = diagnostic(category);
    const setupMessage = errorMsg('DIRECTOR_SETUP_REQUIRED', { nativeDiagnostic: native, rawMessage: 'PRIVATE_CHILD_OUTPUT' });
    const image = nativeDiagnosticMsg(native, 'images', true);
    for (const [locale, pattern] of [['en', english], ['zh-CN', chinese]]) {
      for (const message of [setupMessage, image]) {
        const text = translateMsg(locale, message);
        assert.match(text, pattern);
        assert.doesNotMatch(text, /PRIVATE_CHILD_OUTPUT|\/auth\/token|native_|[{}]/);
      }
      assert.match(translateMsg(locale, image), locale === 'en' ? /Nothing was charged/ : /没有产生费用/);
      assert.doesNotMatch(translateMsg(locale, setupMessage), /Nothing was charged|没有产生费用/);
    }
  });
}

test('B25 native timeouts show the actual limit, and missing or malformed limits get plain fallback text', () => {
  assert.match(en(nativeDiagnosticMsg({ category: 'native_timeout', limitMs: 15_000 }, 'images')), /within 15 s/);
  assert.match(en(nativeDiagnosticMsg({ category: 'native_timeout', limitMs: 65_500 }, 'setup')), /within 65.5 s/);
  for (const limitMs of [undefined, null, 'PRIVATE_CHILD_OUTPUT', NaN, Infinity, -1, 0, 600_001]) {
    const message = nativeDiagnosticMsg({ category: 'native_timeout', limitMs }, 'images');
    assert.match(en(message), /took too long/);
    assert.doesNotMatch(en(message), /PRIVATE|NaN|Infinity|undefined|[{}]/);
  }
});

test('B25 unknown diagnostic data never becomes public copy', () => {
  for (const value of [null, 'PRIVATE_CHILD_OUTPUT', {}, { category: 'PRIVATE_CHILD_OUTPUT' }, { category: 'toString' }]) {
    assert.equal(nativeDiagnosticMsg(value, 'images'), null);
    assert.deepEqual(errorMsg('DIRECTOR_SETUP_REQUIRED', { nativeDiagnostic: value, message: 'PRIVATE_CHILD_OUTPUT' }), { id: 'error.DIRECTOR_SETUP_REQUIRED' });
  }
  assert.doesNotMatch(JSON.stringify(nativeDiagnosticMsg(diagnostic(), 'images')), /PRIVATE|\/auth/);
});

test('B25 image failures need authoritative no-dispatch proof before saying nothing was charged', () => {
  for (const notDispatched of [undefined, false, 'true', true]) {
    for (const charged of [false, true]) {
      const overview = lastFerryOverview();
      const shot = overview.shots[shotId('3.1')];
      shot.keyframe = { state: 'failed', takeCount: 0, opened: false, failure: failed({ notDispatched, charged }) };
      const view = inspectorView(overview, shot, 'en-US');
      const proof = notDispatched === true && !charged;
      assert.equal(en(view.failure.message).includes('Nothing was charged'), proof);
      assert.equal(en(cardStatus(shot).reason).includes('Nothing was charged'), proof);
      if (!proof && !charged) assert.doesNotMatch(en(view.status), /not charged/);
    }
  }
});

test('B25 a failed native replacement keeps the current image and explains its cause in the Inspector', () => {
  const overview = lastFerryOverview();
  const shot = overview.shots[shotId('2.1')];
  const artifact = structuredClone(shot.keyframe.artifact);
  shot.keyframe.replacement = { state: 'failed', failure: failed({ nativeDiagnostic: diagnostic('native_auth_required'), notDispatched: true }) };
  const view = inspectorView(overview, shot, 'en-US');
  assert.deepEqual(shot.keyframe.artifact, artifact);
  assert.equal(shot.keyframe.state, 'ready');
  assert.match(en(view.failure.message), /sign in.*Nothing was charged/);
  assert.equal(view.failure.slot, 'keyframe');
  assert.match(en(view.status), /current kept/);
  assert.equal(view.regenerate.enabled, true);
});

test('B25 persisted setup diagnostics survive a read and explain Settings and computer readiness', () => {
  for (const patch of [{ nativeDiagnostic: diagnostic() }, { readiness: { status: 'blocked', nativeDiagnostic: diagnostic() } }]) {
    const data = setup(patch);
    assert.equal(codexState(data), 'blocked');
    const message = codexDiagnostic(data);
    assert.match(en(message), /within 60 s/);
    assert.equal(directorRow(data).choices[0].ready, false);
    assert.deepEqual(directorRow(data).choices[0].reason, message);
    assert.deepEqual(computerView(null, data, null).rows[0].detail, message);
    assert.doesNotMatch(JSON.stringify(message), /PRIVATE_CHILD_OUTPUT/);
  }
});

test('B25 a first-film setup refusal preserves its original code and localized diagnostic in the sheet', async () => {
  let toast = null;
  let commandCount = 0;
  const store = {
    getState: () => ({ toast }),
    dispatch(action) { if (action.type === 'toastDismiss') toast = null; },
    async read() { return setup(); },
    async command() {
      commandCount++;
      toast = { id: 1, tone: 'error', message: errorMsg('DIRECTOR_SETUP_REQUIRED', { nativeDiagnostic: diagnostic() }) };
      assert.equal(shownRefusal(store, null), 'DIRECTOR_SETUP_REQUIRED');
      return undefined;
    },
  };
  const result = await setUpDirector(store, { id: 'first', name: 'First' }, { state: 'unknown' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DIRECTOR_SETUP_REQUIRED');
  assert.match(en(result.message), /within 60 s/);
  assert.match(translateMsg('zh-CN', result.message), /60 秒/);
  assert.equal(commandCount, 1, 'a failed setup is never retried automatically');
  assert.equal(toast, null, 'the setup refusal belongs to the sheet');
});
