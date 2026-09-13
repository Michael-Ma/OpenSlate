import test from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { canonical, digest } from "@openslate/core";
import { OwnedTranscriptionService } from "../dist/narration/owned-transcription-service.js";
import { ownedTranscriptionFixture, key, draft, rows, bodies, transcriptionProfile } from "./owned-transcription-fixture.mjs";
import { generatedNarrationFixture, selection } from "./generated-narration-fixture.mjs";

const unchangedKinds = ["grant", "candidate", "attempt", "reservation", "external_allowance", "external_allowance_consumption", "logical_ids",
  "stage", "hold", "execution_control", "node_binding", "plan", "narration_state", "narration_segment", "narration_audio", "narration_cue", "narration_acceptance", "narration_revision", "narration_canonical"];
const unchanged = f => canonical({ project: f.store.getProject(f.project.id), bodies: bodies(f, unchangedKinds) });
const allRows = f => ["projects", "entities", "commands", "events"].map(table => canonical(f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const noProposal = f => { assert.equal(rows(f, "owned_transcription_source").length, 0); assert.equal(rows(f, "owned_transcription_proposal").length, 0); };
function latch() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function suspendVerification(f) {
  const entered = latch(), released = latch(), original = f.media.verifiedSource.bind(f.media); let verified, signal;
  f.media.verifiedSource = async (...args) => { signal = args[1]?.signal; verified = await original(...args); entered.release(); await released.promise; return verified; };
  return { entered: entered.promise, release: released.release, get verified() { return verified; }, get signal() { return signal; } };
}
async function whileVerifying(f, mutate, expected, input = f.input(), options = {}) {
  const gate = suspendVerification(f), running = f.prepare(input, options);
  try { await gate.entered; await mutate(gate); gate.release(); await assert.rejects(running, expected); }
  finally { gate.release(); await running.catch(() => {}); }
  noProposal(f);
}

for (const invalid of ["unknown_profile", "wrong_kind", "unsupported_model", "unsupported_language"])
test(`preflight rejects ${invalid} before any owned media read or state change`, async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(); let reads = 0;
  if (invalid === "unknown_profile") input.profileId = "not-installed";
  if (invalid === "wrong_kind") input.profileId = "fake-image-v1";
  if (invalid === "unsupported_language") input.language = "invented-language";
  if (invalid === "unsupported_model") {
    const lock = f.store.get("capability_lock", f.project.capabilityLockId);
    lock.profiles.find(profile => profile.id === f.profile.id).configuration.model = "unsupported-model";
    f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?").run(canonical(lock), lock.id);
  }
  f.media.verifiedSource = () => { reads++; throw Error("invalid options must not reach media"); };
  const before = allRows(f), code = invalid === "unsupported_model" ? "AUDIO_PREFLIGHT_INVALID"
    : invalid === "unsupported_language" ? "AUDIO_PREFLIGHT_INVALID" : "OWNED_TRANSCRIPTION_INVALID";
  await assert.rejects(f.prepare(input), { code }); assert.equal(reads, 0); assert.deepEqual(allRows(f), before); noProposal(f);
});

for (const change of ["head", "cancel"])
test(`the service fences a ${change} change after the actual composition result exists`, { timeout: 15000 }, async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(), controller = new AbortController(), original = Worker.prototype.on;
  let intercepted = false, beforeReturn;
  // Each test file has its own Node test process. Intercept only the first real
  // composition message, mutate synchronously, then release that exact message.
  t.mock.method(Worker.prototype, "on", function (event, listener) {
    if (event !== "message") return original.call(this, event, listener);
    return original.call(this, event, function (message) {
      if (!intercepted && message.ok && message.plan?.nodes.some(node => node.applicationInput)) {
        intercepted = true;
        if (change === "head") { const p = f.store.getProject(f.project.id); f.store.saveProject({ ...p, brief: "Changed after composition" }, p.headVersion); }
        else controller.abort();
        beforeReturn = allRows(f);
      }
      listener.call(this, message);
    });
  });
  await assert.rejects(f.prepare(input, { signal: controller.signal }), { code: change === "head" ? "REVISION_CONFLICT" : "OWNED_TRANSCRIPTION_CANCELLED" });
  assert.equal(intercepted, true); assert.deepEqual(allRows(f), beforeReturn); noProposal(f);
  assert.equal(f.store.get("artifact", f.audio.id), undefined); assert.equal(f.store.get("message", f.actor.requestId).state, "active");
});

test("upload-first preparation publishes only an immutable ungranted proposal and source binding", async t => {
  const f = await ownedTranscriptionFixture(t); f.engine.setHold(f.project.id, { scopeId: f.project.id, ownerId: f.human.requestId });
  f.media.describeTranscriptionAudio = () => { throw Error("proposal must not prepare a derivative"); };
  f.media.deriveTranscriptionAudio = () => { throw Error("proposal must not convert"); };
  const before = unchanged(f), input = f.input(), events = f.store.cursor(f.project.id), proposal = await f.prepare(input);
  assert.equal(unchanged(f), before); assert.equal(f.provider.acceptedCount(), 0);
  assert.equal(f.view().segments.length, 0); assert.equal(f.store.getProject(f.project.id).artifacts.length, 0);
  assert.equal(proposal.state, "ungranted"); assert.equal(proposal.basePlan, null); assert.equal(proposal.inputDigest, digest(input));
  assert.deepEqual(proposal.compiled.nodes.map(node => node.kind), ["transcription"]);
  const binding = f.store.get("owned_transcription_source", proposal.sourceBinding.id), node = proposal.compiled.nodes[0];
  assert.equal(proposal.sourceBinding.digest, digest(binding)); assert.equal(binding.sourceRecord.digest, digest(f.audio));
  assert.deepEqual(binding.target, { kind: "recording" }); assert.equal(binding.sourceStartSample, 0); assert.equal(binding.sourceEndSample, f.source.probe.audio.samples);
  assert.deepEqual(node.applicationInput, { kind: "owned_transcription", id: binding.id, digest: digest(binding) });
  assert.deepEqual(node.inputs[0].source.artifact, binding.artifact); assert.equal(node.args.language, "auto"); assert.equal(node.args.timing, "word");
  assert.equal(f.store.cursor(f.project.id), events + 1); assert.equal(f.store.readEvents(f.project.id, events)[0].kind, "narration.transcription_proposed");
  const artifact = f.store.get("artifact", f.audio.id); assert.equal(digest(artifact), binding.artifactRecordDigest);
  assert.deepEqual(await readFile(artifact.path), await readFile((await f.media.verifiedSource(f.source)).path));
  assert.deepEqual(rows(f, "owned_transcription_proposal"), [proposal]);
  assert.throws(() => f.store.put("owned_transcription_proposal", proposal.id, f.project.id, { ...proposal, state: "granted" }));
});

test("a full active two-shot plan retains every prior node, gate and returned render without changing global state", async t => {
  const f = await ownedTranscriptionFixture(t, { plan: true }), current = f.store.getProject(f.project.id), base = f.store.get("plan", current.activePlanId).compiled;
  const before = unchanged(f), proposal = await f.prepare();
  assert.equal(unchanged(f), before); assert.deepEqual(proposal.compiled.nodes.filter(node => node.alias !== proposal.operation.alias), base.nodes); assert.deepEqual(proposal.compiled.gates, base.gates);
  assert.equal(proposal.compiled.nodes.length, 7); assert.equal(proposal.compiled.gates.length, 2);
  assert.equal(proposal.compiled.canonicalSource.split("\n").find(line => line.trim().startsWith("return")), base.canonicalSource.split("\n").find(line => line.trim().startsWith("return")));
  assert.deepEqual(proposal.basePlan, { id: current.activePlanId, digest: digest(base) });
  assert.equal(rows(f, "candidate").length, 4); assert.equal(rows(f, "attempt").length, 0);
});

test("standalone recording and exact section targets stay explicit even when two sections use the same audio", async t => {
  const f = await ownedTranscriptionFixture(t, { section: true }), before = unchanged(f);
  const standalone = await f.prepare(f.input({ target: { kind: "recording" } })), selected = await f.prepare();
  assert.deepEqual(f.store.get("owned_transcription_source", standalone.sourceBinding.id).target, { kind: "recording" });
  const target = f.store.get("owned_transcription_source", selected.sourceBinding.id).target, entry = f.view().segments[0].entry;
  assert.deepEqual(target, { kind: "section", narrationRevisionId: f.view().state.revisionId, segmentId: entry.segmentId, segmentRevisionId: entry.segmentRevisionId, audioId: f.audio.id });
  assert.equal(unchanged(f), before); assert.equal(rows(f, "narration_acceptance").length, 0);
  await assert.rejects(f.prepare(f.input({ target: { kind: "section", segmentId: entry.segmentId, segmentRevisionId: f.view().segments[1].script.id, audioId: f.audio.id } })), { code: "OWNED_TRANSCRIPTION_STALE" });
});

test("exact command replay precedes missing files and later state, while changed input still conflicts", async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(), proposal = await f.prepare(input);
  const file = (await f.media.verifiedSource(f.source)).path; await unlink(file);
  const current = f.store.getProject(f.project.id); f.store.saveProject({ ...current, brief: "Later project state" }, current.headVersion);
  f.media.verifiedSource = () => { throw Error("replay must not read media"); }; const before = allRows(f);
  assert.deepEqual(await f.prepare(input), proposal); assert.deepEqual(allRows(f), before);
  await assert.rejects(f.prepare({ ...input, language: "en" }), { code: "IDEMPOTENCY_CONFLICT" }); assert.deepEqual(allRows(f), before);
});

test("even an exact replay cannot borrow a superseding request's authority", async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(); await f.prepare(input);
  f.production.beginRequest(f.project.id, "human", "A new request replaces the original");
  const before = allRows(f); await assert.rejects(f.prepare(input), { code: "EPOCH_REVOKED" }); assert.deepEqual(allRows(f), before);
});

test("original actor, input, source descriptor and artifact directory are captured before asynchronous verification", async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(), originalInput = structuredClone(input), gate = suspendVerification(f);
  const controller = new AbortController(), options = { signal: controller.signal }, running = f.prepare(input, options);
  try {
    await gate.entered; assert.equal(gate.signal, controller.signal);
    input.audioId = "replacement"; input.language = "fr"; input.target.kind = "section"; f.actor.principalId = "replacement";
    f.audio.media.sha256 = "f".repeat(64); f.service.artifactDir = join(f.parent, "replacement-artifacts"); options.signal = new AbortController().signal;
    gate.release(); const proposal = await running;
    assert.equal(proposal.inputDigest, digest(originalInput)); assert.equal(proposal.principalId, f.human.principalId); assert.equal(proposal.operation.language, "auto");
    assert.equal(f.store.get("artifact", originalInput.audioId).path.startsWith(f.artifactDir + "/"), true);
  } finally { gate.release(); await running.catch(() => {}); }
});

test("original cancellation survives options replacement and publishes no SQL proposal", async t => {
  const f = await ownedTranscriptionFixture(t), controller = new AbortController(), options = { signal: controller.signal }, before = allRows(f);
  await whileVerifying(f, () => { options.signal = new AbortController().signal; controller.abort(); }, { code: "OWNED_TRANSCRIPTION_CANCELLED" }, f.input(), options);
  assert.deepEqual(allRows(f), before);
});

for (const change of ["request", "head", "lock", "source_record", "section", "artifact", "stage"])
test(`a concurrent ${change} change fences publication after asynchronous source verification`, async t => {
  const f = await ownedTranscriptionFixture(t, { section: change === "section" });
  const expected = { request: "EPOCH_REVOKED", head: "REVISION_CONFLICT", lock: "CAPABILITY_MISMATCH", source_record: "OWNED_TRANSCRIPTION_STALE",
    section: "OWNED_TRANSCRIPTION_STALE", artifact: "OWNED_TRANSCRIPTION_STALE", stage: "STAGE_BINDING_CONFLICT" }[change];
  await whileVerifying(f, () => {
    if (change === "request") f.production.beginRequest(f.project.id, "human", "Replacement request");
    if (change === "head") { const p = f.store.getProject(f.project.id); f.store.saveProject({ ...p, brief: "Concurrent edit" }, p.headVersion); }
    if (change === "lock") f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.recipeDigest',?) WHERE kind='capability_lock' AND id=?").run("f".repeat(64), f.project.capabilityLockId);
    if (change === "source_record") f.store.db.prepare("UPDATE entities SET body=json_set(body,'$.declaredOrigin','generated') WHERE kind='narration_audio' AND id=?").run(f.audio.id);
    if (change === "section") f.revise({ update: [{ segmentId: f.view().segments[0].entry.segmentId, draft: draft("Selected section changed") }] });
    if (change === "artifact") f.store.insert("artifact", f.audio.id, f.project.id, { id: f.audio.id, projectId: f.project.id,
      artifact: { artifactId: f.audio.id, sha256: f.source.sha256, kind: "audio" }, fixture: false, attemptId: null, path: "/conflicting/artifact.wav", mimeType: "audio/wav" });
    if (change === "stage") { const id = digest({ projectId: f.project.id, stageId: "narration", scopeId: f.project.id }); f.store.put("stage", id, f.project.id, { id, bindingVersion: 1 }); }
  }, { code: expected });
});

test("changed normalized source bytes cannot publish a descriptor-only proposal", async t => {
  const f = await ownedTranscriptionFixture(t);
  await whileVerifying(f, async gate => { const bytes = await readFile(gate.verified.path); bytes[bytes.length - 1] ^= 1; await chmod(gate.verified.path, 0o644); await writeFile(gate.verified.path, bytes); },
    { code: "NARRATION_ARTIFACT_INVALID" });
});

test("replacing the selected recording with an equal-byte take still invalidates the exact section target", async t => {
  const f = await ownedTranscriptionFixture(t, { section: true }), alternate = await f.narration.importAudio(f.project.id, f.human, { path: f.originalPath, declaredOrigin: "uploaded", key: key() });
  assert.equal(alternate.media.sha256, f.audio.media.sha256); assert.notEqual(alternate.id, f.audio.id);
  await whileVerifying(f, () => f.bind(0, alternate.id), { code: "OWNED_TRANSCRIPTION_STALE" });
});

test("an unrelated section edit does not invalidate the selected section and original recording", async t => {
  const f = await ownedTranscriptionFixture(t, { section: true }), input = f.input(), gate = suspendVerification(f), running = f.prepare(input);
  try {
    await gate.entered; f.revise({ update: [{ segmentId: f.view().segments[1].entry.segmentId, draft: draft("Only the unrelated section changes") }] });
    const before = unchanged(f); gate.release(); const proposal = await running; assert.equal(unchanged(f), before);
    assert.equal(f.store.get("owned_transcription_source", proposal.sourceBinding.id).target.segmentRevisionId, input.target.segmentRevisionId);
  } finally { gate.release(); await running.catch(() => {}); }
});

for (const failure of ["event", "command"])
test(`a final ${failure} failure rolls back artifact, source, proposal and command publication together`, async t => {
  const f = await ownedTranscriptionFixture(t), input = f.input(), before = allRows(f);
  if (failure === "event") {
    const original = f.store.appendEvent.bind(f.store);
    t.mock.method(f.store, "appendEvent", (...args) => { if (args[1] === "narration.transcription_proposed") throw Error("injected event publication failure"); return original(...args); });
  } else f.store.db.exec("CREATE TEMP TRIGGER reject_proposal_command BEFORE INSERT ON commands WHEN NEW.actor_scope LIKE '%:owned-transcription:%' BEGIN SELECT RAISE(FAIL,'injected command publication failure'); END");
  await assert.rejects(f.prepare(input), /injected .*publication failure/); assert.deepEqual(allRows(f), before); noProposal(f);
  assert.equal(f.store.get("artifact", f.audio.id), undefined);
  if (failure === "event") t.mock.restoreAll(); else f.store.db.exec("DROP TRIGGER reject_proposal_command");
  const proposal = await f.prepare(input); assert.equal(proposal.state, "ungranted"); assert.equal(f.provider.acceptedCount(), 0);
});

test("a retained generated narration row keeps its speech and normalization provenance without a new call", async t => {
  const f = await generatedNarrationFixture(t, { extraProfiles: [structuredClone(transcriptionProfile)] });
  await f.narration.attachGeneratedAudio(f.project.id, f.human, selection(f));
  // This older fixture installs its speech plan directly through Engine. Establish
  // the current immutable application revision through a real application edit.
  const revision = await f.production.prepare(f.project.id, f.human, { variant: "project",
    expectedHeadVersion: f.store.getProject(f.project.id).headVersion, creative: { brief: "Retain the generated recording." } });
  f.production.apply(f.project.id, f.human, revision.id);
  const service = new OwnedTranscriptionService(f.narration, join(f.root, "artifacts")), audio = f.view().segments[0].audio;
  const before = unchanged(f), calls = { ...f.calls }, artifact = canonical(f.store.get("artifact", audio.id));
  const proposal = await service.prepare(f.project.id, f.human, { key: key(), expectedHeadVersion: f.store.getProject(f.project.id).headVersion,
    audioId: audio.id, sourceRecordDigest: digest(audio), profileId: transcriptionProfile.id, language: "auto", target: { kind: "recording" } });
  assert.equal(unchanged(f), before); assert.deepEqual(f.calls, calls); assert.equal(canonical(f.store.get("artifact", audio.id)), artifact);
  const binding = f.store.get("owned_transcription_source", proposal.sourceBinding.id);
  assert.equal(binding.sourceRecord.digest, digest(audio)); assert.equal(binding.artifactRecordDigest, digest(f.store.get("artifact", audio.id)));
});
