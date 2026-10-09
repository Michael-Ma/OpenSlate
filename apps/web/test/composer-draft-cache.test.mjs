import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheableComposerDraft,
  composerContextIssues,
  emptyComposerDraft,
  isComposerDraft,
} from '../src/composer-draft-cache.ts';
import { readLocalDraft, writeLocalDraft } from '../src/local-draft-cache.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}
const area = new MemoryStorage();
globalThis.window = { localStorage: area, addEventListener() {} };
const owner = () => crypto.randomUUID();
const ref = { key: '["film","scene","scene-1",""]', projectId: 'film', kind: 'scene', id: 'scene-1', label: 'Scene 1' };
const composer = (overrides = {}) => ({
  ...emptyComposerDraft(),
  text: 'Adjust the scene',
  scopeIds: ['shot-1'],
  references: [ref],
  replyQuestionId: 'question-1',
  ...overrides,
});
const context = (overrides = {}) => ({
  project: { shots: [{ id: 'shot-1' }], scenes: [{ id: 'scene-1' }] },
  questions: [{ id: 'question-1', state: 'pending', canAnswer: true }],
  pendingEditContinuations: [{ requestId: 'continue-1' }],
  control: { paused: false },
  ...overrides,
});

test('one recovery record restores text and intended scope, references and reply together', () => {
  const namespace = owner();
  const draft = composer();
  const result = writeLocalDraft(namespace, 'film', 'composer', cacheableComposerDraft(draft), null, null, isComposerDraft);
  assert.equal(result.status, 'saved');
  const restored = readLocalDraft(namespace, 'film', 'composer', isComposerDraft);
  assert.deepEqual(restored.value, draft);
  assert.deepEqual(composerContextIssues(restored.value, 'film', context()), {
    staleReply: false, staleContinuation: false, missingScopeIds: [],
    missingReferences: [], conflictingTargets: false,
  });
  assert.equal(readLocalDraft(namespace, 'other-film', 'composer', isComposerDraft), null);
});

test('deleted or changed targets keep text and report every stale context without narrowing it', () => {
  const draft = composer({ continuationRequestId: 'continue-1' });
  const before = structuredClone(draft);
  const changed = context({
    project: { shots: [], scenes: [] }, questions: [],
    pendingEditContinuations: [],
  });
  assert.deepEqual(composerContextIssues(draft, 'film', changed), {
    staleReply: true, staleContinuation: true, missingScopeIds: ['shot-1'],
    missingReferences: [ref], conflictingTargets: true,
  });
  assert.deepEqual(draft, before, 'validation cannot silently drop an old scope or target');
});

test('expiry removes the entire composer bundle; incomplete bundles never hydrate', () => {
  const namespace = owner();
  const draft = composer({ replyQuestionId: null });
  assert.equal(writeLocalDraft(namespace, 'film', 'composer', draft, null, null, isComposerDraft).status, 'saved');
  const id = [...area.values.keys()].find(key => key.includes(encodeURIComponent(namespace)));
  const expired = JSON.parse(area.getItem(id));
  expired.expiresAt = Date.now() - 1;
  area.setItem(id, JSON.stringify(expired));
  assert.equal(readLocalDraft(namespace, 'film', 'composer', isComposerDraft), null);
  assert.equal(writeLocalDraft(namespace, 'film', 'composer', { text: 'orphan' }, null, null, isComposerDraft).status, 'unavailable');
  assert.equal(area.getItem(id), null);
});

test('malformed reference detail or artifact identity cannot hydrate or break a later save', () => {
  assert.equal(isComposerDraft(composer({ references: [{ ...ref, detail: 42 }] })), false);
  assert.equal(isComposerDraft(composer({ references: [{ ...ref,
    artifact: { artifactId: 'wrong', kind: 'image', sha256: 'a'.repeat(64) } }] })), false);
});

test('a stale tab cannot replace a newer entire composer context', () => {
  const namespace = owner();
  const first = writeLocalDraft(namespace, 'film', 'composer', composer(), null, null, isComposerDraft);
  const newer = composer({ text: 'New direction', scopeIds: [], references: [], replyQuestionId: null });
  const second = writeLocalDraft(namespace, 'film', 'composer', newer, null, first.revision, isComposerDraft);
  assert.equal(second.status, 'saved');
  const stale = composer({ text: 'Old tab text', continuationRequestId: 'continue-1' });
  assert.equal(writeLocalDraft(namespace, 'film', 'composer', stale, null, first.revision, isComposerDraft).status, 'conflict');
  assert.deepEqual(readLocalDraft(namespace, 'film', 'composer', isComposerDraft)?.value, newer);
});
