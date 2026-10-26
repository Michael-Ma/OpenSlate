import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../dist/app.js';

/** An app whose log lines are collected instead of printed. */
function appWithLog(options = {}) {
  const lines = [];
  const app = createApp({ logger: { stream: { write: line => lines.push(line) } }, ...options });
  return { app, out: () => lines.join('') };
}

test('the studio does not log every request by default, but still logs errors', async t => {
  const { app, out } = appWithLog();
  t.after(() => app.close());
  await app.inject({ method: 'GET', url: '/api/health' });
  await app.inject({ method: 'GET', url: '/api/projects' });
  assert.doesNotMatch(out(), /incoming request|request completed/);
  // The level is unchanged: the app's own error logs (an unexpected 500) still reach the log.
  app.log.error(new Error('kaboom'));
  assert.match(out(), /kaboom/);
});

test('OPENSLATE_LOG_REQUESTS turns request logging back on', async t => {
  const { app, out } = appWithLog({ logRequests: true });
  t.after(() => app.close());
  await app.inject({ method: 'GET', url: '/api/health' });
  assert.match(out(), /incoming request/);
  assert.match(out(), /request completed/);
});
