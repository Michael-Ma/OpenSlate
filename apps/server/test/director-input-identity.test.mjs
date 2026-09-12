import test from 'node:test';
import assert from 'node:assert/strict';
import { directorInputDigest } from '../dist/application/director-input-identity.js';
import { digest, toolCatalog } from '@openslate/core';

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

test('director dispatch preserves legacy identities and binds v2 catalog without credentials or launch paths', () => {
  const input = { text: 'Draft narration', context: 'same context', images: [] };
  const legacy = digest(input);
  assert.equal(directorInputDigest(input), legacy);
  assert.equal(directorInputDigest({ ...input, bridge: { toolContractVersion: '1.0.0' } }), legacy);
  const modern = { ...input, bridge: { toolContractVersion: '2.0.0', credential: 'secret', entrypoint: '/host/a' } };
  assert.equal(directorInputDigest(modern), digest({ ...input, toolContract: { version: '2.0.0', digest: toolCatalog('2.0.0').digest } }));
  assert.notEqual(directorInputDigest(modern), legacy);
  assert.equal(directorInputDigest({ ...modern, bridge: { ...modern.bridge, credential: 'new secret', entrypoint: '/host/b' } }), directorInputDigest(modern));
});
