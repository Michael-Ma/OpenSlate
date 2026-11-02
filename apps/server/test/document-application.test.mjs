import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { DocumentApplicationService, DOCUMENT_IMPORT_MAX_BYTES, DOCUMENT_TEXT_MAX_CHARACTERS } from '../dist/media/index.js';
import { extractPdfText } from '../dist/media/document-extraction.js';
import { FakeProvider } from '@openslate/providers';
import { newId } from '@openslate/core';
import { documentPdf } from './document-fixtures.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex'), code = expected => error => error?.code === expected;
let pdfAvailable = false;
try { pdfAvailable = JSON.parse(await readFile(new URL(import.meta.resolve('pdfjs-dist/package.json')), 'utf8')).version === '5.4.296'; } catch {}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-documents-')), store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') }), production = new ProductionService(store, engine);
  const project = production.createProject('Attached material'), human = production.beginRequest(project.id, 'human', 'Import document'), documents = new DocumentApplicationService(production, options);
  const head = () => store.getProject(project.id), input = (name = 'story.txt', bytes = Buffer.from('你好，渡船。\n中文文本'), key = newId()) => ({ expectedHeadVersion: head().headVersion, key, name, bytes, sha256: sha(bytes) });
  t.after(async () => { store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, production, project, human, documents, head, input };
}
function noPublication(f) {
  assert.equal(f.head().artifacts.length, 0); assert.equal(f.store.list('artifact', f.project.id).length, 0); assert.equal(f.store.list('document_import_receipt', f.project.id).length, 0);
  for (const family of ['grant', 'approval', 'attempt']) assert.equal(f.store.list(family, f.project.id).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
}

test('TXT and MD UTF-8 Chinese imports own exact bytes, extracted text and sanitized display names', async t => {
  const f = await fixture(t);
  for (const name of ['../中文故事.TXT', 'notes.md']) {
    const input = f.input(name), result = await f.documents.importDocument(f.project.id, f.human, input), record = f.store.get('artifact', result.artifact.artifactId);
    assert.equal(result.name, name.replace('../', '')); assert.equal(result.characters, 11); assert.equal(result.truncated, false); assert.equal('pages' in result, false);
    assert.equal(record.text, input.bytes.toString('utf8')); assert.equal(record.originalName, result.name); assert.equal(record.origin, 'supplied_document');
    assert.equal(record.mimeType, name.endsWith('.md') ? 'text/markdown' : 'text/plain'); assert.equal(record.fixture, false); assert.equal(record.attemptId, null);
    assert.deepEqual(await readFile(record.path), input.bytes); assert.equal(record.artifact.kind, 'document'); assert.equal(record.artifact.sha256, sha(input.bytes));
    assert.equal(JSON.stringify(result).includes(f.dir), false);
  }
  assert.deepEqual(await readdir(join(f.documents.rootDir, 'tmp')), []); assert.equal(f.head().headVersion, 2);
});

test('document text is capped at 200000 characters and the extraction receipt says truncated', async t => {
  const f = await fixture(t), text = '渡'.repeat(DOCUMENT_TEXT_MAX_CHARACTERS + 100), result = await f.documents.importDocument(f.project.id, f.human, f.input('long.md', Buffer.from(text)));
  const record = f.store.get('artifact', result.artifact.artifactId);
  assert.equal(result.characters, DOCUMENT_TEXT_MAX_CHARACTERS); assert.equal(record.text, text.slice(0, DOCUMENT_TEXT_MAX_CHARACTERS)); assert.equal(result.truncated, true);
});

test('upload bytes, name, command and human authority are snapshotted before asynchronous publication', async t => {
  const f = await fixture(t), input = f.input('original.md', Buffer.from('原始材料'), 'original'), actor = { ...f.human }, expected = Buffer.from(input.bytes);
  const pending = f.documents.importDocument(f.project.id, actor, input);
  input.bytes.fill(0); input.name = 'changed.exe'; input.key = 'changed'; input.sha256 = 'f'.repeat(64); actor.principalId = 'foreign';
  const result = await pending, record = f.store.get('artifact', result.artifact.artifactId);
  assert.equal(result.name, 'original.md'); assert.equal(record.text, '原始材料'); assert.deepEqual(await readFile(record.path), expected);
  assert.equal(f.store.list('document_import', f.project.id)[0].requestId, f.human.requestId);
});

test('a completed upload replays without extraction or publication and changed bytes or name conflict', async t => {
  let calls = 0;
  const f = await fixture(t, { extractPdf: async () => { calls++; return { text: 'Read only as material', pages: 1, truncated: false }; } });
  const input = f.input('brief.pdf', documentPdf(), 'once'), result = await f.documents.importDocument(f.project.id, f.human, input);
  assert.deepEqual(await f.documents.importDocument(f.project.id, f.human, input), result); assert.equal(calls, 1); assert.equal(f.head().headVersion, 1);
  for (const changed of [{ name: 'different.pdf' }, { bytes: documentPdf({ scanned: true }), sha256: sha(documentPdf({ scanned: true })) }])
    await assert.rejects(f.documents.importDocument(f.project.id, f.human, { ...input, ...changed }), code('IDEMPOTENCY_CONFLICT'));
  const intent = f.store.list('document_import', f.project.id)[0];
  assert.throws(() => f.store.put('document_import', intent.id, f.project.id, { ...intent, name: 'changed.pdf' }), code('IMMUTABLE_RECORD'));
  assert.throws(() => f.store.put('document_import_receipt', intent.id, f.project.id, { ...result, characters: 0 }), code('IMMUTABLE_RECORD'));
});

test('PDF service retains page count and an empty scanned text layer from the bounded extractor', async t => {
  const f = await fixture(t, { extractPdf: async bytes => ({ text: bytes.includes(Buffer.from('Hello')) ? 'Hello attached document' : '', pages: 1, truncated: false }) });
  for (const scanned of [false, true]) {
    const result = await f.documents.importDocument(f.project.id, f.human, f.input(scanned ? 'scan.pdf' : 'text.pdf', documentPdf({ scanned })));
    assert.equal(result.pages, 1); assert.equal(result.characters, scanned ? 0 : 23); assert.equal(result.truncated, false);
  }
});

test('oversized, malformed, binary, invalid UTF-8 and unsupported documents never publish', async t => {
  const f = await fixture(t);
  const invalid = [
    [f.input('huge.txt', Buffer.alloc(DOCUMENT_IMPORT_MAX_BYTES + 1)), 'UPLOAD_TOO_LARGE'], [f.input('wrong.pdf', Buffer.from('not a pdf')), 'DOCUMENT_INVALID'],
    [f.input('binary.txt', Buffer.from([0, 1, 2])), 'DOCUMENT_INVALID'], [f.input('invalid.md', Buffer.from([0xc3, 0x28])), 'DOCUMENT_INVALID'],
    [f.input('script.html', Buffer.from('<script>danger</script>')), 'DOCUMENT_FORMAT_UNSUPPORTED'],
  ];
  for (const [input, expected] of invalid) await assert.rejects(f.documents.importDocument(f.project.id, f.human, input), code(expected));
  noPublication(f); assert.deepEqual(await readdir(join(f.documents.rootDir, 'tmp')), []); assert.deepEqual(await readdir(join(f.documents.rootDir, 'blobs')), []);
});

test('stale heads and revoked human authority refuse before extraction', async t => {
  const f = await fixture(t, { extractPdf: () => { throw new Error('must refuse before extraction'); } }), input = f.input('text.pdf', documentPdf());
  const project = f.head(); f.store.saveProject({ ...project, revisionId: newId() }, project.headVersion);
  await assert.rejects(f.documents.importDocument(f.project.id, f.human, input), code('REVISION_CONFLICT'));
  const foreign = f.production.createProject('Foreign'); await assert.rejects(f.documents.importDocument(foreign.id, f.human, f.input()), code('ACTOR_DENIED'));
  f.production.beginRequest(f.project.id, 'human', 'New edit'); await assert.rejects(f.documents.importDocument(f.project.id, f.human, f.input()), code('ACTOR_DENIED')); noPublication(f);
});

test('extraction failure, cancellation or an edit during extraction cannot publish a document', async t => {
  for (const mode of ['failure', 'cancelled', 'superseded', 'stale']) {
    const abort = new AbortController(), f = await fixture(t, { extractPdf: async () => {
      if (mode === 'failure') throw Object.assign(new Error('bad PDF'), { code: 'DOCUMENT_INVALID' });
      if (mode === 'cancelled') abort.abort();
      if (mode === 'superseded') f.production.beginRequest(f.project.id, 'human', 'New edit');
      if (mode === 'stale') { const project = f.head(); f.store.saveProject({ ...project, revisionId: newId() }, project.headVersion); }
      return { text: 'original', pages: 1, truncated: false };
    } });
    await assert.rejects(f.documents.importDocument(f.project.id, f.human, f.input('text.pdf', documentPdf()), { signal: abort.signal }), code({ failure: 'DOCUMENT_INVALID', cancelled: 'MEDIA_CANCELLED', superseded: 'ACTOR_DENIED', stale: 'REVISION_CONFLICT' }[mode]));
    noPublication(f);
  }
});

test('concurrent replay publishes one artifact and a failed receipt can resume its immutable intent', async t => {
  const f = await fixture(t), input = f.input('story.txt', Buffer.from('one'), 'concurrent');
  const results = await Promise.all([1, 2].map(() => f.documents.importDocument(f.project.id, f.human, input)));
  assert.deepEqual(results[0], results[1]); assert.equal(f.head().headVersion, 1); assert.equal(f.head().artifacts.length, 1);
  const next = f.input('story.md'), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === 'document_import_receipt') throw new Error('synthetic receipt failure'); return insert(...args); };
  await assert.rejects(f.documents.importDocument(f.project.id, f.human, next), /synthetic receipt failure/); assert.equal(f.head().artifacts.length, 1);
  f.store.insert = insert;
  const intent = f.store.list('document_import', f.project.id).find(value => value.sha256 === next.sha256), result = await f.documents.importDocument(f.project.id, f.human, next);
  assert.equal(result.artifact.artifactId, intent.artifactId); assert.equal(f.head().artifacts.length, 2);
});

test('corrupted or linked immutable document storage is refused', async t => {
  for (const linked of [false, true]) {
    const f = await fixture(t), input = f.input(), destination = join(f.documents.rootDir, 'blobs', input.sha256);
    if (linked) { const outside = join(f.dir, 'outside'); await writeFile(outside, input.bytes); await symlink(outside, destination); }
    else await writeFile(destination, Buffer.alloc(input.bytes.length));
    await assert.rejects(f.documents.importDocument(f.project.id, f.human, input)); noPublication(f);
  }
});

test('real pdf.js worker extracts a text PDF and preserves a scanned PDF with no text', { skip: !pdfAvailable && 'Pinned pdfjs-dist package is unavailable in the offline cache' }, async () => {
  const text = await extractPdfText(documentPdf(), { timeoutMs: 15_000 }), scanned = await extractPdfText(documentPdf({ scanned: true }), { timeoutMs: 15_000 });
  assert.match(text.text, /Hello attached document/); assert.equal(text.pages, 1); assert.equal(text.truncated, false);
  assert.equal(scanned.text, ''); assert.equal(scanned.pages, 1); assert.equal(scanned.truncated, false);
  await assert.rejects(extractPdfText(Buffer.from('%PDF-1.4\nbroken'), { timeoutMs: 15_000 }), code('DOCUMENT_INVALID'));
});

test('PDF extraction cancellation and unavailable dependencies return explicit failures', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(extractPdfText(documentPdf(), { signal: abort.signal, timeoutMs: 15_000 }), code('MEDIA_CANCELLED'));
  if (!pdfAvailable) await assert.rejects(extractPdfText(documentPdf(), { timeoutMs: 15_000 }), code('DOCUMENT_EXTRACTOR_UNAVAILABLE'));
});

test('PDF extraction stops an active worker on its deadline or cancellation', async () => {
  await assert.rejects(extractPdfText(documentPdf(), { timeoutMs: 1 }), code('DOCUMENT_EXTRACTION_TIMEOUT'));
  const abort = new AbortController(), pending = extractPdfText(documentPdf(), { signal: abort.signal, timeoutMs: 15_000 }); abort.abort();
  await assert.rejects(pending, code('MEDIA_CANCELLED'));
});
