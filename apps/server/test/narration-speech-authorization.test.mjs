import test from "node:test";
import assert from "node:assert/strict";
import { canonical, digest } from "@openslate/core";
import { Store } from "../dist/persistence/store.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { OpenAISpeechExecution } from "../dist/execution/openai-speech-execution.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { assertNarrationSpeechProposal } from "../dist/narration/narration-speech-records.js";
import { assertNarrationSpeechAttemptInput, assertNarrationSpeechApplication, assertNarrationSpeechReview, resolveNarrationSpeechApplication } from "../dist/narration/narration-speech-authorization.js";
import { narrationSpeechFixture, key, draft, rows, bodies } from "./narration-speech-fixture.mjs";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { Engine } from "../dist/execution/engine.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { SpoolAudioIngestor } from "../dist/execution/spool-audio-ingester.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { resolveGeneratedNarrationAudio } from "../dist/narration/generated-audio.js";
import { inspectPcmWave } from "../dist/media/pcm-wave.js";

const data = f => ["projects", "entities", "commands", "events"].map(table => canonical(f.store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const edit = (f, index = 0) => f.revise({ update: [{ segmentId: f.view().segments[index].entry.segmentId, draft: draft("New saved words") }] });
const context = attempt => ({ expectedLease: { owner: attempt.leaseOwner, epoch: attempt.leaseEpoch } });
async function reviewed(t, options = {}) {
  const f = await narrationSpeechFixture(t, { realSpeech: true, ...options }); f.proposal = await f.prepare(); f.applied = await f.review(f.proposal);
  f.node = f.proposal.compiled.nodes.find(node => node.alias === f.proposal.operation.alias); return f;
}
function reopen(f) {
  f.store.close(); const store = new Store(f.path); f.stores.push(store);
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.root, "execution-output") });
  const forbidden = () => { throw Error("Recovery must not resolve keys or submit"); };
  return { store, bridge: new OpenAISpeechExecution({ store, outputStore: outputs, credentials: new EnvironmentMediaCredentials(forbidden), fetch: forbidden }) };
}

test("fresh human review can approve an older director proposal without borrowing that old request's authority", async t => {
  const f = await narrationSpeechFixture(t), proposal = await f.prepare();
  const human = f.production.beginRequest(f.project.id, "second-human", "Approve precisely these saved narration words");
  const applied = await f.service.review(f.project.id, human, { key: key(), proposalId: proposal.id, proposalDigest: digest(proposal) });
  const chain = resolveNarrationSpeechApplication(f.store, f.project.id, applied.candidateId);
  assert.equal(chain.review.requestId, human.requestId); assert.notEqual(chain.review.requestId, chain.proposal.requestId);
  assert.equal(f.store.get("grant", applied.grantId).authorityId, human.requestId); assert.equal(rows(f, "external_allowance").length, 0);
});

test("proposal and application history validates after section edits and later request replacement", async t => {
  const f = await reviewed(t), chain = resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId);
  edit(f); f.production.beginRequest(f.project.id, "human", "Move on to another editing request");
  const before = data(f); assert.deepEqual(resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId), chain); assert.deepEqual(data(f), before);
});

test("structural speech evidence rejects text, selected revision, output-node, grant and exact event tampering", async t => {
  const f = await reviewed(t), chain = resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId);
  for (const mutate of [p => { p.operation.text += " changed"; }, p => { p.section.segmentRevisionId = key(); }, p => { p.compiled.nodes[0].args.voice = "alloy"; }, p => { p.impact = []; }]) {
    const p = structuredClone(f.proposal); mutate(p); assert.throws(() => assertNarrationSpeechProposal(f.store, f.project.id, p));
  }
  for (const mutate of [r => { r.requestId = key(); }, r => { r.grantDigest = "a".repeat(64); }, r => { r.nodeId = key(); }, r => { r.section.segmentDigest = "b".repeat(64); }]) {
    const r = structuredClone(chain.review); mutate(r); assert.throws(() => assertNarrationSpeechReview(f.store, f.project.id, r));
  }
  const app = structuredClone(chain.application); app.receipt.cursor++; assert.throws(() => assertNarrationSpeechApplication(f.store, f.project.id, app));
  const event = f.store.db.prepare("SELECT body FROM events WHERE project_id=? AND sequence=?").get(f.project.id, chain.application.receipt.cursor), changed = JSON.parse(event.body);
  changed.payload.preparedId = key(); f.store.db.prepare("UPDATE events SET body=? WHERE project_id=? AND sequence=?").run(JSON.stringify(changed), f.project.id, changed.sequence);
  assert.throws(() => resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId), { code: "NARRATION_SPEECH_AUTHORIZATION_INVALID" });
});

test("immutable records and candidate purpose reject overwritten history and borrowed reviewed grants", async t => {
  const f = await reviewed(t), chain = resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId), before = data(f);
  for (const [kind, value] of [["narration_speech_proposal", f.proposal], ["narration_speech_review", chain.review], ["narration_speech_application", chain.application]])
    assert.throws(() => f.store.put(kind, value.id, f.project.id, { ...value, changed: true }));
  assert.throws(() => f.store.insert("candidate", key(), f.project.id, { nodeId: key(), grantId: f.applied.grantId, origin: "user_change" }));
  const plan = structuredClone(f.proposal.compiled); plan.nodes[0].args.text = "Borrowed grant for different words";
  assert.throws(() => f.engine.installPlan(f.project.id, key(), plan, { [f.node.id]: f.applied.grantId }));
  assert.throws(() => f.engine.installPlan(f.project.id, f.applied.applied.activePlanId, f.proposal.compiled, { unknown: f.applied.grantId }));
  f.engine.installPlan(f.project.id, f.applied.applied.activePlanId, f.proposal.compiled, { [f.node.id]: f.applied.grantId });
  assert.deepEqual(data(f), before);
});

test("ordinary full-plan reinstallation retains the exact reviewed speech node and candidate without a new grant", async t => {
  const f = await reviewed(t, { plan: true }), beforeCandidates = rows(f, "candidate"), beforeGrants = rows(f, "grant"), current = f.store.getProject(f.project.id);
  const source = f.proposal.compiled.source.replace(JSON.stringify(f.proposal.baseProject.revisionId), JSON.stringify(current.revisionId));
  const prepared = await f.production.prepare(f.project.id, f.actor, { variant: "plan", expectedHeadVersion: current.headVersion, source });
  assert.deepEqual(f.store.get("prepared", prepared.id).grantBindings, {}); f.production.apply(f.project.id, f.actor, prepared.id);
  assert.deepEqual(rows(f, "candidate"), beforeCandidates); assert.deepEqual(rows(f, "grant"), beforeGrants);
  assert.equal(f.store.get("node_binding", f.node.id).candidateId, f.applied.candidateId); resolveNarrationSpeechApplication(f.store, f.project.id, f.applied.candidateId);
});

test("review plus separate finite allowance produces immutable attempt metadata outside provider args", async t => {
  const f = await reviewed(t), allowance = f.issue(f.applied), attempt = f.admit(f.applied), application = f.store.get("narration_speech_application", f.applied.applicationId);
  assert.deepEqual(attempt.narrationSpeech, { version: 1, application: { id: application.id, digest: digest(application) } });
  assert.deepEqual(attempt.request.args, f.node.args); assert.equal(Object.hasOwn(attempt.request, "narrationSpeech"), false); assert.deepEqual(attempt.request.inputs, []);
  assert.equal(attempt.request.externalAllowanceId, allowance.id); assert.equal(rows(f, "external_allowance_consumption").length, 1);
  const before = data(f);
  for (const mutate of [a => { delete a.narrationSpeech; }, a => { a.narrationSpeech.application.digest = "a".repeat(64); }, a => { a.request.args.text = "Unreviewed words"; }, a => { a.fingerprint = a.request.fingerprint = "b".repeat(64); }]) {
    const a = structuredClone(attempt); mutate(a); assert.throws(() => assertNarrationSpeechAttemptInput(f.store, a)); assert.throws(() => f.store.put("attempt", a.id, f.project.id, a));
  }
  assert.deepEqual(data(f), before); assert.equal(f.calls.http, 0);
});

test("selected section changes block normal admission before consumption while unrelated section edits stay eligible", async t => {
  const f = await reviewed(t); const allowance = f.issue(f.applied); edit(f, 1); const attempt = f.admit(f.applied); assert.equal(attempt.ordinal, 1);
  const g = await reviewed(t); const second = g.issue(g.applied); edit(g);
  const before = bodies(g, ["attempt", "reservation", "external_allowance_consumption", "external_allowance"]), outcome = await g.engine.runReady();
  assert.equal(outcome.dispatched, 0); assert.ok(outcome.blocked.some(item => item.code === "NARRATION_SPEECH_STALE"));
  assert.equal(bodies(g, ["attempt", "reservation", "external_allowance_consumption", "external_allowance"]), before);
  assert.equal(g.store.get("external_allowance", second.id).id, second.id); assert.equal(f.store.get("external_allowance", allowance.id).id, allowance.id);
});

for (const change of ["section", "pause", "hold", "lease"]) test(`first marker rechecks ${change} after credentials without dispatch or fabricated terminal evidence`, async t => {
  let checkpoint; const f = await reviewed(t, { credential: () => { checkpoint(); return "offline-only"; } }); f.issue(f.applied); const attempt = f.admit(f.applied);
  checkpoint = () => {
    if (change === "section") edit(f);
    if (change === "pause") f.engine.setPaused(f.project.id, true, f.human.requestId);
    if (change === "hold") f.engine.setHold(f.project.id, { scopeId: f.project.id, ownerId: f.human.requestId });
    if (change === "lease") f.store.put("attempt", attempt.id, f.project.id, { ...attempt, leaseEpoch: attempt.leaseEpoch + 1 });
  };
  await assert.rejects(f.bridge.submit(attempt.request, context(attempt)));
  assert.equal(f.calls.http, 0); assert.equal(rows(f, "speech_execution_dispatch").length, 0); assert.equal(rows(f, "speech_execution_result").length, 0);
});

test("original cancellation during credentials makes no POST and retains only a definite local cancellation", async t => {
  const controller = new AbortController(); const f = await reviewed(t, { credential: () => { controller.abort(); return "offline-only"; } }); f.issue(f.applied); const attempt = f.admit(f.applied);
  const result = await f.bridge.submit(attempt.request, { ...context(attempt), signal: controller.signal });
  assert.equal(result.type, "rejected"); assert.equal(f.calls.http, 0); assert.equal(rows(f, "speech_execution_dispatch").length, 0);
  assert.equal(rows(f, "speech_execution_result")[0].observation.code, "LOCAL_CANCELLED");
});

test("completed speech reopens after selected-section edits with no current authority, key or repeat POST", async t => {
  const f = await reviewed(t); f.issue(f.applied); const attempt = f.admit(f.applied), result = await f.bridge.submit(attempt.request, context(attempt));
  assert.equal(result.type, "completed"); assert.equal(f.calls.http, 1); edit(f); const savedNarration = bodies(f, ["narration_state", "narration_segment", "narration_audio", "narration_acceptance"]);
  const g = reopen(f), replay = await g.bridge.lookup(attempt.id, attempt.request);
  assert.deepEqual(replay, result); assert.deepEqual(g.store.get("attempt", attempt.id).narrationSpeech, attempt.narrationSpeech);
  assert.equal(bodies({ ...f, store: g.store }, ["narration_state", "narration_segment", "narration_audio", "narration_acceptance"]), savedNarration);
  assert.equal(f.calls.http, 1);
});

test("ambiguous post-marker failure never resubmits even after section edit and reopen", async t => {
  const f = await reviewed(t, { fetch: async () => { throw Error("connection lost after dispatch"); } }); f.issue(f.applied); const attempt = f.admit(f.applied);
  const first = await f.bridge.submit(attempt.request, context(attempt)); assert.equal(first.type, "unknown"); assert.equal(f.calls.http, 1); edit(f);
  const g = reopen(f); assert.equal((await g.bridge.lookup(attempt.id, attempt.request)).type, "unknown");
  assert.equal((await g.bridge.submit(attempt.request, context(attempt))).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("actual Engine normalization preserves section-purpose proof through filesystem completion failure and tool-free reopen", async t => {
  const f = await reviewed(t); f.issue(f.applied);
  const paths = { ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg"),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") };
  const media = new LocalMediaService({ rootDir: join(f.root, "media"), allowedInputRoots: [f.outputs.rootDir], ...paths });
  let conversions = 0; const convert = media.importMedia.bind(media); media.importMedia = async (...args) => { conversions++; return convert(...args); };
  const engine = new Engine(f.store, f.bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: f.outputs,
    outputIngestor: new SpoolAudioIngestor(f.outputs, media, { rootDir: join(f.root, "audio-derivations") }),
    externalAdmission: new DurableExternalAdmission(f.store, () => {}) });
  const insert = f.store.insert.bind(f.store); let failures = 0;
  f.store.insert = (...args) => { if (args[0] === "audio_derivation_receipt") { failures++; throw Error("INJECTED_SPEECH_DERIVATION_SQL_FAILURE"); } return insert(...args); };
  const run = await engine.runReady().then(value => ({ value }), error => ({ error }));
  assert.match(String(run.error), /INJECTED_SPEECH_DERIVATION_SQL_FAILURE/, JSON.stringify({ outcome: run.value, phases: rows(f, "attempt").map(a => ({ phase: a.phase, failure: a.failure })), failures, conversions, calls: f.calls })); f.store.insert = insert;
  const attempt = rows(f, "attempt")[0]; assert.equal(attempt.phase, "ingesting"); assert.equal(failures, 1); assert.equal(conversions, 1); assert.equal(f.calls.http, 1);
  assert.equal(rows(f, "artifact").length, 0); assert.equal(rows(f, "audio_derivation_receipt").length, 0);
  const intent = rows(f, "audio_derivation_intent")[0]; assert.ok(readFileSync(join(f.root, "audio-derivations", "completions", `${intent.id}.json`)).length > 0);
  const identity = structuredClone(attempt.narrationSpeech); edit(f);
  const protectedRows = ["narration_state", "narration_segment", "narration_audio", "narration_acceptance", "narration_canonical"], before = bodies(f, protectedRows), projectBefore = f.store.getProject(f.project.id);
  f.store.put("attempt", attempt.id, f.project.id, { ...attempt, leaseExpiresAt: 0 });
  const g = reopen(f), recoveredOutputs = new ExecutionOutputStore(g.store, { rootDir: join(f.root, "execution-output") });
  const recoveredMedia = new LocalMediaService({ rootDir: join(f.root, "media"), allowedInputRoots: [recoveredOutputs.rootDir], ffmpegPath: "/missing/ffmpeg", ffprobePath: "/missing/ffprobe" });
  recoveredMedia.importMedia = recoveredMedia.describeAudioNormalization = () => { throw Error("Completed normalization must not repeat or describe tools"); };
  const recovered = new Engine(g.store, g.bridge, { artifactDir: f.artifactDir, profiles: f.profiles, outputStore: recoveredOutputs,
    outputIngestor: new SpoolAudioIngestor(recoveredOutputs, recoveredMedia, { rootDir: join(f.root, "audio-derivations") }) });
  assert.equal((await recovered.reconcile()).reconciled, 1);
  const done = g.store.get("attempt", attempt.id), artifact = g.store.get("artifact", done.outputs.audio.artifactId);
  assert.equal(done.phase, "succeeded"); assert.deepEqual(done.narrationSpeech, identity); assert.equal(g.store.get("reservation", done.reservationId).state, "charged");
  assert.equal(g.store.list("external_allowance_consumption", f.project.id).length, 1); assert.equal(artifact.origin, "generated_audio");
  const { pcm } = await inspectPcmWave(artifact.path, 1024 * 1024, new AbortController().signal);
  assert.equal(pcm.sampleRate, 48000); assert.equal(pcm.channels, 2); assert.equal(pcm.sampleCount, 48000);
  const generated = resolveGeneratedNarrationAudio(g.store, f.project.id, artifact.id); assert.equal(generated.attempt.id, done.id);
  assert.equal(bodies({ ...f, store: g.store }, protectedRows), before); assert.deepEqual(g.store.getProject(f.project.id), projectBefore);
  assert.equal(f.calls.http, 1); assert.equal(conversions, 1);
  await recovered.reconcile(); assert.equal(g.store.list("artifact", f.project.id).length, 1);
});
