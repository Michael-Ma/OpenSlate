import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/app.js";
import { ProductionService } from "../dist/application/service.js";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { setup as executionFixture } from "./execution-fixture.mjs";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-api-"));
  const store = new Store(join(directory, "store.sqlite"));
  const provider = new FakeProvider(join(directory, "fake-provider.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  const service = new ProductionService(store, engine);
  const localToken = randomBytes(32).toString("base64url");
  const app = createApp({ service, localToken, logger: false });
  t.after(async () => {
    await app.close();
    if (store.db.open) store.close();
    if (provider.db.open) provider.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const headers = (token = localToken, extra = {}) => ({ host: "127.0.0.1", authorization: `Bearer ${token}`, ...extra });
  const request = (method, url, payload, extraHeaders = {}) => app.inject({ method, url, ...(payload === undefined ? {} : { payload }), headers: headers(localToken, extraHeaders) });
  const project = service.createProject("API fixture");
  const path = `/api/projects/${project.id}`;
  const tool = (name, payload, token) => app.inject({ method: "POST", url: `/internal/projects/${project.id}/tools/${name}`, payload, headers: headers(token, { "x-openslate-tool-call-id": randomUUID() }) });
  return { app, store, provider, engine, service, project, path, headers, request, tool, localToken };
}

function error(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error.code, code, response.body);
}

async function reviewFixture(t) {
  const cleanups = [];
  const f = executionFixture({ after: cleanup => cleanups.push(cleanup) }, { count: 2 });
  const service = new ProductionService(f.store, f.engine);
  const localToken = randomBytes(32).toString("base64url");
  const app = createApp({ service, localToken, logger: false });
  t.after(async () => { await app.close(); for (const cleanup of cleanups) cleanup(); });
  await f.engine.runReady();
  await f.engine.reconcile();
  const snapshot = f.engine.reviewSnapshot(f.projectId);
  assert.equal(snapshot.members.length, 2);
  assert.ok(snapshot.members.every(member => member.ready));
  const post = (route, payload, key) => app.inject({
    method: "POST", url: `/api/projects/${f.projectId}/${route}`, payload,
    headers: { host: "127.0.0.1", authorization: `Bearer ${localToken}`, "idempotency-key": key },
  });
  return { ...f, snapshot, post };
}

test("an approval key binds the exact snapshot and selected videos while identical replay preserves its outcome", async t => {
  const f = await reviewFixture(t);
  const [firstVideo, secondVideo] = f.snapshot.members.map(member => member.videoNodeId);
  const body = { snapshotId: f.snapshot.id, videoNodeIds: [firstVideo] };
  const first = await f.post("approvals", body, "one-review-command");
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().length, 1);
  const cursor = f.store.cursor(f.projectId);
  const replay = await f.post("approvals", body, "one-review-command");
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  error(await f.post("approvals", { ...body, videoNodeIds: [secondVideo] }, "one-review-command"), 409, "IDEMPOTENCY_CONFLICT");
  const otherSnapshot = f.engine.reviewSnapshot(f.projectId);
  error(await f.post("approvals", { ...body, snapshotId: otherSnapshot.id }, "one-review-command"), 409, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.store.cursor(f.projectId), cursor);
  assert.equal(f.store.list("message", f.projectId).length, 1);
  assert.equal(f.store.list("approval", f.projectId).length, 1);
});

test("a review reply key binds replyToReviewId while identical approval replies replay without new decisions", async t => {
  const f = await reviewFixture(t);
  const body = { text: "approve", replyToReviewId: f.snapshot.id };
  const first = await f.post("messages", body, "one-review-reply");
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().status, "approved");
  assert.equal(first.json().approvals.length, 2);
  const cursor = f.store.cursor(f.projectId);
  const replay = await f.post("messages", body, "one-review-reply");
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json(), first.json());
  const otherSnapshot = f.engine.reviewSnapshot(f.projectId);
  error(await f.post("messages", { ...body, replyToReviewId: otherSnapshot.id }, "one-review-reply"), 409, "IDEMPOTENCY_CONFLICT");
  assert.equal(f.store.cursor(f.projectId), cursor);
  assert.equal(f.store.list("message", f.projectId).length, 1);
  assert.equal(f.store.list("approval", f.projectId).length, 2);
});

test("health remains public on loopback while project routes require a valid local session", async t => {
  const f = fixture(t);
  for (const [method, url, payload] of [
    ["GET", f.path], ["GET", `${f.path}/review`], ["GET", `${f.path}/events`],
    ["POST", "/api/projects", { name: "Denied project" }],
    ["POST", `${f.path}/messages`, { text: "Denied request" }],
    ["POST", `${f.path}/controls`, { action: "resume" }],
    ["POST", `${f.path}/approvals`, { snapshotId: "snapshot", videoNodeIds: ["video"] }],
  ]) {
    error(await f.app.inject({ method, url, payload, headers: { host: "127.0.0.1" } }), 403, "AUTH_REQUIRED");
    error(await f.app.inject({ method, url, payload, headers: f.headers("invalid-token-0123456789012345") }), 403, "AUTH_REQUIRED");
  }
  const internal = `/internal/projects/${f.project.id}/tools/read_context`;
  error(await f.app.inject({ method: "POST", url: internal, payload: {}, headers: { host: "127.0.0.1" } }), 403, "AUTH_REQUIRED");
  error(await f.app.inject({ method: "POST", url: internal, payload: {}, headers: f.headers("invalid-token-0123456789012345") }), 403, "EPOCH_REVOKED");
  for (const url of ["/api/health", f.path]) {
    error(await f.app.inject({ url, headers: f.headers(f.localToken, { host: "attacker.example" }) }), 403, "ORIGIN_DENIED");
    error(await f.app.inject({ url, headers: f.headers(f.localToken, { origin: "https://attacker.example" }) }), 403, "ORIGIN_DENIED");
    error(await f.app.inject({ url, headers: f.headers(f.localToken, { origin: "null" }) }), 403, "ORIGIN_DENIED");
  }
  const publicHealth = await f.app.inject({ url: "/api/health", headers: { host: "127.0.0.1" } });
  assert.equal(publicHealth.statusCode, 200, publicHealth.body);
  assert.equal(publicHealth.json().status, "ok");
  const health = await f.request("GET", "/api/health", undefined, { origin: "http://localhost:5173" });
  assert.equal(health.statusCode, 200, health.body);
  assert.equal(health.json().status, "ok");
  const snapshot = await f.request("GET", f.path);
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.equal(snapshot.json().project.id, f.project.id);
});

test("public schemas reject additional authority fields and type coercion before mutation", async t => {
  const f = fixture(t);
  const cursor = f.store.cursor(f.project.id);
  for (const payload of [
    { text: "Edit", actor: { kind: "human", principalId: "forged" } },
    { text: "Edit", principalId: "forged" },
    { text: "Edit", requestId: "forged" },
    { text: "Edit", epochId: "forged" },
    { text: "Edit", editing: "false" },
    { text: "Edit", scopeIds: [] },
    { text: 12 },
  ]) error(await f.request("POST", `${f.path}/messages`, payload), 400, "VALIDATION_ERROR");
  for (const payload of [{ name: "Project", actor: "human" }, { name: 12 }, { name: "" }])
    error(await f.request("POST", "/api/projects", payload), 400, "VALIDATION_ERROR");
  error(await f.request("POST", `${f.path}/controls`, { action: "resume", principalId: "forged" }), 400, "VALIDATION_ERROR");
  error(await f.request("POST", `${f.path}/approvals`, { snapshotId: "snapshot", videoNodeIds: ["video"], actor: "human" }), 400, "VALIDATION_ERROR");
  error(await f.request("POST", `${f.path}/approvals`, { snapshotId: "snapshot", videoNodeIds: ["video", "video"] }), 400, "VALIDATION_ERROR");
  assert.equal(f.store.cursor(f.project.id), cursor);
  assert.deepEqual(f.store.list("message", f.project.id), []);
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
});

test("recorded messages are idempotent and local-user identity comes from the authenticated route", async t => {
  const f = fixture(t);
  const payload = { text: "What has been created?", editing: false };
  const first = await f.request("POST", `${f.path}/messages`, payload, { "idempotency-key": "message-once" });
  assert.equal(first.statusCode, 200, first.body);
  const cursor = f.store.cursor(f.project.id);
  const second = await f.request("POST", `${f.path}/messages`, payload, { "idempotency-key": "message-once" });
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(second.json().requestId, first.json().requestId);
  assert.equal(f.store.cursor(f.project.id), cursor);
  const records = f.store.list("message", f.project.id);
  assert.equal(records.length, 1);
  assert.equal(records[0].principalId, "local-user");
  assert.equal(records[0].editing, false);
  assert.deepEqual(f.store.list("hold", f.project.id), []);
});

test("local-user and director tokens cannot cross routes or gain human review and resume authority", async t => {
  const f = fixture(t);
  const human = f.service.beginRequest(f.project.id, "local-user", "Settle the brief");
  const bridge = f.service.openEpoch(f.project.id, human);
  error(await f.tool("read_context", {}, f.localToken), 403, "EPOCH_REVOKED");
  for (const [method, url, payload] of [
    ["GET", f.path],
    ["POST", `${f.path}/controls`, { action: "resume" }],
    ["POST", `${f.path}/approvals`, { snapshotId: "snapshot", videoNodeIds: ["video"] }],
  ]) error(await f.app.inject({ method, url, payload, headers: f.headers(bridge.token) }), 403, "AUTH_REQUIRED");
  const read = await f.tool("read_context", {}, bridge.token);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(read.json().project.id, f.project.id);
  error(await f.tool("control_execution", { action: "resume" }, bridge.token), 400, "VALIDATION_ERROR");
  error(await f.tool("approve", { snapshotId: "snapshot", videoNodeIds: ["video"] }, bridge.token), 404, "NOT_FOUND");
  error(await f.tool("authorize", { scopeId: f.project.id, kind: "video" }, bridge.token), 404, "NOT_FOUND");
  const pause = await f.tool("control_execution", { action: "pause" }, bridge.token);
  assert.equal(pause.statusCode, 200, pause.body);
  assert.ok(f.store.list("hold", f.project.id).some(hold => hold.active && hold.ownerId === human.requestId));
  const other = f.service.createProject("Other project");
  error(await f.app.inject({ method: "POST", url: `/internal/projects/${other.id}/tools/read_context`, payload: {}, headers: f.headers(bridge.token) }), 403, "EPOCH_REVOKED");
});

test("director tool schemas reject claimed actors and preserve the prepare/apply boundary", async t => {
  const f = fixture(t);
  const human = f.service.beginRequest(f.project.id, "local-user", "Settle the brief");
  const bridge = f.service.openEpoch(f.project.id, human);
  const proposal = { variant: "project", expectedHeadVersion: 0, creative: { brief: "A short product film" } };
  for (const claimed of ["actor", "principalId", "requestId", "epochId"]) {
    error(await f.tool("read_context", { [claimed]: "forged" }, bridge.token), 400, "VALIDATION_ERROR");
    error(await f.tool("prepare_change", { ...proposal, [claimed]: "forged" }, bridge.token), 400, "VALIDATION_ERROR");
  }
  error(await f.tool("prepare_change", { ...proposal, creative: { ...proposal.creative, headVersion: 99 } }, bridge.token), 400, "VALIDATION_ERROR");
  error(await f.tool("apply_change", { preparedId: "not-used", actor: { kind: "human" } }, bridge.token), 400, "VALIDATION_ERROR");
  assert.deepEqual(f.store.list("prepared", f.project.id), []);
  const prepared = await f.tool("prepare_change", proposal, bridge.token);
  assert.equal(prepared.statusCode, 200, prepared.body);
  assert.equal(f.store.getProject(f.project.id).brief, "");
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
  const applied = await f.tool("apply_change", { preparedId: prepared.json().id }, bridge.token);
  assert.equal(applied.statusCode, 200, applied.body);
  assert.equal(applied.json().headVersion, 1);
  assert.equal(f.store.getProject(f.project.id).brief, proposal.creative.brief);
  assert.equal(f.store.getProject(f.project.id).activePlanId, null);
  assert.ok(f.store.list("hold", f.project.id).some(hold => hold.active && hold.ownerId === human.requestId), "saving creative decisions alone does not release the edit hold");
  const again = await f.tool("apply_change", { preparedId: prepared.json().id }, bridge.token);
  assert.equal(again.statusCode, 200, again.body);
  assert.deepEqual(again.json(), applied.json());
  assert.equal(f.store.getProject(f.project.id).headVersion, 1);
});

test("late calls from a revoked bridge cannot apply, and a replacement bridge cannot inherit its prepared change", async t => {
  const f = fixture(t);
  const oldHuman = f.service.beginRequest(f.project.id, "local-user", "Write the first brief");
  const oldBridge = f.service.openEpoch(f.project.id, oldHuman);
  const prepared = await f.tool("prepare_change", { variant: "project", expectedHeadVersion: 0, creative: { brief: "Old request" } }, oldBridge.token);
  assert.equal(prepared.statusCode, 200, prepared.body);
  const replacement = await f.request("POST", `${f.path}/messages`, { text: "Use a new direction" });
  assert.equal(replacement.statusCode, 200, replacement.body);
  const newBridge = f.service.openEpoch(f.project.id, { kind: "human", principalId: "local-user", requestId: replacement.json().requestId });
  const cursor = f.store.cursor(f.project.id);
  error(await f.tool("apply_change", { preparedId: prepared.json().id }, oldBridge.token), 403, "EPOCH_REVOKED");
  error(await f.tool("prepare_change", { variant: "project", expectedHeadVersion: 0, creative: { brief: "Late old request" } }, oldBridge.token), 403, "EPOCH_REVOKED");
  error(await f.tool("read_context", {}, oldBridge.token), 403, "EPOCH_REVOKED");
  error(await f.tool("control_execution", { action: "pause" }, oldBridge.token), 403, "EPOCH_REVOKED");
  assert.equal(f.store.cursor(f.project.id), cursor, "Revoked credentials cannot create invocation records");
  error(await f.tool("apply_change", { preparedId: prepared.json().id }, newBridge.token), 403, "ACTOR_DENIED");
  assert.deepEqual(f.store.readEvents(f.project.id, cursor).map(event => event.kind), ["tool.started", "tool.finished"]);
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
  assert.equal(f.store.getProject(f.project.id).brief, "");
});

test("a read-only director bridge can inspect state but cannot prepare, apply, or place edit holds", async t => {
  const f = fixture(t);
  const human = f.service.beginRequest(f.project.id, "local-user", "Explain current progress", { editing: false });
  const bridge = f.service.openEpoch(f.project.id, human);
  assert.equal((await f.tool("read_context", {}, bridge.token)).statusCode, 200);
  error(await f.tool("prepare_change", { variant: "project", expectedHeadVersion: 0, creative: { brief: "Unrequested edit" } }, bridge.token), 403, "ACTOR_DENIED");
  error(await f.tool("apply_change", { preparedId: "unused" }, bridge.token), 403, "ACTOR_DENIED");
  error(await f.tool("control_execution", { action: "pause" }, bridge.token), 403, "ACTOR_DENIED");
  assert.deepEqual(f.store.list("hold", f.project.id), []);
  assert.equal(f.store.getProject(f.project.id).headVersion, 0);
});

test("invalid event cursors are rejected before opening a stream", async t => {
  const f = fixture(t);
  for (const cursor of ["-1", "0.5", "NaN", "999999", "9007199254740992"])
    error(await f.request("GET", `${f.path}/events?after=${cursor}`), 400, "VALIDATION_ERROR");
  error(await f.request("GET", `${f.path}/events`, undefined, { "last-event-id": "bad" }), 400, "VALIDATION_ERROR");
});

async function openEvents(url, token, lastEventId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("SSE test exceeded its five-second bound")), 5000);
  let reader;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, ...(lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) }) },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
    reader = response.body.getReader();
  } catch (error) { clearTimeout(timeout); controller.abort(); throw error; }
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (frame.startsWith(":")) continue;
          const lines = frame.split("\n");
          const value = prefix => lines.find(line => line.startsWith(prefix))?.slice(prefix.length);
          const data = value("data: ");
          if (data === undefined) continue;
          return { id: Number(value("id: ")), kind: value("event: "), data: JSON.parse(data) };
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, "event stream ended before the expected event");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    async close() {
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel().catch(() => {});
    },
  };
}

test("loopback SSE replays after a snapshot and reconnects from Last-Event-ID without repeating prior events", { timeout: 15000 }, async t => {
  const f = fixture(t);
  const address = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const response = await fetch(`${address}${f.path}`, { headers: { authorization: `Bearer ${f.localToken}` } });
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  const post = async text => {
    const result = await fetch(`${address}${f.path}/messages`, {
      method: "POST", headers: { authorization: `Bearer ${f.localToken}`, "content-type": "application/json" },
      body: JSON.stringify({ text, editing: false }),
    });
    assert.equal(result.status, 200, await result.text());
  };
  const verify = (event, sequence, text) => {
    assert.equal(event.id, sequence);
    assert.equal(event.kind, "message.recorded");
    assert.equal(event.data.sequence, sequence);
    assert.equal(event.data.projectId, f.project.id);
    assert.equal(event.data.payload.text, text);
    assert.ok(event.data.eventId);
  };
  await post("Recorded between snapshot and subscription");
  const stream = await openEvents(`${address}${f.path}/events?after=${snapshot.cursor}`, f.localToken);
  let last;
  try {
    verify(await stream.next(), snapshot.cursor + 1, "Recorded between snapshot and subscription");
    await post("Recorded while connected");
    last = await stream.next();
    verify(last, snapshot.cursor + 2, "Recorded while connected");
  } finally { await stream.close(); }
  await post("Recorded while disconnected");
  // The header wins over the deliberately older query cursor on reconnect.
  const reconnect = await openEvents(`${address}${f.path}/events?after=0`, f.localToken, last.id);
  try { verify(await reconnect.next(), last.id + 1, "Recorded while disconnected"); }
  finally { await reconnect.close(); }
  const final = await f.request("GET", f.path);
  assert.equal(final.json().cursor, snapshot.cursor + 3);
});
