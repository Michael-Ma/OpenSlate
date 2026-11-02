import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pictureRefusal, pictureFromAsset, pictureFromShot, checkedShotPicture, shotKeyframesPath, addPicture, pictureChips, composerView, messageBody, messageText,
  userMessage, resolveRef, sentPictureName, labelList, draftToSave, readDraft, draftKey, failedTurns, heldEdits, threadView, withoutKeyframes, afterSend,
  errorInThread, headerScope,
  PICTURE_LIMIT, MESSAGE_LIMIT,
} from '../../src/next/model/director.ts';
import { refLink } from '../../src/next/model/markdown.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, artifactFor, sceneId, shotId, PROJECT_ID } from '../../src/next/fixtures/last-ferry.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { applyDirectorPresets, FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { FIXTURE_TIMING } from '../../src/next/fixtures/fixture-commands.ts';
import { reducer } from '../../src/next/store/reducer.ts';
import { initialState } from '../../src/next/store/state.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const NOW = new Date('2026-10-14T12:00:00');
const codex = { mode: 'native', status: 'idle', activeRequestId: null, imageAttachmentsAvailable: true };
const ref = artifactFor('ref');
const upload = { artifact: { ...ref, kind: 'image' }, role: 'upload', current: false, source: 'imported', label: 'coat-colours.png', createdAt: 'x' };
const uploadImage = { artifactId: ref.artifactId, sha256: ref.sha256, source: 'upload', shotId: null, name: 'coat-colours.png' };
const keyframe22 = { artifactId: artifactFor('2.2').artifactId, sha256: artifactFor('2.2').sha256, source: 'keyframe', shotId: shotId('2.2'), name: '' };
const empty = { text: '', targets: [], sending: false, images: [] };

test('only the Codex Director with FFmpeg can be shown pictures; every other state says why', () => {
  assert.equal(pictureRefusal(codex), null);
  assert.match(en(pictureRefusal(lastFerryDirector)), /scripted Director can't look at pictures.*Settings › Director/);
  assert.match(en(pictureRefusal({ mode: 'native', status: 'idle', imageAttachmentsAvailable: false })), /FFmpeg/);
  assert.match(en(pictureRefusal({ mode: 'offline', status: 'not_connected' })), /isn't connected/);
  assert.match(en(pictureRefusal({ mode: 'native', status: 'idle' })), /can't show pictures/);
  assert.match(en(pictureRefusal(null)), /could not be read/);
  assert.match(zh(pictureRefusal(lastFerryDirector)), /示例导演看不了图片/);
});

test('an asset becomes a picture: imported pictures and current keyframes; demo stand-ins and earlier takes are refused', () => {
  const overview = lastFerryOverview();
  // The library keeps no file name for imported pictures, so they are named by kind.
  assert.deepEqual(pictureFromAsset(upload, overview), { image: { ...uploadImage, name: '' } });
  const current = { artifact: { ...artifactFor('2.2'), kind: 'image' }, role: 'keyframe', shotId: shotId('2.2'), sceneId: sceneId(2), takeIndex: 1, current: true, source: 'generated', label: 'k', createdAt: 'x' };
  assert.deepEqual(pictureFromAsset(current, overview), { image: keyframe22 });
  const earlier = { ...current, artifact: { ...current.artifact, sha256: 'b'.repeat(64) }, current: false };
  assert.match(en(pictureFromAsset(earlier, overview).refused), /current keyframe, and this is an earlier take/);
  assert.match(en(pictureFromAsset({ ...upload, source: 'demo' }, overview).refused), /demo stand-in/);
  assert.match(en(pictureFromAsset({ ...current, shotId: 'gone' }, overview).refused), /no longer in the film/);
  assert.equal(pictureFromAsset({ ...current, artifact: { ...current.artifact, kind: 'video' }, role: 'clip' }, overview), null);
  assert.equal(pictureFromAsset({ ...upload, artifact: { ...upload.artifact, kind: 'audio' }, role: 'music' }, overview), null);
});

test('the Keyframes preview offers the shot\'s current keyframe, and says so when there is none', () => {
  const overview = lastFerryOverview();
  assert.deepEqual(pictureFromShot(overview.shots[shotId('2.2')]), { image: keyframe22 });
  assert.equal(en(pictureFromShot(overview.shots[shotId('3.1')]).refused), '3.1 has no current keyframe to show.');
});

test('the preview checks the library like Assets does: a demo provider\'s keyframe is refused there too', async () => {
  const shot = lastFerryOverview().shots[shotId('2.2')];
  const listed = (source, artifact = artifactFor('2.2')) => ({ artifact: { ...artifact, kind: 'image' }, role: 'keyframe', shotId: shot.shotId, takeIndex: 1, current: true, source, label: 'k', createdAt: 'x' });
  assert.match(en(pictureFromShot(shot, [listed('demo')]).refused), /demo stand-in/);
  assert.deepEqual(pictureFromShot(shot, [listed('generated')]), { image: keyframe22 });
  // An earlier demo take does not count against the current keyframe.
  assert.deepEqual(pictureFromShot(shot, [listed('demo', artifactFor('2.2-old'))]), { image: keyframe22 });
  // When pressed: every page of the shot's keyframes is read.
  const paths = [];
  const pages = [[listed('generated', artifactFor('2.2-old'))], [listed('demo')]];
  const read = async (offset) => { paths.push(shotKeyframesPath(shot.shotId, offset)); const index = offset ? 1 : 0; return { assets: pages[index], total: 2, offset, nextOffset: index ? null : 1 }; };
  assert.match(en((await checkedShotPicture(shot, read)).refused), /demo stand-in/);
  assert.deepEqual(paths, [`/assets?shotId=${shotId('2.2')}&role=keyframe&offset=0`, `/assets?shotId=${shotId('2.2')}&role=keyframe&offset=1`]);
  assert.deepEqual(await checkedShotPicture(shot, async (offset) => ({ assets: [listed('generated')], total: 1, offset, nextOffset: null })), { image: keyframe22 });
  // A library that cannot be read refuses for now, in both languages; a shot with no keyframe is not read at all.
  const failed = await checkedShotPicture(shot, async () => { throw new Error('offline'); });
  assert.deepEqual([en(failed.refused), zh(failed.refused)], ["2.2's keyframe couldn't be checked just now. Try again in a moment.", '暂时无法核对 2.2 的关键帧，请稍后再试。']);
  let reads = 0;
  assert.match(en((await checkedShotPicture(lastFerryOverview().shots[shotId('3.1')], async () => { reads++; return { assets: [], total: 0, offset: 0, nextOffset: null }; })).refused), /no current keyframe/);
  assert.equal(reads, 0);
});

test('adding pictures: the Director must take them, no picture twice, at most four', () => {
  const one = addPicture([], { image: uploadImage }, codex);
  assert.deepEqual(one, { images: [uploadImage], added: uploadImage });
  assert.match(en(addPicture([uploadImage], { image: uploadImage }, codex).refused), /already in your message/);
  assert.match(en(addPicture([], { image: uploadImage }, lastFerryDirector).refused), /scripted Director/);
  assert.match(en(addPicture([], { refused: { id: 'director.picture.demo' } }, codex).refused), /demo/);
  const four = ['a', 'b', 'c', 'd'].map(c => ({ ...uploadImage, artifactId: `art-${c}`, sha256: c.repeat(64) }));
  assert.equal(PICTURE_LIMIT, 4);
  assert.match(en(addPicture(four, { image: uploadImage }, codex).refused), /up to 4 pictures/);
});

test('picture chips are named and flag a keyframe that was replaced or whose shot is gone', () => {
  const overview = lastFerryOverview();
  const chips = pictureChips([uploadImage, keyframe22], overview);
  assert.deepEqual(chips.map(c => [en(c.label), c.problem]), [['coat-colours.png', null], ['2.2 keyframe', null]]);
  assert.deepEqual(chips.map(c => zh(c.label)), ['coat-colours.png', '2.2 关键帧']);
  // Nameless imported pictures are "Imported image", numbered when there are several.
  const nameless = (c) => ({ ...uploadImage, artifactId: `art-${c}`, sha256: c.repeat(64), name: '' });
  assert.deepEqual(pictureChips([nameless('a')], overview).map(c => en(c.label)), ['Imported image']);
  assert.deepEqual(pictureChips([nameless('a'), keyframe22, nameless('b')], overview).map(c => zh(c.label)), ['导入的图片 1', '2.2 关键帧', '导入的图片 2']);
  assert.match(messageText({ ...empty, text: 'x', images: [nameless('a')] }, overview), /^\[@image\]\(#openslate-ref\//);
  const replaced = { ...overview, shots: { ...overview.shots, [shotId('2.2')]: { ...overview.shots[shotId('2.2')], keyframe: { state: 'ready', artifact: { ...artifactFor('2.2-red') }, takeCount: 2, opened: false } } } };
  assert.equal(en(pictureChips([keyframe22], replaced)[0].problem), '2.2 has a newer keyframe. Remove its picture, then show the new one.');
  const { [shotId('2.2')]: _gone, ...rest } = overview.shots;
  assert.match(en(pictureChips([keyframe22], { ...overview, shots: rest })[0].problem), /shot was removed/);
});

test('the composer holds Send while its pictures cannot go, and keeps the draft', () => {
  const overview = lastFerryOverview();
  const film = { open: true, stopped: false };
  const withPicture = { ...empty, text: 'Use these colours', images: [uploadImage] };
  const ok = composerView(withPicture, true, overview, film, codex);
  assert.deepEqual([ok.canSend, ok.problem, ok.pictures.length], [true, null, 1]);
  const scripted = composerView(withPicture, true, overview, film, lastFerryDirector);
  assert.equal(scripted.canSend, false);
  assert.match(en(scripted.problem), /scripted Director/);
  // Without pictures the Director's mode does not matter.
  assert.equal(composerView({ ...empty, text: 'hi' }, true, overview, film, lastFerryDirector).canSend, true);
  // The limit counts the picture links that lead the sent text.
  const nearly = { ...withPicture, text: 'x'.repeat(MESSAGE_LIMIT - 10) };
  assert.equal(composerView(nearly, true, overview, film, codex).problem.id, 'director.composer.too_long');
  assert.equal(composerView({ ...nearly, images: [] }, true, overview, film, codex).problem, null);
});

test('keyframes point the message at their shots: the composer says so unless a chip already covers them', () => {
  const overview = lastFerryOverview();
  const film = { open: true, stopped: false };
  const keyframe = (label) => ({ artifactId: artifactFor(label).artifactId, sha256: artifactFor(label).sha256, source: 'keyframe', shotId: shotId(label), name: '' });
  const view = (targets, images) => composerView({ ...empty, text: 'x', targets, images }, true, overview, film, codex).pointsAt;
  // In film order, whatever order they were added in; imported pictures add no scope.
  assert.deepEqual(view([], [keyframe('2.3'), uploadImage, keyframe('2.1')]), ['2.1', '2.3']);
  assert.deepEqual(view([{ kind: 'shot', id: shotId('2.1') }], [keyframe('2.1'), keyframe('2.3')]), ['2.3']);
  assert.deepEqual(view([{ kind: 'scene', id: sceneId(2) }], [keyframe('2.1'), keyframe('2.3')]), []);
  assert.deepEqual(view([], [uploadImage]), []);
  assert.equal(labelList(['2.1', '2.3'], 'en'), '2.1 and 2.3');
  assert.equal(labelList(['2.1', '2.2', '2.3'], 'zh-CN'), '2.1、2.2 和 2.3');
  assert.equal(en({ id: 'director.picture.points_at', values: { shots: '2.1', n: 1 } }), 'This message also points at 2.1, so the Director sees its keyframe.');
  assert.equal(en({ id: 'director.picture.points_at', values: { shots: '2.1 and 2.3', n: 2 } }), 'This message also points at 2.1 and 2.3, so the Director sees their keyframes.');
  assert.equal(zh({ id: 'director.picture.points_at', values: { shots: '2.1', n: 1 } }), '这条消息也会指向 2.1，导演才能看到它的关键帧。');
  assert.equal(zh({ id: 'director.picture.points_at', values: { shots: '2.1和2.3', n: 2 } }), '这条消息也会指向 2.1和2.3，导演才能看到这些关键帧。');
});

test('a keyframe on a message with no @ target narrows it from the whole film to that shot, and the composer says so', () => {
  const overview = lastFerryOverview();
  const film = { open: true, stopped: false };
  const keyframe21 = { artifactId: artifactFor('2.1').artifactId, sha256: artifactFor('2.1').sha256, source: 'keyframe', shotId: shotId('2.1'), name: '' };
  const view = (targets, images) => composerView({ ...empty, text: 'Make the whole film colder, like this frame', targets, images }, true, overview, film, codex);
  // No target: the keyframe's shot replaces the whole film (the server attaches no keyframes to a whole-film message).
  const alone = view([], [keyframe21, uploadImage]);
  assert.deepEqual([alone.pointsAt, alone.narrowed], [['2.1'], true]);
  assert.deepEqual(messageBody({ ...empty, text: 'x', images: [keyframe21, uploadImage] }, overview).scopeIds, [shotId('2.1')]);
  // With a target, the keyframe's shot joins it: "also".
  const joined = view([{ kind: 'shot', id: shotId('2.3') }], [keyframe21]);
  assert.deepEqual([joined.pointsAt, joined.narrowed], [['2.1'], false]);
  // Imported pictures alone narrow nothing.
  assert.deepEqual([view([], [uploadImage]).pointsAt, view([], [uploadImage]).narrowed], [[], false]);
  assert.equal(en({ id: 'director.picture.points_only', values: { shots: '2.1', n: 1 } }),
    'This message now points only at 2.1, not the whole film, so the Director sees its keyframe and can change only 2.1.');
  assert.equal(en({ id: 'director.picture.points_only', values: { shots: '2.1 and 2.3', n: 2 } }),
    'This message now points only at 2.1 and 2.3, not the whole film, so the Director sees their keyframes and can change only 2.1 and 2.3.');
  assert.equal(zh({ id: 'director.picture.points_only', values: { shots: '2.1', n: 1 } }), '这条消息现在只指向 2.1，不再是整部影片：导演能看到它的关键帧，也只能修改 2.1。');
  assert.equal(en({ id: 'director.picture.keep_film', values: { n: 1 } }), 'Keep the whole film (remove the keyframe)');
  assert.equal(zh({ id: 'director.picture.keep_film', values: { n: 2 } }), '改回整部影片（移除这些关键帧）');
  // Keeping the whole film drops the keyframes and keeps imported pictures: the message points at the film again.
  const kept = withoutKeyframes([keyframe21, uploadImage]);
  assert.deepEqual(kept, [uploadImage]);
  assert.deepEqual([view([], kept).narrowed, messageBody({ ...empty, text: 'x', images: kept }, overview).scopeIds], [false, [PROJECT_ID]]);
});

test('the message body: imported pictures as images, keyframes through their shot, links before the words', () => {
  const overview = lastFerryOverview();
  assert.deepEqual(messageBody({ ...empty, text: '  Make it colder ' }, overview), { text: 'Make it colder', scopeIds: [PROJECT_ID], editing: true });
  assert.equal(messageBody({ ...empty, text: '   ', images: [uploadImage] }, overview), null);
  const body = messageBody({ text: 'Use these', targets: [{ kind: 'scene', id: sceneId(2) }], sending: false, images: [uploadImage, keyframe22] }, overview);
  assert.deepEqual(body.scopeIds, [sceneId(2), shotId('2.2')]);
  assert.deepEqual(body.images, [{ artifactId: ref.artifactId, sha256: ref.sha256 }]);
  assert.equal(body.text, `[@coat-colours.png](#openslate-ref/last-ferry/image/${ref.artifactId}/${ref.sha256}) [@2.2](#openslate-ref/last-ferry/image/${keyframe22.artifactId}/${keyframe22.sha256})\n\nUse these`);
  // Only keyframes: no images field, the shot is the scope.
  const keyframesOnly = messageBody({ ...empty, text: 'Look', images: [keyframe22] }, overview);
  assert.deepEqual([keyframesOnly.scopeIds, 'images' in keyframesOnly], [[shotId('2.2')], false]);
  // A name with brackets cannot break its link.
  assert.match(messageText({ ...empty, text: 'x', images: [{ ...uploadImage, name: 'a]b[c\nd' }] }, overview), /^\[@a b c d\]\(/);
});

test('a sent message reads back: picture links become picture chips, repeated scope links go, other references stay', () => {
  const overview = lastFerryOverview();
  const picture = { projectId: PROJECT_ID, kind: 'image', id: ref.artifactId, sha256: ref.sha256 };
  const shot = { projectId: PROJECT_ID, kind: 'shot', id: shotId('2.3'), sha256: '' };
  const scene = { projectId: PROJECT_ID, kind: 'scene', id: sceneId(2), sha256: '' };
  const sent = `[@coat.png](${refLink(picture)}) [@Scene 2](${refLink(scene)})\n\nCompare with [@2.3](${refLink(shot)}) please`;
  const message = userMessage(sent, true, [sceneId(2)]);
  assert.deepEqual(message.pictures.map(p => [p.ref, p.label, en(p.name)]), [[picture, 'coat.png', 'coat.png']]);
  // Names from the link words next writes: a shot label was its keyframe, "image" an imported picture.
  assert.deepEqual(['2.1', 'image', 'ref.png'].map(label => [en(sentPictureName(label)), zh(sentPictureName(label))]),
    [['2.1 keyframe', '2.1 关键帧'], ['Imported image', '导入的图片'], ['ref.png', 'ref.png']]);
  assert.deepEqual(message.segments, [{ kind: 'text', text: 'Compare with ' }, { kind: 'ref', ref: shot, label: '2.3' }, { kind: 'text', text: ' please' }]);
  // Without chips a leading scene link is kept as a reference.
  assert.equal(userMessage(sent, false).segments[0].kind, 'ref');
  // Plain leading mentions still go when chips show them (the sample conversation).
  assert.deepEqual(userMessage('@Scene 2 make it colder', true, [sceneId(2)]).segments, [{ kind: 'text', text: 'make it colder' }]);
  assert.deepEqual(resolveRef(shot, overview), { open: { kind: 'shot', id: shotId('2.3') }, picture: null });
  assert.deepEqual(resolveRef(scene, overview), { open: { kind: 'scene', id: sceneId(2) }, picture: null });
  assert.deepEqual(resolveRef(picture, overview), { open: null, picture: { artifactId: ref.artifactId, sha256: ref.sha256 } });
  assert.deepEqual(resolveRef({ ...shot, id: 'gone' }, overview), { open: null, picture: null });
  assert.deepEqual(resolveRef({ ...shot, projectId: 'another-film' }, overview), { open: null, picture: null });
});

test('the unsent draft round-trips through storage; malformed or empty drafts read as none', () => {
  const composer = { text: 'Keep the fog', targets: [{ kind: 'shot', id: shotId('2.3') }], sending: true, images: [uploadImage, keyframe22] };
  const saved = draftToSave(composer);
  assert.deepEqual(saved, { text: 'Keep the fog', targets: [{ kind: 'shot', id: shotId('2.3') }], images: [uploadImage, keyframe22] });
  assert.deepEqual(readDraft(JSON.stringify(saved)), saved);
  assert.equal(draftToSave(empty), null);
  for (const bad of [null, '', 'not json', '[]', '{"text":1,"targets":[],"images":[]}', JSON.stringify({ ...saved, images: [{ ...uploadImage, sha256: 'xyz' }] }),
    JSON.stringify({ ...saved, targets: [{ kind: 'asset', id: 'a' }] }), JSON.stringify({ ...saved, images: [{ ...keyframe22, shotId: null }] }),
    JSON.stringify({ ...saved, images: [uploadImage, uploadImage, uploadImage, uploadImage, uploadImage] }), JSON.stringify({ text: '', targets: [], images: [] })])
    assert.equal(readDraft(bad), null, String(bad));
  // Extra fields are not carried along.
  assert.deepEqual(readDraft(JSON.stringify({ ...saved, images: [{ ...uploadImage, evil: '<b>' }] })).images, [uploadImage]);
  // A long pasted script comes back whole; the composer then says it is too long and holds Send.
  const long = { ...saved, text: 'x'.repeat(MESSAGE_LIMIT * 3) };
  assert.equal(readDraft(JSON.stringify(long)).text.length, MESSAGE_LIMIT * 3);
  const tooLong = composerView({ ...readDraft(JSON.stringify(long)), sending: false }, true, lastFerryOverview(), { open: true, stopped: false }, codex);
  assert.deepEqual([tooLong.canSend, tooLong.problem.id], [false, 'director.composer.too_long']);
  assert.equal(draftKey('film-1'), 'openslate.next.draft.film-1');
  assert.equal(draftKey('last-ferry', 'fixture'), 'openslate.next.sample-draft.last-ferry');
});

test('the reducer keeps pictures with the composer, restores a draft, and empties both on send and on a film switch', () => {
  let state = reducer(initialState, { type: 'project', projectId: PROJECT_ID });
  state = reducer(state, { type: 'composerImages', images: [uploadImage] });
  state = reducer(state, { type: 'composerText', text: 'hi' });
  assert.deepEqual(state.composer.images, [uploadImage]);
  state = reducer(state, { type: 'composerSent' });
  assert.deepEqual(state.composer, { text: '', targets: [], sending: false, images: [], files: [] });
  state = reducer(state, { type: 'composerRestore', text: 'back', targets: [{ kind: 'scene', id: sceneId(1) }], images: [keyframe22] });
  assert.deepEqual(state.composer, { text: 'back', targets: [{ kind: 'scene', id: sceneId(1) }], images: [keyframe22], files: [], sending: false });
  state = reducer(state, { type: 'project', projectId: 'other' });
  assert.deepEqual(state.composer, { text: '', targets: [], sending: false, images: [], files: [] });
});

test('sending takes away only what was sent: a picture or @ target added meanwhile stays for the next message', () => {
  const sent = { text: 'Colder', targets: [{ kind: 'scene', id: sceneId(2) }], images: [uploadImage] };
  const meanwhile = { text: 'Colder', targets: [{ kind: 'scene', id: sceneId(2) }, { kind: 'shot', id: shotId('2.3') }], sending: true, images: [uploadImage, keyframe22] };
  assert.deepEqual(afterSend(meanwhile, sent), { text: '', targets: [{ kind: 'shot', id: shotId('2.3') }], sending: false, images: [keyframe22], files: [] });
  let state = reducer(initialState, { type: 'project', projectId: PROJECT_ID });
  state = reducer(state, { type: 'composerRestore', ...meanwhile });
  state = reducer(state, { type: 'composerSent', sent });
  assert.deepEqual(state.composer, { text: '', targets: [{ kind: 'shot', id: shotId('2.3') }], sending: false, images: [keyframe22], files: [] });
});

test('a failed turn marks the last entry of its request, with the catalog\'s words or the Director\'s own', () => {
  const snapshot = lastFerrySnapshot(NOW);
  const conversation = [...snapshot.conversation, { id: 'u2', role: 'user', text: 'Colder', requestId: 'r2', at: '2026-10-14T11:00:00' }];
  const turns = [{ id: 't2', requestId: 'r2', state: 'failed', reason: 'failed' }];
  // A generic run failure: the server sends no words for it, so the catalog says it.
  const generic = { ...lastFerryDirector, status: 'error', turn: { requestId: 'r2', state: 'failed', errorCode: 'DIRECTOR_RUN_FAILED' }, message: null };
  let view = threadView({ ...snapshot, conversation, turns }, lastFerryOverview(), generic, 'zh-CN', NOW);
  assert.deepEqual([zh(view.entries.at(-1).attention.detail), view.entries.at(-1).attention.text], ['导演出错停止了。发送一条消息重试。', null]);
  assert.equal(view.entries.at(-2).attention, null);
  assert.equal(view.ending, null, 'the marker says it; the ending line would repeat it');
  // Every code the server words itself is in the catalog, so its English sentence never shows in the Chinese interface.
  for (const code of ['DIRECTOR_GUIDANCE_UNSUPPORTED', 'DIRECTOR_GUIDANCE_IN_FLIGHT', 'DIRECTOR_TOOLS_BUSY', 'DIRECTOR_TOOLS_STALE', 'DIRECTOR_IMAGE_LIMIT', 'DIRECTOR_IMAGES_UNAVAILABLE']) {
    const status = { ...generic, turn: { ...generic.turn, errorCode: code }, message: 'An English sentence from the server.' };
    const attention = failedTurns(turns, status).get('r2');
    assert.equal(attention.text, null, code);
    // Product names (OpenSlate, Codex, FFmpeg) stay as they are; nothing else is English.
    assert.doesNotMatch(zh(attention.detail).replace(/OpenSlate|Codex|FFmpeg|PNG/g, ''), /[A-Za-z]{3,}/, `${code} reads ${zh(attention.detail)}`);
  }
  // A code this interface does not know yet shows the Director's own words rather than nothing.
  const words = { ...generic, turn: { ...generic.turn, errorCode: 'SOMETHING_NEW' }, message: 'Codex stopped: the model did not respond.' };
  view = threadView({ ...snapshot, conversation, turns }, lastFerryOverview(), words, 'en', NOW);
  assert.deepEqual(view.entries.at(-1).attention, { detail: null, text: 'Codex stopped: the model did not respond.' });
  const coded = { ...words, turn: { ...words.turn, errorCode: 'DIRECTOR_IMAGE_MISSING' } };
  view = threadView({ ...snapshot, conversation, turns }, lastFerryOverview(), coded, 'zh-CN', NOW);
  assert.equal(zh(view.entries.at(-1).attention.detail), '有图片丢失或无法读取。请重新导入，再发一条新消息。');
  // An older failure (not the current turn) says only that it failed.
  view = threadView({ ...snapshot, conversation, turns }, lastFerryOverview(), lastFerryDirector, 'en', NOW);
  assert.equal(en(view.entries.at(-1).attention.detail), 'The Director stopped with an error. Send a message to try again.');
  assert.match(en(failedTurns([{ id: 't', requestId: 'r', state: 'unknown', reason: 'unknown' }], null).get('r').detail), /without a confirmed result/);
  // The server's English sentence for an unconfirmed ending gives way to the catalog's, which says the same in both languages.
  const unknown = { mode: 'native', status: 'error', activeRequestId: 'r', turn: { requestId: 'r', state: 'unknown', errorCode: null }, message: 'The previous turn ended without a confirmed result. Saved changes are retained; send a follow-up to continue.' };
  const unconfirmed = failedTurns([{ id: 't', requestId: 'r', state: 'unknown', reason: 'unknown' }], unknown).get('r');
  assert.deepEqual([unconfirmed.text, zh(unconfirmed.detail)], [null, '导演这一轮没有确认的结果就结束了。已保存的内容会保留；发一条消息继续。']);
  // A later turn that worked clears the request's marker; a turn of another request leaves it.
  assert.equal(failedTurns([...turns, { id: 't3', requestId: 'r2', state: 'completed', reason: null }], null).size, 0);
  // A reply to the failed request carries the marker instead of the message.
  const replied = [...conversation, { id: 'a2', role: 'assistant', text: 'Partly done', requestId: 'r2' }];
  view = threadView({ ...snapshot, conversation: replied, turns }, lastFerryOverview(), words, 'en', NOW);
  assert.deepEqual([view.entries.at(-2).attention, !!view.entries.at(-1).attention], [null, true]);
});

test('held edits: queued slots waiting on edit_pending, grouped by request, off while the Director works on it', () => {
  const overview = lastFerryOverview();
  const wait = (requestId) => ({ state: 'queued', takeCount: 0, opened: false, waiting: { code: 'edit_pending', since: 'x', requestId } });
  const shots = { ...overview.shots };
  shots[shotId('3.2')] = { ...shots[shotId('3.2')], keyframe: wait('r1') };
  shots[shotId('3.1')] = { ...shots[shotId('3.1')], keyframe: wait('r1') };
  shots[shotId('2.1')] = { ...shots[shotId('2.1')], video: wait('r2') };
  const held = heldEdits({ ...overview, shots }, null, lastFerryDirector);
  assert.deepEqual(held.map(h => [h.requestId, h.labels, h.blocked]), [['r2', ['2.1'], null], ['r1', ['3.1', '3.2'], null]]);
  const working = heldEdits({ ...overview, shots }, { turns: [{ id: 't', requestId: 'r1', state: 'running' }] }, lastFerryDirector);
  assert.match(en(working.find(h => h.requestId === 'r1').blocked), /still working on this edit/);
  assert.equal(heldEdits(overview, null, null).length, 0);
  // The card says that letting go starts the waiting work at once, under the approval already given.
  assert.match(en({ id: 'director.held.body' }), /start right away, as already approved/);
  assert.match(zh({ id: 'director.held.body' }), /按之前的批准立即开始生成/);
});

test('fixture presets: codex takes pictures, held holds Scene 3, failed fails like the server does, markdown adds a rich reply', () => {
  const port = new FixturePort();
  applyDirectorPresets(port.world, ['codex', 'held', 'failed', 'markdown']);
  assert.equal(port.world.director.imageAttachmentsAvailable, true);
  // The server sends no words of its own for a generic failure.
  assert.deepEqual([port.world.director.turn.errorCode, port.world.director.message], ['DIRECTOR_RUN_FAILED', null]);
  const held = heldEdits(port.world.overview, port.world.snapshot, port.world.director);
  assert.deepEqual(held.map(h => [h.requestId, h.labels]), [['request-held', ['3.1', '3.2']]]);
  // Whatever order the list names them in, the sample conversation stays in time order.
  assert.deepEqual(port.world.snapshot.conversation.slice(2).map(e => e.id), ['m-markdown', 'request-held', 'request-failed']);
  assert.match(port.world.snapshot.conversation[2].text, /\| Shot \| Now \| After \|/);
  port.close();
});

test('a failed turn is marked in the thread once: the header line leaves it to the marker under its message', () => {
  const port = new FixturePort();
  applyDirectorPresets(port.world, ['failed']);
  const { snapshot, director } = port.world;
  assert.equal(errorInThread(snapshot, director), true);
  // The same error with no entry for its request (or no failed turn) still needs the header to say it.
  assert.equal(errorInThread({ ...snapshot, conversation: snapshot.conversation.filter(e => e.requestId !== 'request-failed') }, director), false);
  assert.equal(errorInThread({ ...snapshot, turns: [] }, director), false);
  assert.equal(errorInThread(snapshot, { ...director, status: 'idle' }), false);
  port.close();
});

test('the header names what the message points at once the composer points somewhere, else what the view shows', () => {
  const overview = lastFerryOverview();
  const label = scope => scope.kind === 'view' ? en(scope.label) : `Points at ${labelList(scope.labels.map(en), 'en')}`;
  const base = { hasFilm: true, sceneOrdinal: 2, overview };
  assert.equal(label(headerScope({ ...base, composer: empty })), 'Scene 2');
  assert.equal(label(headerScope({ ...base, sceneOrdinal: null, composer: empty })), 'Whole film');
  assert.equal(label(headerScope({ ...base, hasFilm: false, composer: empty })), 'No film open');
  // A keyframe narrows the message to its shot: the header says so, as the composer's line does.
  const keyframe21 = { ...keyframe22, artifactId: artifactFor('2.1').artifactId, sha256: artifactFor('2.1').sha256, shotId: shotId('2.1') };
  assert.equal(label(headerScope({ ...base, composer: { ...empty, images: [keyframe21] } })), 'Points at 2.1');
  // The @ targets and the keyframes' shots in storyboard order (a scene before its shots), whatever order they were
  // added in, as the composer's scope line names its shots; a shot the targets cover is not named twice.
  const targets = [{ kind: 'shot', id: shotId('2.3') }, { kind: 'scene', id: sceneId(1) }];
  assert.equal(label(headerScope({ ...base, composer: { ...empty, targets, images: [keyframe21, uploadImage] } })), 'Points at Scene 1, 2.1, and 2.3');
  // "2.1 keyframe" and @2.2 under it: the header reads 2.1 first too, never "2.2 and 2.1".
  assert.equal(label(headerScope({ ...base, composer: { ...empty, targets: [{ kind: 'shot', id: shotId('2.2') }], images: [keyframe21] } })), 'Points at 2.1 and 2.2');
  assert.equal(label(headerScope({ ...base, composer: { ...empty, targets: [{ kind: 'shot', id: shotId('3.1') }, { kind: 'scene', id: sceneId(3) }, { kind: 'shot', id: shotId('1.2') }] } })), 'Points at 1.2, Scene 3, and 3.1');
  assert.equal(label(headerScope({ ...base, composer: { ...empty, targets: [{ kind: 'scene', id: sceneId(2) }], images: [keyframe21] } })), 'Points at Scene 2');
  // An imported picture alone does not narrow anything; a removed target is not named.
  assert.equal(label(headerScope({ ...base, composer: { ...empty, images: [uploadImage], targets: [{ kind: 'shot', id: 'gone' }] } })), 'Scene 2');
  const zhScope = headerScope({ ...base, composer: { ...empty, targets: [{ kind: 'scene', id: sceneId(1) }], images: [keyframe21] } });
  assert.deepEqual(zhScope.labels.map(zh), ['第 1 场', '2.1']);
});

test('sending pictures through the store: the fixture Codex Director takes them; the scripted one refuses at the composer', async t => {
  const port = new FixturePort();
  applyDirectorPresets(port.world, ['codex']);
  const bodies = [];
  const request = port.request.bind(port);
  port.request = (path, options = {}) => { if (options.method === 'POST') bodies.push({ path, body: options.body, key: options.key }); return request(path, options); };
  const store = new StudioStore({ client: port, storage: null, newKey: (() => { let n = 0; return () => `key-${++n}`; })() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  assert.equal(store.showPicture({ image: uploadImage }), null);
  assert.equal(store.showPicture({ image: keyframe22 }), null);
  assert.match(en(store.showPicture({ image: uploadImage })), /already/);
  store.setComposerText('Use the red from the reference');
  assert.equal(await store.sendMessage(), true);
  const sent = bodies.at(-1);
  assert.equal(sent.path, `/api/projects/${PROJECT_ID}/messages`);
  assert.deepEqual(sent.body.images, [{ artifactId: ref.artifactId, sha256: ref.sha256 }]);
  assert.deepEqual(sent.body.scopeIds, [shotId('2.2')]);
  assert.match(sent.body.text, /^\[@coat-colours\.png\]\(#openslate-ref\/last-ferry\/image\/art-ref\/[a-f0-9]{64}\) \[@2\.2\]\(#openslate-ref\//);
  assert.deepEqual(store.getState().composer, { text: '', targets: [], sending: false, images: [], files: [] });
  await new Promise(done => setTimeout(done, FIXTURE_REPLY_MS + 300));
  assert.match(port.world.snapshot.conversation.at(-1).text, /I looked at the 2 pictures you showed me/);
  await store.refresh();
  const view = threadView(store.getState().snapshot, store.getState().overview, store.getState().director, 'en', new Date());
  const mine = view.entries.at(-2);
  assert.deepEqual(mine.user.pictures.map(p => p.label), ['coat-colours.png', '2.2']);
  assert.deepEqual(mine.user.segments, [{ kind: 'text', text: 'Use the red from the reference' }]);

  // The scripted Director: the store refuses to add a picture, and the fixture refuses one sent anyway.
  const scripted = new FixturePort();
  t.after(() => scripted.close());
  await assert.rejects(scripted.request(`/api/projects/${PROJECT_ID}/messages`, { method: 'POST', body: { text: 'x', scopeIds: [PROJECT_ID], images: [{ artifactId: ref.artifactId, sha256: ref.sha256 }] } }), { code: 'DIRECTOR_IMAGES_UNAVAILABLE' });
  await assert.rejects(port.request(`/api/projects/${PROJECT_ID}/messages`, { method: 'POST', body: { text: 'x', images: [{ artifactId: 'art-2.2', sha256: artifactFor('2.2').sha256 }] } }), { code: 'DIRECTOR_IMAGE_SCOPE' });
});

test('a message that finishes sending after another film opened leaves that film\'s composer alone', async t => {
  const port = new FixturePort();
  let release;
  const request = port.request.bind(port);
  port.request = async (path, options = {}) => {
    if (options.method === 'POST' && path.endsWith('/messages')) await new Promise(done => { release = done; });
    return request(path, options);
  };
  const store = new StudioStore({ client: port, storage: null, newKey: () => 'k' });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  store.setComposerText('For the ferry');
  const sending = store.sendMessage();
  await new Promise(done => setTimeout(done, 20));
  assert.equal(store.getState().composer.sending, true);
  // Another film opens meanwhile, and its own draft is typed.
  store.dispatch({ type: 'project', projectId: 'night-bus' });
  store.restoreDraft({ text: 'For the bus', targets: [], images: [] });
  release();
  assert.equal(await sending, true);
  assert.deepEqual(store.getState().composer, { text: 'For the bus', targets: [], sending: false, images: [], files: [] });
});

test('a picture shown while a message is sending is not lost: it waits in the composer for the next one', async t => {
  const port = new FixturePort();
  applyDirectorPresets(port.world, ['codex']);
  let release;
  const bodies = [];
  const request = port.request.bind(port);
  port.request = async (path, options = {}) => {
    if (options.method === 'POST' && path.endsWith('/messages')) { bodies.push(options.body); await new Promise(done => { release = done; }); }
    return request(path, options);
  };
  const store = new StudioStore({ client: port, storage: null, newKey: (() => { let n = 0; return () => `key-${++n}`; })() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  store.showPicture({ image: uploadImage });
  store.setComposerText('Use this red');
  const sending = store.sendMessage();
  await new Promise(done => setTimeout(done, 20));
  assert.equal(store.showPicture({ image: keyframe22 }), null);
  release();
  assert.equal(await sending, true);
  assert.deepEqual(bodies[0].images, [{ artifactId: ref.artifactId, sha256: ref.sha256 }]);
  assert.deepEqual(store.getState().composer, { text: '', targets: [], sending: false, images: [keyframe22], files: [] });
});

test('Let it go: release-holds takes no body and a key, refuses while the Director works, and frees the shots', async t => {
  const port = new FixturePort();
  applyDirectorPresets(port.world, ['held']);
  const sent = [];
  const request = port.request.bind(port);
  port.request = (path, options = {}) => { if (options.method === 'POST') sent.push({ path, body: options.body, key: options.key }); return request(path, options); };
  const store = new StudioStore({ client: port, storage: null, newKey: () => 'release-key' });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  await assert.rejects(request(`/api/projects/${PROJECT_ID}/requests/request-held/release-holds`, { method: 'POST', body: {} }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(request(`/api/projects/${PROJECT_ID}/requests/nope/release-holds`, { method: 'POST' }), { code: 'NOT_FOUND' });
  const receipt = await store.command('release-holds:request-held', { requestId: 'request-held' }, () => ({ path: '/requests/request-held/release-holds', body: undefined }));
  assert.deepEqual(receipt, { requestId: 'request-held', releasedHolds: 2 });
  assert.deepEqual(sent.at(-1), { path: `/api/projects/${PROJECT_ID}/requests/request-held/release-holds`, body: undefined, key: 'release-key' });
  assert.equal(heldEdits(port.world.overview, port.world.snapshot, port.world.director).length, 0);
  assert.equal(port.world.overview.shots[shotId('3.1')].keyframe.state, 'running');
  await new Promise(done => setTimeout(done, FIXTURE_TIMING.keyframeMs + 200));
  assert.equal(port.world.overview.shots[shotId('3.1')].keyframe.state, 'ready');
  // While the Director works on a request, it cannot be let go.
  const busy = new FixturePort();
  t.after(() => busy.close());
  applyDirectorPresets(busy.world, ['held']);
  busy.world.snapshot = { ...busy.world.snapshot, turns: [{ id: 'turn-held', requestId: 'request-held', state: 'running' }] };
  await assert.rejects(busy.request(`/api/projects/${PROJECT_ID}/requests/request-held/release-holds`, { method: 'POST' }), { code: 'DIRECTOR_WORKING' });
});
