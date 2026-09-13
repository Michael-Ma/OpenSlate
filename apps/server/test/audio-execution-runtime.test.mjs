import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, DEFAULT_PROFILES, digest, DomainError, providerProfileArguments } from "@openslate/core";
import { FakeProvider, OPENAI_SPEECH_MODEL } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { ProductionService } from "../dist/application/service.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { createMediaExecutionRuntime } from "../dist/application/media-execution-runtime.js";
import { allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { wave } from "./speech-execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const speech = { id: "runtime-speech", revision: "synthetic-estimate-1", kind: "speech", adapter: "openai-speech", executionVersion: "1",
  configuration: { model: OPENAI_SPEECH_MODEL, settings: {} }, maxConcurrency: 2, unitCostMicros: "100", maxRetries: 0 };
const transcription = { ...speech, id: "runtime-transcription", kind: "transcription", adapter: "openai-transcription", configuration: { model: "whisper-1", settings: {} } };
const providerConfiguration = { version: 1, profiles: [{ label: "Synthetic speech estimate", profile: speech }, { label: "Synthetic recognition estimate", profile: transcription }] };
const disabled = { image: false, h3: false, h3DownloadHosts: [] };
const key = () => randomUUID();

function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-audio-runtime-"))), stores = [], fakes = [];
  const f = { directory, calls: { speech: 0, transcription: 0, normalization: 0, derivative: 0 }, keys: options.keys !== false };
  f.open = (configuration = { ...disabled, speech: true, transcription: true }) => {
    if (f.store?.db.open) f.store.close(); if (f.fake?.db.open) f.fake.close();
    f.store = new Store(join(directory, "openslate.sqlite")); stores.push(f.store);
    f.fake = new FakeProvider(join(directory, "fake-provider.sqlite")); fakes.push(f.fake);
    f.runtime = createMediaExecutionRuntime({ store: f.store, fakeProvider: f.fake, dataDirectory: directory, configuration,
      ffmpegPath: options.tools === false ? null : ffmpegPath, ffprobePath: options.tools === false ? null : ffprobePath,
      credentials: new EnvironmentMediaCredentials(() => f.keys ? "synthetic-runtime-audio-key" : undefined), providerConfiguration,
      transport: {
        imageFetch: async () => assert.fail("Audio must not call the image provider"), h3Fetch: async () => assert.fail("Audio must not call H3"),
        speechFetch: async (_url, init) => { f.calls.speech++; assert.equal(init.method, "POST");
          const body = JSON.parse(init.body); assert.equal(body.voice, "coral"); assert.equal(body.input, "Leather boots.");
          return new Response(wave(24000), { headers: { "content-type": "audio/wav" } }); },
        transcriptionFetch: async (_url, init) => { f.calls.transcription++; assert.equal(init.method, "POST");
          return new Response(JSON.stringify({ text: "Leather boots.", language: "english", duration: 1,
            words: [{ word: "Leather", start: 0.1, end: 0.4 }, { word: "boots.", start: 0.5, end: 0.9 }] }), { headers: { "content-type": "application/json" } }); },
      } });
    if (f.runtime.localMedia) {
      const media = f.runtime.localMedia, normalize = media.importMedia.bind(media), derive = media.deriveTranscriptionAudio.bind(media);
      media.importMedia = async (...args) => { f.calls.normalization++; return normalize(...args); };
      media.deriveTranscriptionAudio = async (...args) => { f.calls.derivative++; return derive(...args); };
    }
    f.production = new ProductionService(f.store, f.runtime.engine, DEFAULT_PROFILES, f.runtime.productionOptions);
    return f.runtime;
  };
  t.after(() => { for (const store of stores) if (store.db.open) store.close(); for (const fake of fakes) if (fake.db.open) fake.close(); rmSync(directory, { recursive: true, force: true }); });
  f.open(options.configuration);
  f.seed = async (changes = {}) => {
    const selection = f.runtime.providerCatalog.select(f.runtime.providerCatalog.digest, [speech.id, transcription.id]);
    const project = f.production.createProject("Synthetic audio runtime", selection); f.projectId = project.id;
    const human = f.production.beginRequest(project.id, "synthetic-human", "Generate the exact reviewed narration and recognize its words");
    f.production.authorize(project.id, human, [{ scopeId: project.id, kind: "speech" }, ...(changes.speechOnly ? [] : [{ scopeId: project.id, kind: "transcription" }])], key(), "initial_slot");
    const q = JSON.stringify;
    const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const voice=p.speech("voice",{profile:${q(speech.id)},text:${q(changes.text ?? "Leather boots.")},voice:${q(changes.voice ?? "coral")},instructions:"Warm and clear."});${changes.speechOnly ? "return voice;" : `return p.transcription("words",{profile:${q(transcription.id)},audio:voice,language:"auto",timing:${q(changes.timing ?? "word")}});`}});`;
    const prepared = await f.production.prepare(project.id, human, { variant: "plan", expectedHeadVersion: project.headVersion, source });
    f.production.apply(project.id, human, prepared.id);
    return f.store.list("node_binding", project.id);
  };
  f.issue = kind => {
    const profile = kind === "speech" ? speech : transcription, binding = f.store.list("node_binding", f.projectId).find(row => row.node.kind === kind);
    const input = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
      selections: [{ candidateId: binding.candidateId, nodeId: binding.id, specDigest: binding.node.specDigest }], maxAttempts: 1,
      maxEstimatedMicros: "100", expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const human = f.production.beginRequest(f.projectId, "synthetic-human", "Approve this exact synthetic estimate", { editing: false,
      contextDigest: allowanceIssueContextDigest(f.projectId, input) });
    return f.runtime.allowances.issue(f.projectId, human, input);
  };
  f.rows = kind => f.store.list(kind, f.projectId);
  f.noAdmission = () => { for (const kind of ["attempt", "reservation", "external_allowance_consumption", "speech_execution_dispatch", "transcription_execution_dispatch"]) assert.equal(f.rows(kind).length, 0, kind); };
  return f;
}

test("audio startup is independently opt-in, preserves default locks and creates no authority or network traffic", t => {
  const f = fixture(t, { configuration: disabled });
  for (const adapter of ["openai-speech", "openai-transcription"]) assert.throws(() => f.runtime.engine.registry.resolve({ adapter, version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
  const demo = f.production.createProject("Default remains fake");
  assert.deepEqual(f.store.get("capability_lock", demo.capabilityLockId).profiles, DEFAULT_PROFILES);
  for (const [enabledKind, absentKind] of [["speech", "transcription"], ["transcription", "speech"]]) {
    f.open({ ...disabled, [enabledKind]: true });
    assert.ok(f.runtime.engine.registry.resolve({ adapter: `openai-${enabledKind}`, version: "1" }));
    assert.throws(() => f.runtime.engine.registry.resolve({ adapter: `openai-${absentKind}`, version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
    const view = f.runtime.providerCatalog.view();
    assert.equal(view.profiles.find(row => row.profile?.adapter === `openai-${enabledKind}`).readiness.realExecutionEnabled, true);
    assert.equal(view.profiles.find(row => row.profile?.adapter === `openai-${absentKind}`).readiness.realExecutionEnabled, false);
  }
  for (const kind of ["request", "grant", "candidate", "attempt", "external_allowance"]) assert.equal(f.store.list(kind, demo.id).length, 0);
  assert.deepEqual(f.calls, { speech: 0, transcription: 0, normalization: 0, derivative: 0 });
});

test("audio enablement requires executable tools and rejects malformed additive flags", t => {
  const f = fixture(t, { configuration: disabled, tools: false }); assert.equal(f.runtime.localMedia, null);
  for (const kind of ["speech", "transcription"]) {
    assert.throws(() => f.open({ ...disabled, [kind]: true }), { code: "MEDIA_EXECUTION_TOOLS_REQUIRED" });
    for (const value of [null, 1, "1"]) assert.throws(() => f.open({ ...disabled, [kind]: value }), { code: "MEDIA_EXECUTION_CONFIGURATION" });
  }
});

test("missing audio key and missing allowance each block without consuming a start", async t => {
  const f = fixture(t, { keys: false }); await f.seed({ speechOnly: true }); f.issue("speech");
  let result = await f.runtime.engine.runReady(); assert.ok(result.blocked.some(row => row.code === "MEDIA_CREDENTIAL_MISSING")); f.noAdmission();
  f.keys = true;
  const other = fixture(t); await other.seed({ speechOnly: true });
  result = await other.runtime.engine.runReady(); assert.ok(result.blocked.some(row => row.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE")); other.noAdmission();
  assert.equal(f.calls.speech + other.calls.speech, 0);
});

for (const changes of [{ voice: "unsupported-voice" }, { text: "x".repeat(2000) }]) test(`audio operation preflight preserves allowance for ${changes.voice ? "unsupported voice" : "oversized text"}`, async t => {
  const f = fixture(t); await f.seed({ ...changes, speechOnly: true }); const allowance = f.issue("speech");
  const result = await f.runtime.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked.length, 1);
  f.noAdmission(); assert.deepEqual(f.store.get("external_allowance", allowance.id), allowance);
  assert.deepEqual(f.calls, { speech: 0, transcription: 0, normalization: 0, derivative: 0 });
});

test("unsupported transcription granularity consumes no transcription allowance or preparation work", async t => {
  const f = fixture(t); await f.seed({ timing: "segment" }); f.issue("speech"); const allowance = f.issue("transcription");
  await f.runtime.engine.runReady(); const result = await f.runtime.engine.runReady();
  assert.equal(result.dispatched, 0); assert.equal(result.blocked.length, 1);
  assert.equal(f.rows("attempt").length, 1); assert.equal(f.rows("external_allowance_consumption").filter(row => row.allowanceId === allowance.id).length, 0);
  assert.equal(f.rows("transcription_audio_intent").length, 0); assert.equal(f.calls.transcription, 0); assert.equal(f.calls.derivative, 0);
});

test("actual runtime composes approved speech, owned normalization and word candidate publication, then reopens without repeating work", async t => {
  const f = fixture(t); await f.seed(); f.issue("speech"); f.issue("transcription");
  await f.runtime.engine.runReady(); await f.runtime.engine.runReady();
  const attempts = f.rows("attempt"); assert.equal(attempts.length, 2); assert.ok(attempts.every(row => row.phase === "succeeded"));
  assert.equal(f.rows("external_allowance_consumption").length, 2); assert.ok(f.rows("reservation").every(row => row.state === "charged"));
  const candidates = f.rows("transcript_candidate"); assert.equal(candidates.length, 1); assert.equal(candidates[0].status, "unreviewed");
  assert.deepEqual(candidates[0].projection.words.map(row => row.word), ["Leather", "boots."]);
  for (const kind of ["narration_segment", "narration_audio", "narration_cue", "narration_acceptance", "narration_transcript_selection", "narration_canonical"]) assert.equal(f.rows(kind).length, 0);
  const project = f.store.getProject(f.projectId); assert.equal(project.cues.length, 0);
  const before = canonical(f.store.db.prepare("SELECT kind,id,project_id,body FROM entities ORDER BY kind,id").all());
  const counts = { ...f.calls }; assert.deepEqual(counts, { speech: 1, transcription: 1, normalization: 1, derivative: 1 });
  f.keys = false; f.open(); await f.runtime.engine.reconcile(); await f.runtime.engine.runReady();
  assert.equal(canonical(f.store.db.prepare("SELECT kind,id,project_id,body FROM entities ORDER BY kind,id").all()), before);
  assert.deepEqual(f.store.getProject(f.projectId), project); assert.deepEqual(f.calls, counts); assert.equal(f.fake.acceptedCount(), 0);
});

test("runtime recovers a retained speech spool after local ingestion contention without another POST or allowance", async t => {
  const f = fixture(t); await f.seed({ speechOnly: true }); f.issue("speech");
  f.runtime.localMedia.importMedia = async () => { throw new DomainError("MEDIA_BUSY", "Synthetic shared worker contention"); };
  await f.runtime.engine.runReady(); const attempt = f.rows("attempt")[0]; assert.notEqual(attempt.phase, "succeeded");
  assert.equal(f.calls.speech, 1); assert.equal(f.rows("external_allowance_consumption").length, 1);
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseExpiresAt: 0 });
  f.keys = false; f.open(); await f.runtime.engine.reconcile();
  const recovered = f.store.get("attempt", attempt.id); assert.equal(recovered.phase, "succeeded");
  assert.equal(f.calls.speech, 1); assert.equal(f.calls.normalization, 1); assert.equal(f.rows("attempt").length, 1);
  assert.equal(f.rows("external_allowance_consumption").length, 1); assert.equal(f.store.get("reservation", recovered.reservationId).state, "charged");
});
