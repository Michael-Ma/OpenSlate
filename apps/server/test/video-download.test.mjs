import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProtectedVideoDownloader, VIDEO_DOWNLOAD_LIMITS } from '../dist/execution/video-download.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { digest } from '../../../packages/core/dist/index.js';
import { setup } from './execution-fixture.mjs';

const receipt = (locator = 'https://media.example.test/result.mp4?signature=private-value', extra = {}) => ({
  id: 'a'.repeat(64), version: 1, projectId: 'project', attemptId: 'attempt', requestDigest: 'b'.repeat(64),
  execution: { adapter: 'test-video', version: '1' }, port: 'video', kind: 'video', mimeType: 'video/mp4',
  vendorTaskId: 'task', diagnosticRequestId: null, source: { kind: 'protected_locator', locator, expiresAt: null }, ...extra,
});
function network(options = {}) {
  const observed = { calls: [], closes: 0, aborts: 0, lookups: 0 };
  const request = (args, callback) => {
    observed.calls.push(args); const client = new EventEmitter(); let body, closed = false;
    client.destroy = () => { if (!closed) { closed = true; args.signal.removeEventListener('abort', abort); body?.destroy(); queueMicrotask(() => { observed.closes++; client.emit('close'); }); } return client; };
    const abort = () => { observed.aborts++; body?.destroy(Error('private URL must not escape')); client.emit('error', Error('private URL must not escape')); client.destroy(); };
    args.signal.addEventListener('abort', abort, { once: true });
    client.end = () => queueMicrotask(() => {
      if (args.signal.aborted) return abort();
      if (options.error) { client.emit('error', Error(options.error)); client.destroy(); return; }
      if (options.noHeaders) return;
      body = options.stalledBody ? new PassThrough() : Readable.from(options.chunks ?? [Buffer.from('synthetic raw MP4 bytes')]);
      body.on('error', () => {}); body.statusCode = options.status ?? 200;
      body.headers = options.headers ?? { 'content-type': 'video/mp4' }; callback(body);
    });
    return client;
  };
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ['media.example.test'],
    lookup: async host => { observed.lookups++; assert.equal(host, 'media.example.test'); return options.addresses ?? [{ address: '8.8.8.8', family: 4 }]; },
    request, ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  return { downloader, observed, request };
}
async function bytes(source, signal = new AbortController().signal) { const chunks = []; for await (const chunk of source(signal)) chunks.push(chunk); return Buffer.concat(chunks); }
async function until(check) { const start = Date.now(); while (!check()) { assert.ok(Date.now() - start < 2000); await new Promise(resolve => setTimeout(resolve, 5)); } }

test('protected download uses one pinned HTTPS GET with original host TLS and no API authentication', async () => {
  const f = network(); const result = await bytes(f.downloader.source(receipt()));
  assert.equal(result.toString(), 'synthetic raw MP4 bytes'); assert.equal(f.observed.calls.length, 1); assert.equal(f.observed.closes, 1);
  const args = f.observed.calls[0]; assert.equal(args.method, 'GET'); assert.equal(args.protocol, 'https:'); assert.equal(args.hostname, 'media.example.test');
  assert.equal(args.servername, 'media.example.test'); assert.equal(args.rejectUnauthorized, true); assert.equal(args.family, 4); assert.equal(args.port, 443);
  assert.equal(args.path, '/result.mp4?signature=private-value'); assert.equal(args.maxHeaderSize, VIDEO_DOWNLOAD_LIMITS.headerBytes);
  assert.deepEqual(args.headers, { accept: 'video/mp4,application/octet-stream', 'accept-encoding': 'identity' });
  assert.deepEqual(args.agent.options.proxyEnv, {}); assert.equal(args.agent.options.maxCachedSessions, 0);
  assert.deepEqual(await new Promise((resolve, reject) => args.lookup('media.example.test', { all: true }, (error, value) => error ? reject(error) : resolve(value))), [{ address: '8.8.8.8', family: 4 }]);
});

test('locator and configured hosts are captured; caller mutation cannot redirect the source', async () => {
  const observed = [], hosts = ['media.example.test'], addresses = [{ address: '8.8.8.8', family: 4 }], f = network();
  const downloader = new ProtectedVideoDownloader({ allowedHosts: hosts, lookup: async () => addresses, request: (args, callback) => {
    addresses[0].address = '127.0.0.1'; args.lookup(args.hostname, {}, (error, address, family) => { assert.equal(error, null); observed.push([address, family]); }); return f.request(args, callback);
  } });
  const value = receipt(), source = downloader.source(value); value.source.locator = 'https://evil.example.test/x'; hosts[0] = 'evil.example.test';
  await bytes(source); assert.deepEqual(observed, [['8.8.8.8', 4]]); assert.equal(f.observed.calls[0].hostname, 'media.example.test');
  assert.throws(() => downloader.source(receipt('https://evil.example.test/x')), { code: 'OUTPUT_DOWNLOAD_LOCATOR' });
});

test('non-HTTPS, credentials, IPs, custom ports, fragments and unconfigured hosts fail before DNS', () => {
  const f = network();
  for (const locator of ['http://media.example.test/x', 'file:///tmp/x', 'https://user:secret@media.example.test/x', 'https://127.0.0.1/x',
    'https://[::1]/x', 'https://media.example.test:444/x', 'https://media.example.test/x#fragment', 'https://media.example.test.evil/x',
    'https://media.example.test/x\n', 'not a URL']) assert.throws(() => f.downloader.source(receipt(locator)), { code: 'OUTPUT_DOWNLOAD_LOCATOR' });
  assert.equal(f.observed.lookups, 0); assert.equal(f.observed.calls.length, 0);
  for (const allowedHosts of [[], ['*.example.test'], ['127.0.0.1'], ['localhost'], ['UPPER.example.test'], ['example.test/']])
    assert.throws(() => new ProtectedVideoDownloader({ allowedHosts }), { code: 'OUTPUT_DOWNLOAD_CONFIGURATION' });
});

test('private, special, mixed and IPv6-only DNS answers cannot create a network request', async () => {
  for (const address of ['0.0.0.1', '10.0.0.1', '100.64.0.1', '127.1.2.3', '169.254.169.254', '172.16.2.3', '192.168.1.1',
    '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '168.63.129.16']) {
    const f = network({ addresses: [{ address: '8.8.8.8', family: 4 }, { address, family: 4 }] });
    await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_ADDRESS' }); assert.equal(f.observed.calls.length, 0);
  }
  for (const addresses of [[], [{ address: '2001:4860:4860::8888', family: 6 }], [{ address: '::ffff:127.0.0.1', family: 4 }], Array(17).fill({ address: '8.8.8.8', family: 4 })]) {
    const f = network({ addresses }); await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_ADDRESS' }); assert.equal(f.observed.calls.length, 0);
  }
});

test('redirect, partial status, encoded body and unsupported content never become downloaded output', async () => {
  for (const status of [206, 301, 302, 307, 403, 404, 500]) {
    const f = network({ status, headers: { location: 'https://127.0.0.1/private' } });
    await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_HTTP_STATUS' }); assert.equal(f.observed.calls.length, 1); assert.equal(f.observed.closes, 1);
  }
  for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-type': 'text/html' }]) {
    const f = network({ headers }); await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_FORMAT' }); assert.equal(f.observed.closes, 1);
  }
});

test('declared and streamed size limits reject overflow, empty and truncated bodies without retaining raw errors', async () => {
  for (const config of [ { headers: { 'content-length': '50' } }, { headers: { 'content-length': 'invalid' } },
    { headers: { 'content-length': '8' }, chunks: [Buffer.alloc(4)] }, { chunks: [Buffer.alloc(5), Buffer.alloc(6)] }, { chunks: [] } ]) {
    const f = network({ maxBytes: 10, ...config }); await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_SIZE' }); assert.equal(f.observed.closes, 1);
  }
  const f = network({ error: 'request https://media.example.test/secret-signature failed' });
  await assert.rejects(bytes(f.downloader.source(receipt())), error => error.code === 'OUTPUT_DOWNLOAD_UNAVAILABLE' && !String(error.stack).includes('secret-signature') && error.cause === undefined);
});

test('large incoming chunks split into bounded spool chunks, with no implicit retry', async () => {
  const f = network({ chunks: [Buffer.alloc(3 * 1024 * 1024, 7)], headers: { 'content-type': 'application/octet-stream', 'content-length': String(3 * 1024 * 1024) } }), lengths = [];
  for await (const chunk of f.downloader.source(receipt())(new AbortController().signal)) lengths.push(chunk.length);
  assert.deepEqual(lengths, [1024 * 1024, 1024 * 1024, 1024 * 1024]); assert.equal(f.observed.calls.length, 1); assert.equal(f.observed.closes, 1);
});

test('expired and pre-cancelled sources never resolve or contact the output host', async () => {
  const f = network(), abort = new AbortController(); abort.abort();
  await assert.rejects(bytes(f.downloader.source(receipt()), abort.signal), { code: 'OUTPUT_DOWNLOAD_CANCELLED' });
  await assert.rejects(bytes(f.downloader.source(receipt(undefined, { source: { kind: 'protected_locator', locator: 'https://media.example.test/result', expiresAt: '2000-01-01T00:00:00.000Z' } }))), { code: 'OUTPUT_DOWNLOAD_EXPIRED' });
  assert.equal(f.observed.lookups, 0); assert.equal(f.observed.calls.length, 0);
});

test('cancellation during delayed DNS returns promptly and cannot dispatch after DNS later resolves', async () => {
  const f = network(); let resolveLookup, entered;
  const arrived = new Promise(resolve => { entered = resolve; }), pendingLookup = new Promise(resolve => { resolveLookup = resolve; });
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ['media.example.test'], request: f.request, lookup: async () => { entered(); return pendingLookup; } });
  const abort = new AbortController(), pending = bytes(downloader.source(receipt()), abort.signal); await arrived; abort.abort();
  await assert.rejects(pending, { code: 'OUTPUT_DOWNLOAD_CANCELLED' }); resolveLookup([{ address: '8.8.8.8', family: 4 }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.observed.calls.length, 0);
});

test('deadline covers response headers and body; resources close before reporting failure', async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try { for (const config of [{ noHeaders: true }, { stalledBody: true }]) {
    const f = network({ ...config, timeoutMs: 30 }); await assert.rejects(bytes(f.downloader.source(receipt())), { code: 'OUTPUT_DOWNLOAD_TIMEOUT' });
    assert.equal(f.observed.calls.length, 1); assert.equal(f.observed.closes, 1); assert.equal(f.observed.aborts, 1);
  } } finally { clearInterval(keepAlive); }
});

test('original cancellation and early consumer return close their own response and request', async () => {
  const f = network({ stalledBody: true }), abort = new AbortController(), pending = bytes(f.downloader.source(receipt()), abort.signal);
  await until(() => f.observed.calls.length === 1); abort.abort(); await assert.rejects(pending, { code: 'OUTPUT_DOWNLOAD_CANCELLED' }); assert.equal(f.observed.closes, 1);
  const g = network({ chunks: [Buffer.alloc(2 * 1024 * 1024)] });
  for await (const chunk of g.downloader.source(receipt())(new AbortController().signal)) { assert.equal(chunk.length, 1024 * 1024); break; }
  assert.equal(g.observed.calls.length, 1); assert.equal(g.observed.closes, 1);
});

async function ownedFixture(t) {
  const f = setup(t, { count: 1 }); await f.engine.runReady(); await f.engine.reconcile();
  const review = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, review.id, [review.members[0].videoNodeId], 'simulated-human');
  const node = f.plan.nodes.find(node => node.kind === 'video'); f.provider.setMode(node.id, 'unknown_after_accept'); await f.engine.runReady();
  const attempt = f.engine.attempts(f.projectId).find(attempt => attempt.nodeId === node.id), rootDir = join(f.directory, 'video-downloads');
  const outputs = new ExecutionOutputStore(f.store, { rootDir }), saved = outputs.recordReceipt(f.projectId, {
    attemptId: attempt.id, expectedRequestDigest: digest(attempt.request), port: 'video', kind: 'video', mimeType: 'video/mp4',
    vendorTaskId: 'known-task', diagnosticRequestId: null, source: receipt().source,
  });
  return { ...f, attempt, rootDir, outputs, saved };
}

test('downloaded bytes become a durable winning spool; replay and local recovery never open another GET', async t => {
  const f = await ownedFixture(t), n = network(), source = n.downloader.source(f.saved);
  const result = await f.outputs.spool(f.projectId, f.saved.id, source);
  const owned = await f.outputs.resolveOwned(f.projectId, result.id), bytes = readFileSync(owned.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), result.sha256); assert.equal(bytes.length, result.byteLength);
  assert.equal((await f.outputs.spool(f.projectId, f.saved.id, source)).id, result.id);
  const reopened = new ExecutionOutputStore(f.store, { rootDir: f.rootDir });
  const completion = await reopened.recoverCompletion(f.projectId, f.attempt.id);
  assert.equal(completion.outputs[0].sha256, result.sha256); assert.equal(n.observed.calls.length, 1); assert.equal(n.observed.closes, 1);
  assert.equal(f.store.list('execution_output_slot', f.projectId).length, 1);
  assert.ok(!JSON.stringify(f.store.readEvents(f.projectId)).includes('private-value'));
});

test('failed download retains protected receipt but publishes no spool/slot and cleans its own staging', async t => {
  const f = await ownedFixture(t), n = network({ maxBytes: 5 });
  await assert.rejects(f.outputs.spool(f.projectId, f.saved.id, n.downloader.source(f.saved)), { code: 'OUTPUT_DOWNLOAD_SIZE' });
  assert.equal(f.store.list('execution_output_receipt', f.projectId).length, 1);
  assert.equal(f.store.list('execution_output_spool', f.projectId).length, 0); assert.equal(f.store.list('execution_output_slot', f.projectId).length, 0);
  assert.deepEqual(readdirSync(join(f.rootDir, 'tmp')), []); assert.equal(n.observed.closes, 1);
  assert.equal(f.engine.attempts(f.projectId).find(row => row.id === f.attempt.id).phase, 'submission_unknown');
});
