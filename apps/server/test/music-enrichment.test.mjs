import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeminiHttpTransport, geminiAudioQuote, parseGeminiAudioResponse } from '@openslate/providers';
import { GeminiMusicListener, measuredDownbeats, parseEnrichment, parseTimestamp, snapEdge, LISTEN_MAX_SECONDS } from '../dist/media/music-enrichment.js';
import { LocalMusicAnalyzer } from '../dist/media/music-analyzer.js';
import { createApp } from '../dist/app.js';
import { seven } from './helpers/contract-seven-fixture.mjs';

// No real Gemini call is made anywhere in this file: every listen goes through a fake transport.
const sha = (seed) => (seed.repeat(64)).slice(0, 64);
const KEY = 'synthetic-gemini-key-never-sent';
const credentials = (configured = true) => ({ status: () => ({ credentials: [{ id: 'gemini-audio', configured }] }),
  resolve: () => { assert.ok(configured, 'the key is resolved only when configured'); return KEY; } });
/** 120 BPM: a beat every 15 frames, a downbeat every 60; measured sections at 0, 20 and 40 s. */
const MEASURED = { durationFrames: 1800, beatFrames: Array.from({ length: 120 }, (_, i) => i * 15), sectionStartFrames: [0, 600, 1200] };

function stereoWav(path, seconds = 1) {
  const samples = 48000 * seconds, out = Buffer.alloc(44 + samples * 4);
  out.write('RIFF', 0, 'ascii'); out.writeUInt32LE(36 + samples * 4, 4); out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(48000, 24);
  out.writeUInt32LE(192000, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36, 'ascii'); out.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) { out.writeInt16LE(3000, 44 + i * 4); out.writeInt16LE(-1500, 46 + i * 4); }
  writeFileSync(path, out);
}
function fixture(t, { configured = true, answer, seconds = 60 } = {}) {
  const f = seven(t), id = randomUUID(), wav = join(f.root, `${id}.wav`);
  stereoWav(wav);
  f.store.insert('narration_audio', id, f.project.id, { id, projectId: f.project.id, declaredOrigin: 'uploaded', requestId: randomUUID(), role: 'music',
    media: { kind: 'audio', sha256: sha(id.replace(/[^a-f0-9]/g, '') || 'a'), byteLength: seconds * 192000, probe: { audio: { samples: seconds * 48000, sampleRate: 48000, channels: 2 } } } });
  f.store.put('song_timing', id, f.project.id, { id, projectId: f.project.id, sha256: f.store.get('narration_audio', id).media.sha256,
    timing: { version: 'song-timing@1', durationSamples: 60 * 48000, ...MEASURED, bpm: 120 } });
  const narration = { mediaAvailable: true, media: { verifiedSource: async () => ({ path: wav }) } };
  const requests = [];
  const transport = () => ({ generate: async request => { requests.push(request); return typeof answer === 'function' ? answer(request) : answer; } });
  const make = () => new GeminiMusicListener({ production: f.service, narration, credentials: credentials(configured), transport, now: () => new Date('2026-10-28T12:00:00Z') });
  const listener = make();
  f.tools = new (f.tools.constructor)(f.service, { musicAnalyzers: { local: new LocalMusicAnalyzer(f.service), enrichment: listener } });
  return { f, id, listener, make, requests, sha256: f.store.get('narration_audio', id).media.sha256 };
}
const completed = (body) => ({ kind: 'completed', text: JSON.stringify(body), usage: { inputTokens: 2520, audioTokens: 1920, outputTokens: 900, thoughtTokens: 300 }, modelVersion: 'gemini-3.8-flash' });
const SONG = {
  canHear: true,
  sections: [
    { label: 'intro', start: '0:00', end: '0:08.2', mood: 'hushed and expectant', energy: 'low' },
    { label: 'verse', start: '0:08.2', end: '0:21.3', mood: 'warm, steady', energy: 'medium' },
    { label: 'chorus', start: '0:21.3', end: '0:40.6', mood: 'soaring', energy: 'high' },
    { label: 'outro', start: '0:40.6', end: '1:00', mood: 'fading', energy: 'low' },
  ],
  vocals: [{ start: '0:08.5', end: '0:20' }, { start: '0:19', end: '0:40.5' }],
  lyrics: [{ start: '0:08.5', end: '0:12', text: 'Last ferry leaves at nine' }, { start: '0:21.5', end: '0:25', text: 'Hold the\nrail' }],
};

test('timestamps, downbeats and snapping are pure and recorded', () => {
  assert.equal(parseTimestamp('1:05.5'), 65.5); assert.equal(parseTimestamp('01:05'), 65); assert.equal(parseTimestamp('1:02:03'), 3723);
  assert.equal(parseTimestamp(12.5), 12.5); assert.equal(parseTimestamp('12.5s'), 12.5);
  for (const bad of ['1:75', 'soon', '', -1, NaN, null, '1:2:3:4']) assert.equal(parseTimestamp(bad), null, String(bad));
  const downbeats = measuredDownbeats(MEASURED.beatFrames, MEASURED.sectionStartFrames);
  assert.equal(downbeats.phase, 0); assert.deepEqual(downbeats.frames.slice(0, 3), [0, 60, 120]);
  // Section starts on the second beat of the bar move the phase.
  assert.equal(measuredDownbeats(MEASURED.beatFrames, [0, 615, 1215]).phase, 1);
  assert.equal(measuredDownbeats([0, 15, 30], []).source, 'none');
  assert.deepEqual(snapEdge(639, downbeats.frames, 1800), { frame: 660, movedFrames: 21, to: 'downbeat' });
  assert.deepEqual(snapEdge(20, downbeats.frames, 1800), { frame: 0, movedFrames: -20, to: 'edge' });
  assert.deepEqual(snapEdge(1790, downbeats.frames, 1800), { frame: 1800, movedFrames: 10, to: 'edge' });
  assert.deepEqual(snapEdge(400, [], 1800), { frame: 400, movedFrames: 0, to: 'none' });
});

test('parseEnrichment clamps to the measured length, snaps sections to downbeats and rejects malformed output', () => {
  const ok = parseEnrichment(JSON.stringify(SONG), MEASURED);
  assert.equal(ok.kind, 'ok');
  const { sections, vocalRanges, lyrics, adjustments } = ok.result;
  assert.deepEqual(sections.map(s => [s.label, s.startFrame, s.endFrame]), [['intro', 0, 240], ['verse', 240, 660], ['chorus', 660, 1200], ['outro', 1200, 1800]],
  'every inner edge moved to the nearest downbeat');
  assert.deepEqual(sections[2].snap.end, { frame: 1200, movedFrames: -18, to: 'downbeat' });
  const chorus = sections[2];
  assert.deepEqual(chorus.snap.start, { frame: 660, movedFrames: 21, to: 'downbeat' });
  assert.equal(chorus.snap.reportedStartSeconds, 21.3); assert.equal(chorus.mood, 'soaring'); assert.equal(chorus.energy, 'high');
  for (const s of sections) assert.equal(s.suggestedShotFrames.reduce((a, b) => a + b, 0), s.endFrame - s.startFrame);
  assert.deepEqual(vocalRanges, [{ startSeconds: 8.5, endSeconds: 40.5 }], 'overlapping vocal ranges merge');
  assert.equal(lyrics[1].text, 'Hold the rail', 'control characters are flattened');
  assert.deepEqual(adjustments, { outOfRange: 0, clampedEnds: 0, invalid: 0, collapsedSections: 0, trimmedOverlaps: 0 });

  // Overlong times: past-the-end items drop, ends past the end clamp, unknown labels drop.
  const long = parseEnrichment(JSON.stringify({ ...SONG,
    sections: [...SONG.sections.slice(0, 3), { label: 'outro', start: '0:40.6', end: '1:15', mood: 'fading', energy: 'low' }, { label: 'outro', start: '1:10', end: '1:20', mood: 'x', energy: 'low' }, { label: 'refrain', start: '0:30', end: '0:31', mood: 'x', energy: 'low' }],
    lyrics: [...SONG.lyrics, { start: '0:58', end: '1:04', text: 'over the end' }, { start: '1:30', end: '1:34', text: 'beyond' }] }), MEASURED);
  assert.equal(long.kind, 'ok');
  assert.equal(long.result.sections.at(-1).endFrame, 1800); assert.equal(long.result.lyrics.at(-1).endSeconds, 60);
  assert.ok(long.result.lyrics.every(line => line.endSeconds <= 60 && line.text !== 'beyond'));
  assert.deepEqual(long.result.adjustments, { outOfRange: 2, clampedEnds: 2, invalid: 1, collapsedSections: 0, trimmedOverlaps: 0 });

  // Mostly past the end: Gemini heard another timescale, so nothing is placed.
  const shifted = parseEnrichment(JSON.stringify({ canHear: true, sections: [{ label: 'verse', start: '2:00', end: '3:00', mood: 'x', energy: 'low' }, { label: 'chorus', start: '0:10', end: '0:20', mood: 'x', energy: 'low' }],
    vocals: [{ start: '2:10', end: '2:20' }], lyrics: [{ start: '2:30', end: '2:40', text: 'la' }] }), MEASURED);
  assert.deepEqual(shifted, { kind: 'malformed', code: 'GEMINI_TIMESTAMPS_OUT_OF_RANGE', reason: shifted.reason });
  assert.equal(parseEnrichment('{"canHear": tru', MEASURED).code, 'GEMINI_OUTPUT_MALFORMED');
  assert.equal(parseEnrichment('{"sections": []}', MEASURED).code, 'GEMINI_OUTPUT_MALFORMED');
  assert.equal(parseEnrichment('{"canHear": true, "sections": [], "vocals": [], "lyrics": []}', MEASURED).code, 'GEMINI_SECTIONS_MISSING');
  assert.deepEqual(parseEnrichment('{"canHear": false, "sections": [], "vocals": [], "lyrics": []}', MEASURED), { kind: 'unheard' });
});

test('without a key analyze_music says enrichment is unavailable and nothing is sent', async t => {
  const { f, id, listener, requests, sha256 } = fixture(t, { configured: false, answer: completed(SONG) });
  const analysis = await f.openTurn({ editing: false }).call('analyze_music', { audioId: id });
  assert.equal(analysis.enrichment.state, 'unavailable'); assert.equal(analysis.enrichment.code, 'GEMINI_KEY_MISSING');
  assert.match(analysis.enrichment.reason, /OPENSLATE_GEMINI_API_KEY/);
  assert.equal(analysis.tempo.bpm, 120); assert.equal(analysis.lyrics, undefined);
  assert.equal(listener.listen(f.project.id, id, sha256).state, 'unavailable', 'a press without a key sends nothing');
  assert.equal(requests.length, 0);
  // A server without a listener says so too.
  const bare = seven(t), song = randomUUID();
  bare.store.insert('narration_audio', song, bare.project.id, { id: song, projectId: bare.project.id, declaredOrigin: 'uploaded', requestId: randomUUID(), role: 'music',
    media: { kind: 'audio', sha256: sha('b'), byteLength: 1, probe: { audio: { samples: 48000, sampleRate: 48000, channels: 2 } } } });
  bare.store.put('song_timing', song, bare.project.id, { id: song, projectId: bare.project.id, sha256: sha('b'), timing: { version: 'song-timing@1', durationSamples: 60 * 48000, ...MEASURED, bpm: 120 } });
  bare.tools = new (bare.tools.constructor)(bare.service, { musicAnalyzers: { local: new LocalMusicAnalyzer(bare.service) } });
  assert.equal((await bare.openTurn().call('analyze_music', { audioId: song })).enrichment.code, 'MUSIC_LISTENER_NOT_CONFIGURED');
});

test('with a key analyze_music quotes and waits for the person; the press listens once and caches per recording', async t => {
  const { f, id, listener, make, requests, sha256 } = fixture(t, { answer: completed(SONG) });
  const before = await f.openTurn({ editing: false }).call('analyze_music', { audioId: id });
  assert.equal(before.enrichment.state, 'needs_confirmation');
  assert.match(before.enrichment.audioLeavesMachine, /Google/);
  assert.ok(before.enrichment.quote.typicalMicros > 0 && before.enrichment.quote.maxMicros >= before.enrichment.quote.typicalMicros);
  assert.match(before.enrichment.next, /Analyze song/);
  assert.equal(requests.length, 0, 'analyze_music never spends');
  assert.throws(() => listener.listen(f.project.id, id, sha('c')), error => error.code === 'RECORDING_CHANGED');

  assert.equal(listener.listen(f.project.id, id, sha256).state, 'running');
  assert.equal(listener.listen(f.project.id, id, sha256).state, 'running', 'a second press while listening sends nothing');
  await listener.settled(f.project.id, id);
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.model, 'gemini-3.8-flash'); assert.match(request.prompt, /1:00\.0/);
  const wav = Buffer.from(request.audio.bytes);
  assert.equal(wav.readUInt16LE(22), 1); assert.equal(wav.readUInt32LE(24), 16000); assert.equal(wav.length, 44 + 16000 * 2);
  assert.equal(wav.readInt16LE(44), 750, 'stereo downmixed to mono');

  const after = await f.openTurn({ editing: false }).call('analyze_music', { audioId: id });
  assert.equal(after.enrichment.state, 'ready');
  assert.equal(after.analyzer, 'local-song-timing@1+gemini-music@1');
  assert.equal(after.tempo.bpm, 120); assert.equal(after.durationFrames, 1800);
  assert.deepEqual(after.beats.frames, MEASURED.beatFrames, 'measured beats are never replaced');
  assert.deepEqual(after.sections.map(s => s.startFrame), [0, 600, 1200], 'measured sections stay; labelled ones are in enrichment');
  assert.deepEqual(after.enrichment.sections.map(s => s.label), ['intro', 'verse', 'chorus', 'outro']);
  assert.equal(after.lyrics.length, 2); assert.deepEqual(after.vocalRanges, after.enrichment.vocalRanges);
  assert.match(after.enrichment.audioLeftMachine, /Google/);
  // 2520 × $0.75/M + 1200 × $3.75/M.
  assert.equal(after.enrichment.cost.estimatedMicros, 6390);

  // Cache hits: the same listener, another press and a restarted listener all read it without sending.
  assert.equal(listener.listen(f.project.id, id, sha256).state, 'ready');
  assert.equal(make().enrichment(f.project.id, id).state, 'ready');
  assert.equal(requests.length, 1);
  // The cache follows the bytes and the analyzer version: the same bytes imported again reuse it, other bytes need a press.
  const audio = f.store.get('narration_audio', id), again = randomUUID(), other = randomUUID();
  f.store.insert('narration_audio', again, f.project.id, { ...audio, id: again });
  f.store.insert('narration_audio', other, f.project.id, { ...audio, id: other, media: { ...audio.media, sha256: sha('d') } });
  assert.equal(listener.enrichment(f.project.id, again).state, 'ready');
  assert.equal(listener.enrichment(f.project.id, other).state, 'needs_confirmation');
  assert.ok(f.store.get('music_enrichment', `${f.project.id}:${sha256}:gemini-music@1:gemini-3.8-flash`), 'keyed by bytes, analyzer version and model');
});

test('malformed output, refusals and transport failures are recorded honestly and can be pressed again', async t => {
  const answers = [
    [{ kind: 'completed', text: 'I think this is a ballad', usage: {}, modelVersion: null }, 'GEMINI_OUTPUT_MALFORMED', 'maybe'],
    [completed({ canHear: true, sections: [{ label: 'verse', start: '3:00', end: '3:30', mood: 'x', energy: 'low' }], vocals: [], lyrics: [{ start: '4:00', end: '4:05', text: 'la' }] }), 'GEMINI_TIMESTAMPS_OUT_OF_RANGE', 'maybe'],
    [{ kind: 'refused', reason: 'RECITATION', usage: {}, charged: 'maybe' }, 'GEMINI_REFUSED', 'maybe'],
    [completed({ canHear: false, sections: [], vocals: [], lyrics: [] }), 'GEMINI_COULD_NOT_HEAR', 'maybe'],
    [{ kind: 'failed', error: { code: 'GEMINI_AUTH_REJECTED', category: 'auth', charged: 'no', httpStatus: 401 } }, 'GEMINI_AUTH_REJECTED', 'no'],
  ];
  let next = 0;
  const { f, id, listener, requests, sha256 } = fixture(t, { answer: () => answers[next][0] });
  for (const [, code, charged] of answers) {
    listener.listen(f.project.id, id, sha256); await listener.settled(f.project.id, id);
    const state = listener.enrichment(f.project.id, id);
    assert.equal(state.state, 'failed'); assert.equal(state.code, code); assert.equal(state.charged, charged);
    assert.ok(state.quote.typicalMicros > 0, 'a failed listen shows the price of trying again');
    const analysis = await f.openTurn({ editing: false }).call('analyze_music', { audioId: id });
    assert.equal(analysis.enrichment.state, 'failed'); assert.equal(analysis.lyrics, undefined); assert.equal(analysis.tempo.bpm, 120);
    next++;
  }
  assert.equal(requests.length, answers.length, 'each press is one call; nothing retried itself');
  // A listen that was running when OpenSlate stopped reads as interrupted, possibly charged.
  const { error: _settled, ...listen } = f.store.get('music_listen', `${f.project.id}:${id}`);
  f.store.put('music_listen', `${f.project.id}:${id}`, f.project.id, { ...listen, state: 'running' });
  assert.deepEqual([listener.enrichment(f.project.id, id).code, listener.enrichment(f.project.id, id).charged], ['LISTEN_INTERRUPTED', 'maybe']);
});

test('songs over the inline limit are unavailable, and the quote follows the published prices', async t => {
  const { f, id, listener } = fixture(t, { seconds: LISTEN_MAX_SECONDS + 1, answer: completed(SONG) });
  assert.equal(listener.enrichment(f.project.id, id).code, 'SONG_TOO_LONG');
  const song = geminiAudioQuote('gemini-3.8-flash', 180, 600, new Date('2026-10-28T00:00:00Z'));
  assert.equal(song.inputTokens, 180 * 32 + 600);
  assert.equal(song.typicalMicros, Math.ceil((6360 * 750000 + 3660 * 3750000) / 1e6));
  assert.equal(song.maxMicros, Math.ceil((6360 * 750000 + 16384 * 3750000) / 1e6));
  const later = geminiAudioQuote('gemini-3.8-flash', 180, 600, new Date('2027-01-01T00:00:00Z'));
  assert.equal(later.priceUntil, null); assert.ok(later.typicalMicros > song.typicalMicros);
  assert.ok(geminiAudioQuote('gemini-3.5-flash-lite', 180, 600, new Date('2026-10-28T00:00:00Z')).typicalMicros < song.typicalMicros);
});

test('HTTP: the person reads and presses song analysis; Settings sees key status without the key', async t => {
  const { f, id, listener, requests, sha256 } = fixture(t, { answer: completed(SONG) });
  const token = 'offline-music-enrichment-token';
  const app = createApp({ service: f.service, localToken: token, musicListener: listener });
  t.after(() => app.close());
  const call = (method, url, payload) => app.inject({ method, url, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  const path = `/api/projects/${f.project.id}/audio-library/${id}/song-analysis`;
  assert.equal((await call('GET', path)).json().state, 'needs_confirmation');
  assert.equal((await call('POST', path, { expectedSha256: 'nope' })).statusCode, 400);
  assert.equal((await call('POST', path, { expectedSha256: sha256 })).json().state, 'running');
  await listener.settled(f.project.id, id);
  assert.equal((await call('GET', path)).json().state, 'ready'); assert.equal(requests.length, 1);
  assert.equal((await call('GET', `/api/projects/${f.project.id}/audio-library/missing/song-analysis`)).statusCode, 404);
  const providers = await call('GET', '/api/providers');
  const music = providers.json().musicListener;
  assert.equal(music.configured, true); assert.equal(music.variable, 'OPENSLATE_GEMINI_API_KEY'); assert.match(music.audioLeavesMachine, /Google/);
  assert.ok(!providers.body.includes(KEY));
  const off = createApp({ service: f.service, localToken: token, musicListener: null }); t.after(() => off.close());
  assert.equal((await off.inject({ method: 'GET', url: '/api/providers', headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } })).json().musicListener, undefined);
});

test('the HTTP transport sends one inline generateContent request with the key only in its header', async () => {
  const calls = [];
  const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  let next = () => reply(200, { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"canHear":true}' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 6000, candidatesTokenCount: 800, thoughtsTokenCount: 200, promptTokensDetails: [{ modality: 'AUDIO', tokenCount: 5760 }] }, modelVersion: 'gemini-3.8-flash' });
  const fetch = async (url, init) => { calls.push({ url, init }); return next(); };
  const transport = new GeminiHttpTransport({ apiKey: KEY, fetch });
  const bytes = Buffer.alloc(100, 1), audio = { bytes, sha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'), mediaType: 'audio/wav' };
  const request = { model: 'gemini-3.8-flash', audio, prompt: 'Listen.', responseSchema: { type: 'object' } };
  const ok = await transport.generate(request);
  assert.deepEqual(ok, { kind: 'completed', text: '{"canHear":true}', usage: { inputTokens: 6000, audioTokens: 5760, outputTokens: 800, thoughtTokens: 200 }, modelVersion: 'gemini-3.8-flash' });
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'audio/wav'); assert.equal(body.contents[0].parts[0].inlineData.data, bytes.toString('base64'));
  assert.deepEqual(body.generationConfig, { responseMimeType: 'application/json', responseJsonSchema: { type: 'object' }, maxOutputTokens: 16384, thinkingConfig: { thinkingLevel: 'low' } });
  assert.ok(!calls[0].url.includes(KEY));

  next = () => reply(401, { error: { message: `bad key ${KEY}` } });
  const denied = await transport.generate(request);
  assert.deepEqual(denied, { kind: 'failed', error: { code: 'GEMINI_AUTH_REJECTED', category: 'auth', charged: 'no', httpStatus: 401 } });
  next = () => reply(429, {}, { 'retry-after': '7' });
  assert.equal((await transport.generate(request)).error.retryAfterMs, 7000);
  next = () => { throw new TypeError(`socket closed ${KEY}`); };
  const lost = await transport.generate(request);
  assert.equal(lost.error.code, 'GEMINI_TRANSPORT_OR_RESPONSE_LOSS'); assert.equal(lost.error.charged, 'maybe'); assert.ok(!JSON.stringify(lost).includes(KEY));
  assert.equal((await transport.generate({ ...request, audio: { ...audio, sha256: sha('e') } })).error.code, 'GEMINI_AUDIO_INVALID', 'tampered audio is refused before sending');
  assert.equal(calls.length, 4);

  assert.deepEqual(parseGeminiAudioResponse(200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }).kind, 'refused');
  assert.equal(parseGeminiAudioResponse(200, { candidates: [{ finishReason: 'RECITATION' }] }).reason, 'RECITATION');
  assert.equal(parseGeminiAudioResponse(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }).error.code, 'GEMINI_OUTPUT_TRUNCATED');
  assert.equal(parseGeminiAudioResponse(200, null).error.code, 'GEMINI_RESPONSE_MALFORMED');
  assert.equal(parseGeminiAudioResponse(503, null).error.charged, 'maybe');
});
