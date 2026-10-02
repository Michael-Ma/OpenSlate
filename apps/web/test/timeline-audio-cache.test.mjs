import test from 'node:test';
import assert from 'node:assert/strict';
import { TimelineAudioCache, audioWindow } from '../src/timeline-audio-cache.ts';
const placement = (id, atSample = 0, durationSamples = 48000) => ({ id, audioId: id, sha256: 'a'.repeat(64), startSample: 0, atSample, durationSamples, gainMilliDb: 0, shotIds: [] });
const flush = () => new Promise(resolve => setImmediate(resolve));
test('audio audition cache keeps a bounded window and releases unused sources on seek and teardown', async () => {
  const revoked = [], loaded = [], updates = [], cache = new TimelineAudioCache(async placement => { loaded.push(placement.id); return `blob:${placement.id}`; }, url => revoked.push(url), (urls, error) => updates.push({ urls, error }));
  cache.select(Array.from({ length: 65 }, (_, index) => placement(`audio${index}`))); await flush(); assert.equal(loaded.length, 8); assert.equal(Object.keys(updates.at(-1).urls).length, 8);
  cache.select([placement('last')]); await flush(); assert.equal(revoked.length, 8); assert.deepEqual(Object.values(updates.at(-1).urls), ['blob:last']);
  cache.close(); assert.equal(revoked.length, 9); cache.select([placement('ignored')]); assert.equal(loaded.length, 9);
});
test('an aborted late audio load cannot publish a stale URL and is revoked once', async () => {
  let complete; const revoked = [], urls = [];
  const cache = new TimelineAudioCache(() => new Promise(resolve => { complete = resolve; }), url => revoked.push(url), next => urls.push(next));
  cache.select([placement('old')]); cache.select([]); complete('blob:old'); await flush(); assert.deepEqual(revoked, ['blob:old']); assert.deepEqual(urls.at(-1), {}); cache.close();
});
test('audition selects active narration/music and only the next two seconds of voice inputs', () => {
  const music = placement('music', 0, 360 * 48000), voices = Array.from({ length: 64 }, (_, index) => placement(`voice${index}`, index * 3 * 48000, 3 * 48000));
  assert.deepEqual(audioWindow([...voices, music], 4).map(placement => placement.id), ['music', 'voice1', 'voice2']);
  assert.equal(audioWindow([...voices, music], 130).length <= 3, true);
});


test('two placements of one recording share verified bytes but retain separate playback elements and ranges', async () => {
  const first = { ...placement('first', 0, 3 * 48000), audioId: 'shared' }, next = { ...placement('second', 3 * 48000, 3 * 48000), audioId: 'shared', startSample: 144000 };
  const window = audioWindow([first, next], 2); assert.deepEqual(window.map(placement => placement.id), ['first', 'second']);
  let loads = 0; const cache = new TimelineAudioCache(async () => { loads++; return 'blob:shared'; }, () => {}, () => {});
  cache.select(window); await flush(); assert.equal(loads, 1); cache.close();
});
