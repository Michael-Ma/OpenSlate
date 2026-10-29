import test from 'node:test';
import assert from 'node:assert/strict';
import { clipAudioDefault } from '@openslate/core';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector } from '../../src/next/fixtures/last-ferry.ts';
import { clipSoundGainEdit, clipSoundKeepEdit, clipSoundOf, clipSoundToast, filmClipSoundDefault, keptClipSound } from '../../src/next/model/clip-sound.ts';
import { audioAt, SAMPLE_RATE } from '../../src/next/model/film-audio.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

function world() {
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector },
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later() {}, advance() {},
  };
  return w;
}
function call(w, method, path, body) {
  const answer = fixtureRoute(w, method, path, body);
  return answer === DECLINE ? fixtureCommand(w, method, path, body) : answer;
}
const withKind = (snapshot, filmKind) => ({ ...snapshot, project: { ...snapshot.project, filmKind } });

test('the web reads the same clip-sound default as the server for every film kind', () => {
  const snapshot = lastFerrySnapshot();
  const kinds = [undefined, { kind: 'social', subtype: 'skit' }, { kind: 'narrative', tones: ['comedy'] }, { kind: 'music_video', tones: ['comedy'] }, { kind: 'explainer' }, 'social_vertical', 7];
  for (const kind of kinds.filter(k => k === undefined || typeof k === 'object'))
    assert.deepEqual(filmClipSoundDefault(withKind(snapshot, kind)), clipAudioDefault({ filmKind: kind && { version: 'film-kind@1', ...kind } }), JSON.stringify(kind));
  assert.equal(filmClipSoundDefault(withKind(snapshot, 7)).keep, false, 'a non-record is read as no kind');
  const shotId = snapshot.project.shots[0].id;
  assert.deepEqual(clipSoundOf(snapshot, shotId), { keep: false, gainDb: -6, source: 'default', reason: 'none' }, 'the sample film keeps clips muted');
  assert.equal(keptClipSound(snapshot).size, 0);
  assert.equal(keptClipSound(withKind(snapshot, { kind: 'social' })).size, snapshot.project.shots.length);
});

test('in the sample film, Keep clip sound and its level are storyboard commands with Undo, like the server', () => {
  const w = world(), shotId = w.snapshot.project.shots[1].id, video = w.overview.shots[shotId].video;
  const keep = clipSoundKeepEdit(shotId, true);
  const receipt = call(w, 'POST', '/storyboard', { ...keep, expectedHeadVersion: w.snapshot.project.headVersion });
  assert.ok(receipt.commandId);
  assert.deepEqual(w.snapshot.project.shots.find(s => s.id === shotId).clipAudio, { keep: true });
  assert.deepEqual(w.overview.shots[shotId].video, video, 'a mix choice never touches the clip');
  assert.deepEqual(clipSoundOf(w.snapshot, shotId), { keep: true, gainDb: -6, source: 'shot', reason: 'none' });
  assert.deepEqual([...keptClipSound(w.snapshot)], [shotId]);
  const level = call(w, 'POST', '/storyboard', { ...clipSoundGainEdit(shotId, -14.4), expectedHeadVersion: w.snapshot.project.headVersion });
  assert.deepEqual(w.snapshot.project.shots.find(s => s.id === shotId).clipAudio, { keep: true, gainMilliDb: -14000 });
  assert.equal(clipSoundGainEdit(shotId, 9).value, '0', 'clamped to 0 dB');
  for (const bad of [{ field: 'keep', value: 'on' }, { field: 'gainMilliDb', value: '3000' }, { field: 'loud', value: '1' }])
    assert.throws(() => call(w, 'POST', '/storyboard', { kind: 'shotClipAudio', id: shotId, ...bad, expectedHeadVersion: w.snapshot.project.headVersion }), e => e.code === 'VALIDATION_ERROR');
  call(w, 'POST', '/storyboard', { kind: 'undo', commandId: level.commandId, expectedHeadVersion: w.snapshot.project.headVersion });
  assert.deepEqual(w.snapshot.project.shots.find(s => s.id === shotId).clipAudio, { keep: true }, 'undo restores the level before');
  call(w, 'POST', '/storyboard', { kind: 'shotClipAudio', id: shotId, field: 'default', expectedHeadVersion: w.snapshot.project.headVersion });
  assert.equal('clipAudio' in w.snapshot.project.shots.find(s => s.id === shotId), false);
});

test('toasts and labels exist in English and Chinese', () => {
  const label = '1.2';
  assert.equal(translateMsg('en', clipSoundToast(label, clipSoundKeepEdit('s', true))), '1.2 keeps its clip sound.');
  assert.equal(translateMsg('zh-CN', clipSoundToast(label, clipSoundKeepEdit('s', false))), '1.2 的片段原声已静音。');
  assert.equal(translateMsg('zh-CN', clipSoundToast(label, clipSoundGainEdit('s', -12))), '1.2 的片段原声为 -12 dB。');
  assert.equal(translateMsg('en', { id: 'film.clip_sound.keep' }), 'Keep clip sound');
  assert.equal(translateMsg('zh-CN', { id: 'film.clip_sound.keep' }), '保留片段原声');
});

test('the preview applies the export ducking as gain steps on a kept clip', () => {
  const clip = { id: 'clip:s2', kind: 'clip', audioId: 'v2', sha256: 'x', startSample: 0, durationSamples: 2 * SAMPLE_RATE, atSample: SAMPLE_RATE, gainMilliDb: -6000, shotIds: ['s2'],
    gainSteps: [{ atSample: SAMPLE_RATE, gainMilliDb: -18000 }, { atSample: 1.5 * SAMPLE_RATE, gainMilliDb: -6000 }] };
  assert.ok(Math.abs(audioAt(clip, 1.2).volume - 10 ** (-18 / 20)) < 1e-6, 'under the voice: -18 dB');
  assert.ok(Math.abs(audioAt(clip, 2).volume - 10 ** (-6 / 20)) < 1e-6, 'after the voice: -6 dB');
  assert.equal(audioAt(clip, 1.2).sourceSeconds, 0.2, 'from the clip start at the shot start');
  assert.equal(audioAt(clip, 3.1).active, false, 'trimmed to the shot');
});
