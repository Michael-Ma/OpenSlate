import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { estimateMsg, impactOf, modelRows, previewCurrent, previewRequest, readiness, shotList, applyRequest, choiceFor } from '../../src/next/model/settings.ts';

const ready = { configurationValid: true, registered: true, mediaTools: { required: true, available: true }, credential: { required: true, present: true, backendUnavailable: false, apiValidated: false }, spendingPermissionRequired: false, enabledByHost: true, realExecutionEnabled: true };
const option = (id, label, kind, adapter, micros, extra = {}) => ({
  id, label, profile: { id, kind, adapter, unitCostMicros: micros },
  estimatedCost: { currency: 'USD', unitMicros: micros, basis: adapter === 'fake' ? 'fixture' : 'host_configured', actualVendorPriceVerified: false },
  readiness: { ...ready, ...(adapter === 'fake' ? { realExecutionEnabled: false, enabledByHost: false } : {}) }, ...extra,
});
const en = (m) => translateMsg('en', m);
const zh = (m) => translateMsg('zh-CN', m);

const status = {
  version: 1, projectId: 'p1', headVersion: 12, revisionId: 'rev-1', capabilityLockId: 'lock-1',
  selectionDigest: 'a'.repeat(64), catalogDigest: 'b'.repeat(64),
  selected: { image: 'gpt-image', video: 'minimax', speech: 'tts', transcription: 'whisper' },
  options: [
    option('fake-image-v1', 'Demo image', 'image', 'fake', '100'),
    option('gpt-image', 'OpenAI gpt-image-2', 'image', 'openai-image', '40000'),
    option('codex-image', 'Codex image · gpt-6-astra', 'image', 'codex-image', '0', { usage: { kind: 'codex_subscription', unit: 'native_turn', quotaEstimateAvailable: false } }),
    option('minimax', 'MiniMax H3', 'video', 'minimax-h3', '500000'),
    option('viggle', 'MiniMax H3 via Viggle', 'video', 'viggle-h3', '450000', { readiness: { ...ready, realExecutionEnabled: false, credential: { required: true, present: false, backendUnavailable: false, apiValidated: false } } }),
    option('fake-video-v1', 'Demo video', 'video', 'fake', '100'),
    option('tts', 'OpenAI gpt-4o-mini-tts', 'speech', 'openai-speech', '10000'),
    option('whisper', 'OpenAI whisper-1', 'transcription', 'openai-transcription', '10000'),
  ],
};

test('one row per media job, configured models first and the stand-in last', () => {
  const rows = modelRows(status, 'en');
  assert.deepEqual(rows.map((r) => r.kind), ['image', 'video', 'speech', 'transcription']);
  assert.deepEqual(rows.map((r) => translate('en', r.job)), ['Keyframes', 'Video', 'Narration', 'Transcription']);
  assert.deepEqual(rows[0].choices.map((c) => en(c.name)), ['OpenAI gpt-image-2', 'Codex image · gpt-6-astra', 'Demo keyframes']);
  assert.deepEqual(rows[1].choices.map((c) => en(c.name)), ['MiniMax H3', 'MiniMax H3 via Viggle', 'Demo video']);
  assert.equal(rows[0].selected, 'gpt-image');
  assert.equal(zh(rows[1].choices[2].name), '示例视频');
});

test('estimates are host-configured, per operation, and never $0.00 (D15)', () => {
  const rows = modelRows(status, 'en');
  const estimate = (kind, id) => en(choiceFor(rows.find((r) => r.kind === kind), id).estimate);
  assert.equal(estimate('image', 'gpt-image'), 'about $0.04 a keyframe');
  assert.equal(estimate('image', 'codex-image'), 'no price set (Codex plan)');
  assert.equal(estimate('image', 'fake-image-v1'), 'free stand-in');
  assert.equal(estimate('video', 'minimax'), 'about $0.50 a clip');
  assert.equal(estimate('speech', 'tts'), 'about $0.01 a voice line');
  assert.equal(estimate('transcription', 'whisper'), 'about $0.01 a transcription');
  assert.equal(en(estimateMsg(option('x', 'X', 'video', 'minimax-h3', '0'), 'en')), 'no price set');
  assert.equal(en(estimateMsg(option('x', 'X', 'speech', 'openai-speech', '4000'), 'en')), 'about $0.004 a voice line');
  assert.equal(zh(estimateMsg(option('x', 'X', 'video', 'minimax-h3', '500000'), 'zh-CN')), '每段视频约 $0.50');
});

test('a model that cannot run is listed with the first missing piece as its reason', () => {
  const why = (patch) => readiness({ ...option('x', 'X', 'video', 'minimax-h3', '1'), readiness: { ...ready, realExecutionEnabled: false, ...patch } });
  assert.deepEqual(readiness(option('x', 'X', 'video', 'fake', '100')), { ready: true, reason: null });
  assert.equal(en(why({ credential: { required: true, present: false, backendUnavailable: false, apiValidated: false } }).reason), 'key not set');
  assert.equal(en(why({ credential: { required: true, present: null, backendUnavailable: true, apiValidated: false } }).reason), "keys can't be read");
  assert.equal(en(why({ mediaTools: { required: true, available: false } }).reason), 'FFmpeg not found');
  assert.equal(en(why({ enabledByHost: false }).reason), 'not turned on here');
  assert.equal(en(why({ configurationValid: false }).reason), 'set up incorrectly');
  assert.equal(en(why({ registered: false }).reason), 'not installed');
  const viggle = choiceFor(modelRows(status, 'en')[1], 'viggle');
  assert.equal(viggle.ready, false);
  assert.equal(en(viggle.reason), 'key not set');
});

test('the preview sends the whole selection with one job switched, for unfinished work', () => {
  const request = previewRequest(status, 'video', 'fake-video-v1');
  assert.equal(request.path, '/settings/models/preview');
  assert.deepEqual(request.body, {
    expectedHeadVersion: 12, expectedSelectionDigest: 'a'.repeat(64), expectedCatalogDigest: 'b'.repeat(64),
    profileIds: ['gpt-image', 'fake-video-v1', 'tts', 'whisper'], scope: { kind: 'unfinished' },
  });
  const sparse = previewRequest({ ...status, selected: { image: 'gpt-image', video: null, speech: null, transcription: null } }, 'speech', 'tts');
  assert.deepEqual(sparse.body.profileIds, ['gpt-image', 'tts']);
});

const preview = (patch = {}) => ({
  version: 1, id: 'preview-1', previewDigest: 'c'.repeat(64), projectId: 'p1',
  base: { headVersion: 12, revisionId: 'rev-1', capabilityLockId: 'lock-1', selectionDigest: 'a'.repeat(64), catalogDigest: 'b'.repeat(64) },
  selected: { ...status.selected, video: 'fake-video-v1' }, scope: { kind: 'unfinished' },
  changes: ['shot-2-1', 'shot-2-2', 'shot-2-3', 'shot-3-1', 'shot-3-2'].map((shotId) => ({ nodeId: `v-${shotId}`, alias: shotId, kind: 'video', shotId, fromProfileId: 'minimax', toProfileId: 'fake-video-v1' })),
  preserved: ['shot-1-1', 'shot-1-2', 'shot-1-3'].map((shotId) => ({ nodeId: `v-${shotId}`, alias: shotId, kind: 'video', shotId, reason: 'completed' })),
  counts: { changed: 5, preserved: 3 }, generationApprovalRequired: true, allowanceRequired: false, ...patch,
});
const labels = { 'shot-1-1': '1.1', 'shot-1-2': '1.2', 'shot-1-3': '1.3', 'shot-2-1': '2.1', 'shot-2-2': '2.2', 'shot-2-3': '2.3', 'shot-3-1': '3.1', 'shot-3-2': '3.2' };

test('a preview is current only for the exact settings it was made from', () => {
  assert.equal(previewCurrent(preview(), status), true);
  assert.equal(previewCurrent(preview(), { ...status, headVersion: 13 }), false);
  assert.equal(previewCurrent(preview(), { ...status, selectionDigest: 'd'.repeat(64) }), false);
  assert.deepEqual(applyRequest(preview()), { path: '/settings/models/apply', body: { previewId: 'preview-1', previewDigest: 'c'.repeat(64) } });
});

test('the impact says what would use the new model and what stays, before anything applies', () => {
  const impact = impactOf(preview(), 'video', labels, 'en');
  assert.equal(translate('en', impact.titleId, { model: 'Demo video' }), 'Use Demo video for video?');
  assert.equal(impact.changes, true);
  assert.deepEqual(impact.lines.map(en), [
    '5 clips not made yet (2.1, 2.2, 2.3, 3.1, 3.2) would use it.',
    'The 3 clips already made stay as they are.',
    'Changed keyframes and clips need a fresh look before video is made.',
    'Switching makes nothing and charges nothing.',
  ]);
  assert.equal(impactOf(preview(), 'video', labels, 'zh-CN').lines.map(zh)[0], '还没生成的 5 段视频（2.1、2.2、2.3、3.1、3.2）会用它。');
});

test('nothing unfinished: only new work uses it; running and reviewed work is named', () => {
  const none = impactOf(preview({ changes: [], preserved: [], generationApprovalRequired: false }), 'transcription', labels, 'en');
  assert.equal(none.changes, false);
  assert.deepEqual(none.lines.map(en), ['Nothing is waiting to be made for this job, so only new work will use it.', 'Switching makes nothing and charges nothing.']);
  const speech = impactOf(preview({
    changes: [{ nodeId: 's', alias: 's', kind: 'speech', shotId: 'shot-3-2', fromProfileId: 'a', toProfileId: 'b' }, { nodeId: 'mix', alias: 'mix', kind: 'video', shotId: 'shot-3-2', fromProfileId: 'x', toProfileId: 'x' }],
    preserved: [{ nodeId: 'r', alias: 'r', kind: 'speech', shotId: 'shot-1-2', reason: 'reviewed_audio' }, { nodeId: 'q', alias: 'q', kind: 'speech', shotId: 'shot-2-3', reason: 'in_flight' }],
    generationApprovalRequired: false,
  }), 'speech', labels, 'en');
  assert.deepEqual(speech.lines.map(en), [
    '1 line with no voice yet (3.2) would use it.',
    '1 later step that depends on them is planned again.',
    '1 job already running finishes on the current model.',
    '1 voice line you already reviewed stays.',
    'Switching makes nothing and charges nothing.',
  ]);
});

test('shot lists follow storyboard order and stay short', () => {
  assert.equal(shotList(['3.2', '2.10', '2.2', '3.2'], 'en'), '2.2, 2.10, 3.2');
  assert.equal(shotList(['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2'], 'en'), '1.1, 1.2, 1.3, 2.1, 2.2, 2.3 +2');
  assert.equal(shotList(['3.1', '3.2'], 'zh-CN'), '3.1、3.2');
});
