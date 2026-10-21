import test from 'node:test';
import assert from 'node:assert/strict';
import { droppedFiles, fileStatus, filesAfterSend, filesProblem, MAX_ATTACHMENTS, readyRefs, roomFor } from '../../src/next/model/composer-files.ts';
import { composerView, generationLines, messageBody, threadView } from '../../src/next/model/director.ts';
import { importedRef, uploadPath } from '../../src/next/model/assets-import.ts';
import { lastFerryOverview, sceneId, shotId, PROJECT_ID } from '../../src/next/fixtures/last-ferry.ts';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { FIXTURE_REPLY_MS } from '../../src/next/fixtures/fixture-director.ts';
import { reducer } from '../../src/next/store/reducer.ts';
import { initialState } from '../../src/next/store/state.ts';
import { StudioStore } from '../../src/next/store/store.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

const en = m => translateMsg('en', m), zh = m => translateMsg('zh-CN', m);
const hash = c => c.repeat(64);
const file = (key, patch = {}) => ({ key, name: `${key}.pdf`, kind: 'document', size: 2048, state: 'ready', loaded: 2048, ref: { artifactId: `art-${key}`, sha256: hash('a') }, ...patch });
const composer = (files, text = 'Look at these') => ({ text, targets: [], sending: false, images: [], files });

test('a file chip says what it is, how the upload goes, or why it failed', () => {
  assert.equal(en(fileStatus(file('a'))), 'Document · 2 KB');
  assert.equal(zh(fileStatus(file('a', { kind: 'video', size: 3 * 1024 * 1024 }))), '视频 · 3 MB');
  assert.equal(en(fileStatus(file('a', { state: 'uploading', loaded: 512 }))), 'Uploading 25%');
  assert.equal(en(fileStatus(file('a', { state: 'uploading', loaded: 2048 }))), 'Saving to Assets…');
  assert.equal(en(fileStatus(file('a', { state: 'failed', refusal: { id: 'assets.refusal.image_format' } }))), 'This picture format can’t be imported. Use PNG, JPEG, WebP or HEIC.');
});

test('Send waits for uploads, is held by a failed file or too many, and carries only saved files', () => {
  assert.equal(filesProblem([file('a')]), null);
  const waiting = filesProblem([file('a'), file('b', { state: 'uploading', loaded: 0 })]);
  assert.deepEqual([en(waiting.reason), waiting.waiting], ['Waiting for 1 file to upload…', true]);
  assert.equal(filesProblem([file('a', { state: 'failed' })]).waiting, false);
  const many = Array.from({ length: 7 }, (_, i) => file(`f${i}`));
  assert.equal(filesProblem(many, 1), null, 'seven files and one picture fit');
  assert.equal(en(filesProblem(many, 2).reason), 'A message can carry 8 files and pictures; this one has 9.');
  assert.equal(roomFor(many, 1), 0);
  assert.equal(MAX_ATTACHMENTS, 8);

  const overview = lastFerryOverview();
  const uploading = composerView(composer([file('a', { state: 'uploading', loaded: 10 })]), true, overview);
  assert.deepEqual([uploading.canSend, en(uploading.hint), uploading.problem], [false, 'Waiting for 1 file to upload…', null]);
  const failed = composerView(composer([file('a', { state: 'failed' })]), true, overview);
  assert.deepEqual([failed.canSend, en(failed.problem)], [false, 'Remove the file that could not be uploaded to send this message.']);
  assert.equal(composerView(composer([file('a')]), true, overview).canSend, true);

  const body = messageBody(composer([file('a'), file('b', { state: 'uploading' })]), overview);
  assert.deepEqual(body.attachments, [{ artifactId: 'art-a', sha256: hash('a') }]);
  assert.equal(messageBody(composer([]), overview).attachments, undefined, 'no attachments field without files');
  assert.deepEqual(readyRefs([file('x', { state: 'failed' })]), []);
});

test('sending takes away only the files that went; one attached meanwhile stays', () => {
  const sent = [file('a')];
  assert.deepEqual(filesAfterSend([file('a'), file('b')], sent).map(f => f.key), ['b']);
  let state = reducer(initialState, { type: 'project', projectId: PROJECT_ID });
  state = reducer(state, { type: 'composerFile', file: file('a', { state: 'uploading', loaded: 0 }) });
  state = reducer(state, { type: 'composerFile', file: file('b') });
  state = reducer(state, { type: 'composerFile', file: file('a') });
  assert.deepEqual(state.composer.files.map(f => `${f.key}:${f.state}`), ['a:ready', 'b:ready'], 'an update keeps its place');
  state = reducer(state, { type: 'composerSent', sent: { text: '', targets: [], images: [], files: [state.composer.files[0]] } });
  assert.deepEqual(state.composer.files.map(f => f.key), ['b']);
  state = reducer(state, { type: 'composerFile', file: state.composer.files[0], remove: true });
  assert.deepEqual(state.composer.files, []);
  state = reducer(reducer(state, { type: 'composerFile', file: file('c') }), { type: 'project', projectId: 'other' });
  assert.deepEqual(state.composer.files, [], 'another film starts with an empty composer');
});

test('drops and pastes take real files only; uploads go to the route for their kind', () => {
  const pdf = { name: 'a.pdf' };
  assert.deepEqual(droppedFiles([{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => pdf }], null), [pdf]);
  assert.deepEqual(droppedFiles([], [pdf]), [pdf]);
  assert.equal(uploadPath('document', 7, 'upload', 'Treatment v2.pdf'), '/documents/uploads?expectedHeadVersion=7&name=Treatment+v2.pdf');
  assert.equal(uploadPath('image', 7, 'upload', 'a.jpg'), '/images/uploads?expectedHeadVersion=7');
  assert.deepEqual(importedRef('document', { artifact: { artifactId: 'd1', sha256: hash('b'), kind: 'document' }, characters: 10 }), { artifactId: 'd1', sha256: hash('b') });
  assert.deepEqual(importedRef('audio', { recording: { id: 'rec-1', sha256: hash('c') } }), { artifactId: 'rec-1', sha256: hash('c') }, 'audio is named by its library recording');
  assert.equal(importedRef('image', { artifact: { artifactId: 'x' } }), null, 'a receipt without a hash names nothing');
});

test('the Director says what it started and its price, and offers Stop while it is being made', () => {
  const overview = lastFerryOverview();
  const effect = { kind: 'keyframes', sceneIds: [sceneId(3)], shotIds: [shotId('3.1'), shotId('3.2')], keyframes: 2, voiceLines: 1,
    quote: { micros: '90000', units: 3, unitMicros: '0', priceUnknown: false }, at: '2026-10-21T01:00:00.000Z' };
  const [line] = generationLines([effect], overview, 'en');
  assert.equal(en(line.text), 'Started 2 keyframes and 1 voice line in Scene 3 · about $0.09');
  assert.equal(zh(line.text), '已在第 3 场开始生成 2 张关键帧和 1 条配音 · 约 $0.09');
  assert.equal(line.running, false, 'nothing of it is being made in the sample overview');
  const making = { ...overview, shots: { ...overview.shots, [shotId('3.1')]: { ...overview.shots[shotId('3.1')], keyframe: { state: 'running', phase: 'running', startedAt: 'x', attemptId: 'a', takeCount: 0, opened: false } } } };
  assert.equal(generationLines([effect], making, 'en')[0].running, true);
  const two = generationLines([{ ...effect, sceneIds: [sceneId(1), sceneId(3)], keyframes: 1, voiceLines: 0 }], overview, 'en')[0];
  assert.equal(en(two.text), 'Started 1 keyframe in Scenes 1 and 3 · about $0.09');
});

test('the sample film lists a message’s files, and starts keyframes when asked', async t => {
  const port = new FixturePort();
  const store = new StudioStore({ client: port, storage: null, newKey: (() => { let n = 0; return () => `key-${++n}`; })() });
  t.after(() => { store.stop(); port.close(); });
  await store.start();
  const head = port.world.snapshot.project.headVersion;
  const receipt = await port.request(`/api/projects/${PROJECT_ID}/documents/uploads?expectedHeadVersion=${head}&name=treatment.pdf`, { method: 'POST', body: { key: 'k1', size: 4000, type: 'application/pdf' } });
  assert.deepEqual([receipt.name, receipt.pages, receipt.artifact.kind], ['treatment.pdf', 1, 'document']);
  store.dispatch({ type: 'composerFile', file: file('t', { ref: { artifactId: receipt.artifact.artifactId, sha256: receipt.artifact.sha256 } }) });
  store.setComposerText('Please make the keyframes now');
  assert.equal(await store.sendMessage(), true);
  const sent = port.world.snapshot.conversation.at(-1);
  assert.deepEqual(sent.attachments.map(a => [a.name, a.artifact.kind, a.readable]), [['treatment.pdf', 'document', true]]);
  await new Promise(done => setTimeout(done, FIXTURE_REPLY_MS + 300));
  await store.refresh();
  const view = threadView(store.getState().snapshot, store.getState().overview, store.getState().director, 'en', new Date());
  const reply = view.entries.at(-1);
  assert.match(reply.blocks.map(b => JSON.stringify(b)).join(''), /Starting the keyframes now/);
  assert.equal(en(reply.generation[0].text), 'Started 2 keyframes and 1 voice line in Scene 3 · about $0.09');
  assert.equal(view.entries.at(-2).attachments[0].name, 'treatment.pdf');
  await assert.rejects(port.request(`/api/projects/${PROJECT_ID}/messages`, { method: 'POST', body: { text: 'x', attachments: [{ artifactId: 'nope', sha256: hash('d') }] } }), /DIRECTOR_ATTACHMENT_SCOPE/);
});
