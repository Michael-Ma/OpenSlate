import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { projectDirectorContext, DIRECTOR_PROJECTION_LIMITS } from '../dist/application/context-projection.js';
import { TRANSCRIPT_REVIEW_LIMITS } from '../dist/narration/transcript-projection.js';
import { transcriptSelectionFixture, payload, response } from './transcript-selection-fixture.mjs';

const token = 'offline_transcript_review_http_token';
async function setup(t, options = {}) {
  const f = await transcriptSelectionFixture(t, options);
  f.app = createApp({ service: f.production, localToken: token });
  registerNarrationRoutes(f.app, { production: f.production, narration: f.narration, canonical: f.canonical, uploadDirectory: join(f.root, 'uploads') });
  await f.app.ready(); t.after(() => f.app.close()); f.base = `/api/projects/${f.project.id}/narration`;
  f.request = (suffix = '', body, extra = {}) => f.app.inject({ method: body === undefined ? 'GET' : 'POST', url: `${f.base}${suffix}`, ...(body === undefined ? {} : { payload: body }), ...extra,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...extra.headers } });
  f.preview = async (start = 0, end = f.candidate.projection.words.length) => {
    const res = await f.request(`/transcripts/${f.candidate.id}/selection?${new URLSearchParams({ audioId: f.audio.id, candidateDigest: digest(f.candidate), startWordIndex: String(start), endWordIndex: String(end) })}`);
    assert.equal(res.statusCode, 200, res.body); return res.json();
  };
  f.session = async () => { const res = await f.request('/sessions', {}); assert.equal(res.statusCode, 200, res.body); return res.json().session; };
  f.input = (session, preview) => { const view = f.narration.workspaceSnapshot(f.project.id), row = view.segments[0];
    return { sessionId: session.id, expectedVersion: view.state.version, segmentId: row.entry.segmentId, segmentRevisionId: row.script.id,
      audioId: f.audio.id, candidateId: preview.candidateId, candidateDigest: preview.candidateDigest,
      startWordIndex: preview.startWordIndex, endWordIndex: preview.endWordIndex, selectedTextDigest: preview.selectedTextDigest }; };
  f.changes = () => f.store.db.prepare('SELECT total_changes() AS n').get().n;
  return f;
}
const wordPath = (f, offset = 0) => `/transcripts/${f.candidate.id}/words?audioId=${f.audio.id}&candidateDigest=${digest(f.candidate)}&offset=${offset}`;
const flagged = () => response(Buffer.from(JSON.stringify(payload({ words: [{ word: ' Leather ', start: 0.00002, end: 0.25 }, { word: 'boots.', start: 0.9, end: 1.000000001 }] }))));

test('authenticated transcript reads expose exact words and flags without requests, holds, media work or canonical writes', async t => {
  const f = await setup(t, { fetch: flagged }), before = f.changes(), project = canonical(f.store.getProject(f.project.id));
  assert.equal((await f.request(`/audio/${f.audio.id}/transcripts`, undefined, { headers: { authorization: '' } })).statusCode, 403);
  assert.equal((await f.request(wordPath(f), undefined, { headers: { origin: 'https://foreign.example' } })).statusCode, 403);
  const res = await f.request(`/audio/${f.audio.id}/transcripts`); assert.equal(res.statusCode, 200, res.body);
  const list = res.json(); assert.equal(list.candidates.length, 1); assert.equal(list.candidates[0].candidateDigest, digest(f.candidate));
  assert.equal(list.candidates[0].audioId, f.audio.id); assert.equal(list.coverage.nextOffset, null);
  const words = (await f.request(wordPath(f))).json(); assert.equal(words.words.length, 2);
  assert.equal(words.words[0].word, ' Leather '); assert.equal(words.words[1].endSample, 48000, 'rounded endpoint does not erase source flags');
  assert.ok(words.words[1].parserIssues.includes('word_outside_source')); assert.ok(words.words[1].sampleIssues.includes('source_range_exceeded'));
  const preview = await f.preview(); assert.equal(preview.text, 'Leather boots.'); assert.equal(preview.writing.allowed, true); assert.equal(preview.timing.allowed, false);
  assert.equal(preview.selectedTextDigest, digest({ policy: 'trim-join-ascii-space-v1', text: 'Leather boots.' }));
  const valid = await f.preview(0, 1); assert.equal(valid.timing.allowed, true); assert.equal(valid.timing.startSample, 1); assert.equal(valid.timing.endSample, 12000);
  for (const value of [list, words, preview]) { assert.ok(Buffer.byteLength(canonical(value)) <= 64 * 1024); assert.ok(!canonical(value).includes(f.root)); assert.ok(!canonical(value).includes('mappingDigest')); }
  assert.equal(f.changes(), before); assert.equal(canonical(f.store.getProject(f.project.id)), project); assert.deepEqual(f.calls, f.initialCalls);
  assert.equal(f.store.list('narration_session', f.project.id).length, 0); assert.equal(f.store.list('narration_transcript_selection', f.project.id).length, 0);
});

test('human timing adoption rejects flagged endpoints, preserves script/audio acceptance and replays after later changes', async t => {
  const f = await setup(t, { fetch: flagged }), session = await f.session(), old = f.narration.workspaceSnapshot(f.project.id), project = canonical(f.store.getProject(f.project.id));
  const rejected = await f.request('/transcript-timing', f.input(session, await f.preview())); assert.notEqual(rejected.statusCode, 200);
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), canonical(old));
  const body = f.input(session, await f.preview(0, 1)), headers = { 'idempotency-key': 'one-exact-timing' };
  const res = await f.request('/transcript-timing', body, { headers }); assert.equal(res.statusCode, 200, res.body);
  const selected = res.json(); assert.equal(selected.state.version, body.expectedVersion + 1);
  assert.equal(selected.segments[0].cue.method, 'transcript_selection'); assert.equal(selected.segments[0].cue.startSample, 1); assert.equal(selected.segments[0].cue.endSample, 12000);
  assert.deepEqual(selected.segments[0].accepted, { script: true, audio: true, timing: false }); assert.deepEqual(selected.segments[0].script, old.segments[0].script);
  const later = await f.request('/placements', { sessionId: session.id, expectedVersion: selected.state.version, placements: [{ segmentId: body.segmentId, atSample: 48000 }] }); assert.equal(later.statusCode, 200, later.body);
  const replay = await f.request('/transcript-timing', body, { headers }); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), selected);
  const changed = await f.request('/transcript-timing', { ...body, endWordIndex: 2 }, { headers }); assert.equal(changed.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(canonical(f.store.getProject(f.project.id)), project); assert.equal(f.store.get('transcript_candidate', f.candidate.id).status, 'unreviewed'); assert.deepEqual(f.calls, f.initialCalls);
});

test('human recognized-word adoption changes draft only and records additive bounded context provenance', async t => {
  const f = await setup(t), session = await f.session(), before = f.narration.workspaceSnapshot(f.project.id), preview = await f.preview(0, 1), body = f.input(session, preview);
  const actor = { kind: 'human', principalId: 'local-user', requestId: session.requestId };
  const priorContext = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' });
  assert.equal('transcriptAdoption' in priorContext.narrationDraft.segments[0], false);
  const res = await f.request('/transcript-words', body); assert.equal(res.statusCode, 200, res.body); const next = res.json(), row = next.segments[0];
  assert.equal(row.script.text, 'Leather'); assert.equal(row.script.textKind, 'draft'); assert.equal(row.script.meaning, before.segments[0].script.meaning);
  assert.equal(row.audio.id, f.audio.id); assert.equal(row.cue, null); assert.deepEqual(row.accepted, { script: false, audio: false, timing: false });
  const changes = f.changes(), context = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' });
  assert.equal(context.narrationDraft.segments[0].transcriptAdoption.writingSelectionId, row.script.transcriptSelectionId);
  assert.equal(context.narrationDraft.segments[0].transcriptAdoption.timingSelectionId, null); assert.notEqual(context.guard.dataDigest, priorContext.guard.dataDigest);
  assert.equal(context.applicationCapabilities.version, 3); assert.equal(context.applicationCapabilities.narration.transcriptReview.automaticAdoption, false);
  assert.equal(context.applicationCapabilities.narration.transcription.available, false); assert.ok(Buffer.byteLength(canonical(context)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
  const digestBefore = context.guard.dataDigest; context.narrationDraft.segments[0].transcriptAdoption.writingSelectionId = 'invented';
  assert.equal(projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' }).guard.dataDigest, digestBefore);
  assert.equal(f.changes(), changes); assert.deepEqual(f.calls, f.initialCalls);
});

test('identical word selection is a true HTTP no-op and exact replay retains the original version', async t => {
  const f = await setup(t), session = await f.session(), body = f.input(session, await f.preview()), before = f.narration.workspaceSnapshot(f.project.id);
  const counts = Object.fromEntries(['narration_segment', 'narration_revision', 'narration_cue', 'narration_transcript_selection', 'narration_acceptance'].map(kind => [kind, f.store.list(kind, f.project.id).length]));
  const headers = { 'idempotency-key': 'identical-text-once' }, res = await f.request('/transcript-words', body, { headers });
  assert.equal(res.statusCode, 200, res.body); assert.deepEqual(res.json(), before); assert.equal(res.json().state.version, body.expectedVersion);
  const later = await f.request('/placements', { sessionId: session.id, expectedVersion: body.expectedVersion, placements: [{ segmentId: body.segmentId, atSample: 48000 }] }); assert.equal(later.statusCode, 200, later.body);
  const replay = await f.request('/transcript-words', body, { headers }); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), before);
  for (const kind of ['narration_segment', 'narration_cue', 'narration_transcript_selection', 'narration_acceptance']) assert.equal(f.store.list(kind, f.project.id).length, counts[kind], kind);
});

test('transcript HTTP rejects forged actor, stale section/audio/digests and foreign sessions without adoption', async t => {
  const f = await setup(t), session = await f.session(), body = f.input(session, await f.preview(0, 1)), before = canonical(f.narration.workspaceSnapshot(f.project.id));
  for (const patch of [{ actor: { kind: 'human' } }, { path: '/tmp/raw.json' }, { candidateDigest: 'bad' }, { startWordIndex: -1 }, { endWordIndex: 8193 }]) assert.equal((await f.request('/transcript-words', { ...body, ...patch })).statusCode, 400);
  assert.equal((await f.request('/transcript-words', body, { headers: { 'idempotency-key': '' } })).statusCode, 400);
  for (const patch of [{ sessionId: randomUUID() }, { segmentRevisionId: randomUUID() }, { audioId: randomUUID() }, { candidateDigest: 'f'.repeat(64) }, { selectedTextDigest: 'f'.repeat(64) }, { startWordIndex: 1, endWordIndex: 1 }]) assert.notEqual((await f.request('/transcript-words', { ...body, ...patch })).statusCode, 200);
  const other = f.production.createProject('Other');
  assert.notEqual((await f.request('/transcript-words', body, { url: `/api/projects/${other.id}/narration/transcript-words` })).statusCode, 200);
  assert.notEqual((await f.request(`/transcripts/${f.candidate.id}/words?audioId=${f.audio.id}&candidateDigest=${'f'.repeat(64)}`)).statusCode, 200);
  assert.equal((await f.request(`${wordPath(f)}&path=/tmp/anything`)).statusCode, 400);
  f.production.beginRequest(f.project.id, 'local-user', 'A later creative request');
  assert.equal((await f.request('/transcript-words', body)).json().error.code, 'NARRATION_SESSION_STALE');
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), before); assert.deepEqual(f.calls, f.initialCalls);
});

test('candidate list scans at most 20 IDs and checks cumulative bytes before parsing, preserving empty-page continuation', async t => {
  const f = await setup(t), insert = f.store.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES('transcript_candidate',?,?,?)");
  for (let i = 0; i < 20; i++) insert.run(`invalid-${i}`, f.project.id, '{}');
  let res = await f.request(`/audio/${f.audio.id}/transcripts`); assert.equal(res.statusCode, 200, res.body); const first = res.json();
  assert.equal(first.coverage.scanned, 20); assert.deepEqual(first.candidates, []); assert.equal(first.coverage.nextOffset, 20);
  res = await f.request(`/audio/${f.audio.id}/transcripts?offset=20&expectedDigest=${first.coverage.dataDigest}`); assert.equal(res.statusCode, 200, res.body); assert.equal(res.json().candidates[0].id, f.candidate.id);
  insert.run('huge-invalid-1', f.project.id, '{}'.padEnd(9 * 1024 ** 2)); insert.run('huge-invalid-2', f.project.id, '{}'.padEnd(9 * 1024 ** 2));
  assert.notEqual((await f.request(`/audio/${f.audio.id}/transcripts?offset=20&expectedDigest=${first.coverage.dataDigest}`)).statusCode, 200);
  const changes = f.changes(); res = await f.request(`/audio/${f.audio.id}/transcripts`); assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().coverage.scanned, 1); assert.equal(res.json().coverage.nextOffset, 1); assert.equal(res.json().coverage.candidateBytes, 9 * 1024 ** 2); assert.equal(f.changes(), changes);
  insert.run('oversized-invalid', f.project.id, '{}'.padEnd(12 * 1024 ** 2 + 1));
  res = await f.request(`/audio/${f.audio.id}/transcripts`); assert.equal(res.statusCode, 200, res.body); assert.equal(res.json().coverage.scanned, 2, 'oversized row skipped without parsing before one bounded row');
});

test('long original word pages adapt below 64 KiB and large writing selections leave timing independently available', async t => {
  const words = Array.from({ length: 90 }, (_, i) => ({ word: String(i).padStart(3, '0') + 'x'.repeat(1000), start: i / 100, end: (i + 1) / 100 }));
  const text = words.map(word => word.word).join(' '), f = await setup(t, { fetch: () => response(Buffer.from(JSON.stringify(payload({ text, words })))) });
  const indices = []; let offset = 0;
  do {
    const res = await f.request(wordPath(f, offset)); assert.equal(res.statusCode, 200, res.body); assert.ok(Buffer.byteLength(res.body) <= TRANSCRIPT_REVIEW_LIMITS.pageBytes);
    const page = res.json(); assert.ok(page.words.length <= 64); if (offset === 0) assert.ok(page.words.length < 64, 'actual byte cap reduces first page');
    for (const word of page.words) { assert.equal(word.word, words[word.index].word); indices.push(word.index); } offset = page.page.nextOffset;
  } while (offset !== null);
  assert.deepEqual(indices, words.map((_, i) => i)); const preview = await f.preview();
  assert.equal(preview.text, null); assert.equal(preview.writing.allowed, false); assert.equal(preview.timing.allowed, true);
  assert.equal(preview.selectedTextDigest, digest({ policy: 'trim-join-ascii-space-v1', text })); assert.ok(Buffer.byteLength(canonical(preview)) < 64 * 1024);
  assert.deepEqual(f.calls, f.initialCalls);
});
