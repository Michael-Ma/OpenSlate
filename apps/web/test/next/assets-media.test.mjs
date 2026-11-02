import test from 'node:test';
import assert from 'node:assert/strict';
import { fallbackSource } from '../../src/next/model/assets-media.ts';

/** A media source that answers from a table ({ fail: code } refuses), and remembers what it was asked. */
function source(name, table) {
  const asked = [];
  return {
    asked,
    revoked: [],
    async url(artifact) {
      asked.push(artifact.artifactId);
      const answer = table[artifact.artifactId];
      if (typeof answer === 'string') return `${name}:${answer}`;
      const code = answer?.fail ?? 'NOT_FOUND';
      throw Object.assign(new Error(code), { code });
    },
    revoke(url) { this.revoked.push(url); },
  };
}

const audio = (artifactId) => ({ artifactId, sha256: 'a'.repeat(64), kind: 'audio' });

test('audio is read from the second store when the first does not have it', async () => {
  const artifacts = source('artifact', { generated: 'g', broken: { fail: 'ARTIFACT_CHANGED' } });
  const narration = source('narration', { generated: 'never', recording: 'r' });
  const both = fallbackSource(artifacts, narration);
  assert.equal(await both.url(audio('generated')), 'artifact:g', 'the first store answers when it has the file');
  assert.equal(await both.url(audio('recording')), 'narration:r', 'NOT_FOUND asks the second store');
  assert.deepEqual(narration.asked, ['recording']);
  await assert.rejects(both.url(audio('broken')), (e) => e.code === 'ARTIFACT_CHANGED', 'other failures are not hidden');
  await assert.rejects(both.url(audio('missing')), (e) => e.code === 'NOT_FOUND', 'missing in both says NOT_FOUND');
  both.revoke('blob:x');
  assert.deepEqual(artifacts.revoked, ['blob:x']);
});

test('a cancelled load is not retried in the second store', async () => {
  const controller = new AbortController();
  controller.abort();
  const first = { async url() { throw Object.assign(new Error('gone'), { code: 'NOT_FOUND' }); }, revoke() {} };
  const second = source('narration', { recording: 'r' });
  await assert.rejects(fallbackSource(first, second).url(audio('recording'), controller.signal));
  assert.deepEqual(second.asked, []);
});
