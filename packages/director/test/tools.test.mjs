import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PassThrough, Writable } from "node:stream";
import { TOOL_NAMES, TOOL_DESCRIPTORS, TOOL_CATALOG_DIGEST, TOOL_CONTRACT_VERSION, parseToolArguments, changeProposalSchema, digest, toolCatalog, toolHandlerId } from "@openslate/core";
import { ToolBridge, runStdioToolBridge, STDIO_LIMITS } from "../dist/tools/index.js";

const entry = fileURLToPath(new URL("../dist/tools/mcp.js", import.meta.url));
const code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
// Real Node children load the schema catalog; allow startup headroom under the
// bounded repository suite. Explicit transport deadline tests pass shorter limits.
async function bounded(promise, ms = 10000) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture deadline exceeded")), ms); })]); } finally { clearTimeout(timer); } }

async function fixture(t, handler) {
  const calls = [], arrived = deferred();
  const server = createServer(async (req, res) => {
    try {
      let text = ""; for await (const chunk of req) text += chunk;
      const call = { url: req.url, headers: req.headers, body: JSON.parse(text) }; calls.push(call); arrived.resolve(call);
      if (handler) await handler(req, res, call);
      else { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, args: call.body })); }
    } catch { if (!res.destroyed) res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const options = { endpoint: `http://127.0.0.1:${server.address().port}`, projectId: randomUUID(), credential: randomBytes(32).toString("base64url") };
  return { calls, arrived, options, bridge: new ToolBridge(options) };
}

async function childFixture(t, options) {
  const child = spawn(process.execPath, [entry], { cwd: tmpdir(), env: {
    PATH: dirname(process.execPath) + ":/usr/bin:/bin", HOME: tmpdir(),
    OPENSLATE_BRIDGE_ENDPOINT: options.endpoint, OPENSLATE_BRIDGE_PROJECT_ID: options.projectId, OPENSLATE_BRIDGE_CREDENTIAL: options.credential,
    ...(options.toolContractVersion ? { OPENSLATE_BRIDGE_TOOL_CONTRACT: options.toolContractVersion } : {}),
  }, stdio: ["pipe", "pipe", "pipe"] });
  let counter = 0, buffer = "", stderr = ""; const pending = new Map();
  const exit = new Promise(resolve => child.once("exit", (code, signal) => {
    for (const waiter of pending.values()) waiter.reject(new Error("MCP child exited")); pending.clear(); resolve({ code, signal });
  }));
  child.stderr.on("data", data => { stderr += data; });
  child.stdin.on("error", () => {});
  child.stdout.on("data", data => {
    buffer += data;
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n"), line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let value; try { value = JSON.parse(line); } catch { for (const waiter of pending.values()) waiter.reject(new Error("Non-protocol stdout")); child.kill(); return; }
      const waiter = pending.get(value.id); if (waiter) { pending.delete(value.id); waiter.resolve(value); }
    }
  });
  t.after(async () => { child.stdin.end(); try { await bounded(exit); } catch { child.kill("SIGKILL"); await bounded(exit); } assert.equal(stderr, ""); });
  const request = (method, params, explicitId) => {
    const id = explicitId ?? ++counter;
    const response = bounded(new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); })).finally(() => pending.delete(id));
    return { id, response };
  };
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }) + "\n");
  const initialize = async () => {
    const reply = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } }).response;
    assert.equal(reply.result.protocolVersion, "2025-11-25"); notify("notifications/initialized"); return reply;
  };
  return { child, exit, request, notify, initialize };
}

test("five immutable descriptors share exact workflow grammar and a stable versioned digest", () => {
  assert.equal(TOOL_CONTRACT_VERSION, "1.0.0");
  assert.equal(TOOL_CATALOG_DIGEST, "4d9723ce7c4ab83739ab188b87ed31374ba7a60cb02f25f755b665d757cc4bec", "shipped v1 catalog remains byte-identical");
  assert.deepEqual(TOOL_DESCRIPTORS.map(tool => tool.name), TOOL_NAMES);
  assert.equal(new Set(TOOL_NAMES).size, 5);
  assert.deepEqual(TOOL_DESCRIPTORS.find(tool => tool.name === "prepare_change").inputSchema, changeProposalSchema);
  assert.equal(TOOL_CATALOG_DIGEST, digest({ version: TOOL_CONTRACT_VERSION, tools: TOOL_DESCRIPTORS }));
  assert.throws(() => { TOOL_DESCRIPTORS[0].inputSchema.additionalProperties = true; }, TypeError);
  const proposal = { variant: "project", expectedHeadVersion: 0, creative: { brief: "Saved intent" } };
  const parsed = parseToolArguments("prepare_change", proposal); proposal.creative.brief = "Mutated later";
  assert.equal(parsed.arguments.creative.brief, "Saved intent");
  assert.deepEqual(parseToolArguments("control_execution", { action: "pause" }), { name: "control_execution", arguments: { action: "pause" } });
});

test("versioned schemas add only draft narration while rejecting the alternate canonical write path", () => {
  const catalog = toolCatalog("2.0.0"); assert.equal(catalog.names.length, 6);
  assert.throws(() => toolCatalog("latest"), code("CAPABILITY_MISMATCH"));
  const input = { expectedVersion: 0, patch: { add: [{ text: "Boots", textKind: "draft", language: "en", meaning: "Craft", source: { kind: "undecided" } }] } };
  assert.deepEqual(parseToolArguments("revise_narration_draft", input, "2.0.0").arguments, input);
  assert.throws(() => parseToolArguments("revise_narration_draft", input), code("NOT_FOUND"));
  const old = { variant: "project", expectedHeadVersion: 0, creative: { narrationScript: "Original" } };
  assert.deepEqual(parseToolArguments("prepare_change", old).arguments, old);
  assert.throws(() => parseToolArguments("prepare_change", old, "2.0.0"), code("VALIDATION_ERROR"));
  assert.throws(() => parseToolArguments("revise_narration_draft", { ...input, actor: "human" }, "2.0.0"), code("VALIDATION_ERROR"));
  assert.throws(() => { catalog.descriptors[0].inputSchema.additionalProperties = true; }, TypeError);
});

test("tool parsing rejects forged authority, unknown tools, coercion, and empty preparation", () => {
  assert.throws(() => parseToolArguments("approve", {}), code("NOT_FOUND"));
  for (const input of [[], null, { actor: "human" }, { requestId: "forged" }, { epochId: "new" }]) assert.throws(() => parseToolArguments("read_context", input), code("VALIDATION_ERROR"));
  for (const [name, input] of [
    ["control_execution", { action: "resume" }], ["inspect_artifact", { artifactId: 12 }], ["apply_change", { preparedId: "" }],
    ["prepare_change", { variant: "project", expectedHeadVersion: 0 }],
    ["prepare_change", { variant: "project", expectedHeadVersion: "0", creative: { brief: "x" } }],
    ["prepare_change", { variant: "project", expectedHeadVersion: 0, creative: { brief: "x" }, principalId: "forged" }],
  ]) assert.throws(() => parseToolArguments(name, input), code("VALIDATION_ERROR"));
});

test("read_context accepts bounded optional sections and offsets without accepting authority claims", () => {
  assert.deepEqual(parseToolArguments("read_context", {}).arguments, {});
  for (const section of ["overview", "shots", "scenes", "plan", "grants", "receipts", "aliases"]) {
    assert.deepEqual(parseToolArguments("read_context", { section }).arguments, { section });
    for (const offset of [0, 1, 10_000_000]) assert.deepEqual(parseToolArguments("read_context", { section, offset }).arguments, { section, offset });
  }
  assert.deepEqual(parseToolArguments("read_context", { offset: 0 }).arguments, { offset: 0 });
  for (const input of [
    { section: "all" }, { section: null }, { offset: -1 }, { offset: 0.5 },
    { offset: 10_000_001 }, { offset: Number.MAX_SAFE_INTEGER + 1 }, { offset: "1" },
    { section: "plan", actor: "human" }, { section: "receipts", projectId: "forged" },
    { section: "grants", epochId: "forged" }, { section: "shots", requestId: "forged" },
  ]) assert.throws(() => parseToolArguments("read_context", input), code("VALIDATION_ERROR"));
});

test("launch accepts only a local HTTP origin and captures project and credential immutably", async t => {
  const f = await fixture(t);
  for (const endpoint of ["https://127.0.0.1", "http://localhost", "http://example.com", "http://127.0.0.1/path", "http://user:pass@127.0.0.1", "http://127.0.0.1/?x=1", "http://127.0.0.1/#fragment"])
    assert.throws(() => new ToolBridge({ ...f.options, endpoint }));
  assert.throws(() => new ToolBridge({ ...f.options, projectId: "../another" }));
  assert.throws(() => new ToolBridge({ ...f.options, credential: "short" }));
  const projectId = f.options.projectId, credential = f.options.credential;
  f.options.projectId = "different"; f.options.credential = "different-credential-0000000000"; f.options.endpoint = "http://example.com";
  assert.equal(f.calls.length, 0, "construction does not access the network");
  const first = await f.bridge.call("read_context", {}), second = await f.bridge.call("inspect_artifact", { artifactId: "saved-artifact" });
  assert.equal(first.isError, false); assert.equal(second.isError, false);
  assert.equal(f.calls[0].url, `/internal/projects/${projectId}/tools/read_context`);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${credential}`);
  assert.equal(f.calls[0].headers["x-openslate-tool-call-id"], first.callId);
  assert.match(first.callId, /^[A-Za-z0-9_-]{1,160}$/); assert.notEqual(first.callId, second.callId);
  await assert.rejects(f.bridge.call("read_context", { actor: "human" }), code("VALIDATION_ERROR"));
  assert.equal(f.calls.length, 2);
});

test("service errors retain their code and responses cannot reveal the bridge credential", async t => {
  let secret;
  const f = await fixture(t, (_req, res) => { res.writeHead(403, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "EPOCH_REVOKED", message: "No active authority", secret } })); });
  secret = f.options.credential;
  const response = await f.bridge.call("read_context", {});
  assert.equal(response.isError, true); assert.equal(response.value.error.code, "EPOCH_REVOKED");
  assert.equal(response.value.error.secret, "[redacted]"); assert.equal(f.calls.length, 1);
});

test("redirects, lost responses, malformed JSON and oversized responses stay unresolved without retries", async t => {
  for (const mode of ["redirect", "disconnect", "invalid", "server-error", "declared-large", "streamed-large", "wrong-type"]) await t.test(mode, async t => {
    const f = await fixture(t, (_req, res) => {
      if (mode === "disconnect") return res.destroy();
      if (mode === "redirect") { res.writeHead(307, { location: "http://127.0.0.1:1/must-not-follow" }); return res.end(); }
      res.setHeader("content-type", mode === "wrong-type" ? "text/plain" : "application/json");
      if (mode === "server-error") { res.statusCode = 500; return res.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Response failed" } })); }
      if (mode === "declared-large") res.setHeader("content-length", "10000");
      if (mode === "invalid") return res.end("{invalid");
      if (mode.endsWith("large")) { res.write(JSON.stringify({ data: "x".repeat(1000) })); return res.end(); }
      res.end("{}");
    });
    const bridge = new ToolBridge({ ...f.options, limits: { responseBytes: 128, timeoutMs: 500 } });
    const result = await bridge.call("apply_change", { preparedId: "possibly-committed" });
    assert.equal(result.isError, true); assert.equal(result.value.error.code, "TOOL_CALL_UNRESOLVED");
    assert.equal(result.value.error.outcome, "unknown"); assert.equal(result.value.error.callId, result.callId);
    assert.equal(f.calls.length, 1);
  });
});

test("timeouts and concurrency limits bound a pending request; pre-dispatch cancellation sends nothing", async t => {
  const f = await fixture(t, () => {});
  const bridge = new ToolBridge({ ...f.options, limits: { timeoutMs: 150, concurrency: 1 } });
  const pending = bridge.call("apply_change", { preparedId: "pending" }); await bounded(f.arrived.promise);
  await assert.rejects(bridge.call("read_context", {}), code("BRIDGE_BUSY"));
  const result = await bounded(pending); assert.equal(result.value.error.code, "TOOL_CALL_UNRESOLVED"); assert.equal(f.calls.length, 1);
  await assert.rejects(bridge.call("read_context", {}, AbortSignal.abort()), code("TOOL_CALL_CANCELLED"));
  const small = new ToolBridge({ ...f.options, limits: { requestBytes: 10 } });
  await assert.rejects(small.call("apply_change", { preparedId: "too-large" }), code("TOOL_ARGUMENTS_TOO_LARGE"));
  assert.equal(f.calls.length, 1);
});

test("actual stdio child negotiates, lists exact tools without HTTP, then forwards validated calls", async t => {
  const f = await fixture(t), c = await childFixture(t, f.options);
  assert.equal((await c.request("tools/list", {}).response).error.code, -32002);
  const initialized = await c.initialize(); assert.deepEqual(initialized.result.capabilities, { tools: {} });
  const listed = await c.request("tools/list", {}).response;
  assert.deepEqual(listed.result.tools, TOOL_DESCRIPTORS); assert.equal(f.calls.length, 0);
  for (const input of [{ actor: "human" }, null, []]) {
    const rejected = await c.request("tools/call", { name: "read_context", arguments: input }).response;
    assert.equal(rejected.result.isError, true); assert.equal(JSON.parse(rejected.result.content[0].text).error.code, "VALIDATION_ERROR");
  }
  const call = c.request("tools/call", { name: "apply_change", arguments: { preparedId: "saved-proposal" } });
  const reply = await call.response;
  assert.equal(reply.result.isError, false); assert.equal(JSON.parse(reply.result.content[0].text).ok, true);
  assert.equal(reply.result._meta["openslate/callId"], f.calls[0].headers["x-openslate-tool-call-id"]);
  const duplicate = await c.request("tools/call", { name: "apply_change", arguments: { preparedId: "different-proposal" } }, call.id).response;
  assert.equal(duplicate.error.code, -32600); assert.equal(f.calls.length, 1);
  const page = await c.request("tools/call", { name: "read_context", arguments: { section: "plan", offset: 4096 } }).response;
  assert.equal(page.result.isError, false);
  assert.deepEqual(f.calls[1].body, { section: "plan", offset: 4096 });
});

test("v2 stdio child captures its exact catalog and forwards draft-only calls", async t => {
  const f = await fixture(t), c = await childFixture(t, { ...f.options, toolContractVersion: "2.0.0" });
  const initialized = await c.initialize(); assert.equal(initialized.result.serverInfo.version, "2.0.0");
  assert.deepEqual((await c.request("tools/list", {}).response).result.tools, toolCatalog("2.0.0").descriptors);
  const args = { expectedVersion: 0, patch: { add: [{ text: "Boots", textKind: "draft", language: "en", meaning: "Craft", source: { kind: "undecided" } }] } };
  const call = await c.request("tools/call", { name: "revise_narration_draft", arguments: args }).response;
  assert.equal(call.result.isError, false); assert.deepEqual(f.calls[0].body, args);
  const denied = await c.request("tools/call", { name: "prepare_change", arguments: { variant: "project", expectedHeadVersion: 0, creative: { narrationSource: "uploaded" } } }).response;
  assert.equal(denied.result.isError, true); assert.equal(f.calls.length, 1);
  const options = { ...f.options, toolContractVersion: "2.0.0" }, bridge = new ToolBridge(options); options.toolContractVersion = "1.0.0";
  assert.equal(bridge.toolContractVersion, "2.0.0");
  assert.throws(() => { bridge.toolContractVersion = "1.0.0"; }, TypeError);
  await assert.rejects(runStdioToolBridge({ bridge, toolContractVersion: "1.0.0" }), /STDIO_CATALOG_MISMATCH/);
});

test("MCP cancellation aborts waiting transport without claiming rollback and still serves pings", async t => {
  const f = await fixture(t, () => {}), c = await childFixture(t, f.options); await c.initialize();
  const call = c.request("tools/call", { name: "apply_change", arguments: { preparedId: "pending" } });
  await bounded(f.arrived.promise); c.notify("notifications/cancelled", { requestId: call.id, reason: "test" });
  const result = await call.response;
  assert.equal(result.result.isError, true); assert.equal(JSON.parse(result.result.content[0].text).error.code, "TOOL_CALL_UNRESOLVED");
  assert.deepEqual((await c.request("ping", {}).response).result, {}); assert.equal(f.calls.length, 1);
});

test("stdio limits concurrent calls and cancels pending transport when input closes", async t => {
  const f = await fixture(t, () => {}), c = await childFixture(t, f.options); await c.initialize();
  const calls = Array.from({ length: 5 }, () => c.request("tools/call", { name: "read_context", arguments: {} }));
  for (const call of calls.slice(0, 4)) void call.response.catch(() => {});
  const busy = await calls[4].response;
  assert.equal(JSON.parse(busy.result.content[0].text).error.code, "BRIDGE_BUSY");
  c.child.stdin.end(); const status = await bounded(c.exit);
  assert.equal(status.code, 0); assert.ok(f.calls.length <= 4);
  await Promise.allSettled(calls.map(call => call.response));
});

test("oversized stdio input terminates without forwarding an HTTP request", async t => {
  const f = await fixture(t), c = await childFixture(t, f.options); await c.initialize();
  c.child.stdin.write("x".repeat(STDIO_LIMITS.frameBytes + 1));
  assert.equal((await bounded(c.exit)).code, 0); assert.equal(f.calls.length, 0);
});

test("stdio output backpressure has a deadline", async () => {
  const input = new PassThrough(); const output = new Writable({ write() {} });
  const running = runStdioToolBridge({ input, output, bridge: { call() { throw new Error("No tool expected"); } }, limits: { writeTimeoutMs: 25 } });
  input.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
  await bounded(running, 1000); assert.equal(input.destroyed, true); output.destroy();
});


test("V3 leaves complete V1/V2 catalogs byte-identical and adds only bounded proposal tools", () => {
  assert.equal(digest(toolCatalog("1.0.0")), "b205f7ba3a89eca36a44f9997673b02e4ccc62777766b78db53a0e234286b1fa");
  assert.equal(digest(toolCatalog("2.0.0")), "c4e9ae02f5e9154e5efed3b20d1eef5562c1d0da6f2a7c8c870d9f62b13325df");
  const v3 = toolCatalog("3.0.0"); assert.equal(v3.names.length, 8); assert.equal(toolHandlerId(v3.version), "director-tools@3");
  assert.equal(toolHandlerId("1.0.0"), "five-tools@1"); assert.equal(toolHandlerId("2.0.0"), "director-tools@2");
  assert.ok(Object.isFrozen(v3)); assert.ok(Object.isFrozen(v3.descriptors[0].inputSchema));
  for (const version of ["1.0.0", "2.0.0"]) {
    for (const name of ["prepare_recording_transcription", "prepare_narration_speech"]) assert.throws(() => parseToolArguments(name, {}, version), code("NOT_FOUND"));
    assert.throws(() => parseToolArguments("read_context", { section: "audio_operations" }, version), code("VALIDATION_ERROR"));
  }
  assert.deepEqual(parseToolArguments("read_context", { section: "audio_operations", offset: 20 }, "3.0.0").arguments, { section: "audio_operations", offset: 20 });
});
const v3Recording = () => ({ expectedHeadVersion: 0, audioId: "owned-audio", sourceRecordDigest: "a".repeat(64), profileId: "saved-asr", language: "auto", target: { kind: "recording" } });
const v3Speech = () => ({ expectedHeadVersion: 0, segmentId: "saved-section", segmentRevisionId: "saved-revision", profileId: "saved-speech", voice: "coral", instructions: "" });
test("V3 proposal schemas reject supplied authority, paths, replacement text, keys and coercion", () => {
  for (const [name, input] of [["prepare_recording_transcription", v3Recording()], ["prepare_narration_speech", v3Speech()]]) {
    assert.deepEqual(parseToolArguments(name, input, "3.0.0").arguments, input);
    for (const extra of [{ actor: "human" }, { key: "caller-key" }, { approved: true }, { path: "/private/input" }, { text: "replacement words" }, { expectedHeadVersion: "0" }, { profileId: "x".repeat(161) }])
      assert.throws(() => parseToolArguments(name, { ...input, ...extra }, "3.0.0"), code("VALIDATION_ERROR"));
  }
  for (const patch of [{ instructions: "x".repeat(257) }, { instructions: null }, { voice: "" }]) assert.throws(() => parseToolArguments("prepare_narration_speech", { ...v3Speech(), ...patch }, "3.0.0"), code("VALIDATION_ERROR"));
  for (const patch of [{ sourceRecordDigest: "bad" }, { target: { kind: "section", segmentId: "s" } }, { target: { kind: "recording", audioId: "extra" } }]) assert.throws(() => parseToolArguments("prepare_recording_transcription", { ...v3Recording(), ...patch }, "3.0.0"), code("VALIDATION_ERROR"));
  const input = { ...v3Recording(), target: { kind: "section", segmentId: "s", segmentRevisionId: "r", audioId: "owned-audio" } }, captured = parseToolArguments("prepare_recording_transcription", input, "3.0.0");
  input.target.audioId = "changed"; assert.equal(captured.arguments.target.audioId, "owned-audio");
});
test("actual V3 stdio child lists its exact catalog and forwards both proposal schemas without media calls", async t => {
  const f = await fixture(t), c = await childFixture(t, { ...f.options, toolContractVersion: "3.0.0" });
  const initialized = await c.initialize(); assert.equal(initialized.result.serverInfo.version, "3.0.0");
  assert.deepEqual((await c.request("tools/list", {}).response).result.tools, toolCatalog("3.0.0").descriptors); assert.equal(f.calls.length, 0);
  for (const [name, args] of [["prepare_recording_transcription", v3Recording()], ["prepare_narration_speech", v3Speech()]]) {
    const result = await c.request("tools/call", { name, arguments: args }).response; assert.equal(result.result.isError, false);
    assert.deepEqual(f.calls.at(-1).body, args); assert.equal(f.calls.at(-1).url.endsWith("/" + name), true);
  }
  assert.equal(f.calls.length, 2);
});
test("V3 cancellation preserves the original transport identity and makes no second proposal request", async t => {
  const f = await fixture(t, () => {}), c = await childFixture(t, { ...f.options, toolContractVersion: "3.0.0" }); await c.initialize();
  const call = c.request("tools/call", { name: "prepare_narration_speech", arguments: v3Speech() });
  await bounded(f.arrived.promise); c.notify("notifications/cancelled", { requestId: call.id });
  const result = await call.response; assert.equal(result.result.isError, true); assert.equal(JSON.parse(result.result.content[0].text).error.code, "TOOL_CALL_UNRESOLVED");
  assert.equal(f.calls.length, 1); assert.deepEqual((await c.request("ping", {}).response).result, {});
});
