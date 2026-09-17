import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { CodexDirectorRuntime, FakeDirectorRuntime } from "../dist/index.js";
import { FIXTURE_DEADLINE_MS, PROTOCOL_FIXTURE_LIMITS } from "./fixture-timing.mjs";

const entry = fileURLToPath(new URL("runtime-fixture.mjs", import.meta.url));
const bridgeEntry = fileURLToPath(new URL("../dist/tools/mcp.js", import.meta.url));
const hash = value => createHash("sha256").update(value).digest("hex");
const code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const deadline = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture timed out")), FIXTURE_DEADLINE_MS); })]); }
  finally { clearTimeout(timer); }
};

async function fixture(t, scenario = "complete", overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "openslate-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { projectId: "project-1", requestId: "request-1", epochId: "epoch-1", turnId: "application-turn-1",
    text: "Prepare this synthetic story", context: "{\"headVersion\":3,\"source\":\"canonical\"}",
    skills: [{ name: "openslate-director", path: join(root, "SKILL.md") }],
    bridge: { endpoint: "http://127.0.0.1:12345", projectId: "project-1", credential: randomBytes(32).toString("base64url"), entrypoint: bridgeEntry } };
  const options = { command: { file: process.execPath, args: [entry] }, cwd: root,
    env: { FIXTURE_SCENARIO: scenario, FIXTURE_LOG: join(root, "protocol.jsonl"), FIXTURE_SKILLS: JSON.stringify(input.skills) },
    model: "fake-model", runtimeVersion: "0.153.4",
    // Local native trust is explicit; fake protocol tests are not independent isolation proof.
    policy: { mode: "local", id: "fixture", runtimeVersion: "0.153.4",
      config: { default_permissions: "fixture", permissions: { fixture: { network: { enabled: false }, filesystem: { "/": "none" } } } } },
    limits: { ...PROTOCOL_FIXTURE_LIMITS },
    ...overrides };
  const records = async () => { try { return (await readFile(options.env.FIXTURE_LOG, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; } };
  return { input, options, records, runtime: new CodexDirectorRuntime(options) };
}

test("native launch requires an explicit local policy and exact runtime version", async t => {
  const f = await fixture(t);
  assert.throws(() => new CodexDirectorRuntime({ ...f.options, policy: undefined }), code("RUNTIME_POLICY_REQUIRED"));
  for (const mode of ["remote", "multi_host", "externally_confined"])
    assert.throws(() => new CodexDirectorRuntime({ ...f.options, policy: { ...f.options.policy, mode } }), code("RUNTIME_MODE_UNSUPPORTED"));
  assert.throws(() => new CodexDirectorRuntime({ ...f.options, runtimeVersion: "0.154.0" }), code("RUNTIME_POLICY_INVALID"));
  assert.throws(() => new CodexDirectorRuntime({ ...f.options, runtimeVersion: "0.154.0",
    policy: { ...f.options.policy, runtimeVersion: "0.154.0" } }), code("RUNTIME_VERSION_UNSUPPORTED"));
  assert.deepEqual(await f.records(), []);
});

test("native bridge rejects remote or wildcard hosts before process launch", async t => {
  const f = await fixture(t);
  for (const endpoint of ["http://192.0.2.1:12345", "http://0.0.0.0:12345", "https://example.com:12345"])
    await assert.rejects(f.runtime.start({ ...f.input, bridge: { ...f.input.bridge, endpoint } }), code("BRIDGE_ENDPOINT_INVALID"));
  assert.deepEqual(await f.records(), []);
});

test("fixed launch, exact skills, canonical context and complete lifecycle are model-free", async t => {
  const f = await fixture(t), events = [];
  const originalCredential = f.input.bridge.credential;
  process.env.OPENSLATE_PARENT_SECRET = "never-inherit-this-value";
  t.after(() => { delete process.env.OPENSLATE_PARENT_SECRET; });
  const promise = f.runtime.start(f.input, { onEvent: event => { events.push(event); } });
  f.input.bridge.credential = randomBytes(32).toString("base64url");
  const result = await deadline(promise);
  assert.equal(result.status, "completed", result.error?.code); assert.equal(result.text, "Prepared safely. 你好 🟢");
  assert.equal(result.dispatched, true); assert.equal(result.turnId, f.input.turnId);
  assert.deepEqual(events.map(event => event.kind), ["runtime_started", "turn_started", "assistant_message"]);
  for (const event of events) assert.equal(event.epochId, f.input.epochId);
  const records = await f.records(), launch = records.find(row => row.kind === "launch");
  assert.equal(launch.credentialDigest, hash(originalCredential)); assert.equal(launch.parentSecretAbsent, true);
  const starts = records.filter(row => row.method === "turn/start"); assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].params.input, [{ type: "text", text: f.input.text }, { type: "skill", ...f.input.skills[0] }]);
  assert.equal(starts[0].params.additionalContext, undefined);
  assert.ok(records.find(row => row.method === "thread/start").params.developerInstructions.endsWith(f.input.context));
  assert.equal(starts[0].params.permissions, "fixture"); assert.equal(starts[0].params.approvalPolicy, "never");
});

test("v2 native launch discovers six locked tools and rejects an advertised legacy catalog", async t => {
  const f = await fixture(t), input = { ...f.input, bridge: { ...f.input.bridge, toolContractVersion: "2.0.0" } };
  assert.equal((await deadline(f.runtime.start(input))).status, "completed");
  const records = await f.records(); const config = records.find(row => row.method === "config/read"); assert.ok(config);
  const legacy = await fixture(t, "catalog-legacy"); legacy.input.bridge.toolContractVersion = "2.0.0";
  const failed = await deadline(legacy.runtime.start(legacy.input));
  assert.equal(failed.status, "failed"); assert.equal(failed.dispatched, false); assert.equal(failed.error.code, "RUNTIME_CATALOG_UNEXPECTED");
  assert.equal((await legacy.records()).some(row => row.method === "turn/start"), false);
});

for (const scenario of ["version-wrong", "missing-result", "skill-extra", "skills-error", "catalog-extra", "instructions-extra", "bridge-wrong", "permissions-wrong", "permissions-expanded", "permissions-defaults-expanded", "permissions-defaults-unknown"]) {
  test(`fail closed before dispatch: ${scenario}`, async t => {
    const f = await fixture(t, scenario);
    const result = await deadline(f.runtime.start(f.input));
    assert.equal(result.status, "failed"); assert.equal(result.dispatched, false);
    assert.equal((await f.records()).some(row => row.method === "turn/start"), false);
  });
}

test("dotted policy configuration normalizes before exact profile comparison", async t => {
  const f = await fixture(t);
  f.options.policy.config = { default_permissions: "fixture", "permissions.fixture.network": { enabled: false },
    "permissions.fixture.filesystem": { "/": "none" } };
  const result = await deadline(new CodexDirectorRuntime(f.options).start(f.input));
  assert.equal(result.status, "completed");
});

for (const scenario of ["early-events", "unicode-chunks", "permissions-defaults"]) {
  test(`protocol accepts ${scenario} without losing completion`, async t => {
    const f = await fixture(t, scenario), result = await deadline(f.runtime.start(f.input));
    assert.equal(result.status, "completed"); assert.match(result.text, /你好 🟢/);
  });
}

test("resume uses a fresh fixed epoch process and does not replay native history", async t => {
  const f = await fixture(t);
  const first = await deadline(f.runtime.start(f.input));
  const secondInput = { ...f.input, requestId: "request-2", turnId: "application-turn-2", epochId: "epoch-2",
    bridge: { ...f.input.bridge, credential: randomBytes(32).toString("base64url") }, resumeThreadId: first.nativeThreadId };
  const second = await deadline(f.runtime.start(secondInput));
  assert.equal(second.status, "completed"); assert.equal(second.epochId, "epoch-2");
  const records = await f.records(), launches = records.filter(row => row.kind === "launch");
  assert.equal(launches.length, 2); assert.notEqual(launches[0].pid, launches[1].pid);
  assert.notEqual(launches[0].credentialDigest, launches[1].credentialDigest);
  assert.equal(records.filter(row => row.method === "turn/start").length, 2);
  const resumed = records.find(row => row.method === "thread/resume");
  assert.equal(resumed.params.threadId, first.nativeThreadId); assert.equal(resumed.params.excludeTurns, true);
  assert.equal(records.some(row => row.method === "thread/read"), false);
});

test("abort before dispatch launches nothing", async t => {
  const f = await fixture(t), signal = AbortSignal.abort();
  const result = await deadline(f.runtime.start(f.input, { signal }));
  assert.equal(result.status, "interrupted"); assert.equal(result.dispatched, false); assert.deepEqual(await f.records(), []);
});

test("abort after dispatch confirms interruption and rejects concurrent project runs", async t => {
  const f = await fixture(t, "hang"), controller = new AbortController(), started = deferred();
  const promise = f.runtime.start(f.input, { signal: controller.signal, onEvent: event => { if (event.kind === "turn_started") started.resolve(); } });
  await deadline(Promise.race([started.promise, promise.then(result => { throw new Error(`Fixture ended before turn_started: ${result.error?.code ?? result.status}`); })]));
  await assert.rejects(f.runtime.start(f.input), code("RUNTIME_BUSY"));
  controller.abort(); const result = await deadline(promise);
  assert.equal(result.status, "interrupted"); assert.equal(result.dispatched, true);
  assert.equal((await f.records()).filter(row => row.method === "turn/interrupt").length, 1);
});

for (const scenario of ["crash", "invalid-utf8", "flood", "stderr-flood", "start-rejected"]) {
  test(`after dispatch ${scenario} preserves unknown completion without retry`, async t => {
    const f = await fixture(t, scenario);
    if (scenario.includes("flood")) f.options.limits.outputBytes = 20_000;
    const runtime = new CodexDirectorRuntime(f.options), events = [];
    const result = await deadline(runtime.start(f.input, { onEvent: event => { events.push(event); } }));
    assert.equal(result.status, "unknown"); assert.equal(result.dispatched, true);
    assert.equal((await f.records()).filter(row => row.method === "turn/start").length, 1);
    assert.equal(JSON.stringify({ result, events }).includes(f.input.bridge.credential), false);
  });
}

test("missing native interruption acknowledgment stays unknown and process is cleaned up", async t => {
  const f = await fixture(t, "interrupt-unconfirmed"), controller = new AbortController();
  const result = await deadline(f.runtime.start(f.input, { signal: controller.signal,
    onEvent: event => { if (event.kind === "turn_started") controller.abort(); } }));
  assert.equal(result.status, "unknown"); assert.equal(result.error.code, "RUNTIME_ABORTED");
  const launch = (await f.records()).find(row => row.kind === "launch");
  assert.throws(() => process.kill(launch.pid, 0), error => error.code === "ESRCH");
});

test("native input is surfaced, denied on its channel, and interrupts the run", async t => {
  const f = await fixture(t, "question"), events = [];
  const result = await deadline(f.runtime.start(f.input, { onEvent: event => { events.push(event); } }));
  assert.equal(result.status, "interrupted"); assert.equal(result.error.code, "RUNTIME_INPUT_REQUIRED");
  assert.equal(events.find(event => event.kind === "pending_input").questions[0].id, "tone");
  const response = (await f.records()).find(row => row.kind === "server-response");
  assert.equal(response.response.error.code, -32601); assert.equal(response.response.result, undefined);
});

test("interactive approval is never granted", async t => {
  const f = await fixture(t, "approval"), result = await deadline(f.runtime.start(f.input));
  assert.equal(result.status, "interrupted"); assert.equal(result.error.code, "RUNTIME_INTERACTIVE_DENIED");
  const response = (await f.records()).find(row => row.kind === "server-response");
  assert.equal(response.response.error.code, -32601);
});

test("a stalled startup respects the overall deadline without dispatch", async t => {
  const f = await fixture(t, "initialize-hang"); f.options.limits.runTimeoutMs = 120;
  const result = await deadline(new CodexDirectorRuntime(f.options).start(f.input));
  assert.equal(result.dispatched, false); assert.equal(result.status, "failed"); assert.equal(result.error.code, "RUNTIME_RUN_TIMEOUT");
});

test("event-consumer failure ends the run instead of silently dropping events", async t => {
  const f = await fixture(t, "hang");
  const result = await deadline(f.runtime.start(f.input, { onEvent: event => { if (event.kind === "turn_started") throw new Error("Fixture sink failed"); } }));
  assert.equal(result.status, "unknown"); assert.equal(result.error.code, "RUNTIME_EVENT_CONSUMER_FAILED");
});

test("noncooperative process is killed after the bounded cleanup grace", async t => {
  const f = await fixture(t, "ignore-shutdown"), controller = new AbortController();
  const result = await deadline(f.runtime.start(f.input, { signal: controller.signal,
    onEvent: event => { if (event.kind === "turn_started") controller.abort(); } }));
  assert.equal(result.status, "unknown");
  const launch = (await f.records()).find(row => row.kind === "launch");
  assert.throws(() => process.kill(launch.pid, 0), error => error.code === "ESRCH");
});

test("cleanup includes a native subprocess descendant", async t => {
  const f = await fixture(t, "descendant"), result = await deadline(f.runtime.start(f.input));
  assert.equal(result.status, "completed");
  const descendant = (await f.records()).find(row => row.kind === "descendant");
  assert.throws(() => process.kill(descendant.pid, 0), error => error.code === "ESRCH");
});

test("assistant output redacts the fixed bridge credential", async t => {
  const f = await fixture(t, "secret-message"), result = await deadline(f.runtime.start(f.input));
  assert.equal(result.text, "redact [redacted]");
});

test("fake runtime exposes an injectable handler, events and immutable request snapshot", async t => {
  const f = await fixture(t), events = [], received = deferred();
  const runtime = new FakeDirectorRuntime(async (input, options) => {
    assert.equal(input.bridge.credential, original);
    await options.onEvent({ projectId: input.projectId, epochId: input.epochId, requestId: input.requestId, turnId: input.turnId,
      kind: "assistant_message", text: "Fixture receipt", phase: "final" });
    received.resolve(); return { status: "completed", text: "Fixture receipt" };
  });
  const original = f.input.bridge.credential;
  const promise = runtime.start(f.input, { onEvent: event => { events.push(event); } }); f.input.bridge.credential = "mutated";
  const result = await deadline(promise); await received.promise;
  assert.equal(result.status, "completed"); assert.equal(result.dispatched, true); assert.equal(events.length, 1);
  assert.deepEqual(await f.records(), []);
});

test("fake runtime abort does not falsely claim an unresolved handler stopped", async t => {
  const f = await fixture(t), controller = new AbortController(), invoked = deferred();
  const runtime = new FakeDirectorRuntime(async (_input, options) => { invoked.resolve(options.signal); return new Promise(() => {}); });
  const promise = runtime.start(f.input, { signal: controller.signal }); const signal = await invoked.promise;
  controller.abort(); const result = await deadline(promise);
  assert.equal(signal.aborted, true); assert.equal(result.status, "unknown"); assert.equal(result.dispatched, true);
});

test("large required references survive start and resume outside the truncating hint channel", async t => {
  const f = await fixture(t);
  const contract = "Contract sentinel: approvedImage is a dependency, not approval.\n".repeat(400);
  const grammar = "Grammar sentinel: preserve saved aliases.\n".repeat(400);
  const context = headVersion => JSON.stringify({ snapshot: { headVersion }, references: [
    { skillId: "production", path: "references/current-contract.md", content: contract },
    { skillId: "plan-authoring", path: "references/grammar.md", content: grammar },
  ] });
  const firstInput = { ...f.input, context: context(3) };
  const first = await deadline(f.runtime.start(firstInput));
  assert.equal(first.status, "completed");
  const secondInput = { ...f.input, context: context(4), resumeThreadId: first.nativeThreadId,
    requestId: "request-2", epochId: "epoch-2", turnId: "turn-2" };
  assert.equal((await deadline(f.runtime.start(secondInput))).status, "completed");
  const records = await f.records();
  for (const [method, expected] of [["thread/start", firstInput.context], ["thread/resume", secondInput.context]]) {
    const instructions = records.find(row => row.method === method).params.developerInstructions;
    assert.ok(instructions.endsWith(expected));
    const delivered = JSON.parse(instructions.slice(instructions.length - expected.length));
    assert.equal(delivered.references[0].content, contract);
    assert.equal(delivered.references[1].content, grammar);
    assert.equal(delivered.snapshot.headVersion, method === "thread/start" ? 3 : 4);
  }
  for (const turn of records.filter(row => row.method === "turn/start")) assert.equal(turn.params.additionalContext, undefined);
});
