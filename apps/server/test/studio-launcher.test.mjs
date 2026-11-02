import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { requestStudioLaunch, studioUrl } from '../dist/studio-launcher.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

function launch(t, port, noOpen) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-launch-port-'));
  const preload = join(root, 'preload.mjs');
  // Redirect the production listener before it can touch 3001. The browser
  // opener is replaced in the child, so even the automatic-open test stays offline.
  writeFileSync(preload, `
    import { Server } from 'node:net';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    const listen = Server.prototype.listen;
    Server.prototype.listen = function(options, ...args) {
      if (!options || options.host !== '127.0.0.1' || options.port !== 3001) throw new Error('Unexpected test listener');
      return listen.call(this, { ...options, port: ${port} }, ...args);
    };
    childProcess.spawn = (command, args, options) => {
      if (!['/usr/bin/open', 'xdg-open'].includes(command) || options.shell !== false || args.length !== 1) throw new Error('Unexpected test subprocess');
      process.stdout.write('TEST_BROWSER ' + JSON.stringify({ command, args }) + '\\n');
      const child = new EventEmitter(); child.kill = () => {};
      queueMicrotask(() => child.emit('exit', 0));
      return child;
    };
    syncBuiltinESMExports();
  `);
  const child = spawn(process.execPath, ['--import', preload, 'apps/server/dist/index.js', '--serve-web', ...(noOpen ? ['--no-open'] : [])], {
    cwd: repository, stdio: ['ignore', 'pipe', 'pipe'],
    // Do not inherit configured providers, credentials, NODE_OPTIONS or live state.
    env: { PATH: process.env.PATH, OPENSLATE_DATA_DIR: join(root, 'data'), OPENSLATE_LOCAL_TOKEN: 'launcher_port_test_012345678901234567890' },
  });
  let output = '', exit;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => { exit = { code, signal }; resolve(exit); });
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 30000);
  t.after(async () => {
    if (!exit) child.kill('SIGKILL');
    try { await completed; } finally { clearTimeout(deadline); rmSync(root, { recursive: true, force: true }); }
  });
  return {
    child, completed, output: () => output,
    async until(phrase) {
      while (!output.includes(phrase)) {
        if (exit) assert.fail(`Studio exited before ${phrase}: ${JSON.stringify(exit)}\n${output}`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    },
  };
}

test('a studio bound to 5173 prints its actual readiness address and a working pairing link', { timeout: 35000 }, async t => {
  const f = launch(t, 5173, true);
  await f.until('Open studio (valid for 60 seconds):');
  const output = f.output();
  assert.match(output, /OpenSlate is ready at http:\/\/127\.0\.0\.1:5173\n/);
  assert.doesNotMatch(output, /http:\/\/127\.0\.0\.1:3001/);
  assert.doesNotMatch(output, /TEST_BROWSER/);
  const url = new URL(output.match(/Open studio \(valid for 60 seconds\): (\S+)/)[1]);
  assert.equal(url.origin, 'http://127.0.0.1:5173');
  const response = await fetch(`${url.origin}/api/session`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { origin: url.origin, 'x-openslate-client': 'studio', 'content-type': 'application/json' },
    body: JSON.stringify({ code: url.hash.slice('#connect='.length) }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  await response.json();
  f.child.kill('SIGTERM');
  assert.deepEqual(await f.completed, { code: 0, signal: null }, f.output());
});

test('automatic browser opening receives the bound 5173 URL without launching a browser', { timeout: 35000 }, async t => {
  const f = launch(t, 5173, false);
  await f.until('Sent the connected studio link to your default browser.');
  const opened = JSON.parse(f.output().match(/TEST_BROWSER (.+)/)[1]);
  assert.match(opened.args[0], /^http:\/\/127\.0\.0\.1:5173\/#connect=[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(f.output(), /http:\/\/127\.0\.0\.1:3001/);
  f.child.kill('SIGTERM');
  assert.deepEqual(await f.completed, { code: 0, signal: null }, f.output());
});

test('an unsupported bound port fails clearly without printing or opening a studio link', { timeout: 35000 }, async t => {
  const f = launch(t, 0, false);
  assert.deepEqual(await f.completed, { code: 1, signal: null }, f.output());
  assert.match(f.output(), /Unsupported studio port \d+; expected 3001 or 5173/);
  assert.doesNotMatch(f.output(), /OpenSlate is ready|Open studio \(valid|TEST_BROWSER|#connect=/);
});

test('the standalone launcher requests only the port it prints: 3001 by default and 5173 for --dev', { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'openslate-launch-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const preload = join(root, 'preload.mjs'), code = 'a'.repeat(43);
  const token = 'launcher_port_test_012345678901234567890', requests = [];
  let status = 200;
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, destination: request.headers['x-test-launch-destination'], authorization: request.headers.authorization });
    response.statusCode = status;
    if (status === 307) response.setHeader('location', 'http://127.0.0.1:3001/api/studio/launch');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const [args, port, responseStatus] of [[[], 3001, 200], [['--dev'], 5173, 200], [['--dev'], 5173, 503], [['--dev'], 5173, 307]]) {
    status = responseStatus;
    // Assert the exact destination before redirecting transport to our ephemeral
    // loopback server. Never listen on or contact the owner's port 3001.
    writeFileSync(preload, `const localFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        process.stdout.write('TEST_REQUEST ' + url + '\\n');
        if (url !== 'http://127.0.0.1:${port}/api/studio/launch' || options.method !== 'POST' || options.redirect !== 'error') throw new Error('Unexpected launcher request');
        return localFetch('http://127.0.0.1:${server.address().port}/api/studio/launch', {
          ...options, headers: { ...options.headers, 'x-test-launch-destination': url },
        });
      };`);
    const command = promisify(execFile)(process.execPath,
      ['--import', preload, 'apps/server/dist/studio-cli.js', '--no-open', ...args], {
        cwd: repository, timeout: 5000,
        env: { OPENSLATE_DATA_DIR: root, OPENSLATE_LOCAL_TOKEN: token },
      });
    if (status !== 200) {
      await assert.rejects(command, error => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, `TEST_REQUEST http://127.0.0.1:${port}/api/studio/launch\n`);
        assert.match(error.stderr, /Could not open studio/);
        return true;
      });
      continue;
    }
    const { stdout } = await command;
    assert.equal(stdout, `TEST_REQUEST http://127.0.0.1:${port}/api/studio/launch\nOpen studio (valid for 60 seconds): http://127.0.0.1:${port}/#connect=${code}\n`);
  }
  assert.deepEqual(requests, [3001, 5173, 5173, 5173].map(port => ({ method: 'POST', url: '/api/studio/launch', destination: `http://127.0.0.1:${port}/api/studio/launch`, authorization: `Bearer ${token}` })));
});

test('unsupported launcher ports are refused before reading credentials or making requests', async () => {
  for (const port of [0, 80, 3101, 5174, '5173', '5173/api', NaN]) {
    await assert.rejects(requestStudioLaunch('/missing-launcher-test-directory', undefined, port), /Unsupported studio port/);
    assert.throws(() => studioUrl('a'.repeat(43), port), /Unsupported studio port/);
  }
});
