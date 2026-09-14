import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { digest, toolCatalog } from "@openslate/core";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ToolInvocationService } from "../dist/application/tool-invocations.js";
import { createDirectorSkillLock } from "../dist/application/director-capabilities.js";
import { DirectorContextService } from "../dist/application/director-context.js";
import { ownedTranscriptionFixture, bodies } from "./owned-transcription-fixture.mjs";
import { narrationSpeechFixture } from "./narration-speech-fixture.mjs";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const untouched = ["grant", "candidate", "attempt", "reservation", "external_allowance", "external_allowance_consumption", "narration_state", "narration_acceptance", "hold"];
function writable(path) { chmodSync(path, 0o700); for (const item of readdirSync(path, { withFileTypes: true })) if (item.isDirectory()) writable(join(path, item.name)); }
function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function lockFixture(t, f, version = "3.0.0") {
  const skills = mkdtempSync(join(tmpdir(), "openslate-v3-tool-skills-"));
  t.after(() => { writable(skills); rmSync(skills, { recursive: true, force: true }); });
  const configured = createDirectorSkillLock({ repositoryRoot, snapshotRoot: skills }, version);
  const contexts = new DirectorContextService(f.production, configured.environment);
  contexts.bootstrapLock(f.project.id, configured.lock); contexts.capture(f.project.id, f.actor, { lockId: configured.lock.id, selectedSkillIds: ["production", "plan-authoring"] });
  f.lock = configured.lock;
  f.args = () => { const { key: _key, ...input } = f.input(); return input; };
  return f;
}
async function fixture(t, options = {}) {
  const f = lockFixture(t, await ownedTranscriptionFixture(t, options), options.version);
  f.tools = new ToolInvocationService(f.production, { ownedTranscription: f.service }); return f;
}
const speechArgs = () => ({ expectedHeadVersion: 0, segmentId: "section", segmentRevisionId: "revision", profileId: "speech", voice: "coral", instructions: "" });
function controlledSpeech(f, prepare) { return { narration: f.narration, prepare }; }
function proposal(projectId, actor, input) { return { id: "controlled-proposal", version: 1, state: "ungranted", projectId,
  requestId: actor.requestId, principalId: actor.principalId, epochId: actor.epochId, inputDigest: digest(input) }; }

test("V3 prepares one actual owned recording on a full plan without generation or narration authority", async t => {
  const f = await fixture(t, { plan: true }), before = bodies(f, untouched), project = f.store.getProject(f.project.id);
  const result = await f.tools.invoke(f.project.id, f.actor, "prepare-once", "prepare_recording_transcription", f.args());
  const saved = f.store.get("owned_transcription_proposal", result.proposalId);
  assert.equal(result.kind, "recording_transcription"); assert.equal(result.state, "ungranted"); assert.equal(result.proposalDigest, digest(saved));
  assert.equal(Object.hasOwn(result, "preparedId"), false); assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024);
  for (const key of ["compiled", "sourceBinding", "path", "source"]) assert.equal(Object.hasOwn(result, key), false);
  assert.equal(saved.compiled.nodes.length, f.store.get("plan", project.activePlanId).compiled.nodes.length + 1);
  assert.equal(bodies(f, untouched), before); assert.deepEqual(f.store.getProject(f.project.id), project); assert.equal(f.provider.acceptedCount(), 0);
  await assert.rejects(f.tools.invoke(f.project.id, f.actor, "cannot-apply-proposal", "apply_change", { preparedId: result.proposalId }), { code: "ACTOR_DENIED" });
});

test("completed V3 call replays after database reopen without configured proposal tools or fresh local work", async t => {
  const f = await fixture(t), args = f.args(), saved = await f.tools.invoke(f.project.id, f.actor, "saved", "prepare_recording_transcription", args);
  f.store.close(); const reopened = new Store(join(f.root, "openslate.sqlite")); t.after(() => { if (reopened.db.open) reopened.close(); });
  const production = new ProductionService(reopened, new Engine(reopened, f.provider, { artifactDir: f.artifactDir, profiles: f.profiles }), f.profiles);
  const tools = new ToolInvocationService(production), cursor = reopened.cursor(f.project.id);
  assert.deepEqual(await tools.invoke(f.project.id, f.actor, "saved", "prepare_recording_transcription", args), saved);
  assert.equal(reopened.cursor(f.project.id), cursor); assert.equal(reopened.list("owned_transcription_proposal", f.project.id).length, 1);
  await assert.rejects(tools.invoke(f.project.id, f.actor, "saved", "prepare_recording_transcription", { ...args, language: "en" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("lost V3 domain response reconciles only the original exact keyed command after epoch fencing", async t => {
  const f = await fixture(t), original = f.service.prepare.bind(f.service); let calls = 0;
  f.service.prepare = async (...args) => { calls++; await original(...args); throw Error("Controlled reply loss"); };
  await assert.rejects(f.tools.invoke(f.project.id, f.actor, "lost", "prepare_recording_transcription", f.args()), { code: "TOOL_CALL_UNRESOLVED" });
  const saved = f.store.list("owned_transcription_proposal", f.project.id)[0]; assert.ok(saved);
  f.service.prepare = () => { throw Error("Reconciliation must never prepare again"); };
  f.production.beginRequest(f.project.id, "human", "Continue from saved proposal evidence");
  const tools = new ToolInvocationService(f.production); tools.reconcileEpoch(f.project.id, f.actor.epochId);
  const result = f.store.list("tool_reconciliation", f.project.id)[0]; assert.equal(result.state, "effect_confirmed");
  assert.equal(result.receipt.proposalId, saved.id); assert.equal(result.receipt.proposalDigest, digest(saved)); assert.equal(calls, 1);
  tools.reconcileEpoch(f.project.id, f.actor.epochId); assert.equal(f.store.list("tool_reconciliation", f.project.id).length, 1);
});

test("new V3 proposal identities cannot be selected through old locks or missing host ports", async t => {
  for (const version of ["1.0.0", "2.0.0"]) {
    const f = await fixture(t, { version }), cursor = f.store.cursor(f.project.id);
    for (const [name, args] of [["prepare_recording_transcription", f.args()], ["prepare_narration_speech", speechArgs()]])
      await assert.rejects(f.tools.invoke(f.project.id, f.actor, "denied", name, args), { code: "NOT_FOUND" });
    assert.equal(f.store.cursor(f.project.id), cursor);
  }
  const f = await fixture(t), tools = new ToolInvocationService(f.production), before = bodies(f, untouched);
  await assert.rejects(tools.invoke(f.project.id, f.actor, "missing", "prepare_narration_speech", speechArgs()), { code: "TOOL_CAPABILITY_UNAVAILABLE" });
  assert.equal(bodies(f, untouched), before);
});

test("actual recording preparation rejects read-only, stale epoch and foreign project callers", async t => {
  const f = await fixture(t), args = f.args();
  const other = f.production.createProject("Other");
  await assert.rejects(f.tools.invoke(other.id, f.actor, "foreign", "prepare_recording_transcription", args), { code: "ACTOR_DENIED" });
  const human = f.production.beginRequest(f.project.id, "human", "Read only", { editing: false }), bridge = f.production.openEpoch(f.project.id, human);
  f.store.insert("director_epoch_lock", bridge.actor.epochId, f.project.id, { id: bridge.actor.epochId, epochId: bridge.actor.epochId, projectId: f.project.id, requestId: human.requestId, lockId: f.lock.id });
  await assert.rejects(f.tools.invoke(f.project.id, bridge.actor, "readonly", "prepare_recording_transcription", args), { code: "ACTOR_DENIED" });
  f.production.beginRequest(f.project.id, "human", "Replace the original editing request.");
  await assert.rejects(f.tools.invoke(f.project.id, f.actor, "stale", "prepare_recording_transcription", args), { code: "EPOCH_REVOKED" });
  assert.equal(f.store.list("owned_transcription_proposal", f.project.id).length, 0);
});

test("V3 captures original actor, arguments, configured port and signal before asynchronous speech preparation", async t => {
  const f = await fixture(t), entered = latch(), gate = latch(), original = new AbortController(), replacement = new AbortController(); let captured;
  const port = controlledSpeech(f, async (projectId, actor, input, options) => { entered.release(); await gate.promise; captured = { actor, input, signal: options.signal }; return proposal(projectId, actor, input); });
  const config = { narrationSpeech: port }, tools = new ToolInvocationService(f.production, config), actor = structuredClone(f.actor), input = speechArgs(), options = { signal: original.signal };
  const pending = tools.invoke(f.project.id, actor, "speech-capture", "prepare_narration_speech", input, options); await entered.promise;
  actor.requestId = "replacement-request"; input.voice = "changed"; input.segmentRevisionId = "changed"; options.signal = replacement.signal;
  config.narrationSpeech = controlledSpeech(f, () => { throw Error("Replacement port"); }); replacement.abort(); gate.release();
  const result = await pending; assert.equal(result.kind, "narration_speech"); assert.equal(captured.actor.requestId, f.actor.requestId);
  assert.equal(captured.input.voice, "coral"); assert.equal(captured.input.segmentRevisionId, "revision"); assert.equal(captured.signal, original.signal);
  const invocation = f.store.list("tool_invocation", f.project.id)[0]; assert.equal(captured.input.key, `director-tool:${invocation.id}`);
  assert.equal(invocation.recovery.audioProposalCommand.digest, digest(captured.input)); assert.equal(invocation.catalogDigest, toolCatalog("3.0.0").digest);
});

test("original cancellation before dispatch writes no invocation and late cancellation remains reconcilable", async t => {
  const f = await fixture(t), original = new AbortController(); original.abort();
  await assert.rejects(f.tools.invoke(f.project.id, f.actor, "aborted", "prepare_recording_transcription", f.args(), { signal: original.signal }), { code: "TOOL_CALL_CANCELLED" });
  assert.equal(f.store.list("tool_invocation", f.project.id).length, 0);
  const entered = latch(), gate = latch(), active = new AbortController(), options = { signal: active.signal };
  const tools = new ToolInvocationService(f.production, { narrationSpeech: controlledSpeech(f, async (projectId, actor, input, call) => {
    entered.release(); await gate.promise; assert.equal(call.signal, active.signal); return proposal(projectId, actor, input);
  }) });
  const pending = tools.invoke(f.project.id, f.actor, "late-abort", "prepare_narration_speech", speechArgs(), options); await entered.promise;
  options.signal = new AbortController().signal; active.abort(); gate.release(); await assert.rejects(pending, { code: "TOOL_CALL_UNRESOLVED" });
  assert.equal(f.store.list("tool_invocation", f.project.id)[0].state, "unresolved");
});

test("wrong proposal authorship is unresolved and foreign services cannot become V3 tool dependencies", async t => {
  const f = await fixture(t), tools = new ToolInvocationService(f.production, { narrationSpeech: controlledSpeech(f,
    async (projectId, actor, input) => ({ ...proposal(projectId, actor, input), requestId: "other-request" })) });
  await assert.rejects(tools.invoke(f.project.id, f.actor, "wrong-receipt", "prepare_narration_speech", speechArgs()), { code: "TOOL_CALL_UNRESOLVED" });
  assert.equal(f.store.list("tool_invocation", f.project.id)[0].state, "unresolved");
  assert.throws(() => new ToolInvocationService(f.production, { narrationSpeech: { narration: { production: {} } } }), { code: "TOOL_CONFIGURATION_INVALID" });
});


test("V3 prepares actual saved section speech without replacing writing, applying the plan or accessing credentials", async t => {
  const f = lockFixture(t, await narrationSpeechFixture(t, { plan: true })), before = bodies(f, untouched), project = f.store.getProject(f.project.id);
  const tools = new ToolInvocationService(f.production, { narrationSpeech: f.service }), args = f.args();
  const result = await tools.invoke(f.project.id, f.actor, "actual-speech", "prepare_narration_speech", args);
  const saved = f.store.get("narration_speech_proposal", result.proposalId);
  assert.equal(saved.operation.text, f.view().segments[0].script.text); assert.equal(saved.operation.voice, args.voice);
  assert.equal(saved.section.segmentRevisionId, args.segmentRevisionId); assert.equal(saved.compiled.nodes.length,
    f.store.get("plan", project.activePlanId).compiled.nodes.length + 1);
  assert.equal(result.kind, "narration_speech"); assert.equal(result.proposalDigest, digest(saved)); assert.equal(Object.hasOwn(result, "preparedId"), false);
  assert.equal(bodies(f, untouched), before); assert.deepEqual(f.store.getProject(f.project.id), project);
  assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(f.provider.acceptedCount(), 0);
  const cursor = f.store.cursor(f.project.id); assert.deepEqual(await tools.invoke(f.project.id, f.actor, "actual-speech", "prepare_narration_speech", args), result);
  assert.equal(f.store.cursor(f.project.id), cursor);
});

test("cancelled actual speech response recovers only its saved command and immutable proposal without preparing again", async t => {
  const f = lockFixture(t, await narrationSpeechFixture(t)), original = f.service.prepare.bind(f.service), cancel = new AbortController(); let calls = 0;
  f.service.prepare = async (...args) => { calls++; const saved = await original(...args); cancel.abort(); return saved; };
  const tools = new ToolInvocationService(f.production, { narrationSpeech: f.service });
  await assert.rejects(tools.invoke(f.project.id, f.actor, "speech-reply-lost", "prepare_narration_speech", f.args(), { signal: cancel.signal }), { code: "TOOL_CALL_UNRESOLVED" });
  const saved = f.store.list("narration_speech_proposal", f.project.id)[0]; assert.ok(saved);
  f.production.beginRequest(f.project.id, "human", "Continue from the saved speech proposal.");
  f.service.prepare = () => { throw Error("Never prepare from receipt reconciliation"); };
  new ToolInvocationService(f.production).reconcileEpoch(f.project.id, f.actor.epochId);
  const receipt = f.store.list("tool_reconciliation", f.project.id)[0]; assert.equal(receipt.state, "effect_confirmed");
  assert.equal(receipt.receipt.proposalId, saved.id); assert.equal(receipt.receipt.proposalDigest, digest(saved)); assert.equal(calls, 1);
  assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});
