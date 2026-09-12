import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertNoPaidRequest, ProbeClient } from "../dist/probe/protocol.js";
import { EpochFixture, createFixtureServers, FIXTURE_TOOLS } from "../dist/probe/epoch-fixture.js";
import { isolatedEnvironment, runProbe, schemaMethods } from "../dist/probe/run.js";

test("probe transport cannot start a model turn or steer real input", () => {
  for (const method of ["turn/start", "thread/compact/start", "thread/inject_items", "command/exec"])
    assert.throws(() => assertNoPaidRequest(method, {}), /PROBE_METHOD_FORBIDDEN/);
  assert.throws(() => assertNoPaidRequest("turn/steer", { input: [{ type: "text", text: "run" }] }), /PROBE_STEER_INPUT_FORBIDDEN/);
  assert.throws(() => assertNoPaidRequest("mcpServer/tool/call", { server: "real_provider" }), /PROBE_MCP_SERVER_FORBIDDEN/);
  assert.doesNotThrow(() => assertNoPaidRequest("turn/steer", { input: [] }));
});

test("child environment is built independently from user credentials/configuration", () => {
  const env = isolatedEnvironment("/isolated-probe", "http://127.0.0.1:1");
  assert.equal(env.HOME, "/isolated-probe/home");
  assert.equal(env.CODEX_HOME, "/isolated-probe/runtime");
  assert.equal(env.USER, "openslate-probe");
  assert.equal(env.HTTPS_PROXY, "http://127.0.0.1:1");
  for (const secret of ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "NODE_OPTIONS", "MINIMAX_API_KEY"])
    assert.equal(Object.hasOwn(env, secret), false);
});

test("schema inventory deduplicates declarations without treating descriptions as methods", () => {
  assert.deepEqual(schemaMethods({ oneOf: [
    { properties: { method: { enum: ["thread/start"] } } },
    { properties: { method: { const: "turn/interrupt" } } },
    { properties: { method: { enum: ["thread/start"] } }, description: "turn/start" },
  ] }), ["thread/start", "turn/interrupt"]);
});

test("a captured old epoch is fenced at commit and cannot inherit replacement rights", () => {
  const gate = new EpochFixture();
  const old = gate.issue("old-request");
  const captured = gate.capture(old.credential);
  gate.setState(old.credential, "revoked");
  const next = gate.issue("new-request");
  assert.throws(() => gate.capture(old.credential), /AUTHORIZATION_EPOCH_REVOKED/);
  assert.throws(() => gate.invoke(captured, "apply_change"), /AUTHORIZATION_EPOCH_REVOKED/);
  gate.invoke(gate.capture(next.credential), "apply_change");
  assert.deepEqual(gate.commits, [{ epochId: next.epochId, authorityRequestId: "new-request" }]);
});

test("read-only reuse cannot regain mutation authority and claimed contexts are rejected", () => {
  const gate = new EpochFixture(); const epoch = gate.issue("request");
  const context = gate.capture(epoch.credential);
  gate.setState(epoch.credential, "read_only");
  assert.equal(gate.invoke(context, "read_context").fixtureOnly, true);
  assert.throws(() => gate.invoke(context, "control_execution"), /AUTHORIZATION_EPOCH_READ_ONLY/);
  assert.throws(() => gate.setState(epoch.credential, "active"), /FIXTURE_STATE_REGRESSION/);
  assert.throws(() => gate.invoke({ ...context }, "apply_change"), /FIXTURE_CAPTURE_FORGED/);
  assert.equal(gate.commits.length, 0);
});

test("a failed executable spawn closes without leaving the probe waiting", async () => {
  const child = new ProbeClient("/does-not-exist-openslate-probe", [], "/tmp", {});
  await assert.rejects(child.request("initialize", {}), /ENOENT/);
  await child.close();
});

function fakeClient(servers, credential) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/probe/fake-mcp.js", import.meta.url))], {
    env: { OPENSLATE_PROBE_CREDENTIAL: credential, OPENSLATE_PROBE_ENDPOINT: servers.bridgeUrl }, stdio: "pipe",
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map(); let id = 0;
  lines.on("line", line => {
    const message = JSON.parse(line); const item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); item.resolve(message.result); }
  });
  return {
    request(method, params) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Fixture MCP timeout")), 5_000);
        pending.set(requestId, { resolve, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
      });
    },
    async close() { const stopped = once(child, "exit"); child.stdin.end(); await stopped; lines.close(); },
  };
}

test("fixed MCP process credentials reject late calls and model-claimed authority", async t => {
  const gate = new EpochFixture();
  let servers;
  try { servers = await createFixtureServers(gate); }
  catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") { t.skip("Environment denies local fixture listeners"); return; }
    throw error;
  }
  const old = gate.issue("original"); const clients = [fakeClient(servers, old.credential)];
  const first = clients[0];
  try {
    await first.request("initialize", { protocolVersion: "2024-11-05" });
    const catalog = await first.request("tools/list", {});
    assert.deepEqual(catalog.tools.map(tool => tool.name), FIXTURE_TOOLS);
    const call = (client, tool, args = {}) => client.request("tools/call", { name: tool, arguments: args });
    const rejected = await call(first, "apply_change", { authorityRequestId: "invented" });
    assert.equal(rejected.isError, true); assert.equal(gate.commits.length, 0);
    const accepted = await call(first, "apply_change");
    assert.match(accepted.content[0].text, /original/); assert.equal(gate.commits.length, 1);
    gate.setState(old.credential, "revoked");
    const next = gate.issue("replacement"); clients.push(fakeClient(servers, next.credential));
    const late = await call(first, "apply_change");
    assert.match(late.content[0].text, /AUTHORIZATION_EPOCH_REVOKED/);
    const fresh = await call(clients[1], "apply_change");
    assert.match(fresh.content[0].text, /replacement/);
    assert.equal(gate.commits.length, 2); assert.deepEqual(servers.providerRequests, []);
  } finally {
    await Promise.all(clients.map(client => client.close())); await servers.close();
  }
});

test("opt-in native Codex probe never starts a model turn", {
  skip: !process.env.OPENSLATE_CODEX_PROBE_BINARY,
  timeout: 90_000,
}, async () => {
  const report = await runProbe(process.env.OPENSLATE_CODEX_PROBE_BINARY);
  assert.ok(report.version, JSON.stringify(report.checks));
  assert.equal(report.safety.turnStartSent, false);
  assert.equal(report.safety.realAuthProvided, false);
  assert.deepEqual(report.safety.providerRequests, []);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.filter(check => check.status === "failed").length, 0, JSON.stringify(report.checks));
  for (const name of ["initialize", "fixed_mcp_catalog", "fake_mcp_old_credential_rejected", "fake_mcp_replacement_epoch"])
    assert.equal(report.checks.find(check => check.name === name)?.status, "passed", name);
});
