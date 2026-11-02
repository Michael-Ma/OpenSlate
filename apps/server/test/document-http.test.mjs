import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { DocumentApplicationService, DOCUMENT_IMPORT_MAX_BYTES } from '../dist/media/index.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { FakeProvider } from '@openslate/providers';
import { newId } from '@openslate/core';
import { documentPdf } from './document-fixtures.mjs';

async function fixture(t, { maxBytes = DOCUMENT_IMPORT_MAX_BYTES, extractPdf } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-document-http-')), store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts') }), production = new ProductionService(store, engine);
  const project = production.createProject('HTTP documents'), uploads = new ManagedUploadStore({ rootDir: join(dir, 'uploads'), maxBytes });
  const documents = new DocumentApplicationService(production, extractPdf ? { extractPdf } : {}), token = 'test-local-token-with-enough-characters';
  const app = createApp({ service: production, localToken: token, documentRoutes: { production, documents, uploads } });
  const path = `/api/projects/${project.id}/documents`, head = () => store.getProject(project.id);
  const request = (method, url, payload, key = newId(), extra = {}) => app.inject({ method, url, ...(payload !== undefined ? { payload } : {}), headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': key, ...extra } });
  const upload = ({ key = newId(), requestId, bytes = Buffer.from('你好，渡船。\n中文文本'), name = 'story.txt', version = head().headVersion } = {}) => request('POST', `${path}/uploads?expectedHeadVersion=${version}&name=${encodeURIComponent(name)}${requestId ? `&requestId=${requestId}` : ''}`, bytes, key, { 'content-type': 'application/octet-stream' });
  t.after(async () => { await app.close(); store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, store, provider, engine, production, project, documents, uploads, app, head, path, request, upload };
}

test('authenticated Chinese document uploads expose contract metadata and owned downloadable bytes', async t => {
  const f = await fixture(t), response = await f.upload(); assert.equal(response.statusCode, 200, response.body);
  const result = response.json(), record = f.store.get('artifact', result.artifact.artifactId);
  assert.equal(result.name, 'story.txt'); assert.equal(result.artifact.kind, 'document'); assert.equal(result.characters, record.text.length); assert.equal(result.truncated, false);
  assert.equal('pages' in result, false); assert.equal(response.body.includes(f.dir), false);
  const content = await f.request('GET', `/api/projects/${f.project.id}/artifacts/${result.artifact.artifactId}/content`);
  assert.equal(content.statusCode, 200, content.body); assert.match(content.headers['content-type'], /^text\/plain/); assert.deepEqual(content.rawPayload, await readFile(record.path));
  const foreign = f.production.createProject('Other owner');
  assert.equal((await f.request('GET', `/api/projects/${foreign.id}/artifacts/${result.artifact.artifactId}/content`)).statusCode, 404);
  assert.deepEqual(await readdir(f.uploads.rootDir), []);
  for (const family of ['grant', 'approval', 'attempt']) assert.equal(f.store.list(family, f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test('document upload retries reuse their request and receipt; changed content conflicts', async t => {
  const f = await fixture(t), input = { key: 'once', version: 0, bytes: Buffer.from('# 中文材料'), name: 'notes.md' }, first = await f.upload(input);
  assert.equal(first.statusCode, 200, first.body);
  const replay = await f.upload(input); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), first.json());
  const changed = await f.upload({ ...input, bytes: Buffer.from('changed') }); assert.equal(changed.statusCode, 409, changed.body); assert.equal(changed.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.store.list('message', f.project.id).length, 1); assert.equal(f.head().artifacts.length, 1); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test('PDF metadata uses extraction page count and keeps a scanned PDF at zero characters', async t => {
  const f = await fixture(t, { extractPdf: async () => ({ text: '', pages: 1, truncated: false }) });
  const response = await f.upload({ name: 'scanned.pdf', bytes: documentPdf({ scanned: true }) });
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().pages, 1); assert.equal(response.json().characters, 0); assert.equal(response.json().truncated, false);
  const assets = await f.request('GET', `/api/projects/${f.project.id}/assets`); assert.equal(assets.statusCode, 200, assets.body);
  const asset = assets.json().assets.find(value => value.artifact.artifactId === response.json().artifact.artifactId);
  assert.equal(asset.label, 'scanned.pdf · 1 page'); assert.equal(asset.role, 'document'); assert.equal(asset.source, 'imported');
});

test('local session, Host, Origin and bounded query schemas guard document uploads', async t => {
  const f = await fixture(t), url = `${f.path}/uploads?expectedHeadVersion=0&name=story.txt`;
  for (const extra of [{ authorization: '' }, { host: 'evil.invalid' }, { origin: 'https://evil.invalid' }])
    assert.equal((await f.request('POST', url, Buffer.from('text'), newId(), { 'content-type': 'application/octet-stream', ...extra })).statusCode, 403);
  for (const suffix of ['&path=/tmp/private', '&principalId=other'])
    assert.equal((await f.request('POST', `${url}${suffix}`, Buffer.from('text'), newId(), { 'content-type': 'application/octet-stream' })).statusCode, 400);
  assert.equal((await f.request('POST', `${f.path}/uploads?expectedHeadVersion=0`, Buffer.from('text'), newId(), { 'content-type': 'application/octet-stream' })).statusCode, 400);
  assert.equal(f.store.list('message', f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test('oversize, malformed and invalid document uploads release every staged byte', async t => {
  const f = await fixture(t, { maxBytes: 64 });
  const large = await f.upload({ bytes: Buffer.alloc(65) }); assert.equal(large.statusCode, 409, large.body); assert.equal(large.json().error.code, 'UPLOAD_TOO_LARGE');
  const requestId = large.json().requestId;
  for (const [name, bytes, expected] of [['empty.txt', Buffer.alloc(0), 'VALIDATION_ERROR'], ['bad.pdf', Buffer.from('broken pdf'), 'DOCUMENT_INVALID'], ['bad.md', Buffer.from([0xff]), 'DOCUMENT_INVALID'], ['bad.exe', Buffer.from('unsupported'), 'DOCUMENT_FORMAT_UNSUPPORTED']]) {
    const response = await f.upload({ requestId, name, bytes }); assert.equal(response.json().error.code, expected, response.body);
  }
  assert.equal(f.head().artifacts.length, 0); assert.equal(f.store.list('document_import_receipt', f.project.id).length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});

test('superseding the request during PDF extraction refuses publication', async t => {
  const f = await fixture(t, { extractPdf: async () => { f.production.beginRequest(f.project.id, 'local-user', 'New edit'); return { text: 'stale', pages: 1, truncated: false }; } });
  const response = await f.upload({ name: 'story.pdf', bytes: documentPdf() });
  assert.equal(response.statusCode, 403, response.body); assert.equal(response.json().error.code, 'ACTOR_DENIED'); assert.equal(f.head().artifacts.length, 0); assert.deepEqual(await readdir(f.uploads.rootDir), []);
});
