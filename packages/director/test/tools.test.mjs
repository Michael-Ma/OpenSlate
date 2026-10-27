import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { chmodSync, cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PassThrough, Writable } from "node:stream";
import { TOOL_NAMES, TOOL_DESCRIPTORS, TOOL_CATALOG_DIGEST, TOOL_CONTRACT_VERSION, parseToolArguments, changeProposalSchema, digest, toolCatalog, toolHandlerId } from "@openslate/core";
import { ToolBridge, runStdioToolBridge, STDIO_LIMITS } from "../dist/tools/index.js";
import { loadSkillCatalog } from "../dist/skills/index.js";

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
  const originalSchema = structuredClone(changeProposalSchema);
  delete originalSchema.properties.creative.properties.createShots.items.properties.narration;
  delete originalSchema.properties.creative.properties.updateShots.items.properties.narration;
  assert.deepEqual(TOOL_DESCRIPTORS.find(tool => tool.name === "prepare_change").inputSchema, originalSchema);
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


test("V4 alone accepts compact shot narration intent while V1–V3 retain their exact grammar", () => {
  const v4 = toolCatalog("4.0.0");
  assert.deepEqual(v4.names, toolCatalog("3.0.0").names);
  assert.equal(toolHandlerId(v4.version), "director-tools@4");
  const narration = { mode: "generated", text: "Crafted for every step.", voice: "stock" };
  const update = { variant: "project", expectedHeadVersion: 0, creative: { updateShots: [{ id: "owned-shot", narration, reauthorPrompts: true }] } };
  const create = { variant: "project", expectedHeadVersion: 0, creative: { createShots: [{ key: "shot", sceneId: "scene", purpose: "Reveal", action: "Boot", framing: "Close", motion: "Slow push", desiredFrames: 180, imagePrompt: "Boot", videoPrompt: "Push", referenceArtifactIds: [], cueId: null, narration }] } };
  for (const input of [update, create]) {
    assert.deepEqual(parseToolArguments("prepare_change", input, "4.0.0").arguments, input);
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) assert.throws(() => parseToolArguments("prepare_change", input, version), code("VALIDATION_ERROR"));
  }
  for (const field of ["narrationScript", "narrationSource"]) assert.throws(() => parseToolArguments("prepare_change", { variant: "project", expectedHeadVersion: 0, creative: { [field]: "uploaded" } }, "4.0.0"), code("VALIDATION_ERROR"));
  for (const extra of [{ narrationPending: false }, { narrationTimingMode: "within_shot" }, { approved: true }]) assert.throws(() => parseToolArguments("prepare_change", { ...update, creative: { updateShots: [{ ...update.creative.updateShots[0], ...extra }] } }, "4.0.0"), code("VALIDATION_ERROR"));
});

test("actual V4 stdio child advertises the saved catalog and forwards compact writing once", async t => {
  const f = await fixture(t), c = await childFixture(t, { ...f.options, toolContractVersion: "4.0.0" });
  const initialized = await c.initialize(); assert.equal(initialized.result.serverInfo.version, "4.0.0");
  assert.deepEqual((await c.request("tools/list", {}).response).result.tools, toolCatalog("4.0.0").descriptors);
  const input = { variant: "project", expectedHeadVersion: 0, creative: { updateShots: [{ id: "owned-shot", narration: { mode: "none", text: "", voice: "stock" }, reauthorPrompts: true }] } };
  const reply = await c.request("tools/call", { name: "prepare_change", arguments: input }).response;
  assert.equal(reply.result.isError, false); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, input);
});


test("every shipped tool catalog has an immutable complete catalog and handler digest", () => {
  const hashes = {
    "6.0.0": ["857fcfc65113b20272eba548c5e1eceff7b79c34b8391934b7043b3ff838fd3c", "d1891b9f92dcb62401e91a1ac71b4aab54a7722db50559136fbbeed9cf4de198"],
    "5.0.0": ["271ad801bf43075bcb1ed0188fd8ca5822f3845f903a9ee2d4cca92fb910530c", "e696fa1999ff0d088ba7ef9a6b64d42af111fb0e5af7a927973999e843f8914e"],
    "1.0.0": ["b205f7ba3a89eca36a44f9997673b02e4ccc62777766b78db53a0e234286b1fa", "4d9723ce7c4ab83739ab188b87ed31374ba7a60cb02f25f755b665d757cc4bec"],
    "2.0.0": ["c4e9ae02f5e9154e5efed3b20d1eef5562c1d0da6f2a7c8c870d9f62b13325df", "2a5ccb9878d62e0edd93a68e5c77c67e36dd70078584ecc6027105684b8e8b4e"],
    "3.0.0": ["81199e4880e2e3e4412ae8828abfb9c6a3f7dbbce9f5434ac9d5c345bf716a4b", "f6ecf84a8d5cd48b8114b4055171fba9b21682deccd7adc45b09b7ab9e45789d"],
    "4.0.0": ["ef3a0a6aaf37ace8b455cb214a63ea0038d4ba5b1735af45f1db35dfd0ffa5be", "978a51d27e316988bdec5674f949dbb353f148ce4bf5422b456ed94ab8300f01"],
  };
  for (const [version, [wholeCatalog, handlerSchema]] of Object.entries(hashes)) {
    assert.equal(digest(toolCatalog(version)), wholeCatalog, `${version} complete saved catalog`);
    assert.equal(toolCatalog(version).digest, handlerSchema, `${version} schema handler binding`);
  }
});

const shippedPackages = {
  '1': ['f0284e141496a4b2ee6e19be5903e78c03c412df1614958ba3257f295347378a', 'a0ee6a6b355eb340ea18de2e4adcdeb9ab1cb5102d7cda6eac0209442c2197b2'],
  '2': ['5c1eb0c1e4cd7aa80b9ef381cc78132b9f5780e78373ccdac86001299798c888', 'eb9f48f8678f87843ee1da6a15f89e20c8310956f58b6b692dd6fa37e9afea43'],
  '3': ['4fa616046fe7c2e0a05b8a9dc81ae215ae7ba5e396667f57ab1f8bbcc2570f06', '25189e7debe84a82877515a39cd092ac3bee34abadd84489779783032f7416e8'],
  '4': ['25f6c9e86417c128a69c39586bab717edcf6148144947d1c31ba14f0fa463981', '6b67cf6e4252c79d9d97fb1906fdfee88ed6f192b4487dbb5e7e0a7a49a353cc'],
  '5': ['206b5110da0b22965e89a4c30ab1ce3866ad913a2b6fae0ebe1db43f345c45c7', 'd61e3c6581a23bb6c46419d10a7a9d26979edacd6ab5885bd1c551d7ede53a20'],
  '6': ['b1747d2be71665532b92a3cf2827b860c354cbf59a66911aacc46f83edbeaa3e', '828e671fb1eb191c8c668fcc946d273e5c22c60ff6b948029a348122f9214c4d'],
  '7': ['6ed8cdca8f26c0e62506bde0e46e41f41a62525060c8a1e5b038c7af41faf1bb', 'f4e3a71c5b62c75ab647c9ebc109bc93fe98bce8f682893467917856febca562'],
};
function writableSkillDirectories(root) {
  chmodSync(root, 0o700);
  for (const entry of readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) writableSkillDirectories(join(root, entry.name));
}
function packageIdentity(source, snapshotRoot) {
  const manifest = JSON.parse(readFileSync(join(source, 'openslate.skill.json'), 'utf8'));
  return loadSkillCatalog({ snapshotRoot, compatibility: manifest.compatibility, availableToolIds: toolCatalog(manifest.compatibility.toolContract).names, packageRoots: [source] }).skills[0].packageDigest;
}
test('every shipped skill package has an immutable packageDigest', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'openslate-package-pins-'));
  t.after(() => { writableSkillDirectories(temporary); rmSync(temporary, { recursive: true, force: true }); });
  for (const [version, pins] of Object.entries(shippedPackages)) for (const [index, name] of ['plan-authoring', 'production'].entries()) {
    const source = fileURLToPath(new URL(`../../../skills/${version === '1' ? '' : `v${version}/`}${name}`, import.meta.url));
    assert.equal(packageIdentity(source, join(temporary, 'snapshots')), pins[index], `${version}/${name} shipped package bytes`);
  }
});
test('the historical package pin detects an instruction edit', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'openslate-package-pin-edit-'));
  t.after(() => { writableSkillDirectories(temporary); rmSync(temporary, { recursive: true, force: true }); });
  const source = join(temporary, 'production');
  cpSync(fileURLToPath(new URL('../../../skills/v4/production', import.meta.url)), source, { recursive: true });
  const entry = join(source, 'SKILL.md');
  writeFileSync(entry, `${readFileSync(entry, 'utf8')}\nChanged historical guidance.\n`);
  assert.throws(() => assert.equal(packageIdentity(source, join(temporary, 'snapshots')), shippedPackages['4'][1]), { code: 'ERR_ASSERTION' });
});

test('V5 stdio advertises notes/proposals and truthful audio suggestions, forwarding each once', async t => {
  const f = await fixture(t), c = await childFixture(t, { ...f.options, toolContractVersion: '5.0.0' });
  assert.equal((await c.initialize()).result.serverInfo.version, '5.0.0');
  const catalog = toolCatalog('5.0.0');
  assert.deepEqual((await c.request('tools/list', {}).response).result.tools, catalog.descriptors);
  for (const name of ['prepare_narration_speech', 'prepare_recording_transcription']) {
    assert.match(catalog.descriptors.find(t => t.name === name).description, /person's press/);
    assert.doesNotMatch(catalog.descriptors.find(t => t.name === name).description, /finite spending approval/);
  }
  const input = { notes: [{ anchor: { shotIds: ['shot'] }, kind: 'observation', blocking: false, text: 'Inspect the opening direction.', choices: [{ kind: 'accept', label: 'Keep it' }] }] };
  const reply = await c.request('tools/call', { name: 'record_notes', arguments: input }).response;
  assert.equal(reply.result.isError, false); assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, input);
  const proposal = { patch: { updateShots: [{ id: 'shot', desiredFrames: 240 }] } };
  const held = await c.request('tools/call', { name: 'propose_change', arguments: proposal }).response;
  assert.equal(held.result.isError, false); assert.equal(f.calls.length, 2); assert.deepEqual(f.calls[1].body, proposal);
  assert.equal(toolHandlerId('5.0.0'), 'director-tools@5');
});

// LIVE-3 made this exact two-note shape, including the singular anchor.shotId.
// Creative text and the film/media identities are replaced with fixture values.
const liveReviewNotes = () => ({ notes: ['shot-one', 'shot-two'].map((shotId, index) => ({
  anchor: { shotId }, blocking: false, kind: 'observation', text: '[redacted visual observation]',
  seenKeyframe: { artifactId: `frame-${index}`, sha256: String(index + 1).repeat(64), shotId },
  choices: [{ kind: 'accept', label: 'Keep this frame' }, { kind: 'reply' }],
})) });

for (const version of ['5.0.0', '6.0.0']) test(`${version} stdio forwards the LIVE-3 invalid note shape and its precise refusal, then accepts a corrected new call`, async t => {
  const refusal = { error: { code: 'VALIDATION_ERROR',
    message: 'record_notes /notes/0/anchor: replace shotId with shotIds: [shotId]. No notes were saved; correct the payload and call record_notes again.' } };
  const f = await fixture(t, (_req, res, call) => {
    res.setHeader('content-type', 'application/json');
    if ('shotId' in call.body.notes[0].anchor) { res.statusCode = 400; res.end(JSON.stringify(refusal)); }
    else { parseToolArguments('record_notes', call.body, version); res.end(JSON.stringify({ notes: [{ noteId: 'note-one', letter: 'a' }, { noteId: 'note-two', letter: 'b' }] })); }
  });
  const c = await childFixture(t, { ...f.options, toolContractVersion: version }); await c.initialize();
  const invalid = liveReviewNotes();
  const denied = await c.request('tools/call', { name: 'record_notes', arguments: invalid }).response;
  assert.equal(denied.result.isError, true);
  assert.deepEqual(JSON.parse(denied.result.content[0].text), refusal);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, invalid);
  const rejectedCallId = denied.result._meta['openslate/callId'];
  assert.equal(rejectedCallId, f.calls[0].headers['x-openslate-tool-call-id']);
  const corrected = liveReviewNotes();
  for (const note of corrected.notes) note.anchor = { shotIds: [note.anchor.shotId] };
  const saved = await c.request('tools/call', { name: 'record_notes', arguments: corrected }).response;
  assert.equal(saved.result.isError, false); assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(saved.result.content[0].text).notes.map(n => n.letter), ['a', 'b']);
  assert.deepEqual(f.calls[1].body, corrected);
  assert.notEqual(saved.result._meta['openslate/callId'], rejectedCallId, 'corrected payload receives a fresh application invocation identity');
});

for (const version of ['5.0.0', '6.0.0']) test(`${version} server note validation is limited to record_notes; other schemas and tools still refuse locally`, async t => {
  const f = await fixture(t), bridge = new ToolBridge({ ...f.options, toolContractVersion: version });
  await assert.rejects(bridge.call('unknown_notes', liveReviewNotes()), code('NOT_FOUND'));
  await assert.rejects(bridge.call('read_context', { actor: 'human' }), code('VALIDATION_ERROR'));
  await assert.rejects(bridge.call('propose_change', { patch: {} }), code('VALIDATION_ERROR'));
  for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0']) {
    await assert.rejects(new ToolBridge({ ...f.options, toolContractVersion: version }).call('record_notes', liveReviewNotes()), code('NOT_FOUND'));
  }
  assert.equal(f.calls.length, 0);
});

for (const version of ['5.0.0', '6.0.0']) test(`${version} notes retain JSON, request-size, cancellation and concurrency guards before dispatch`, async t => {
  const f = await fixture(t, () => {}), options = { ...f.options, toolContractVersion: version };
  const bridge = new ToolBridge({ ...options, limits: { timeoutMs: 150, concurrency: 1 } });
  for (const value of [undefined, () => {}, 1n, NaN, Infinity, new Date()]) {
    await assert.rejects(bridge.call('record_notes', { notes: [], extra: value }), code('VALIDATION_ERROR'));
  }
  const cyclic = liveReviewNotes(); cyclic.extra = cyclic;
  await assert.rejects(bridge.call('record_notes', cyclic));
  const small = new ToolBridge({ ...options, limits: { requestBytes: 32 } });
  await assert.rejects(small.call('record_notes', liveReviewNotes()), code('TOOL_ARGUMENTS_TOO_LARGE'));
  await assert.rejects(bridge.call('record_notes', liveReviewNotes(), AbortSignal.abort()), code('TOOL_CALL_CANCELLED'));
  assert.equal(f.calls.length, 0, 'non-JSON, oversized and cancelled notes never reach HTTP');
  const pending = bridge.call('record_notes', liveReviewNotes()); await bounded(f.arrived.promise);
  await assert.rejects(bridge.call('record_notes', liveReviewNotes()), code('BRIDGE_BUSY'));
  const unresolved = await bounded(pending);
  assert.equal(unresolved.value.error.code, 'TOOL_CALL_UNRESOLVED');
  assert.equal(unresolved.value.error.outcome, 'unknown');
  assert.equal(f.calls.length, 1, 'an unknown note result never causes an automatic retry');
});


test('contract 6 alone accepts scoped keyframes and explicit-shot regeneration without authority fields', () => {
  for (const input of [{ sceneIds: ['scene-one', 'scene-two'] }, { shotIds: ['shot-one'] }, { shotIds: ['shot-one'], regenerate: true }, { sceneIds: ['scene-one'], regenerate: false }]) {
    assert.deepEqual(parseToolArguments('make_keyframes', input, '6.0.0').arguments, input);
    for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']) assert.throws(() => parseToolArguments('make_keyframes', input, version), code('NOT_FOUND'));
  }
  for (const input of [{}, { sceneIds: [], shotIds: ['shot'] }, { sceneIds: ['scene'], shotIds: ['shot'] }, { sceneIds: ['scene'], regenerate: true },
    { shotIds: ['shot', 'shot'] }, { shotIds: [1] }, { shotIds: ['shot'], regenerate: 'true' }, { shotIds: ['shot'], actor: 'human' },
    { shotIds: ['shot'], requestId: 'forged' }, { shotIds: ['shot'], kind: 'video' }, { shotIds: ['shot'], quote: { amountMicros: '0' } }]) {
    assert.throws(() => parseToolArguments('make_keyframes', input, '6.0.0'), code('VALIDATION_ERROR'));
  }
  const descriptor = toolCatalog('6.0.0').descriptors.find(tool => tool.name === 'make_keyframes');
  assert.equal(descriptor.annotations.readOnlyHint, false);
  assert.match(descriptor.description, /person's fresh editing conversation/);
  assert.match(descriptor.description, /confirm_video note choices in chat or Keyframes; only a human click confirms/);
  assert.match(descriptor.description, /explicit shotIds/);
});

test('contract 6 stdio advertises make_keyframes and forwards one scoped call with returned scene quotes', async t => {
  const outcome = { scenes: [{ sceneId: 'scene-one', keyframes: ['shot-one'], voiceLines: ['shot-one'], quote: { currency: 'USD', amountMicros: '125000' } },
    { sceneId: 'scene-two', code: 'direction_required' }] };
  const f = await fixture(t, (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(outcome)); });
  const c = await childFixture(t, { ...f.options, toolContractVersion: '6.0.0' });
  await c.initialize();
  assert.deepEqual((await c.request('tools/list', {}).response).result.tools, toolCatalog('6.0.0').descriptors);
  const input = { sceneIds: ['scene-one', 'scene-two'] };
  const reply = await c.request('tools/call', { name: 'make_keyframes', arguments: input }).response;
  assert.equal(reply.result.isError, false); assert.deepEqual(JSON.parse(reply.result.content[0].text), outcome);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].body, input);
  assert.match(f.calls[0].url, /\/tools\/make_keyframes$/);
  assert.equal(reply.result._meta['openslate/callId'], f.calls[0].headers['x-openslate-tool-call-id']);
  const invalid = await c.request('tools/call', { name: 'make_keyframes', arguments: { sceneIds: ['scene-one'], regenerate: true } }).response;
  assert.equal(JSON.parse(invalid.result.content[0].text).error.code, 'VALIDATION_ERROR');
  assert.equal(f.calls.length, 1, 'invalid regeneration never reaches the application');
});

test('a lost make_keyframes response retains its exact unresolved call identity and never resubmits', async t => {
  const f = await fixture(t, (_req, res) => res.destroy());
  const bridge = new ToolBridge({ ...f.options, toolContractVersion: '6.0.0' });
  const result = await bridge.call('make_keyframes', { shotIds: ['shot-one'] });
  assert.equal(result.isError, true); assert.equal(result.value.error.code, 'TOOL_CALL_UNRESOLVED');
  assert.equal(result.value.error.callId, result.callId); assert.equal(result.value.error.outcome, 'unknown');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].headers['x-openslate-tool-call-id'], result.callId);
});

for (const version of ['5.0.0', '6.0.0']) test(`${version} stdio ${version === '6.0.0' ? 'forwards' : 'refuses'} typed proposal decisions with no model-authored preview or actor`, async t => {
  const f = await fixture(t), c = await childFixture(t, { ...f.options, toolContractVersion: version });
  await c.initialize();
  const listed = (await c.request('tools/list', {}).response).result.tools;
  for (const name of ['accept_proposal', 'reject_proposal']) {
    assert.equal(listed.some(tool => tool.name === name), version === '6.0.0');
    const input = { proposalId: name === 'accept_proposal' ? 'c' : 'proposal-id' };
    const response = (await c.request('tools/call', { name, arguments: input }).response).result;
    if (version === '5.0.0') {
      assert.equal(response.isError, true);
      assert.equal(JSON.parse(response.content[0].text).error.code, 'NOT_FOUND');
      continue;
    }
    assert.equal(response.isError, false);
    assert.deepEqual(JSON.parse(response.content[0].text), { ok: true, args: input });
    assert.deepEqual(f.calls.at(-1).body, input);
    assert.match(f.calls.at(-1).url, new RegExp(`/tools/${name}$`));
    for (const extra of [{ previewDigest: 'a'.repeat(64) }, { requestId: 'forged' }, { actor: 'human' }]) {
      const refused = (await c.request('tools/call', { name, arguments: { ...input, ...extra } }).response).result;
      assert.equal(refused.isError, true);
      assert.equal(JSON.parse(refused.content[0].text).error.code, 'VALIDATION_ERROR');
    }
  }
  assert.equal(f.calls.length, version === '6.0.0' ? 2 : 0, 'only the two exact current-contract inputs reach the application');
});
