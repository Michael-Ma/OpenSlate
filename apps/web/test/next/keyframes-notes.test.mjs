import test from 'node:test';
import assert from 'node:assert/strict';
import { noteBanner, noteCallout, firstClause, proposalTimeline, regeneratePrice, settledMsg } from '../../src/next/model/note-banner.ts';
import { noteViews, sceneOpenNotes, shotCallouts } from '../../src/next/model/notes.ts';
import { lastFerryOverview, lastFerryNotes, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const label = l => ('text' in l ? l.text : en(l));
const golden = () => {
  const overview = lastFerryOverview(), proposals = lastFerryProposals();
  return { overview, proposals, views: noteViews(lastFerryNotes(), overview, proposals) };
};
const view = (views, letter) => views.find(v => v.letter === letter);

test('the banner shows the blocking recommendation b first, with its proposal as Now / After', () => {
  const { overview, proposals, views } = golden();
  const open = sceneOpenNotes(views, sceneId(2));
  assert.deepEqual(open.map(v => v.letter), ['b', 'a']);
  const banner = noteBanner(open[0], overview, proposals, 'en-US');
  assert.equal(banner.state, 'open');
  assert.equal(en(banner.eyebrow), 'Director recommends');
  assert.equal(zh(banner.eyebrow), '导演建议');
  assert.equal(banner.title, 'The 2.3 line runs 7.4 s but the shot is 6 s.');
  assert.equal(banner.sub.map(en).join(' · '), '2.3 · Settle before making video · Film 48 s → 50 s · Keeps the keyframe');
  assert.deepEqual(banner.timeline.now.map(s => [en(s.text), s.seconds, s.hot]), [['2.1 · 5 s', 5, false], ['2.2 · 4 s', 4, false], ['2.3 · 6 s', 6, false], ['Scene 3', 0, false]]);
  assert.deepEqual(banner.timeline.after.map(s => [en(s.text), s.seconds, s.hot]), [['2.1 · 5 s', 5, false], ['2.2 · 4 s', 4, false], ['2.3 · 8 s', 8, true], ['Scene 3 · 2 s later', 0, false]]);
  assert.deepEqual(banner.actions.map(a => [label(a.label), a.style, a.enabled, a.action.kind, a.proposal?.proposalId ?? null]),
    [['Make 2.3 8 s', 'chosen', true, 'proposal', 'p1'], ['Edit narration', 'outline', true, 'edit', null]]);
});

test("note a is the Director's observation: Keep maroon first, Regenerate 2.2 with its price", () => {
  const { overview, proposals, views } = golden();
  const banner = noteBanner(view(views, 'a'), overview, proposals, 'en-US');
  assert.equal(en(banner.eyebrow), "Director's note");
  assert.equal(banner.sub.map(en).join(' · '), '2.2');
  assert.equal(banner.timeline, null);
  assert.deepEqual(banner.actions.map(a => [label(a.label), a.style, a.price && en(a.price), a.enabled]),
    [['Keep maroon', 'chosen', null, true], ['Regenerate 2.2', 'outline', 'about $0.04', true]]);
  // The shot's own quote wins over the scene's.
  overview.shots[shotId('2.2')].quotes = { regenerateKeyframe: { micros: '70000', units: 2, unitMicros: '0', priceUnknown: false } };
  assert.equal(en(regeneratePrice([shotId('2.2')], overview, 'en-US')), 'about $0.07');
  // While 2.2 is being made, its regenerate choice waits.
  overview.shots[shotId('2.2')].keyframe = { ...overview.shots[shotId('2.2')].keyframe, state: 'running' };
  assert.equal(noteBanner(view(views, 'a'), overview, proposals, 'en-US').actions[1].enabled, false);
});

test('a proposal that is no longer held is shown but cannot be accepted', () => {
  const { overview, views } = golden();
  const stale = lastFerryProposals().map(p => ({ ...p, state: 'stale', staleReason: 'SHOT_CHANGED' }));
  const banner = noteBanner(noteViews(lastFerryNotes(), overview, stale).find(v => v.letter === 'b'), overview, stale, 'en-US');
  assert.equal(banner.actions[0].enabled, false);
  assert.equal(banner.timeline, null);
  assert.match(banner.sub.map(en).join(' · '), /no longer available/);
  assert.ok(views);
});

test('the settled view says how it was settled, even before the server read catches up', () => {
  const { overview, proposals, views } = golden();
  const settled = noteBanner(view(views, 'b'), overview, proposals, 'en-US', 0);
  assert.equal(settled.state, 'settled');
  assert.equal(en(settled.eyebrow), 'Director recommends · done');
  assert.deepEqual(settled.sub.map(en), ['Settled: change applied']);
  assert.deepEqual(settled.timeline.now.map(s => [en(s.text), s.hot]), [['2.1 · 5 s', false], ['2.2 · 4 s', false], ['2.3 · 8 s', true], ['Scene 3 · 2 s later', false]]);
  assert.equal(settled.actions.length, 0);
  assert.deepEqual(noteBanner(view(views, 'a'), overview, proposals, 'en-US', 0).sub.map(en), ['Settled: Keep maroon']);
  assert.equal(en(noteBanner(view(views, 'a'), overview, proposals, 'en-US', 0).eyebrow), "Director's note · done");
  const actions = view(views, 'a').choices.map(c => c.action);
  assert.equal(en(settledMsg(actions[1], view(views, 'a').choices[1].label, overview)), 'Settled: 2.2 regenerated');
});

test('card callouts: the first clause on an amber chip, the regenerate link, and a done chip once settled', () => {
  const { overview, proposals } = golden();
  const notes = lastFerryNotes();
  const views = noteViews(notes, overview, proposals);
  const a = noteCallout(shotCallouts(views, shotId('2.2'))[0], shotId('2.2'), overview, 'en-US');
  assert.deepEqual([a.letter, a.text, a.full, a.done, label(a.regenerate.label), en(a.regenerate.price), a.regenerate.choiceIndex], ['a', "Mara's coat came out maroon", "Mara's coat came out maroon, not red.", false, 'Regenerate 2.2 · about $0.04', 'about $0.04', 1]);
  // On the card the link is one short line with its price; the card already names the shot (read out after it).
  assert.deepEqual([en(a.regenerate.take), en(a.regenerate.price), a.regenerate.shots, a.regenerate.wait], ['New take', 'about $0.04', '2.2', null]);
  // The clause is whole: the chip ends where its room does (CSS), never at a fixed count of characters.
  const b = noteCallout(shotCallouts(views, shotId('2.3'))[0], shotId('2.3'), overview, 'en-US');
  assert.deepEqual([b.letter, b.text, b.full, b.regenerate], ['b', 'The 2.3 line runs 7.4 s but the shot is 6 s', 'The 2.3 line runs 7.4 s but the shot is 6 s.', null]);
  notes[0] = { ...notes[0], state: 'resolved', version: 2, resolution: { choiceIndex: 0, at: 'x' } };
  const done = noteCallout(shotCallouts(noteViews(notes, overview, proposals), shotId('2.2'))[0], shotId('2.2'), overview, 'en-US');
  assert.deepEqual([done.done, label(done.doneLabel), done.regenerate], [true, 'Keep maroon', null]);
  assert.deepEqual(shotCallouts(views, shotId('2.1')), []);
});

test('the first clause keeps decimals and stops at Chinese punctuation', () => {
  assert.equal(firstClause('The line runs 7.4 s. Shorten it.'), 'The line runs 7.4 s');
  assert.equal(firstClause('大衣出来是酱红色，不是红色。'), '大衣出来是酱红色');
  assert.equal(firstClause('Short'), 'Short');
  assert.equal(firstClause('A long clause with no punctuation that goes on and on'), 'A long clause with no punctuation that goes on and on');
  assert.equal(firstClause('Supercalifragilisticexpialidociously long word here', 20), 'Supercalifragilistic…');
});

test("a card's note link guards both known work and neutral unclassified waits", () => {
  const { overview, proposals } = golden();
  const working = (slot, code) => {
    const next = lastFerryOverview();
    next.shots[shotId('2.2')][slot] = { ...next.shots[shotId('2.2')][slot], state: 'queued', ...(code ? { waiting: { code, since: 'x' } } : {}) };
    return noteCallout(shotCallouts(noteViews(lastFerryNotes(), next, proposals), shotId('2.2'))[0], shotId('2.2'), next, 'en-US').regenerate;
  };
  const clip = working('video');
  assert.deepEqual([clip.enabled, en(clip.wait), zh(clip.wait)], [false, 'Waiting for the studio to report its status', '等待工作室报告状态']);
  const keyframe = working('keyframe');
  assert.deepEqual([keyframe.enabled, en(keyframe.wait)], [false, 'Waiting for the studio to report its status']);
  assert.equal(en(working('keyframe', 'capacity').wait), "Wait for 2.2's keyframe to finish.");
  assert.equal(en(working('video', 'capacity').wait), "Wait for 2.2's clip to finish.");
  assert.equal(noteCallout(shotCallouts(noteViews(lastFerryNotes(), overview, proposals), shotId('2.2'))[0], shotId('2.2'), overview, 'en-US').regenerate.wait, null);
});

test('a proposal strip ends at the film when its scene is the last one', () => {
  const overview = lastFerryOverview();
  const preview = { changes: [], timeline: [{ shotId: shotId('3.1'), sceneId: sceneId(3), label: '3.1', nowSeconds: 8, afterSeconds: 6, changed: true }], effects: [], filmSecondsNow: 48, filmSecondsAfter: 46 };
  const strip = proposalTimeline(preview, overview, sceneId(3));
  assert.deepEqual([...strip.now, ...strip.after].map(s => en(s.text)), ['3.1 · 8 s', 'End of film', '3.1 · 6 s', 'Ends 2 s earlier']);
});

test('a held proposal lists every field it changes, Now → After, and names the button only for a lone duration', () => {
  const { overview, proposals, views } = golden();
  const b = noteBanner(view(views, 'b'), overview, proposals, 'en-US');
  const rows = r => r.changes.map(c => [c.key.map(label).join(' · '), label(c.before), label(c.after), c.stacked]);
  assert.deepEqual(b.changes.map(c => c.field), ['desiredFrames']);
  assert.deepEqual(rows(b), [['2.3 · Length', '6 s', '8 s', false]]);
  assert.equal(label(b.actions[0].label), 'Make 2.3 8 s');

  // Duration and new words together: the button no longer names only the duration, and the words are shown.
  const words = 'Rain crosses the harbour lights as the last ferry turns for home, slower than the tide.';
  const narration = JSON.stringify({ mode: 'generated', text: words, voice: 'stock' });
  const both = proposals.map(p => p.proposalId !== 'p1' ? p : { ...p, preview: { ...p.preview, changes: [...p.preview.changes,
    { shotId: shotId('2.3'), field: 'narration', before: JSON.stringify({ mode: 'undecided', text: '', voice: 'stock' }), after: narration },
    { sceneId: sceneId(2), field: 'purpose', before: 'Crossing', after: 'Night crossing' },
    { sceneId: sceneId(2), field: 'title', before: 'Harbour at dawn', after: 'Harbour before dawn' }] } });
  const banner = noteBanner(noteViews(lastFerryNotes(), overview, both).find(v => v.letter === 'b'), overview, both, 'en-US');
  assert.deepEqual(rows(banner), [
    ['2.3 · Length', '6 s', '8 s', false],
    ['2.3 · Narration', 'No line yet', words, true],
    ['Scene 2 · Scene direction', 'Crossing', 'Night crossing', false],
    ['Scene 2 · Scene title', 'Harbour at dawn', 'Harbour before dawn', false],
  ]);
  assert.equal(label(banner.actions[0].label), 'Apply 4 changes');
  assert.equal(zh(banner.actions[0].label), '采用这 4 处修改');
  assert.deepEqual(banner.changes.map(c => zh(c.key[1])), ['时长', '旁白', '场景方向', '场景标题']);

  // A personal voice and an explicit "no narration" are said the way Plan says them.
  const voices = proposals.map(p => p.proposalId !== 'p1' ? p : { ...p, preview: { ...p.preview, changes: [
    { shotId: shotId('2.3'), field: 'narration', before: JSON.stringify({ mode: 'generated', text: 'Home.', voice: 'personal' }), after: JSON.stringify({ mode: 'none', text: '', voice: 'stock' }) }] } });
  const one = noteBanner(noteViews(lastFerryNotes(), overview, voices).find(v => v.letter === 'b'), overview, voices, 'en-US');
  assert.deepEqual(rows(one), [['2.3 · Narration', 'Home. (your personal voice)', 'None', false]]);
  assert.equal(label(one.actions[0].label), 'Apply the change');
});

test('a settled or unavailable proposal lists no changes', () => {
  const { overview, proposals, views } = golden();
  assert.deepEqual(noteBanner(view(views, 'b'), overview, proposals, 'en-US', 0).changes, []);
  const stale = proposals.map(p => ({ ...p, state: 'stale', staleReason: 'SHOT_CHANGED' }));
  assert.deepEqual(noteBanner(noteViews(lastFerryNotes(), overview, stale).find(v => v.letter === 'b'), overview, stale, 'en-US').changes, []);
});

test('a video confirm offered for a scene whose clips are all saved says why it is off, not "Play Scene 1"', () => {
  const { overview, proposals } = golden();
  const saved = overview.scenes.find(s => s.state === 'video_saved');
  const note = {
    noteId: 'n-saved', letter: 'c', kind: 'recommendation', state: 'open', text: 'Remake only 1.1.', anchor: { text: '1.1' }, blocking: false,
    sceneId: saved.sceneId, regeneration: null, settled: null,
    choices: [{ label: { text: 'Confirm' }, chosen: false, action: { kind: 'confirm_video', noteId: 'n-saved', choiceIndex: 0, sceneId: saved.sceneId } }],
  };
  const action = noteBanner(note, overview, proposals, 'en-US').actions[0];
  assert.equal(action.enabled, false);
  assert.equal(en(action.reason), `Every clip in Scene ${saved.ordinal} is already saved. To redo one, ask the Director for a new clip of that shot; its keyframe is kept.`);
  assert.equal(zh(action.reason), `第 ${saved.ordinal} 场的视频都已保存。要重做某个镜头，请让导演为那个镜头重做视频，关键帧会保留。`);
});

const remakeNote = (shotIds) => ({
  noteId: 'n-clip', letter: 'd', kind: 'recommendation', state: 'open', text: 'A new clip for 1.1.', anchor: { text: '1.1' }, blocking: false,
  sceneId: null, regeneration: null, settled: null,
  choices: [{ label: { text: 'New clip' }, chosen: false, action: { kind: 'remake_clip', noteId: 'n-clip', choiceIndex: 0, shotIds } }],
});

test('a new-clip choice is priced from the shots’ own remake quotes and runs only when the server says it can', () => {
  const { overview, proposals } = golden();
  const saved = overview.scenes.find(s => s.state === 'video_saved');
  const id = saved.shotIds[0], shot = overview.shots[id];
  shot.quotes = { ...shot.quotes, remakeClip: { micros: '100000', priceUnknown: false, units: 1, unitMicros: '100000' } };
  shot.remakeClip = { available: true };
  const on = noteBanner(remakeNote([id]), overview, proposals, 'en-US').actions[0];
  assert.deepEqual([on.enabled, en(on.price), on.reason, on.style], [true, 'about $0.10', null, 'chosen']);
  // The label comes from the typed choice, never the model.
  const raw = { noteId: 'r1', letter: 'd', kind: 'recommendation', state: 'open', text: 'New clip?', anchor: { shotIds: [id] }, blocking: false,
    createdAt: '2026-10-29T00:00:00.000Z', choices: [{ kind: 'remake_clip', shotIds: [id] }, { kind: 'reply' }] };
  const viewed = noteViews([raw], overview, proposals).find(v => v.noteId === 'r1');
  assert.equal(en(viewed.choices[0].label), `New clip for ${shot.label}`);
  assert.equal(zh(viewed.choices[0].label), `为 ${shot.label} 重做视频`);
  assert.deepEqual(viewed.choices[0].action, { kind: 'remake_clip', noteId: 'r1', choiceIndex: 0, shotIds: [id] });

  shot.remakeClip = { available: false, code: 'CLIP_NOT_SAVED' };
  const off = noteBanner(remakeNote([id]), overview, proposals, 'en-US').actions[0];
  assert.equal(off.enabled, false);
  assert.equal(en(off.reason), "This shot has no saved clip yet. Use the scene's Confirm to make it.");

  // No remake quote from the server: the press is not offered with a guessed price.
  shot.remakeClip = { available: true };
  delete shot.quotes.remakeClip;
  assert.equal(noteBanner(remakeNote([id]), overview, proposals, 'en-US').actions[0].enabled, false);
});

test('a settled new-clip note says the clip is being made, failed (old clip kept) or saved', () => {
  const { overview } = golden();
  const id = overview.scenes.find(s => s.state === 'video_saved').shotIds[0], shot = overview.shots[id];
  const said = () => en(settledMsg({ kind: 'remake_clip', noteId: 'n', choiceIndex: 0, shotIds: [id] }, { text: '' }, overview));
  assert.equal(said(), `Settled: new clip for ${shot.label} saved`);
  shot.video = { ...shot.video, replacement: { state: 'running' } };
  assert.equal(said(), `Making a new clip for ${shot.label}…`);
  shot.video = { ...shot.video, replacement: { state: 'failed' } };
  assert.equal(said(), `The new clip failed for ${shot.label}. The earlier clip is kept.`);
});
