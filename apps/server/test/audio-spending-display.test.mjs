import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { FakeProvider, OPENAI_SPEECH_MODEL } from "../../../packages/providers/dist/index.js";
import { spendingAudioDetails, spendingHistoryDisplay, spendingProviderDisplay } from "../dist/application/spending-display.js";
import { projectSpendingProjection } from "../dist/application/allowance-projection.js";
import { ExternalAllowanceService, allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { ProductionService } from "../dist/application/service.js";
import { Engine } from "../dist/execution/engine.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture } from "./execution-fixture.mjs";

const profile = (kind = "speech", changes = {}) => ({ id: `reviewed-${kind}`, revision: "v1", kind,
  adapter: kind === "speech" ? "openai-speech" : "openai-transcription", executionVersion: "1",
  configuration: { model: kind === "speech" ? OPENAI_SPEECH_MODEL : "whisper-1", settings: {} },
  maxConcurrency: 2, maxRetries: 0, unitCostMicros: "100", ...changes });
const secretText = "Private spoken text 手工缝制", secretInstructions = "Private delivery instructions";
const options = kind => kind === "speech" ? { text: secretText, voice: "coral", instructions: secretInstructions, settings: {} }
  : { language: "auto", timing: "word", settings: {} };
const audio = { artifactId: "owned-recording", kind: "audio", sha256: "d".repeat(64) };
const node = (p = profile(), changes = {}) => ({ id: "audio-node", specDigest: "a".repeat(64), alias: "closing-narration", shotId: null,
  kind: p.kind, profileId: p.id, args: { ...providerProfileArguments(p), ...options(p.kind) },
  inputs: p.kind === "speech" ? [] : [{ source: { kind: "artifact", artifact: audio }, destinationPort: "audio", role: "audio", order: 0 }], ...changes });
const selection = { candidateId: "audio-candidate", nodeId: "audio-node", specDigest: "a".repeat(64) };
const allowance = p => ({ projectId: "project", profileDigest: providerProfileArguments(p).profileDigest, profileDefinitionDigest: digest(p), selections: [selection] });
const history = (p, n = node(p), locks = [{ projectId: "project", profiles: [p] }]) => spendingHistoryDisplay("project", locks,
  [{ projectId: "project", compiled: { nodes: [n] } }]);

test("audio provider display contains only exact fixed model identity and empty settings", () => {
  for (const p of [profile(), profile("speech", { configuration: { model: "gpt-4o-mini-tts", settings: {} } }), profile("transcription")]) {
    const display = spendingProviderDisplay(p, digest(p));
    assert.deepEqual(display, { id: p.id, revision: p.revision, definitionDigest: digest(p), adapter: p.adapter, model: p.configuration.model, settings: {} });
    display.settings.extra = "external mutation"; assert.deepEqual(p.configuration.settings, {});
    assert.equal(spendingProviderDisplay({ ...p, unitCostMicros: "101" }, digest(p)), null);
    for (const bad of [{ ...p, executionVersion: "2" }, { ...p, configuration: { ...p.configuration, settings: { apiKey: "SECRET_VALUE" } } },
      { ...p, configuration: { model: "https://private.example/model", settings: {} } }, { ...p, token: "SECRET_VALUE" }]) {
      assert.equal(spendingProviderDisplay(bad, digest(bad)), null);
    }
  }
});

test("safe audio summaries validate exact options without copying text, instructions, input references or private settings", () => {
  const speech = profile(), asr = profile("transcription");
  assert.deepEqual(spendingAudioDetails(speech, node(speech)), { audioDisplay: { operation: "speech", voice: "coral", textBytes: Buffer.byteLength(secretText), instructionsPresent: true }, audioUnavailableCode: null });
  assert.deepEqual(spendingAudioDetails(asr, node(asr)), { audioDisplay: { operation: "transcription", language: null, timing: "word" }, audioUnavailableCode: null });
  const en = node(asr); en.args.language = "en";
  assert.equal(spendingAudioDetails(asr, en).audioDisplay.language, "en");
  for (const [p, changes] of [[speech, { voice: "/private/voice-key" }], [speech, { instructions: "x".repeat(257) }],
    [speech, { text: "x".repeat(1793) }], [speech, { settings: { authorization: "SECRET_VALUE" } }],
    [asr, { timing: "segment" }], [asr, { language: "https://private.example" }], [asr, { settings: { endpoint: "SECRET_VALUE" } }]]) {
    const value = node(p); Object.assign(value.args, changes);
    const result = spendingAudioDetails(p, value);
    assert.deepEqual(result, { audioDisplay: null, audioUnavailableCode: "AUDIO_OPERATION_UNSUPPORTED" });
    assert.equal(JSON.stringify(result).includes("SECRET_VALUE"), false);
  }
  assert.equal(spendingAudioDetails(speech, node(speech, { inputs: [{}] })).audioUnavailableCode, "AUDIO_OPERATION_UNSUPPORTED");
  assert.equal(spendingAudioDetails(asr, node(asr, { inputs: [] })).audioUnavailableCode, "AUDIO_OPERATION_UNSUPPORTED");
  assert.equal(spendingAudioDetails(undefined, node()).audioUnavailableCode, "AUDIO_PROFILE_UNAVAILABLE");
  const serialized = JSON.stringify([history(speech)(allowance(speech), []), history(asr)(allowance(asr), [])]);
  for (const omitted of [secretText, secretInstructions, audio.artifactId, audio.sha256, "profileConfiguration"]) assert.equal(serialized.includes(omitted), false);
});

test("history retains original audio model, voice and language after caller mutation and replacement profiles", () => {
  for (const kind of ["speech", "transcription"]) {
    const p = profile(kind), n = node(p), allowed = allowance(p), lookup = history(p, n);
    const before = lookup(allowed, []);
    if (kind === "speech") n.args.voice = "onyx"; else n.args.language = "zh";
    p.configuration.model = "future-model"; p.unitCostMicros = "999";
    assert.deepEqual(lookup(allowed, []), before);
    assert.equal(before.work[0].operation, kind); assert.equal(before.work[0].historyAvailable, true);
    assert.equal(before.work[0].audioUnavailableCode, null);
    assert.equal(before.work[0].audioDisplay[kind === "speech" ? "voice" : "language"], kind === "speech" ? "coral" : null);
    assert.equal(lookup(allowed, [selection]).work[0].current, true);
  }
});

test("missing retained audio profiles and unsupported saved operations remain visible with explicit reasons", () => {
  for (const kind of ["speech", "transcription"]) {
    const p = profile(kind), original = allowance(p), n = node(p);
    const missing = history(p, n, [])(original, []);
    assert.equal(missing.providerDisplay, null); assert.equal(missing.work[0].alias, n.alias);
    assert.equal(missing.work[0].operation, kind); assert.equal(missing.work[0].historyAvailable, true);
    assert.equal(missing.work[0].audioUnavailableCode, "AUDIO_PROFILE_UNAVAILABLE");
    n.args.settings = { password: "SECRET_VALUE" };
    const unsupported = history(p, n)(original, []);
    assert.equal(unsupported.work[0].historyAvailable, true);
    assert.equal(unsupported.work[0].audioUnavailableCode, "AUDIO_OPERATION_UNSUPPORTED");
    assert.equal(JSON.stringify(unsupported).includes("SECRET_VALUE"), false);
    const conflicting = spendingHistoryDisplay("project", [{ projectId: "project", profiles: [p] }],
      [{ projectId: "project", compiled: { nodes: [node(p)] } }, { projectId: "project", compiled: { nodes: [n] } }]);
    assert.equal(conflicting(original, []).work[0].historyAvailable, false);
  }
});

function fixture(t, kind, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-audio-spending-")), path = join(directory, "store.sqlite");
  const store = new Store(path), fake = new FakeProvider(join(directory, "fake.sqlite")), p = profile(kind);
  const engine = new Engine(store, fake, { artifactDir: join(directory, "artifacts"), profiles: [p] }), production = new ProductionService(store, engine, [p]);
  t.after(() => { if (store.db.open) store.close(); fake.close(); rmSync(directory, { recursive: true, force: true }); });
  const project = { ...projectFixture(randomUUID(), 1), artifacts: [audio] };
  store.createProject(project); store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: [p] });
  const q = JSON.stringify, args = { ...options(kind), ...overrides };
  const operation = kind === "speech" ? `p.speech("closing-narration",{profile:${q(p.id)},text:${q(args.text)},voice:${q(args.voice)},instructions:${q(args.instructions)},settings:${q(args.settings)}})`
    : `p.transcription("owned-recording-transcript",{profile:${q(p.id)},audio:p.asset(${q(audio.artifactId)}),language:${q(args.language)},timing:${q(args.timing)},settings:${q(args.settings)}})`;
  const compiled = compilePlan(`definePlan({baseRevision:${q(project.revisionId)}},p=>{return ${operation};});`, { project, profiles: [p], logicalIds: {}, allocateId: randomUUID });
  const human = production.beginRequest(project.id, "local-user", "Review this exact audio work");
  const grant = production.authorize(project.id, human, [{ scopeId: project.id, kind }], randomUUID(), "initial_slot")[0];
  const planId = randomUUID(), n = compiled.nodes[0]; engine.installPlan(project.id, planId, compiled, { [n.id]: grant.id });
  store.saveProject({ ...store.getProject(project.id), activePlanId: planId }, store.getProject(project.id).headVersion);
  return { directory, path, store, fake, p, production, engine, project, node: n };
}
const rows = store => ({ entities: store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all(),
  commands: store.db.prepare("SELECT * FROM commands ORDER BY actor_scope,key").all(), events: store.db.prepare("SELECT * FROM events ORDER BY project_id,sequence").all() });

test("current audio cost projection is read-only and does not infer provider readiness or issue authority", t => {
  for (const kind of ["speech", "transcription"]) {
    const f = fixture(t, kind), before = rows(f.store), current = projectSpendingProjection(f.production, f.project.id);
    assert.equal(current.candidates.length, 1); const row = current.candidates[0];
    assert.equal(row.operation, kind); assert.equal(row.selectionCurrent, true); assert.equal(row.suggestedForIssue, true);
    assert.equal(row.estimatedMicros, "100"); assert.equal(row.audioUnavailableCode, null);
    assert.equal(row.providerDisplay.adapter, f.p.adapter); assert.equal(row.matchingAllowanceCount, 0);
    assert.match(current.notice, /configured estimates/); assert.match(current.notice, /does not approve creative work/); assert.match(current.notice, /enable a provider/);
    assert.deepEqual(rows(f.store), before); assert.equal(f.fake.acceptedCount(), 0);
    for (const family of ["attempt", "reservation", "external_allowance", "external_allowance_consumption"]) assert.equal(f.store.list(family, f.project.id).length, 0);
    const payload = JSON.stringify(current); for (const omitted of [secretText, secretInstructions, "apiKey", "profileConfiguration"]) assert.equal(payload.includes(omitted), false);
  }
});

test("unsupported audio operations are visible but not suggested and missing current profiles are not replaced", t => {
  for (const [kind, overrides] of [["speech", { voice: "unsupported-voice" }], ["transcription", { timing: "segment" }]]) {
    const f = fixture(t, kind, overrides), before = rows(f.store), current = projectSpendingProjection(f.production, f.project.id).candidates[0];
    assert.equal(current.selectionCurrent, false); assert.equal(current.suggestedForIssue, false);
    assert.equal(current.audioUnavailableCode, "AUDIO_OPERATION_UNSUPPORTED"); assert.equal(current.unavailableCode, "AUDIO_OPERATION_UNSUPPORTED");
    assert.equal(current.estimatedMicros, "100"); assert.deepEqual(rows(f.store), before);
    const p = f.store.getProject(f.project.id), lockId = randomUUID(); f.store.insert("capability_lock", lockId, p.id, { profiles: [] });
    f.store.saveProject({ ...p, capabilityLockId: lockId }, p.headVersion);
    const unavailable = projectSpendingProjection(f.production, p.id).candidates[0];
    assert.equal(unavailable.providerDisplay, null); assert.equal(unavailable.estimatedMicros, null);
    assert.equal(unavailable.audioUnavailableCode, "AUDIO_PROFILE_UNAVAILABLE"); assert.equal(unavailable.suggestedForIssue, false);
  }
});

test("audio allowance history survives current-profile removal and reopen using only exact saved identities", t => {
  const f = fixture(t, "speech"), candidate = projectSpendingProjection(f.production, f.project.id).candidates[0];
  const input = { profileDigest: candidate.profileDigest, profileDefinitionDigest: candidate.profileDefinitionDigest,
    selections: [{ candidateId: candidate.candidateId, nodeId: candidate.nodeId, specDigest: candidate.specDigest }],
    maxAttempts: 1, maxEstimatedMicros: "100", expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const human = f.production.beginRequest(f.project.id, "local-user", "Approve only this exact spending limit", { editing: false, contextDigest: allowanceIssueContextDigest(f.project.id, input) });
  new ExternalAllowanceService(f.store).issue(f.project.id, human, input);
  const p = f.store.getProject(f.project.id), lockId = randomUUID(); f.store.insert("capability_lock", lockId, p.id, { profiles: [] });
  f.store.saveProject({ ...p, capabilityLockId: lockId, activePlanId: null }, p.headVersion);
  const before = rows(f.store), saved = projectSpendingProjection(f.production, p.id).allowances[0];
  assert.equal(saved.providerDisplay.model, OPENAI_SPEECH_MODEL); assert.equal(saved.work[0].audioDisplay.voice, "coral");
  assert.equal(saved.work[0].current, false); assert.equal(saved.status, "no_current_work"); assert.deepEqual(rows(f.store), before);
  f.store.close(); const reopened = new Store(f.path);
  try {
    const engine = new Engine(reopened, f.fake, { artifactDir: join(f.directory, "artifacts") }), production = new ProductionService(reopened, engine);
    const after = projectSpendingProjection(production, p.id).allowances[0]; assert.deepEqual(after, saved);
    assert.equal(reopened.list("attempt", p.id).length, 0); assert.equal(reopened.list("external_allowance_consumption", p.id).length, 0);
  } finally { reopened.close(); }
});
