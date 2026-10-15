import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactUrlCache, RELEASE_DELAY_MS, cacheFor } from '../../src/next/media/artifact-cache.ts';

function fakes({ fail = false } = {}) {
  const loads = [], revoked = [], timers = new Map();
  let id = 0, pending = [];
  const media = {
    url(artifact, signal) {
      loads.push({ artifact, signal });
      return new Promise((resolve, reject) => pending.push(() => (fail ? reject(Object.assign(new Error('x'), { code: 'ARTIFACT_CHANGED' })) : resolve(`blob:${artifact.artifactId}#${loads.length}`))));
    },
    revoke(url) { revoked.push(url); },
  };
  const clock = {
    setTimeout(callback, ms) { timers.set(++id, { callback, ms }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const flushTimers = () => { for (const [key, timer] of [...timers]) { timers.delete(key); timer.callback(); } };
  const resolveAll = async () => { const run = pending; pending = []; run.forEach(fn => fn()); await new Promise(r => setImmediate(r)); };
  return { media, clock, loads, revoked, timers, flushTimers, resolveAll };
}

const frame = { artifactId: 'art-2.2', sha256: 'a'.repeat(64), kind: 'image' };

test('the preview and the card share one load of the same frame', async () => {
  const f = fakes();
  const cache = new ArtifactUrlCache(f.media, f.clock);
  const a = cache.acquire(frame), b = cache.acquire({ ...frame });
  await f.resolveAll();
  assert.equal(f.loads.length, 1);
  assert.equal(await a, await b);
  assert.equal(cache.size, 1);
});

test('a URL nobody shows is revoked 30 s after the last release, unless it is shown again first', async () => {
  const f = fakes();
  const cache = new ArtifactUrlCache(f.media, f.clock);
  const url = cache.acquire(frame); cache.acquire(frame);
  await f.resolveAll();
  cache.release(frame);
  assert.equal(f.timers.size, 0, 'still held by one user');
  cache.release(frame);
  assert.deepEqual([...f.timers.values()].map(t => t.ms), [RELEASE_DELAY_MS]);
  // Shown again within 30 s: the same URL, no new load, no revoke.
  cache.acquire(frame);
  assert.equal(f.timers.size, 0);
  assert.equal(f.loads.length, 1);
  cache.release(frame);
  f.flushTimers();
  assert.deepEqual(f.revoked, [await url]);
  assert.equal(cache.size, 0);
});

test('a different take of the same shot is a different entry', async () => {
  const f = fakes();
  const cache = new ArtifactUrlCache(f.media, f.clock);
  cache.acquire(frame); cache.acquire({ ...frame, sha256: 'b'.repeat(64) });
  await f.resolveAll();
  assert.equal(f.loads.length, 2);
});

test('a failed load is not cached, so the next user tries again', async () => {
  const f = fakes({ fail: true });
  const cache = new ArtifactUrlCache(f.media, f.clock);
  const failed = assert.rejects(cache.acquire(frame), { code: 'ARTIFACT_CHANGED' });
  await f.resolveAll();
  await failed;
  assert.equal(cache.size, 0);
  cache.acquire(frame).catch(() => {});
  assert.equal(f.loads.length, 2);
});

test('a load dropped before it finished is cancelled, and a late URL is revoked at once', async () => {
  const f = fakes();
  const cache = new ArtifactUrlCache(f.media, f.clock);
  cache.acquire(frame);
  cache.release(frame);
  f.flushTimers();
  assert.equal(f.loads[0].signal.aborted, true);
  await f.resolveAll();
  assert.equal(f.revoked.length, 1, 'the URL that arrived after the drop was revoked');
});

test('one cache per media source', () => {
  const f = fakes();
  assert.equal(cacheFor(f.media), cacheFor(f.media));
  assert.notEqual(cacheFor(f.media), cacheFor(fakes().media));
});
