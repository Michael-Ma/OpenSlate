import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { applyCardPresets } from '../../src/next/fixtures/routes/cards.ts';
import { fixtureMessage, FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { confirmCard } from '../../src/next/model/confirm-card.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { chosenOption, lookView, styleProposalOf } from '../../src/next/model/style-proposal.ts';
import { lipSyncEstimateMicros, performanceEdit, singingView } from '../../src/next/model/performance.ts';
import { translate, translateMsg } from '../../src/next/i18n/translate.ts';
import { listLabels } from '../../src/next/model/keyframes.ts';

// v8 Director cards on the sample film: the contract 7.0.0 confirmation cards, the style proposal (assumed note
// shape), and the singing switch's price line.

function world(presets) {
  const timers = [];
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(_ms, change) { timers.push(change); },
    flush() { while (timers.length) w.update(timers.shift()); },
  };
  applyCardPresets(w, presets);
  return w;
}
function call(w, method, path, body) {
  const answer = fixtureRoute(w, method, path, body);
  return answer === DECLINE ? fixtureCommand(w, method, path, body) : answer;
}
const note = (w, kind) => w.snapshot.notes.find((n) => n.choices[0].kind === kind);
const en = (m) => translateMsg('en', m), zh = (m) => translateMsg('zh-CN', m);
const facts = (card, locale = 'en') => card.facts.map((f) => (f.list ? translate(locale, f.text.id, { list: listLabels(f.list.map((m) => translateMsg(locale, m)), locale) }) : translateMsg(locale, f.text)));
const resolve = (w, n, choiceIndex) => call(w, 'POST', `/director/notes/${n.noteId}/resolve`, { choiceIndex, expectedVersion: n.version });

test('a delete card says what leaves the timeline and the new length, in both languages, before anything changes', () => {
  const w = world(['cards']);
  const card = confirmCard(note(w, 'confirm_delete_shots'), w.overview, 'en');
  assert.equal(en(card.title), 'Delete shot 2.3?');
  assert.equal(zh(card.title), '删除镜头 2.3？');
  assert.deepEqual(facts(card), [
    'The film goes from 48 s to 42 s.',
    'Paid work leaves the timeline: 1 keyframe and 1 voice line. It stays in Assets, and nothing is refunded.',
    'Undo puts it back.',
  ]);
  assert.equal(en(card.confirm.label), 'Delete shot');
  assert.equal(en(card.keep.label), 'Keep them');
  const scene = confirmCard(note(w, 'confirm_delete_scene'), w.overview, 'en');
  assert.equal(en(scene.title), 'Delete Scene 3, “Departure”, and its 2 shots?');
  assert.ok(facts(scene).includes('Nothing has been made for it yet, so no paid work is lost.'));
  assert.equal(en(scene.confirm.label), 'Delete scene and 2 shots');
  assert.ok(w.overview.shots[shotId('2.3')], 'showing the card deletes nothing');
});

test('confirming deletes with the person\'s own command; Keep only settles the card', () => {
  const w = world(['cards']);
  const keep = note(w, 'confirm_delete_scene');
  resolve(w, keep, 1);
  assert.ok(w.overview.scenes.some((s) => s.sceneId === sceneId(3)), 'Keep deletes nothing');
  assert.equal(en(confirmCard(note(w, 'confirm_delete_scene'), w.overview, 'en').settled), 'Kept. Nothing was deleted.');
  const del = note(w, 'confirm_delete_shots');
  const resolved = resolve(w, del, 0);
  assert.equal(resolved.state, 'resolved'); assert.ok(resolved.resolution.resultRef, 'the note names the command (Undo)');
  assert.equal(w.overview.shots[shotId('2.3')], undefined);
  assert.throws(() => resolve(w, note(w, 'confirm_delete_shots'), 0), (e) => e.code === 'NOTE_ALREADY_SETTLED');
});

test('a use_take card says the clip goes out of date and what remaking it costs', () => {
  const w = world(['cards']);
  const card = confirmCard(note(w, 'use_take'), w.overview, 'en');
  assert.equal(en(card.title), 'Use the earlier keyframe for 1.2?');
  assert.deepEqual(facts(card), [
    "The earlier take becomes 1.2's keyframe. Using it is free.",
    "1.2's clip goes out of date and needs confirming again.",
    'Making the clip again costs about $0.50.',
    'The current keyframe stays in the take history; Undo switches back.',
  ]);
  assert.equal(facts(card, 'zh-CN')[2], '重新生成视频需要约 $0.50。');
  resolve(w, note(w, 'use_take'), 0);
  assert.equal(w.overview.shots[shotId('1.2')].keyframe.artifact.artifactId, 'art-1.2');
  assert.equal(w.overview.shots[shotId('1.2')].video.state, 'outdated');
});

test('the resume card is about the whole film (never "Scene 0") and says which jobs start again', () => {
  const w = world(['resume']);
  const raw = note(w, 'confirm_resume');
  const view = noteViews([raw], w.overview)[0];
  assert.equal(en(view.anchor), 'Whole film');
  assert.equal(zh(view.anchor), '整部影片');
  const card = confirmCard(raw, w.overview, 'en');
  assert.deepEqual(facts(card), [
    '2 unsent jobs start again and are charged at the price you confirmed.',
    '1 job was already sent before the stop; it finishes either way.',
    'You can stop the film again at any time.',
  ]);
  assert.equal(en(card.confirm.label), 'Continue 2 jobs');
  resolve(w, raw, 0);
  assert.equal(w.overview.stopped, null);
  assert.equal(en(confirmCard(note(w, 'confirm_resume'), w.overview, 'en').settled), 'Continued. Stopped work is starting again.');
});

test('the style proposal offers three looks with why and risk; choosing saves the look Plan shows', () => {
  const w = world(['style']);
  const raw = w.snapshot.notes.find((n) => n.styleProposal);
  const proposal = styleProposalOf(raw);
  assert.deepEqual(proposal.options.map((o) => o.tier), ['safe', 'distinct', 'bold']);
  assert.ok(proposal.options.every((o) => o.fits && o.risk));
  assert.equal(styleProposalOf({ ...raw, styleProposal: { options: proposal.options.slice(0, 1) } }), null, 'one option is not a proposal');
  assert.equal(styleProposalOf({ ...raw, choices: [{ kind: 'reply' }] }), null, 'every option needs its choice');
  assert.equal(lookView(w.snapshot).chosen, false);
  assert.equal(translateMsg('en', lookView(w.snapshot).label), 'Not chosen yet · grounded realism by default');
  resolve(w, raw, 1);
  const settled = w.snapshot.notes.find((n) => n.noteId === raw.noteId);
  assert.equal(chosenOption(settled, proposal).styleId, 'vintage-film-16mm');
  assert.deepEqual(lookView(w.snapshot).label, { text: 'Vintage 16mm' });
  assert.match(lookView(w.snapshot).detail, /16mm/);
});

test('asking the scripted Director for looks writes a style proposal and nothing else', () => {
  const w = world([]);
  const head = w.snapshot.project.headVersion;
  fixtureMessage(w, { text: 'Suggest two or three visual styles for this film, with why each fits and its main risk.' });
  w.flush();
  const raw = w.snapshot.notes.at(-1);
  assert.ok(styleProposalOf(raw));
  assert.equal(w.snapshot.project.headVersion, head);
  assert.equal(w.snapshot.project.visualStyle, undefined);
  void FIXTURE_REPLY_MS;
});

test('the singing switch says what lip sync costs for the shot, or why it would be an ordinary clip', () => {
  assert.equal(lipSyncEstimateMicros(6), 496000, '6.2 s at $0.08');
  assert.equal(lipSyncEstimateMicros(15), 1200000, 'no tail past 15 s');
  assert.equal(lipSyncEstimateMicros(16), Math.round(16 * 80000 * 1.2));
  const shot = lastFerryOverview().shots[shotId('2.2')];
  assert.equal(translateMsg('en', singingView(shot, undefined, 30, true, 'en').note), "Turn on when the singer's mouth must match the song. Lip sync costs about $0.34 for these 4 s, instead of a normal clip.");
  assert.match(translateMsg('zh-CN', singingView(shot, 'singing', 30, true, 'zh-CN').note), /约 \$0\.34/);
  assert.equal(singingView(shot, undefined, 30, false, 'en').offered, false, 'no song: not offered');
  assert.equal(singingView(shot, 'singing', 30, false, 'en').offered, true, 'still shown to turn it off');
  assert.equal(translateMsg('en', singingView({ ...shot, lipSync: { state: 'unavailable', reason: 'no_profile' } }, 'singing', 30, true, 'en').note), 'No lip-sync model is set up, so it would be made as a normal clip. Add one in Settings › Models.');
  assert.deepEqual(performanceEdit('s', true), { kind: 'shotPerformance', id: 's', value: 'singing' });
});
