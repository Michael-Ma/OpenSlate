import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStop, modeLine, scriptedTag, scopeLabel, bylineTime, userText, paragraphs, threadView, pendingQuestions,
  composeAnswer, composerView, pickerItems, filterPicker, mentionAt, removeMention, MESSAGE_LIMIT,
  threadNotes, noteOpens, byLetter,
} from '../../src/next/model/director.ts';
import { noteViews } from '../../src/next/model/notes.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, sceneId, shotId, PROJECT_ID } from '../../src/next/fixtures/last-ferry.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { reducer } from '../../src/next/store/reducer.ts';
import { initialState } from '../../src/next/store/state.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const NOW = new Date('2026-10-14T12:00:00');
const idle = { mode: 'fake', status: 'idle', activeRequestId: null };

test('the golden thread: two entries, bylines with times, the @Scene 2 chip and the Director without a bubble', () => {
  const view = threadView(lastFerrySnapshot(NOW), lastFerryOverview(), lastFerryDirector, "en", NOW);
  assert.equal(view.entries.length, 2);
  const [you, director] = view.entries;
  assert.deepEqual([you.who, you.time, you.chips.map(en)], ['you', '10:42', ['Scene 2']]);
  assert.equal(you.paragraphs[0], "make the harbour feel colder, more like early morning, and keep Mara's red coat.");
  assert.deepEqual([director.who, director.time, director.chips], ['director', '10:44', []]);
  assert.match(director.paragraphs[0], /^I rewrote the three Scene 2 prompts/);
  assert.equal(director.scripted, false);
  assert.equal(view.working, false);
  assert.deepEqual(view.questions, []);
  assert.deepEqual(you.chips.map(zh), ['第 2 场']);
});

test('chips name scenes and shots from the overview; the whole film and unknown ids show no chip', () => {
  const overview = lastFerryOverview();
  assert.equal(en(scopeLabel(overview, sceneId(3))), 'Scene 3');
  assert.equal(en(scopeLabel(overview, shotId('2.2'))), '2.2');
  assert.equal(scopeLabel(overview, PROJECT_ID), null);
  assert.equal(scopeLabel(overview, 'gone'), null);
  const snapshot = lastFerrySnapshot();
  snapshot.conversation = [{ id: 'x', role: 'user', text: 'Whole film please', scopeIds: [PROJECT_ID] }, { id: 'y', role: 'user', text: 'Two at once', scopeIds: [shotId('2.1'), sceneId(1), shotId('2.1')] }];
  const [whole, two] = threadView(snapshot, overview, idle, 'en', NOW).entries;
  assert.deepEqual(whole.chips, []);
  assert.equal(whole.time, null);
  assert.deepEqual(two.chips.map(en), ['2.1', 'Scene 1']);
});

test('user text keeps its words; leading mentions that repeat the chips and classic reference links are cleaned', () => {
  assert.equal(userText('@Scene 2 make it colder', true), 'make it colder');
  assert.equal(userText('@Scene 2 make it colder', false), '@Scene 2 make it colder');
  assert.equal(userText('@2.2 @Shot 2.3: tighter', true), 'tighter');
  assert.equal(userText('[@Shot 2.3](#openslate-ref/p/shot/s/)\n\nShorter line', true), 'Shorter line');
  assert.equal(userText('See [@Scene 01](#openslate-ref/p/scene/s/) again', false), 'See @Scene 01 again');
  assert.equal(userText('<b>not html</b>', false), '<b>not html</b>');
});

test('Director text becomes plain paragraphs on blank lines, with single line breaks kept inside', () => {
  assert.deepEqual(paragraphs('One.\n\nTwo\nlines.\n \n\nThree.'), ['One.', 'Two\nlines.', 'Three.']);
  assert.deepEqual(paragraphs('  '), []);
});

test('byline times: today shows the time, another day adds the date, missing or bad times show none', () => {
  assert.equal(bylineTime('2026-10-14T09:05:00', 'en', NOW), '09:05');
  assert.equal(bylineTime('2026-10-14T09:05:00', 'zh-CN', NOW), '09:05');
  assert.match(bylineTime('2026-10-13T22:30:00', 'en', NOW), /Oct 13.*22:30/);
  assert.equal(bylineTime(undefined, 'en', NOW), null);
  assert.equal(bylineTime('not a date', 'en', NOW), null);
});

test('Working shows while the Director runs a turn; scripted replies are marked', () => {
  const snapshot = lastFerrySnapshot();
  snapshot.conversation.push({ id: 'r', role: 'assistant', text: 'Noted.', runtime: 'scripted' });
  const overview = lastFerryOverview();
  assert.equal(threadView(snapshot, overview, { ...idle, status: 'running' }, 'en', NOW).working, true);
  overview.director = { state: 'working', scopeIds: [] };
  const view = threadView(snapshot, overview, idle, 'en', NOW);
  assert.equal(view.working, true);
  assert.equal(view.entries.at(-1).scripted, true);
});

test('pending questions: only pending ones the person can answer; answers combine choices and free text', () => {
  const item = (id, header) => ({ id, header, question: `${header}?`, options: [{ label: 'Red', description: 'Bright' }, { label: 'Maroon', description: 'Low light' }] });
  const questions = [
    { id: 'q1', requestId: 'r', state: 'pending', questions: [item('a', 'Coat')] },
    { id: 'q2', requestId: 'r', state: 'answered', questions: [item('a', 'Coat')] },
    { id: 'q3', requestId: 'r', state: 'pending', canAnswer: false, questions: [item('a', 'Coat')] },
    { id: 'q4', requestId: 'r', state: 'pending', questions: [item('a', 'Coat'), item('b', 'Light')] },
  ];
  const views = pendingQuestions(questions);
  assert.deepEqual(views.map(q => q.id), ['q1', 'q4']);
  assert.equal(composeAnswer(views[0], { a: 'Red' }, ''), 'Red');
  assert.equal(composeAnswer(views[0], {}, '  brighter please '), 'brighter please');
  assert.equal(composeAnswer(views[1], { a: 'Red', b: 'Maroon' }, 'and warmer'), 'Coat: Red\nLight: Maroon\n\nand warmer');
  assert.equal(composeAnswer(views[1], {}, ''), '');
});

test('Stop counts only real work: Director turns, running or queued media, running confirmations; never once stopped', () => {
  const overview = lastFerryOverview();
  assert.equal(canStop(overview, idle), false, 'idle with unmade Scene 3 shots is not stoppable');
  assert.equal(canStop(null, idle), false);
  const awaitingConfirm = structuredClone(overview);
  for (const shot of Object.values(awaitingConfirm.shots)) shot.video = { state: 'queued', takeCount: 0, waiting: { code: 'review', since: 'x' } };
  assert.equal(canStop(awaitingConfirm, idle), false, 'clips waiting for a person to confirm are not running work');
  for (const shot of Object.values(awaitingConfirm.shots)) shot.video.waiting.code = 'capacity';
  assert.equal(canStop(awaitingConfirm, idle), true, 'clips queued behind other jobs will go out by themselves');
  assert.equal(canStop(overview, { ...idle, status: 'running' }), true);
  assert.equal(canStop(overview, { ...idle, status: 'waiting_user' }), true);
  assert.equal(canStop(overview, { ...idle, status: 'error' }), false);
  assert.equal(canStop({ ...overview, director: { state: 'waiting_user', scopeIds: [] } }, idle), true);
  const running = lastFerryOverview();
  running.shots[shotId('3.1')].keyframe = { state: 'running', takeCount: 0, opened: false };
  assert.equal(canStop(running, idle), true);
  const queued = lastFerryOverview();
  queued.shots[shotId('2.1')].video = { state: 'queued', takeCount: 0, waiting: { code: 'capacity', ahead: 1, since: 'x' } };
  assert.equal(canStop(queued, idle), true);
  const failed = lastFerryOverview();
  failed.shots[shotId('2.1')].video = { state: 'failed', takeCount: 1 };
  failed.shots[shotId('3.1')].keyframe = { state: 'no_answer', takeCount: 0, opened: false };
  assert.equal(canStop(failed, idle), false);
  const confirming = lastFerryOverview();
  confirming.scenes[1].confirmation = { confirmationId: 'c', state: 'running' };
  assert.equal(canStop(confirming, idle), true);
  confirming.scenes[1].confirmation = { confirmationId: 'c', state: 'done' };
  assert.equal(canStop(confirming, idle), false);
  const stopped = { ...running, stopped: { stopId: 's', at: 'x', sentJobs: 1, detachedJobs: 2 } };
  assert.equal(canStop(stopped, { ...idle, status: 'running' }), false);
});

test('the mode line: scripted, not connected, error and unreadable; nothing for a working real Director', () => {
  // Only where nothing in the film changes (the sample film, no held edit on screen) does it say so; else only that replies are scripted.
  assert.equal(en(modeLine(idle, undefined, { filmUnchanged: true }).message), 'Scripted Director: replies are canned and nothing in the film changes.');
  assert.equal(en(modeLine(idle, undefined).message), 'Scripted Director: its replies are scripted.');
  assert.equal(zh(modeLine(idle, undefined).message), '示例导演：回复是预设的。');
  assert.equal(modeLine(idle, undefined).tone, 'info');
  // An error the thread already marks under its message is said there once; the header then says what Director this is.
  assert.equal(en(modeLine({ mode: 'fake', status: 'error' }, undefined).message), 'The Director stopped with an error. Send a message to try again.');
  assert.equal(en(modeLine({ mode: 'fake', status: 'error' }, undefined, { errorShown: true }).message), 'Scripted Director: its replies are scripted.');
  assert.equal(modeLine({ mode: 'native', status: 'error' }, undefined, { errorShown: true }), null);
  // A scripted reply says nothing changed only in the sample film; the studio's scripted Director can change it.
  assert.equal(en(scriptedTag('fixture')), 'Scripted reply; nothing in the film was changed.');
  assert.deepEqual([en(scriptedTag('live')), zh(scriptedTag('live'))], ['Scripted reply.', '预设回复。']);
  // Classic is going away: the line points to next's own Settings › Director.
  assert.match(en(modeLine({ mode: 'offline', status: 'not_connected' }, undefined).message), /Settings › Director/);
  assert.doesNotMatch(en(modeLine({ mode: 'offline', status: 'not_connected' }, undefined).message), /classic/);
  assert.match(en(modeLine({ mode: 'native', status: 'not_connected' }, undefined).message), /not connected/);
  assert.equal(modeLine({ mode: 'native', status: 'error' }, undefined).tone, 'attention');
  assert.equal(modeLine({ mode: 'native', status: 'idle' }, undefined), null);
  assert.equal(modeLine({ mode: 'native', status: 'running' }, undefined), null);
  assert.equal(modeLine(null, undefined), null);
  assert.equal(modeLine(null, 'NETWORK_ERROR').tone, 'attention');
});

test('the composer sends only real text while connected, within the server limit', () => {
  const overview = lastFerryOverview();
  const base = { text: '', targets: [], sending: false };
  assert.equal(composerView(base, true, overview).canSend, false);
  assert.equal(composerView({ ...base, text: '   ' }, true, overview).canSend, false);
  assert.equal(composerView({ ...base, text: 'Colder' }, true, overview).canSend, true);
  assert.equal(composerView({ ...base, text: 'Colder', sending: true }, true, overview).canSend, false);
  assert.equal(en(composerView(base, true, overview).hint), 'a scene or shot to point at it');
  const offline = composerView({ ...base, text: 'Colder' }, false, overview);
  assert.equal(offline.canSend, false);
  assert.equal(offline.problem, null, 'the hint says it, once');
  assert.equal(en(offline.hint), 'Offline · your draft is kept');
  const long = composerView({ ...base, text: 'x'.repeat(MESSAGE_LIMIT + 1) }, true, overview);
  assert.equal(long.canSend, false);
  assert.equal(en(long.problem), 'Keep the message under 16,000 characters.');
  assert.equal(composerView({ ...base, text: 'x'.repeat(MESSAGE_LIMIT) }, true, overview).canSend, true);
  const chips = composerView({ ...base, targets: [{ kind: 'shot', id: shotId('2.2') }, { kind: 'scene', id: sceneId(2) }, { kind: 'shot', id: 'gone' }] }, true, overview).chips;
  assert.deepEqual(chips.map(c => en(c.label)), ['2.2', 'Scene 2', 'Removed']);
});

test('the composer while stopped keeps Send on and says the Director waits; with no film it is off', () => {
  const overview = lastFerryOverview();
  const draft = { text: 'Colder', targets: [], sending: false };
  const stopped = composerView(draft, true, overview, { open: true, stopped: true });
  assert.equal(stopped.canSend, true, 'a message sent while stopped is kept for the Director');
  assert.equal(en(stopped.hint), 'Stopped · the Director waits for Continue');
  assert.equal(translateMsg('zh-CN', stopped.hint), '已停止 · 导演等你继续');
  assert.equal(en(composerView(draft, false, overview, { open: true, stopped: true }).hint), 'Offline · your draft is kept', 'offline says more than stopped');
  const none = composerView(draft, true, overview, { open: false, stopped: false });
  assert.equal(none.off, true);
  assert.equal(none.canSend, false);
  assert.equal(none.hint, null);
  assert.equal(composerView(draft, true, overview).off, false);
});

test('the picker lists scenes then shots with their own words, and filters by what follows @', () => {
  const items = pickerItems(lastFerryOverview());
  assert.deepEqual(items.map(i => en(i.label)), ['Scene 1', 'Scene 2', 'Scene 3', '1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2']);
  assert.equal(items[1].detail, 'Harbour at dawn');
  assert.match(items[7].detail, /^Medium · Mara on the pier/);
  assert.deepEqual(items[7].target, { kind: 'shot', id: shotId('2.2') });
  const names = q => filterPicker(items, q, en).map(i => en(i.label));
  assert.deepEqual(names('2.2'), ['2.2']);
  assert.deepEqual(names('2').slice(0, 4), ['Scene 2', '2.1', '2.2', '2.3']);
  assert.deepEqual(names('scene 3'), ['Scene 3']);
  assert.ok(names('fog').includes('2.1'));
  assert.deepEqual(names('zzz'), []);
  const one = filterPicker(items, '1', en);
  assert.equal(en(one[0].label), 'Scene 1');
  assert.ok(one.findIndex(i => i.group === 'shot') > one.findLastIndex(i => i.group === 'scene'), 'scenes stay before shots, so the list order is the arrow order');
  assert.equal(filterPicker(items, '', en).length, items.length);
  assert.deepEqual(filterPicker(items, '第 2', zh).map(i => zh(i.label)), ['第 2 场']);
});

test('typing @ opens a mention at the caret; picking removes the typed query', () => {
  assert.deepEqual(mentionAt('@', 1), { start: 0, end: 1, query: '' });
  assert.deepEqual(mentionAt('make @2.', 8), { start: 5, end: 8, query: '2.' });
  assert.equal(mentionAt('mail@host', 9), null, 'an @ inside a word is not a mention');
  assert.equal(mentionAt('@2.2 then', 9), null, 'a space ends the mention');
  assert.deepEqual(mentionAt('a @x b', 4), { start: 2, end: 4, query: 'x' });
  assert.deepEqual(removeMention('make @2. now', { start: 5, end: 8, query: '2.' }), { text: 'make  now', caret: 5 });
  assert.deepEqual(removeMention('text', null), { text: 'text', caret: 4 });
});

test('selecting a shot never changes what the composer points at (LG-3, WA-11)', () => {
  let state = reducer(initialState, { type: 'project', projectId: PROJECT_ID });
  state = reducer(state, { type: 'overview', overview: lastFerryOverview() });
  state = reducer(state, { type: 'composerTarget', target: { kind: 'scene', id: sceneId(2) }, add: true });
  const targets = state.composer.targets;
  state = reducer(state, { type: 'shot', shotId: shotId('2.3') });
  state = reducer(state, { type: 'scene', sceneId: sceneId(3) });
  assert.equal(state.composer.targets, targets);
});

test('the fixture Director records the message with its scope, works, then replies without touching the film', async t => {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: (() => { let n = 0; return () => `key-${++n}`; })() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  const shotsBefore = JSON.stringify(port.world.overview.shots);
  store.pointAt({ kind: 'shot', id: shotId('2.2') });
  store.setComposerText('Make the coat brighter');
  assert.equal(await store.sendMessage(), true);
  assert.deepEqual(store.getState().composer, { text: '', targets: [], sending: false, images: [] });
  const sent = port.world.snapshot.conversation.at(-1);
  assert.deepEqual([sent.role, sent.text, sent.scopeIds], ['user', 'Make the coat brighter', [shotId('2.2')]]);
  assert.equal(port.world.director.status, 'running');
  assert.equal(canStop(port.world.overview, port.world.director), true);
  await new Promise(done => setTimeout(done, FIXTURE_REPLY_MS + 300));
  const reply = port.world.snapshot.conversation.at(-1);
  assert.deepEqual([reply.role, reply.runtime], ['assistant', 'scripted']);
  assert.match(reply.text, /^Noted for 2\.2\./);
  assert.equal(port.world.director.status, 'idle');
  assert.equal(port.world.overview.director.state, 'idle');
  assert.equal(JSON.stringify(port.world.overview.shots), shotsBefore);
  await store.refresh();
  const view = threadView(store.getState().snapshot, store.getState().overview, store.getState().director, 'en', new Date());
  assert.deepEqual(view.entries.slice(-2).map(e => [e.who, e.chips.map(en)]), [['you', ['2.2']], ['director', []]]);
  assert.equal(view.working, false);
});

test('answering a question posts exactly { text, replyToQuestionId } and the fixture marks it answered', async t => {
  const port = new FixturePort();
  port.world.snapshot.questions = [{ id: 'q1', requestId: 'r', state: 'pending', questions: [{ id: 'a', header: 'Coat', question: 'Which red?', options: [{ label: 'Red', description: '' }] }] }];
  const bodies = [];
  const request = port.request.bind(port);
  port.request = (path, options = {}) => { if (options.method === 'POST') bodies.push(options.body); return request(path, options); };
  const store = new StudioStore({ client: port, storage: null, newKey: () => 'k' });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  assert.equal(await store.answerQuestion('q1', '  Red '), true);
  assert.deepEqual(bodies, [{ text: 'Red', replyToQuestionId: 'q1' }]);
  assert.equal(port.world.snapshot.questions[0].state, 'answered');
  assert.equal(await store.answerQuestion('q1', '   '), false);
});

// ---- Director notes in the thread (DC-18) ----------------------------------------------

const note = (letter, over = {}) => ({
  noteId: `note-${letter}`, requestId: 'req-1', turnId: 'turn-1', letter, anchor: { shotIds: [shotId('2.2')] },
  kind: 'recommendation', blocking: false, text: `Note ${letter}.`, choices: [{ kind: 'accept', label: 'Keep maroon' }, { kind: 'regenerate_keyframe', shotIds: [shotId('2.2')] }],
  state: 'open', version: 1, createdAt: '2026-10-14T10:44:00', ...over,
});
const reply = (id, requestId, text = 'Reply.') => ({ id, role: 'assistant', text, ...(requestId ? { requestId } : {}) });
const asked = (id, requestId) => ({ id, role: 'user', text: 'Ask.', ...(requestId ? { requestId } : {}) });

test('notes sit under the last reply of their own request, in letter order', () => {
  const conversation = [asked('u1', 'req-1'), reply('r1', 'req-1', 'Working on it.'), reply('r2', 'req-1', 'Done.'), asked('u2', 'req-2'), reply('r3', 'req-2')];
  const placed = threadNotes(conversation, [note('b'), note('a'), note('a', { noteId: 'other-a', requestId: 'req-2', turnId: 'turn-2' })]);
  assert.deepEqual([...placed.keys()].sort(), ['r2', 'r3']);
  assert.deepEqual(placed.get('r2').map(n => n.letter), ['a', 'b']);
  assert.deepEqual(placed.get('r3').map(n => n.noteId), ['other-a']);
  assert.deepEqual(threadNotes(conversation, []).size, 0);
  assert.deepEqual(['b', 'aa', 'z', 'a'].map(letter => ({ letter })).sort(byLetter).map(n => n.letter), ['a', 'b', 'z', 'aa']);
});

test('replies without a request id show the latest turn\'s unclaimed notes under the latest such reply', () => {
  // The fixture film's 10:44 reply has no request id; a later scripted reply has one and must not take its notes.
  const conversation = [asked('m1'), reply('m2'), asked('fx-3', 'fixture-request-3'), reply('fx-3-reply', 'fixture-request-3')];
  const older = note('a', { noteId: 'old-a', requestId: 'req-0', turnId: 'turn-0', createdAt: '2026-10-14T09:00:00' });
  const placed = threadNotes(conversation, [note('b'), older, note('a')]);
  assert.deepEqual([...placed.keys()], ['m2']);
  assert.deepEqual(placed.get('m2').map(n => n.noteId), ['note-a', 'note-b'], 'only the latest turn, in letter order');
  // A server that gives every reply its request id never uses the fallback: unmatched notes stay out of the thread.
  assert.equal(threadNotes([reply('r1', 'req-9')], [note('a')]).size, 0);
});

test('Open pills: one per anchored shot that still exists, else the scene; labels in both languages', () => {
  const overview = lastFerryOverview();
  const [two, scene, gone] = noteViews([
    note('a', { anchor: { shotIds: [shotId('2.2'), shotId('2.3')] } }),
    note('b', { anchor: { sceneId: sceneId(3) } }),
    note('c', { anchor: { shotIds: ['shot-gone'] } }),
  ], overview);
  assert.deepEqual(noteOpens(two, overview).map(o => [o.kind, o.id, en(o.label)]), [['shot', shotId('2.2'), 'Open 2.2'], ['shot', shotId('2.3'), 'Open 2.3']]);
  assert.deepEqual(noteOpens(scene, overview).map(o => [o.kind, o.id, en(o.label), zh(o.label)]), [['scene', sceneId(3), 'Open Scene 3', '查看第 3 场']]);
  assert.deepEqual(noteOpens(gone, overview), [], 'a note on a removed shot offers nothing to open');
});

test('the thread shows notes under the Director\'s reply: open amber, settled neutral with how, stale says so', () => {
  const snapshot = lastFerrySnapshot();
  snapshot.notes = [
    note('b', { anchor: { shotIds: [shotId('2.3')] }, blocking: true, state: 'stale' }),
    note('a', { state: 'resolved', resolution: { choiceIndex: 0, at: '2026-10-14T10:50:00' } }),
    note('c', { anchor: { shotIds: [shotId('2.1')] } }),
  ];
  const view = threadView(snapshot, lastFerryOverview(), idle, 'en', NOW);
  const [you, director] = view.entries;
  assert.deepEqual(you.notes, []);
  assert.deepEqual(director.notes.map(n => [n.view.letter, n.tone, n.opens.map(o => en(o.label)), n.view.settled && en(n.view.settled)]), [
    ['a', 'done', ['Open 2.2'], 'Settled: Keep maroon'],
    ['b', 'stale', ['Open 2.3'], 'Out of date: the shot changed since'],
    ['c', 'open', ['Open 2.1'], null],
  ]);
  assert.equal(threadView(snapshot, null, idle, 'en', NOW).entries[1].notes.length, 0, 'no overview, no labels: nothing to show yet');
});

test('turn status shows what a running turn does and how a turn ended without a reply (DC-16)', async () => {
  const { turnStatus, structuredAnswers } = await import('../../src/next/model/director.ts');
  const { translateMsg } = await import('../../src/next/i18n/translate.ts');
  const en = m => m && translateMsg('en', m);
  assert.deepEqual(turnStatus(undefined), { activity: null, ending: null });
  assert.equal(en(turnStatus([{ id: 't', requestId: 'r', state: 'running', progress: { tool: 'record_notes', state: 'started' } }]).activity), 'Writing notes');
  assert.equal(en(turnStatus([{ id: 't', requestId: 'r', state: 'running', action: 'keyframe_review' }]).activity), 'Reviewing the new keyframes');
  assert.equal(en(turnStatus([{ id: 't', requestId: 'r', state: 'completed', reason: 'no_reply' }]).ending), 'The Director finished without a reply.');
  assert.equal(turnStatus([{ id: 't', requestId: 'r', state: 'completed', reason: null }]).ending, null);
  const question = { id: 'q', items: [{ id: 'i1', header: 'Coat', question: 'Which?', options: [{ label: 'Red', description: '' }, { label: 'Maroon', description: '' }] }] };
  assert.deepEqual(structuredAnswers(question, { i1: 'Maroon' }), [{ questionId: 'i1', optionIndex: 1 }]);
  assert.deepEqual(structuredAnswers(question, {}), []);
});
