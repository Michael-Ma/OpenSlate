import test from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "@openslate/core";
import { narrationSpeechFixture, key, draft, rows, bodies } from "./narration-speech-fixture.mjs";
import { assertNarrationSpeechProposal } from "../dist/narration/narration-speech-records.js";
import { resolveNarrationSpeechApplication } from "../dist/narration/narration-speech-authorization.js";

const authority = ["grant", "candidate", "prepared", "narration_speech_review", "narration_speech_application", "external_allowance", "external_allowance_consumption", "attempt", "reservation"];
const narration = ["narration_state", "narration_segment", "narration_revision", "narration_audio", "narration_acceptance", "narration_cue", "narration_canonical"];
const data = f => ["projects", "entities", "commands", "events"].map(table => canonical(f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const edit = (f, index = 0, value = draft("Changed saved words.")) => f.revise({ update: [{ segmentId: f.view().segments[index].entry.segmentId, draft: value }] });
function barrier(f) {
  const original = f.service.compose.bind(f.service); let release, entered, originalSignal;
  const wait = new Promise(done => { release = done; }), ready = new Promise(done => { entered = done; });
  f.service.compose = async (...args) => { originalSignal = args[3]?.signal; const result = await original(...args); entered(); await wait; return result; };
  return { ready, release, get signal() { return originalSignal; } };
}

test("preparation pins exact saved draft and full graph, without changing authority, narration, head or global IDs", async t => {
  const f = await narrationSpeechFixture(t, { plan: true }), before = f.store.getProject(f.project.id), protectedRows = bodies(f, [...authority, ...narration, "logical_ids", "stage"]);
  const base = f.store.get("plan", before.activePlanId).compiled, input = f.input(), proposal = await f.prepare(input);
  assert.equal(proposal.state, "ungranted"); assert.equal(proposal.inputDigest, digest(input)); assert.equal(proposal.operation.text, f.view().segments[0].script.text);
  assert.equal(proposal.operation.voice, input.voice); assert.equal(proposal.operation.instructions, input.instructions);
  assert.deepEqual(proposal.compiled.nodes.filter(node => node.alias !== proposal.operation.alias), base.nodes); assert.deepEqual(proposal.compiled.gates, base.gates);
  assert.equal(proposal.compiled.canonicalSource.split("\n").find(line => line.trim().startsWith("return")), base.canonicalSource.split("\n").find(line => line.trim().startsWith("return")));
  assert.equal(bodies(f, [...authority, ...narration, "logical_ids", "stage"]), protectedRows); assert.deepEqual(f.store.getProject(f.project.id), before);
  assert.equal(f.calls.http, 0); assert.equal(f.provider.acceptedCount(), 0); assertNarrationSpeechProposal(f.store, f.project.id, proposal);
});

for (const actor of ["human", "director"]) test(`${actor} may prepare; only human review creates one separate purpose grant`, async t => {
  const f = await narrationSpeechFixture(t), proposal = await f.service.prepare(f.project.id, actor === "human" ? f.human : f.actor, f.input());
  const before = bodies(f, narration); assert.equal(rows(f, "grant").length, 0);
  await assert.rejects(f.service.review(f.project.id, f.actor, { key: key(), proposalId: proposal.id, proposalDigest: digest(proposal) }), { code: "ACTOR_DENIED" });
  const applied = await f.review(proposal), chain = resolveNarrationSpeechApplication(f.store, f.project.id, applied.candidateId);
  assert.equal(chain.review.id, applied.grantId); assert.deepEqual(chain.review.section, proposal.section); assert.equal(chain.application.id, applied.candidateId);
  assert.equal(rows(f, "grant").length, 1); assert.equal(rows(f, "candidate").length, 1); assert.equal(bodies(f, narration), before);
  for (const kind of ["external_allowance", "external_allowance_consumption", "attempt", "reservation"]) assert.equal(rows(f, kind).length, 0, kind);
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.equal(rows(f, "attempt").length, 0);
});

for (const [name, change, code] of [
  ["replacement text", f => f.input({ text: "Unreviewed replacement" }), "NARRATION_SPEECH_INVALID"],
  ["unsupported voice", f => f.input({ voice: "arbitrary-voice" }), "AUDIO_PREFLIGHT_INVALID"],
  ["stale saved revision", f => f.input({ segmentRevisionId: key() }), "NARRATION_SPEECH_STALE"],
  ["long delivery instructions", f => f.input({ instructions: "x".repeat(257) }), "NARRATION_SPEECH_DELIVERY_LIMIT"],
]) test(`preparation rejects ${name} without writing any proposal or authority`, async t => {
  const f = await narrationSpeechFixture(t), before = data(f); await assert.rejects(f.prepare(change(f)), { code }); assert.deepEqual(data(f), before);
});

for (const [name, value, code] of [
  ["uploaded source", { ...draft(), source: { kind: "uploaded" } }, "NARRATION_SPEECH_INVALID"],
  ["saved voice mismatch", draft(undefined, { voice: "alloy" }), "NARRATION_SPEECH_SOURCE_MISMATCH"],
  ["saved profile revision mismatch", draft(undefined, { profileRevisionId: "other-revision" }), "NARRATION_SPEECH_SOURCE_MISMATCH"],
  ["oversize section", draft("字".repeat(700)), "NARRATION_SPEECH_SPLIT_REQUIRED"],
]) test(`preparation rejects ${name} and never silently rewrites or splits saved writing`, async t => {
  const f = await narrationSpeechFixture(t); edit(f, 0, value); const before = data(f);
  await assert.rejects(f.prepare(), { code }); assert.deepEqual(data(f), before); assert.equal(f.view().segments[0].script.text, value.text);
});

test("matching saved voice/profile revision is preserved and blank instructions remain exact", async t => {
  const f = await narrationSpeechFixture(t); edit(f, 0, draft("  Exact words.\n", { voice: "coral", profileRevisionId: f.profile.revision }));
  const p = await f.prepare(f.input({ instructions: "" })); assert.equal(p.operation.text, "  Exact words.\n"); assert.equal(p.operation.instructions, "");
  assert.equal(p.compiled.nodes[0].args.instructions, ""); await f.review(p);
});

for (const action of ["prepare", "review"]) for (const change of ["section", "cancel", "actor", "head", "lock"]) test(`${action} rechecks original ${change} after isolated composition`, async t => {
  const f = await narrationSpeechFixture(t), proposal = action === "review" ? await f.prepare() : null;
  const gate = barrier(f), controller = new AbortController(), options = { signal: controller.signal };
  const running = action === "prepare" ? f.prepare(f.input(), options) : f.review(proposal, {}, options);
  try {
    await gate.ready;
    if (change === "section") edit(f);
    if (change === "cancel") { controller.abort(); options.signal = new AbortController().signal; }
    if (change === "actor") f.production.beginRequest(f.project.id, "human", "A new editing request");
    if (change === "head") { const p = f.store.getProject(f.project.id); f.store.saveProject({ ...p, title: "Changed title" }, p.headVersion); }
    if (change === "lock") { const lock = f.store.get("capability_lock", f.store.getProject(f.project.id).capabilityLockId); f.store.db.prepare("UPDATE entities SET body=? WHERE kind='capability_lock' AND id=?").run(JSON.stringify({ ...lock, changed: true }), lock.id); }
    const before = data(f); gate.release(); await assert.rejects(running); assert.deepEqual(data(f), before);
    assert.equal(gate.signal, controller.signal); assert.equal(rows(f, "narration_speech_review").length, 0);
  } finally { gate.release(); await running.catch(() => {}); }
});

test("unrelated section edits and caller input mutation cannot change the captured proposal", async t => {
  const f = await narrationSpeechFixture(t), input = f.input(), expected = structuredClone(input), gate = barrier(f), running = f.prepare(input);
  try { await gate.ready; input.voice = "alloy"; input.instructions = "changed"; edit(f, 1); gate.release();
    const p = await running; assert.equal(p.operation.voice, expected.voice); assert.equal(p.operation.instructions, expected.instructions); assert.equal(p.inputDigest, digest(expected));
    await f.review(p);
  } finally { gate.release(); await running.catch(() => {}); }
});

test("successful command replay survives later section edit but still requires original active authority", async t => {
  const f = await narrationSpeechFixture(t), input = f.input(), p = await f.prepare(input), reviewInput = { key: key(), proposalId: p.id, proposalDigest: digest(p) };
  const applied = await f.service.review(f.project.id, f.human, reviewInput); edit(f); const before = data(f);
  assert.deepEqual(await f.prepare(input), p); assert.deepEqual(await f.service.review(f.project.id, f.human, reviewInput), applied); assert.deepEqual(data(f), before);
  await assert.rejects(f.prepare({ ...input, voice: "alloy" }), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(f.service.review(f.project.id, f.human, { ...reviewInput, proposalDigest: "a".repeat(64) }), { code: "IDEMPOTENCY_CONFLICT" });
  f.production.beginRequest(f.project.id, "human", "Supersede the original editing request");
  await assert.rejects(f.prepare(input)); await assert.rejects(f.service.review(f.project.id, f.human, reviewInput));
});

test("concurrent same-key review returns the first exact receipt with one grant/application", async t => {
  const f = await narrationSpeechFixture(t), p = await f.prepare(), input = { key: key(), proposalId: p.id, proposalDigest: digest(p) };
  const results = await Promise.all([f.service.review(f.project.id, f.human, input), f.service.review(f.project.id, f.human, input)]);
  assert.deepEqual(results[0], results[1]); assert.equal(rows(f, "grant").length, 1); assert.equal(rows(f, "narration_speech_application").length, 1);
});

test("application insertion failure rolls back grant, review, head, plan and command; retry publishes once", async t => {
  const f = await narrationSpeechFixture(t), p = await f.prepare(), input = { key: key(), proposalId: p.id, proposalDigest: digest(p) }, before = data(f), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "narration_speech_application") throw Error("INJECTED_SPEECH_APPLICATION_FAILURE"); return insert(...args); };
  await assert.rejects(f.service.review(f.project.id, f.human, input), /INJECTED_SPEECH_APPLICATION_FAILURE/); assert.deepEqual(data(f), before);
  f.store.insert = insert; await f.service.review(f.project.id, f.human, input); assert.equal(rows(f, "grant").length, 1);
});

test("successive explicit section reviews preserve the first purpose-bound node and history", async t => {
  const f = await narrationSpeechFixture(t), first = await f.prepare(), one = await f.review(first), saved = resolveNarrationSpeechApplication(f.store, f.project.id, one.candidateId);
  const section = f.view().segments[1], second = await f.prepare(f.input({ segmentId: section.entry.segmentId, segmentRevisionId: section.script.id }));
  assert.deepEqual(second.compiled.nodes.filter(n => n.alias !== second.operation.alias), first.compiled.nodes);
  const two = await f.review(second); assert.notEqual(one.candidateId, two.candidateId);
  assert.deepEqual(resolveNarrationSpeechApplication(f.store, f.project.id, one.candidateId), saved); assert.equal(rows(f, "grant").length, 2);
});
