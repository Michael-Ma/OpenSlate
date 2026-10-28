import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CodexTransport } from "../dist/runtime/transport.js";
import { ImageRpc } from "../dist/media/image-rpc.js";
import { CODEX_RUNTIME_LIMITS, CODEX_MAX_STARTUP_TIMEOUT_MS, classifyNativeDiagnostic } from "../dist/index.js";
import { RuntimeFault } from "../dist/runtime/validation.js";
const entry = fileURLToPath(new URL("native-startup-fixture.mjs", import.meta.url));

function fixture(t, Transport) {
  let waiting;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const rpc = new Transport({ command: process.execPath, args: [entry], cwd: tmpdir(), env: {},
    limits: { ...CODEX_RUNTIME_LIMITS }, secrets: [], onMessage: message => {
      if (message.method === "fixture/waiting") waiting?.(message.params.method);
    } });
  t.after(async () => { t.mock.timers.reset(); await rpc.close(); });
  const request = async method => {
    const arrived = new Promise(resolve => { waiting = resolve; });
    const response = rpc.request(method, {});
    await arrived; waiting = undefined;
    return { response, release: error => rpc.child.stdin.write(JSON.stringify({ method: "fixture/release", ...(error ? { error } : {}) }) + "\n") };
  };
  return { rpc, request };
}

assert.equal(CODEX_RUNTIME_LIMITS.requestTimeoutMs, 15_000);
assert.equal(CODEX_RUNTIME_LIMITS.startupTimeoutMs, 60_000);
assert.equal(CODEX_MAX_STARTUP_TIMEOUT_MS, 120_000);

for (const [label, Transport, methods] of [
  ["director", CodexTransport, ["initialize", "account/read", "model/list", "thread/start"]],
  ["image", ImageRpc, ["initialize", "account/read", "modelProvider/capabilities/read", "thread/start"]],
]) {
  for (const target of methods) test(`${label} cold ${target} succeeds beyond 15 seconds within the startup limit`, async t => {
    const f = fixture(t, Transport);
    for (const method of methods) {
      const { response, release } = await f.request(method);
      let settled = false; void response.then(() => { settled = true; });
      if (method === target) { t.mock.timers.tick(16_000); await Promise.resolve(); assert.equal(settled, false); }
      release(); assert.deepEqual(await response, { prepared: true });
    }
  });
  test(`${label} preparation shares one finite startup deadline and preserves its safe limit`, async t => {
    const f = fixture(t, Transport);
    const first = await f.request("initialize"); t.mock.timers.tick(40_000); first.release(); await first.response;
    const second = await f.request("account/read");
    const rejected = assert.rejects(second.response, error => {
      assert.equal(error.code, "RUNTIME_RPC_TIMEOUT");
      assert.deepEqual(classifyNativeDiagnostic(error), { category: "native_timeout", limitMs: 60_000 });
      assert.equal(error.message, "Native request timed out"); return true;
    });
    t.mock.timers.tick(20_001); await rejected;
  });
  test(`${label} steady-state request retains the 15 second deadline`, async t => {
    const f = fixture(t, Transport); f.rpc.finishStartup();
    const { response } = await f.request("account/read");
    const rejected = assert.rejects(response, error => {
      assert.deepEqual(classifyNativeDiagnostic(error), { category: "native_timeout", limitMs: 15_000 }); return true;
    });
    t.mock.timers.tick(15_001); await rejected;
  });
  for (const [error, category] of [[{ code: 401 }, "native_auth_required"], [{ code: 429 }, "native_rate_limited"], [{ code: -32601 }, "native_protocol"], [{ code: -1, message: "PRIVATE /auth/path token=SECRET" }, "native_unknown"],
    [{ code: -32000, data: { type: "auth_required", message: "PRIVATE" } }, "native_auth_required"],
    [{ code: -32000, data: { code: "rate_limit_exceeded", path: "PRIVATE" } }, "native_rate_limited"]]) {
    test(`${label} RPC rejection retains ${category} without the native body`, async t => {
      const f = fixture(t, Transport), { response, release } = await f.request("initialize");
      const rejected = assert.rejects(response, failure => {
        assert.deepEqual(classifyNativeDiagnostic(failure), { category });
        assert.equal(failure.message, "Native runtime rejected the request");
        assert.ok(!JSON.stringify(failure).includes("PRIVATE")); return true;
      });
      release(error); await rejected;
    });
  }
}

test("native diagnostic classifier projects only allowlisted categories and finite timeout limits", () => {
  for (const [code, category] of [
    ["RUNTIME_RPC_TIMEOUT", "native_timeout"], ["RUNTIME_SPAWN_FAILED", "native_spawn_failed"], ["ENOENT", "native_spawn_failed"],
    ["SETUP_AUTH_REQUIRED", "native_auth_required"], ["CODEX_IMAGE_CHATGPT_REQUIRED", "native_auth_required"],
    ["RUNTIME_PROTOCOL_INVALID", "native_protocol"], ["SETUP_CONFIG_MISMATCH", "native_protocol"], ["RUNTIME_FAILED", "native_unknown"],
    ["rate_limit_exceeded", "native_rate_limited"], ["usageLimitExceeded", "native_rate_limited"],
  ]) assert.deepEqual(classifyNativeDiagnostic({ code, message: "PRIVATE /home/auth/token" }), { category });
  const privateError = new RuntimeFault("RUNTIME_RPC_TIMEOUT", "PRIVATE token", { category: "native_timeout", limitMs: 60_000, message: "PRIVATE" });
  assert.deepEqual(classifyNativeDiagnostic(privateError), { category: "native_timeout", limitMs: 60_000 });
  for (const limitMs of [-1, 0, Infinity, 1.5, 600_001, "60000"])
    assert.deepEqual(classifyNativeDiagnostic({ nativeDiagnostic: { category: "native_timeout", limitMs, path: "PRIVATE" } }), { category: "native_timeout" });
  assert.deepEqual(classifyNativeDiagnostic({ nativeDiagnostic: { category: "PRIVATE", limitMs: 1 }, message: "rate limit exceeded" }), { category: "native_unknown" });
  assert.deepEqual(classifyNativeDiagnostic({ code: -32000, data: { code: "rate_limit_exceeded" } }), { category: "native_rate_limited" });
  assert.deepEqual(classifyNativeDiagnostic({ code: -32000, data: { type: "auth_required" } }), { category: "native_auth_required" });
});

test("the classifier reads whole words: the app's authority errors are not a Codex sign-in (lead review)", () => {
  for (const code of ["AUTHORIZATION_EPOCH_REVOKED", "AUTHORIZATION_EPOCH_READ_ONLY", "RETRY_NOT_AUTHORIZED", "ORIGIN_NOT_AUTHORIZED", "SCENE_AUTHORITY_CHANGED"])
    assert.notEqual(classifyNativeDiagnostic({ code }).category, "native_auth_required", code);
  assert.equal(classifyNativeDiagnostic({ code: "SETUP_AUTH_REQUIRED" }).category, "native_auth_required");
  assert.equal(classifyNativeDiagnostic({ code: -32000, data: { code: "unauthorized" } }).category, "native_auth_required");
  assert.equal(classifyNativeDiagnostic({ code: -32000, data: { code: "not_logged_in" } }).category, "native_auth_required");
  assert.equal(classifyNativeDiagnostic({ code: -32000, data: { status: 401 } }).category, "native_auth_required");
  assert.equal(classifyNativeDiagnostic({ code: -32000, data: { code: "usage_limit_reached" } }).category, "native_rate_limited");
  assert.equal(classifyNativeDiagnostic({ code: -32000, data: { code: "rate-limited" } }).category, "native_rate_limited");
});

test("known native preparation guards retain their allowlisted reason", () => {
  for (const code of ["RUNTIME_PLATFORM_UNSUPPORTED", "RUNTIME_MODE_UNSUPPORTED", "RUNTIME_VERSION_UNSUPPORTED", "RUNTIME_CONFIG_INVALID",
    "RUNTIME_METHOD_DENIED", "RUNTIME_OUTPUT_LIMIT", "RUNTIME_REQUEST_TOO_LARGE", "RUNTIME_BACKPRESSURE", "RUNTIME_REQUEST_LIMIT",
    "SETUP_NODE_VERSION", "SETUP_PATH_INVALID", "SETUP_PATH_OVERLAP", "SETUP_COMMAND_INVALID", "SETUP_ENV_INVALID",
    "SETUP_AUTH_HOME_INVALID", "SETUP_AUTH_LINK_INVALID", "SETUP_DIRECTORY_CHANGED", "CODEX_IMAGE_PLATFORM_UNSUPPORTED",
    "CODEX_IMAGE_MODEL_UNSUPPORTED", "CODEX_IMAGE_ENV_INVALID", "CODEX_IMAGE_LIMIT_INVALID", "CODEX_IMAGE_PATH_INVALID",
    "CODEX_IMAGE_CONFIG_LIMIT", "CODEX_IMAGE_MCP_UNEXPECTED", "CODEX_IMAGE_BINARY_CHANGED", "CODEX_IMAGE_FILE_INVALID",
    "CODEX_IMAGE_FILE_CHANGED", "CODEX_IMAGE_REFERENCE_CHANGED", "CODEX_IMAGE_REFERENCE_INVALID"])
    assert.deepEqual(classifyNativeDiagnostic({ code, message: "PRIVATE token=/native/account" }), { category: "native_protocol" }, code);
  assert.deepEqual(classifyNativeDiagnostic({ code: "CODEX_IMAGE_INTERACTIVE_DENIED" }), { category: "native_auth_required" });
  assert.deepEqual(classifyNativeDiagnostic({ code: "SETUP_INSTRUCTIONS_UNEXPECTED" }), { category: "native_instructions_unexpected" });
  for (const code of ["CODEX_IMAGE_CLOSED", "CODEX_IMAGE_BUSY", "RUNTIME_PROCESS_EXIT", "RUNTIME_TRANSPORT_FAILED", "RUNTIME_CLEANUP_FAILED"])
    assert.deepEqual(classifyNativeDiagnostic({ code, message: "PRIVATE auth required" }), { category: "native_unknown" }, code);
});

test("instruction diagnostic reclassification preserves only bounded printable file metadata", () => {
  assert.deepEqual(classifyNativeDiagnostic({ code: "RUNTIME_INSTRUCTIONS_UNEXPECTED" }), { category: "native_instructions_unexpected" });
  const files = ["~/.codex/AGENTS.md", "/tmp/AGENTS.override.md", "/tmp/AGENTS.override.md", "PRIVATE_TEXT", "/tmp/../private", "/tmp/AGENTS.md\nPRIVATE", "/tmp/\u202ePRIVATE"];
  assert.deepEqual(classifyNativeDiagnostic({ nativeDiagnostic: { category: "native_instructions_unexpected", instructionFiles: files,
    contents: "PRIVATE_CONTENT", limitMs: 5000, raw: "PRIVATE" } }), {
    category: "native_instructions_unexpected", instructionFiles: ["~/.codex/AGENTS.md", "/tmp/AGENTS.override.md"],
  });
  assert.equal(classifyNativeDiagnostic({ nativeDiagnostic: { category: "native_instructions_unexpected",
    instructionFiles: Array.from({ length: 50 }, (_, i) => `/tmp/${i}/AGENTS.md`) } }).instructionFiles.length, 32);
});
