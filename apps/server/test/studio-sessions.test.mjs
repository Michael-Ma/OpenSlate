import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../dist/app.js';
import { StudioSessions } from '../dist/studio-sessions.js';
import { studioUrl, openStudioBrowser } from '../dist/studio-launcher.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { FakeProvider } from '../../../packages/providers/dist/index.js';

const token = 'local_studio_test_012345678901234567890';
const origin = 'http://127.0.0.1:3001';
const browserHeaders = { origin, 'x-openslate-client': 'studio' };
function fixture(t) {
  let now = 1000;
  const root = mkdtempSync(join(tmpdir(), 'openslate-studio-session-'));
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  const sessions = new StudioSessions(() => now);
  const app = createApp({ service, localToken: token, studioSessions: sessions });
  t.after(async () => { await app.close(); provider.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const req = (url, options = {}) => app.inject({ url, ...options, headers: { host: '127.0.0.1:3001', ...options.headers } });
  const connect = code => req('/api/session', { method: 'POST', headers: browserHeaders, payload: { code: code ?? sessions.issueLaunch() } });
  return { app, store, service, sessions, req, connect, advance: ms => { now += ms; } };
}
const cookieOf = response => response.headers['set-cookie'].split(';')[0];

test('launcher credential mints a single-use link; browser obtains only cookie and CSRF, not the launcher credential', async t => {
  const f = fixture(t);
  assert.equal((await f.req('/api/projects')).statusCode, 403);
  assert.equal((await f.req('/api/studio/launch', { method: 'POST' })).statusCode, 403);
  const launched = await f.req('/api/studio/launch', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  assert.equal(launched.statusCode, 200); assert.equal(launched.headers['cache-control'], 'no-store');
  const code = launched.json().code, connected = await f.connect(code);
  assert.equal(connected.statusCode, 200);
  assert.match(connected.headers['set-cookie'], /HttpOnly; SameSite=Strict; Path=\/api; Max-Age=43200/);
  assert.equal(connected.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(connected.json()), ['csrf']); assert.ok(!connected.body.includes(token));
  const cookie = cookieOf(connected);
  assert.ok(!connected.body.includes(cookie.split('=')[1]));
  assert.equal((await f.connect(code)).json().error.code, 'STUDIO_LINK_EXPIRED');
  const restored = await f.req('/api/session', { headers: { cookie } });
  assert.equal(restored.json().csrf, connected.json().csrf);
  assert.equal((await f.req('/api/projects', { headers: { cookie } })).statusCode, 200);
  assert.equal((await f.req('/api/studio/launch', { method: 'POST', headers: { ...browserHeaders, cookie, 'x-openslate-csrf': connected.json().csrf } })).statusCode, 403);
});

test('cookie mutations require the exact session CSRF and an allowed Origin, while bearer clients still work', async t => {
  const f = fixture(t), response = await f.connect(), cookie = cookieOf(response), csrf = response.json().csrf;
  const post = headers => f.req('/api/projects', { method: 'POST', headers, payload: { name: 'Studio project' } });
  for (const headers of [{ cookie }, { cookie, origin }, { cookie, 'x-openslate-csrf': csrf }, { cookie, origin, 'x-openslate-csrf': 'x'.repeat(43) }, { cookie, origin: 'http://evil.example', 'x-openslate-csrf': csrf }, { cookie, origin: 'http://127.0.0.1:9999', 'x-openslate-csrf': csrf }]) {
    assert.equal((await post(headers)).statusCode, 403);
  }
  assert.equal(f.store.listProjects().length, 0);
  assert.equal((await post({ cookie, origin, 'x-openslate-csrf': csrf })).statusCode, 200);
  assert.equal((await f.req('/api/projects', { headers: { authorization: `Bearer ${token}` } })).statusCode, 200);
  assert.equal((await f.req('/api/projects', { headers: { cookie, authorization: 'Bearer invalid' } })).statusCode, 403);
});

test('cross-site, missing-origin and malformed pairing requests cannot consume a launch code', async t => {
  const f = fixture(t), code = f.sessions.issueLaunch();
  for (const headers of [{}, { origin }, { ...browserHeaders, origin: 'null' }, { ...browserHeaders, origin: 'https://evil.example' }, { ...browserHeaders, host: 'evil.example:3001' }]) {
    assert.equal((await f.req('/api/session', { method: 'POST', headers, payload: { code } })).statusCode, 403);
  }
  assert.equal((await f.req('/api/session', { method: 'POST', headers: browserHeaders, payload: { code, admin: true } })).statusCode, 400);
  assert.equal((await f.connect(code)).statusCode, 200);
});

test('launch expiry, logout, session expiry and process restart invalidate their exact credentials', async t => {
  const f = fixture(t), expired = f.sessions.issueLaunch(); f.advance(60_000);
  assert.equal((await f.connect(expired)).json().error.code, 'STUDIO_LINK_EXPIRED');
  const connected = await f.connect(), cookie = cookieOf(connected), csrf = connected.json().csrf;
  const logout = await f.req('/api/session/logout', { method: 'POST', headers: { cookie, origin, 'x-openslate-csrf': csrf } });
  assert.equal(logout.statusCode, 200); assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal((await f.req('/api/session', { headers: { cookie } })).statusCode, 403);
  const second = cookieOf(await f.connect()); f.advance(12 * 60 * 60 * 1000);
  assert.equal((await f.req('/api/projects', { headers: { cookie: second } })).statusCode, 403);
  const third = cookieOf(await f.connect()); assert.equal(new StudioSessions().get(third), undefined);
});

test('pairing replaces an existing browser session and cookie auth cannot enter the director bridge', async t => {
  const f = fixture(t), first = await f.connect(), oldCookie = cookieOf(first);
  const next = await f.req('/api/session', { method: 'POST', headers: { ...browserHeaders, cookie: oldCookie }, payload: { code: f.sessions.issueLaunch() } });
  assert.equal(next.statusCode, 200); assert.equal(f.sessions.get(oldCookie), undefined);
  const project = f.service.createProject('Separate authority');
  const response = await f.req(`/internal/projects/${project.id}/tools/read_context`, { method: 'POST', headers: { cookie: cookieOf(next), origin, 'x-openslate-csrf': next.json().csrf }, payload: {} });
  assert.equal(response.statusCode, 403);
  assert.equal((await f.req('/api/projects', { headers: { cookie: `${cookieOf(next)}; ${cookieOf(next)}` } })).statusCode, 403);
});

test('logout closes an already-open cookie-authenticated event stream', async t => {
  const f = fixture(t), project = f.service.createProject('Stream'), connected = await f.connect();
  const cookie = cookieOf(connected), csrf = connected.json().csrf;
  const address = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${address}/api/projects/${project.id}/events`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200); const reader = response.body.getReader(); await reader.read();
  assert.equal((await f.req('/api/session/logout', { method: 'POST', headers: { cookie, origin, 'x-openslate-csrf': csrf } })).statusCode, 200);
  while (!(await reader.read()).done) {}
});

test('launch URL accepts only bounded random codes and fixed local browser destinations', () => {
  const code = 'a'.repeat(43);
  assert.equal(studioUrl(code), `http://127.0.0.1:3001/#connect=${code}`);
  assert.equal(studioUrl(code, true), `http://127.0.0.1:5173/#connect=${code}`);
  assert.throws(() => studioUrl('x&redirect=https://evil.example'));
  assert.throws(() => openStudioBrowser(`https://evil.example/#connect=${code}`));
});
