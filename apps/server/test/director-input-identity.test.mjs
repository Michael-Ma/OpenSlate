import test from 'node:test';
import assert from 'node:assert/strict';
import { directorInputDigest } from '../dist/application/director-input-identity.js';

test('director dispatch identity binds exact ordered visual inputs without host paths', () => {
  const first = { path: '/projection/first.png', sha256: 'a'.repeat(64), mediaType: 'image/png' };
  const second = { path: '/projection/second.png', sha256: 'b'.repeat(64), mediaType: 'image/png' };
  const input = { text: 'Compare these frames.', context: { projectId: 'project', headVersion: 3 }, images: [first, second] };
  const original = directorInputDigest(input);
  assert.equal(directorInputDigest({ ...input, images: [{ ...first, path: '/other-projection/first.png' }, second] }), original);
  assert.notEqual(directorInputDigest({ ...input, images: [second, first] }), original);
  assert.notEqual(directorInputDigest({ ...input, images: [{ ...first, sha256: 'c'.repeat(64) }, second] }), original);
  assert.notEqual(directorInputDigest({ ...input, images: [{ ...first, mediaType: 'image/jpeg' }, second] }), original);
  assert.notEqual(directorInputDigest({ ...input, text: 'Use the first frame.' }), original);
});
