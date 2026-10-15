import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { IMPORT_MAX_CHARS, importName, importNotes, importProblem, importReview, importStage } from '../../src/next/model/plan-import.ts';

const project = () => lastFerrySnapshot().project;

test('a written plan is a non-empty .txt or .md document of up to 12,000 characters', () => {
  assert.equal(importName('  '), 'plan.md');
  assert.equal(importProblem('', 'Scene one.'), null);
  assert.equal(importProblem('draft.MD', 'Scene one.'), null);
  assert.deepEqual(importProblem('draft.docx', 'Scene one.'), { id: 'plan.import.name_invalid' });
  assert.deepEqual(importProblem('draft.txt', '   '), { id: 'plan.import.text_empty' });
  assert.deepEqual(importProblem('draft.txt', 'x'.repeat(IMPORT_MAX_CHARS + 1)), { id: 'plan.import.too_long', values: { max: 12000 } });
  assert.equal(importProblem('draft.txt', 'x'.repeat(IMPORT_MAX_CHARS)), null);
});

test('the sheet follows the pending import: paste, no Codex, reading, review, out of date', () => {
  const pending = { id: 'r', name: 'a.md', text: 't', sourceDigest: 'd', stale: false, running: true, draft: null };
  assert.equal(importStage(null, true), 'paste');
  assert.equal(importStage(null, false), 'nocodex');
  assert.equal(importStage(pending, true), 'reading');
  assert.equal(importStage({ ...pending, running: false }, true), 'waiting');
  assert.equal(importStage({ ...pending, running: false, draft: { preparedId: 'p', proposalDigest: 'x', project: project() } }, false), 'review');
  assert.equal(importStage({ ...pending, stale: true, draft: { preparedId: 'p', proposalDigest: 'x', project: project() } }, true), 'stale');
});

test('the review tags every proposed shot Same, Changed or New and counts Now against proposed', () => {
  const now = project();
  const next = structuredClone(now);
  next.shots = next.shots.map((shot) => (shot.id === shotId('2.3') ? { ...shot, narration: { ...shot.narration, text: 'It was the last boat of the season.' } } : shot));
  next.shots.splice(6, 0, { id: 'gangway', sceneId: sceneId(2), purpose: 'The gangway is lowered; Mara steps aboard.', framing: 'Wide', motion: 'Static', desiredFrames: 120, imagePrompt: 'Gangway.', videoPrompt: 'Gangway.', narration: { mode: 'none', text: '', voice: 'stock' } });
  const review = importReview(now, next, 30);
  assert.deepEqual(review.now, { scenes: 3, shots: 8, seconds: 48 });
  assert.deepEqual(review.proposed, { scenes: 3, shots: 9, seconds: 52 });
  assert.deepEqual(review.counts, { same: 7, changed: 1, new: 1 });
  assert.deepEqual(review.scenes[1].rows.map((row) => [row.label, row.tag]), [['2.1', 'same'], ['2.2', 'same'], ['2.3', 'changed'], ['2.4', 'new']]);
  assert.deepEqual(review.scenes[1].rows[2].details, [{ id: 'plan.import.detail.line', values: { text: 'It was the last boat of the season.' } }]);
  assert.deepEqual(review.scenes[1].rows[3].details, [{ id: 'plan.import.detail.new_silent', values: { framing: 'Wide', seconds: 4 } }]);
  assert.deepEqual(review.removed, []);
});

test('shots the proposal leaves out are listed, and new scenes are marked', () => {
  const now = project();
  const next = structuredClone(now);
  next.shots = next.shots.filter((shot) => shot.sceneId !== sceneId(3));
  next.scenes = [...next.scenes.slice(0, 2), { id: 'epilogue', revisionId: 'x', purpose: 'Epilogue' }];
  next.shots.push({ ...now.shots[0], id: 'e1', sceneId: 'epilogue', desiredFrames: 240 });
  const review = importReview(now, next, 30);
  assert.deepEqual(review.removed, [{ label: '3.1', purpose: now.shots[6].purpose }, { label: '3.2', purpose: now.shots[7].purpose }]);
  assert.deepEqual([review.scenes[2].title, review.scenes[2].isNew, review.scenes[2].rows[0].label], ['Epilogue', true, '3.1']);
  const changed = structuredClone(now);
  changed.shots[0] = { ...changed.shots[0], desiredFrames: 240, framing: 'Close-up' };
  assert.deepEqual(importReview(now, changed, 30).scenes[0].rows[0].details.map((d) => d.id), ['plan.import.detail.length', 'plan.import.detail.framing']);
});

test("the Director's words about the plan are listed apart, from that request only", () => {
  const conversation = [
    { id: '1', role: 'user', text: 'hi', requestId: 'r1' },
    { id: '2', role: 'assistant', text: 'A two-second hold would help.', requestId: 'imp' },
    { id: '3', role: 'assistant', text: 'Other reply', requestId: 'r1' },
  ];
  assert.deepEqual(importNotes(conversation, 'imp'), ['A two-second hold would help.']);
  assert.deepEqual(importNotes(undefined, 'imp'), []);
});
