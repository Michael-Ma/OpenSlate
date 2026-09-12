import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertWebDataSeparation, loadWebAssets } from "../dist/web-assets.js";
import { createApp } from "../dist/app.js";
import { ProductionService } from "../dist/application/service.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";

const token = "local_web_test_token_01234567890123456789";
const html = "<!doctype html><html><head><script src='/assets/index-test.js'></script></head><body>OpenSlate test</body></html>";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-web-assets-"));
  const bundle = join(directory, "web"); mkdirSync(join(bundle, "assets"), { recursive: true });
  writeFileSync(join(bundle, "index.html"), html);
  writeFileSync(join(bundle, "assets", "index-test.js"), "console.log('bundle');");
  writeFileSync(join(bundle, "assets", "style-test.css"), "body { color: black; }");
  const applications = [];
  t.after(async () => { for (const app of applications) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, bundle, app(options = {}) { const app = createApp({ localToken: token, webAssets: loadWebAssets(bundle), ...options }); applications.push(app); return app; } };
}
function get(app, url, headers = {}, method = "GET") { return app.inject({ method, url, headers: { host: "127.0.0.1:3001", ...headers } }); }

test("the built interface and exact assets are public while project and bridge routes stay protected", async t => {
  const f = fixture(t), app = f.app();
  const page = await get(app, "/");
  assert.equal(page.statusCode, 200, page.body); assert.equal(page.body, html);
  assert.match(page.headers["content-type"], /^text\/html/);
  assert.equal(page.headers["cache-control"], "no-cache");
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.match(page.headers["content-security-policy"], /connect-src 'self'/);
  assert.match(page.headers["content-security-policy"], /media-src 'self' blob:/);
  assert.ok(!page.body.includes(token));
  const script = await get(app, "/assets/index-test.js?version=1");
  assert.equal(script.statusCode, 200); assert.match(script.headers["content-type"], /^text\/javascript/);
  assert.equal(script.body, "console.log('bundle');");
  const head = await get(app, "/assets/index-test.js", {}, "HEAD");
  assert.equal(head.statusCode, 200); assert.equal(head.body, "");
  assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(script.body));
  assert.match((await get(app, "/assets/style-test.css")).headers["content-type"], /^text\/css/);
  assert.equal((await get(app, "/api/health")).statusCode, 200);
  for (const url of ["/api/projects", "/api/missing", "/api", "/internal/missing", "/internal", "/%61pi/missing", "/API/missing"]) {
    const response = await get(app, url, { accept: "text/html" });
    assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    assert.equal(response.json().error.code, "AUTH_REQUIRED");
  }
  for (const url of ["/api/missing", "/internal/missing"]) {
    const response = await get(app, url, { accept: "text/html", authorization: `Bearer ${token}` });
    assert.equal(response.statusCode, 404, response.body); assert.notEqual(response.body, html);
  }
});

test("SPA fallback is limited to HTML navigation and never masks missing bundle files", async t => {
  const app = fixture(t).app();
  assert.equal((await get(app, "/projects/one", { accept: "text/html,application/xhtml+xml" })).body, html);
  for (const [url, accept] of [["/projects/one", "application/json"], ["/assets/missing.js", "text/html"], ["/assets/missing", "text/html"], ["/missing.png", "text/html"], ["/source.map", "text/html"]]) {
    const response = await get(app, url, { accept }); assert.equal(response.statusCode, 404, `${url}: ${response.body}`);
  }
  const post = await get(app, "/", { authorization: `Bearer ${token}` }, "POST");
  assert.equal(post.statusCode, 404); assert.notEqual(post.body, html);
});

test("public static responses retain loopback Host and Origin checks", async t => {
  const app = fixture(t).app();
  for (const headers of [{ host: "attacker.example" }, { origin: "https://attacker.example" }, { origin: "null" }]) {
    const response = await get(app, "/assets/index-test.js", headers);
    assert.equal(response.statusCode, 403); assert.equal(response.json().error.code, "ORIGIN_DENIED");
  }
  assert.equal((await get(app, "/", { origin: "http://localhost:3001" })).statusCode, 200);
});

test("bundle requests cannot expose dotfiles, parent paths, excluded extensions or files added after startup", async t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "secret.js"), "outside-secret");
  writeFileSync(join(f.bundle, ".env"), "private-key");
  writeFileSync(join(f.bundle, "source.js.map"), "private-source");
  writeFileSync(join(f.bundle, "local-session.token"), token);
  const app = f.app();
  writeFileSync(join(f.bundle, "late.js"), "unregistered-file");
  rmSync(join(f.bundle, "assets", "index-test.js"));
  symlinkSync(join(f.directory, "secret.js"), join(f.bundle, "assets", "index-test.js"));
  assert.equal((await get(app, "/assets/index-test.js")).body, "console.log('bundle');", "serves the frozen bundle, not a swapped file");
  for (const url of ["/.env", "/%2e%2e/secret.js", "/assets/%2e%2e/%2e%2e/secret.js", "/assets%2findex-test.js", "/assets%5cindex-test.js", "/%252e%252e/secret.js", "/source.js.map", "/local-session.token", "/late.js"]) {
    const response = await get(app, url, { authorization: `Bearer ${token}` });
    assert.notEqual(response.statusCode, 200, `${url}: ${response.body}`);
    assert.ok(!response.body.includes("outside-secret") && !response.body.includes("private-key") && !response.body.includes(token));
  }
});

test("bundle loading rejects symlinks, absent index, excessive bytes and excessive nesting", t => {
  const f = fixture(t);
  writeFileSync(join(f.directory, "outside.js"), "outside");
  symlinkSync(join(f.directory, "outside.js"), join(f.bundle, "escape.js"));
  assert.throws(() => loadWebAssets(f.bundle), /symbolic links/); rmSync(join(f.bundle, "escape.js"));
  symlinkSync(f.directory, join(f.bundle, "linked-directory"));
  assert.throws(() => loadWebAssets(f.bundle), /symbolic links/); rmSync(join(f.bundle, "linked-directory"));
  const index = readFileSync(join(f.bundle, "index.html")); rmSync(join(f.bundle, "index.html"));
  assert.throws(() => loadWebAssets(f.bundle), /no index.html/); writeFileSync(join(f.bundle, "index.html"), index);
  writeFileSync(join(f.bundle, "large.js"), ""); truncateSync(join(f.bundle, "large.js"), 8 * 1024 * 1024 + 1);
  assert.throws(() => loadWebAssets(f.bundle), /byte limit/); rmSync(join(f.bundle, "large.js"));
  mkdirSync(join(f.bundle, ...Array(10).fill("nested")), { recursive: true });
  assert.throws(() => loadWebAssets(f.bundle), /directory limit/);
});

test("local data must remain outside the public bundle, including paths through symlinked parents", t => {
  const f = fixture(t);
  assert.doesNotThrow(() => assertWebDataSeparation(f.bundle, join(f.directory, "private", "data")));
  for (const data of [f.bundle, f.directory, join(f.bundle, "new-data")]) assert.throws(() => assertWebDataSeparation(f.bundle, data), /OPENSLATE_DATA_DIR/);
  symlinkSync(f.bundle, join(f.directory, "alias"));
  assert.throws(() => assertWebDataSeparation(f.bundle, join(f.directory, "alias", "data")), /OPENSLATE_DATA_DIR/);
});

test("closing the local app ends open event subscriptions before closing storage", { timeout: 10000 }, async t => {
  const f = fixture(t);
  const store = new Store(join(f.directory, "app.sqlite")), provider = new FakeProvider(join(f.directory, "provider.sqlite"));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(f.directory, "artifacts") }));
  const project = service.createProject("Shutdown test"), app = f.app({ service });
  let closed = false;
  app.addHook("onClose", async () => { store.close(); provider.close(); closed = true; });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(`${address}/api/projects/${project.id}/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = response.body.getReader();
  assert.equal(response.status, 200); assert.equal((await reader.read()).done, false);
  await app.close();
  while (!(await reader.read()).done) { /* Drain already emitted frames. */ }
  assert.equal(closed, true);
});
