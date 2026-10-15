import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { FIXTURE_AUDIO_ROUTE, fixtureVoiceWav } from '../../src/next/fixtures/routes/narration.ts';
import { shotId } from '../../src/next/fixtures/last-ferry.ts';
import { takeView } from '../../src/next/model/narration.ts';

const base = '/api/projects/last-ferry';
function open() {
  const port = new FixturePort();
  const head = () => port.world.snapshot.project.headVersion;
  const get = (path) => port.request(path.startsWith('/api/') ? path : `${base}${path}`);
  const post = (path, body) => port.request(`${base}${path}`, { method: 'POST', body });
  const storyboard = (body) => post('/storyboard', { ...body, expectedHeadVersion: head() });
  const record = (label, body, at = head()) => post(`/shots/${shotId(label)}/narration/recording?expectedHeadVersion=${at}`, { type: 'audio/wav', size: 64000, ...body });
  const narration = (label) => port.world.overview.shots[shotId(label)].narration;
  const stored = (label) => port.world.snapshot.project.shots.find((row) => row.id === shotId(label)).narration;
  return { port, head, get, post, storyboard, record, narration, stored };
}

test('stock voices: the film narrator from Settings › Voice is marked as the default', async () => {
  const { port, get, post, head } = open();
  try {
    const read = await get('/api/narration/voices?projectId=last-ferry');
    assert.equal(read.defaultNarratorVoice, 'cedar');
    assert.equal(read.voices.length, 13);
    assert.deepEqual(read.voices.filter((v) => v.default).map((v) => v.id), ['cedar']);
    await post('/settings/voice', { narratorVoice: 'ash', expectedHeadVersion: head() });
    assert.deepEqual((await get('/api/narration/voices?projectId=last-ferry')).voices.filter((v) => v.default).map((v) => v.id), ['ash']);
    assert.equal((await get('/api/narration/voices')).defaultNarratorVoice, 'cedar', 'without a film the stock default');
  } finally { port.close(); }
});

test("a shot's take: its voice line, the voice it was made with, and its length for the stand-in audio", async () => {
  const { port, get } = open();
  try {
    const detail = await get(`/narration/shots/${shotId('2.3')}`);
    assert.equal(detail.segment.audio.originEvidence, 'verified_generated_audio');
    assert.equal(detail.segment.audio.generation.voice, 'cedar');
    assert.equal(detail.segment.audio.media.probe.audio.samples, 7.4 * 48000);
    const take = takeView(port.world.overview.shots[shotId('2.3')], detail);
    assert.equal(take.seconds, 7.4);
    assert.deepEqual(await get(`${FIXTURE_AUDIO_ROUTE}/${encodeURIComponent(take.audio.artifactId)}`), { seconds: 7.4 });
    assert.equal((await get(`/narration/shots/${shotId('2.1')}`)).segment, null, 'no narration, no section');
    await assert.rejects(get(`${FIXTURE_AUDIO_ROUTE}/nothing`), (error) => error.code === 'NOT_FOUND');
  } finally { port.close(); }
});

test('a new voice outdates a voiced line made in another voice; following the film keeps it; Undo restores it', async () => {
  const { port, storyboard, narration, stored } = open();
  try {
    const kept = await storyboard({ kind: 'narration', id: shotId('2.3'), field: 'voice', value: 'stock' });
    assert.equal(narration('2.3').state, 'ready', 'the line was made in the film\'s voice');
    assert.ok(kept.commandId);
    const pinned = await storyboard({ kind: 'narration', id: shotId('2.3'), field: 'voice', value: 'ash' });
    assert.equal(stored('2.3').voice, 'ash');
    assert.equal(narration('2.3').state, 'text_only');
    assert.equal(narration('2.3').measuredSeconds, undefined);
    assert.ok(narration('2.3').estimatedSeconds > 0);
    await storyboard({ kind: 'undo', commandId: pinned.commandId });
    assert.equal(stored('2.3').voice, 'stock');
    assert.equal(narration('2.3').state, 'ready');
    assert.equal(narration('2.3').measuredSeconds, 7.4);
    await assert.rejects(storyboard({ kind: 'narration', id: shotId('2.3'), field: 'voice', value: 'robot' }), (error) => error.code === 'VALIDATION_ERROR');
    await assert.rejects(storyboard({ kind: 'undo', commandId: pinned.commandId }), (error) => error.code === 'UNDO_UNAVAILABLE');
  } finally { port.close(); }
});

test('a recording becomes the shot\'s narration: measured, replayed by its key, and undone', async () => {
  const { port, get, head, record, storyboard, narration, stored } = open();
  try {
    const before = head();
    const receipt = await record('2.2', { name: 'mara.wav', durationSeconds: 3.2, key: 'k1' });
    assert.deepEqual([receipt.shotId, receipt.fits, receipt.measuredSeconds, receipt.headVersion], [shotId('2.2'), true, 3.2, before + 1]);
    assert.equal(receipt.recording.samples, 3.2 * 48000);
    assert.equal(stored('2.2').mode, 'uploaded');
    assert.deepEqual([narration('2.2').state, narration('2.2').measuredSeconds, narration('2.2').fits], ['ready', 3.2, true]);
    const detail = await get(`/narration/shots/${shotId('2.2')}`);
    assert.equal(detail.segment.audio.declaredOrigin, 'uploaded');
    assert.equal(detail.segment.audio.id, receipt.recording.id);
    // The same key replays its receipt: nothing is added twice.
    assert.deepEqual(await record('2.2', { name: 'mara.wav', durationSeconds: 3.2, key: 'k1' }, before), receipt);
    assert.equal(head(), before + 1);
    await storyboard({ kind: 'undo', commandId: receipt.commandId });
    assert.equal(stored('2.2'), undefined, '2.2 had no narration');
    assert.equal(narration('2.2').state, 'none');
    assert.equal((await get(`/narration/shots/${shotId('2.2')}`)).segment, null);
  } finally { port.close(); }
});

test('a recording longer than the shot is attached and then fitted through narration-fit', async () => {
  const { port, post, head, record, narration } = open();
  try {
    const receipt = await record('2.2', { name: 'long.wav', durationSeconds: 6.3, key: 'k2' });
    assert.equal(receipt.fits, false);
    assert.equal(narration('2.2').fits, false);
    const scene = port.world.overview.scenes.find((s) => s.sceneId === 'scene-2');
    assert.ok(scene.blockers.some((b) => b.code === 'narration_too_long' && b.shotId === shotId('2.2')));
    await post(`/shots/${shotId('2.2')}/narration-fit`, { fit: 'extend_shot', expectedHeadVersion: head() });
    assert.equal(port.world.overview.shots[shotId('2.2')].durationFrames, 7 * 30);
    assert.equal(narration('2.2').fit, 'extend_shot');
  } finally { port.close(); }
});

test('recording refusals, said in the reply when asked: stale film, unreadable, too long, while video is made', async () => {
  const { port, head, record } = open();
  try {
    await assert.rejects(record('2.2', { name: 'a.wav', durationSeconds: 2 }, head() - 1), (error) => error.code === 'REVISION_CONFLICT');
    assert.deepEqual(await record('2.2', { name: 'broken.wav', refusalInBody: true }), { refused: { code: 'MEDIA_INVALID_INPUT' } });
    assert.deepEqual(await record('2.2', { name: 'long.wav', durationSeconds: 400, refusalInBody: true }), { refused: { code: 'MEDIA_DURATION_LIMIT' } });
    assert.deepEqual(await record('2.2', { name: 'empty.wav', size: 0, durationSeconds: 2, refusalInBody: true }), { refused: { code: 'MEDIA_INVALID_INPUT' } });
    port.world.overview.scenes.find((s) => s.sceneId === 'scene-2').confirmation = { confirmationId: 'c', state: 'running' };
    assert.deepEqual(await record('2.2', { name: 'a.wav', durationSeconds: 2, refusalInBody: true }), { refused: { code: 'CONFIRMATION_RUNNING' } });
  } finally { port.close(); }
});

test('the Plan editor\'s "My recording" stores mode uploaded through Plan\'s own route', async () => {
  const { port, storyboard, stored } = open();
  try {
    await storyboard({ kind: 'narration', id: shotId('1.2'), field: 'mode', value: 'uploaded' });
    assert.equal(stored('1.2').mode, 'uploaded');
  } finally { port.close(); }
});

test('the stand-in audio is a WAV of the take\'s length', () => {
  const wav = new DataView(fixtureVoiceWav(2.5));
  assert.equal(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3)), 'RIFF');
  assert.equal(wav.getUint32(24, true), 8000);
  assert.equal(wav.getUint32(40, true) / 2 / 8000, 2.5);
});
