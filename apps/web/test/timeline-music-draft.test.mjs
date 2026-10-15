import test from 'node:test';
import assert from 'node:assert/strict';
import { clearLocalDraft, readLocalDraft, writeLocalDraft } from '../src/legacy/local-draft-cache.ts';
import { musicDraftBase, musicDraftStale, validMusicGain, validMusicStart } from '../src/legacy/timeline-music-draft.ts';
import { timelineMusicCommand } from '../src/legacy/timeline-editor-model.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.window = { localStorage: new MemoryStorage(), addEventListener() {} };

const project = (headVersion, audioId, gainMilliDb = -18000, startFrame = 0) => ({
  project: { id: 'film', headVersion, soundtrack: { audioId, gainMilliDb, startFrame }, shots: [{ desiredFrames: 180 }] },
});

test('failed music edits remain separate recoverable values and never imply a new command on read', () => {
  const namespace = crypto.randomUUID(), gainField = 'music:track-a:gainMilliDb', startField = 'music:track-a:startFrame';
  const gainBase = { headVersion: 7, audioId: 'track-a', savedValue: -18000 };
  const startBase = { headVersion: 7, audioId: 'track-a', savedValue: 0 };
  const gain = writeLocalDraft(namespace, 'film', gainField, -12000, gainBase, null);
  const start = writeLocalDraft(namespace, 'film', startField, 60, startBase, null);
  assert.equal(gain.status, 'saved'); assert.equal(start.status, 'saved');
  let posts = 0;
  const recoveredGain = readLocalDraft(namespace, 'film', gainField, validMusicGain);
  const recoveredStart = readLocalDraft(namespace, 'film', startField, validMusicStart);
  assert.equal(posts, 0, 'hydration only reads local state');
  assert.equal(recoveredGain.value, -12000); assert.equal(recoveredStart.value, 60);
  assert.equal(musicDraftStale(recoveredGain.value, musicDraftBase(recoveredGain.base), -18000, 7, 'track-a'), false);
  assert.equal(musicDraftStale(recoveredStart.value, musicDraftBase(recoveredStart.base), 0, 7, 'track-a'), false);
  const explicitSave = value => { posts++; return timelineMusicCommand(project(7, 'track-a'), 'gainMilliDb', value, recoveredGain.base.headVersion); };
  assert.equal(explicitSave(recoveredGain.value)?.value, '-12000'); assert.equal(posts, 1);
  assert.equal(readLocalDraft(namespace, 'film', gainField, validMusicGain).value, -12000,
    'a submitted value remains recoverable until the canonical project confirms it');
  assert.equal(readLocalDraft(namespace, 'other-film', gainField, validMusicGain), null);
  assert.equal(readLocalDraft(namespace, 'film', 'music:track-b:gainMilliDb', validMusicGain), null);
  assert.equal(clearLocalDraft(namespace, 'film', gainField, gain.revision), 'saved');
  assert.equal(readLocalDraft(namespace, 'film', gainField, validMusicGain), null);
  assert.equal(readLocalDraft(namespace, 'film', startField, validMusicStart).value, 60);
});

test('recovered music edits require explicit review after the head, saved value or placement changes', () => {
  const base = { headVersion: 4, audioId: 'track-a', savedValue: 0 };
  assert.equal(musicDraftStale(30, base, 0, 4, 'track-a'), false);
  assert.equal(musicDraftStale(30, base, 0, 5, 'track-a'), true);
  assert.equal(musicDraftStale(30, base, 15, 4, 'track-a'), true);
  assert.equal(musicDraftStale(30, base, 0, 4, 'track-b'), true);
  assert.equal(musicDraftStale(30, null, 0, 4, 'track-a'), true);
  assert.equal(timelineMusicCommand(project(5, 'track-a'), 'startFrame', 30, base.headVersion), null,
    'the old project head cannot authorize a new placement');
  const reviewed = { headVersion: 5, audioId: 'track-a', savedValue: 0 };
  assert.equal(musicDraftStale(30, reviewed, 0, 5, 'track-a'), false);
  assert.equal(timelineMusicCommand(project(5, 'track-a'), 'startFrame', 30, reviewed.headVersion)?.value, '30');
  assert.equal(musicDraftStale(30, base, 30, 5, 'track-a'), false,
    'canonical confirmation clears even an older local base');
  assert.equal(validMusicGain(-12001), false); assert.equal(validMusicGain(-12000), true);
  assert.equal(validMusicStart(-1), false); assert.equal(validMusicStart(60), true);
});
