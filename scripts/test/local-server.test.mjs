import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectServer, matchesServer, stopServer } from '../local-server.mjs';

async function withServer(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('recognizes a healthy OpenSlate service', async t => {
  const origin = await withServer(t, (_, res) => res.end(JSON.stringify({ name: 'OpenSlate', status: 'ok' })));
  assert.equal(await inspectServer(origin), 'ready');
});
for (const [name, code, body] of [['unrelated JSON', 200, '{"status":"ok"}'], ['failed health', 503, '{"name":"OpenSlate","status":"ok"}'], ['HTML page', 200, '<html>Another app</html>']]) {
  test(`does not mistake ${name} for a ready or free server`, async t => {
    const origin = await withServer(t, (_, res) => { res.statusCode = code; res.end(body); });
    assert.equal(await inspectServer(origin), 'occupied');
  });
}
test('a refused connection means stopped', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.equal(await inspectServer(`http://127.0.0.1:${port}`), 'stopped');
});
test('process identity requires exact checkout and production entrypoint', () => {
  const root = '/tmp/Open Slate';
  assert.equal(matchesServer('node apps/server/dist/index.js --serve-web --no-open', root, root), true);
  assert.equal(matchesServer(`/usr/bin/node ${root}/apps/server/dist/index.js --serve-web`, root, root), true);
  for (const command of ['node evil.js --serve-web', 'node apps/server/dist/index.js.evil', 'sh -c node apps/server/dist/index.js', 'node apps/server/dist/index.js --require=evil']) assert.equal(matchesServer(command, root, root), false);
  assert.equal(matchesServer('node apps/server/dist/index.js --serve-web', '/tmp/another', root), false);
});
test('graceful restart waits for process exit and never force kills', async () => {
  const signals = [];
  await stopServer(42, { signal: (_, signal) => { signals.push(signal); if (signals.length === 3) throw Object.assign(new Error(), { code: 'ESRCH' }); }, sleep: async () => {} });
  assert.deepEqual(signals, ['SIGTERM', 0, 0]);
});
test('shutdown timeout refuses to force kill or report completion', async () => {
  const signals = [];
  await assert.rejects(stopServer(42, { signal: (_, signal) => signals.push(signal), sleep: async () => {}, tries: 2 }), /No force-kill/);
  assert.deepEqual(signals, ['SIGTERM', 0, 0]);
});
test('permission errors are not treated as exited processes', async () => {
  await assert.rejects(stopServer(42, { signal: () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } }), /denied/);
});
