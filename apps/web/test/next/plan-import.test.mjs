import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { IMPORT_MAX_CHARS, importName, importNotes, importProblem, importReview, importStage, reviewTexts } from '../../src/next/model/plan-import.ts';

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
  next.shots.splice(6, 0, { id: 'gangway', sceneId: sceneId(2), purpose: 'The gangway is lowered; Mara steps aboard.', action: 'Mara crosses.', framing: 'Wide', motion: 'Static', desiredFrames: 120, imagePrompt: 'Gangway.', videoPrompt: 'Gangway, static.', narration: { mode: 'none', text: '', voice: 'stock' } });
  const review = importReview(now, next, 30);
  assert.deepEqual(review.now, { scenes: 3, shots: 8, seconds: 48 });
  assert.deepEqual(review.proposed, { scenes: 3, shots: 9, seconds: 52 });
  assert.deepEqual(review.counts, { same: 7, changed: 1, new: 1 });
  assert.deepEqual(review.scenes[1].rows.map((row) => [row.label, row.tag]), [['2.1', 'same'], ['2.2', 'same'], ['2.3', 'changed'], ['2.4', 'new']]);
  assert.deepEqual(review.scenes[1].rows[2].details, [{ id: 'plan.import.detail.line', values: { text: 'It was the last boat of the season.' } }]);
  // A new shot shows its framing and length, what happens, and both prompts in full.
  assert.deepEqual(review.scenes[1].rows[3].details, [
    { id: 'plan.import.detail.new_silent', values: { framing: 'Wide', seconds: 4 } },
    { id: 'plan.import.detail.action', values: { text: 'Mara crosses.' } },
    { id: 'plan.import.detail.prompt', values: { text: 'Gangway.' } },
    { id: 'plan.import.detail.video_prompt', values: { text: 'Gangway, static.' } },
  ]);
  assert.deepEqual(review.removed, []);
});

test('a changed prompt, action or video prompt is shown with its new words, not only as "changed"', () => {
  const now = project();
  const next = structuredClone(now);
  next.shots[0] = { ...next.shots[0], imagePrompt: 'The ticket office, lamp lit.', videoPrompt: 'Lamp flickers.', action: 'The clerk pulls the shutter.' };
  assert.deepEqual(importReview(now, next, 30).scenes[0].rows[0].details, [
    { id: 'plan.import.detail.action', values: { text: 'The clerk pulls the shutter.' } },
    { id: 'plan.import.detail.prompt', values: { text: 'The ticket office, lamp lit.' } },
    { id: 'plan.import.detail.video_prompt', values: { text: 'Lamp flickers.' } },
  ]);
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

test("the review shows the proposed brief, story and narration script beside the outline", () => {
  const now = project();
  const next = { ...structuredClone(now), story: 'A new story.', narration: { script: 'One for the morning boat.', source: 'generated' } };
  assert.deepEqual(reviewTexts(now, next), [
    { field: 'brief', now: now.brief, proposed: now.brief, changed: false },
    { field: 'story', now: now.story, proposed: 'A new story.', changed: true },
    { field: 'script', now: '', proposed: 'One for the morning boat.', changed: true },
  ]);
  // Without a script on either side, only the brief and the story are listed.
  assert.deepEqual(reviewTexts(now, now).map((text) => [text.field, text.changed]), [['brief', false], ['story', false]]);
  assert.deepEqual(importReview(now, next, 30).texts.map((text) => text.field), ['brief', 'story', 'script']);
});

test('a missing prompt says which one is missing', () => {
  const now = project();
  const next = structuredClone(now);
  next.shots[0] = { ...next.shots[0], imagePrompt: 'The ticket office, lamp lit.', videoPrompt: '' };
  const details = importReview(now, next, 30).scenes[0].rows[0].details;
  assert.deepEqual(details.at(-1), { id: 'plan.import.detail.video_prompt_none' });
  const added = structuredClone(now);
  added.shots.push({ ...added.shots[0], id: 'new-shot', imagePrompt: '', videoPrompt: '' });
  const row = importReview(now, added, 30).scenes[0].rows.find((item) => item.shotId === 'new-shot');
  assert.deepEqual(row.details.slice(-2), [{ id: 'plan.import.detail.prompt_none' }, { id: 'plan.import.detail.video_prompt_none' }]);
});
