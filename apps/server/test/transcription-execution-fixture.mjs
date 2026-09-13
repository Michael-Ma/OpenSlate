import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, digest, providerProfileArguments } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { OpenAITranscriptionExecution } from "../dist/execution/openai-transcription-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { TranscriptionAudioService } from "../dist/execution/transcription-audio-service.js";
import { TranscriptionAudioStore } from "../dist/media/transcription-audio-store.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { NarrationService, NarrationCanonicalService } from "../dist/narration/index.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ProductionService } from "../dist/application/service.js";
import { ExternalAllowanceService, allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { wave } from "./speech-execution-fixture.mjs";

export const key = "offline-transcription-bridge-fixture", hash = value => createHash("sha256").update(value).digest("hex");
export const payload = extra => ({ text: "Leather boots.", language: "english", duration: 1,
  words: [{ word: "Leather", start: 0.1, end: 0.45 }, { word: "boots.", start: 0.5, end: 0.9 }], ...extra });
export const raw = Buffer.from(` \n${JSON.stringify(payload({ model: "whisper-1", usage: { type: "duration", seconds: 1 } }))}\n`);
export const response = (bytes = raw) => new Response(bytes, { headers: { "content-type": "application/json", "x-request-id": "req-transcription-diagnostic" } });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });

/** Real accepted canonical narration, grant and human spending consumption; API and estimates are explicitly synthetic. */
export async function transcriptionFixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-transcription-execution-"))), path = join(directory, "openslate.sqlite");
  const store = new Store(path), stores = [store], artifactRoot = join(directory, "artifacts"); mkdirSync(artifactRoot);
  t.after(() => { for (const saved of stores) if (saved.db.open) saved.close(); rmSync(directory, { recursive: true, force: true }); });
  const profile = { id: "offline-transcription", revision: "fixture-estimate-1", kind: "transcription", adapter: "openai-transcription", executionVersion: "1",
    configuration: { model: options.model ?? "whisper-1", settings: options.profileSettings ?? {} }, maxConcurrency: 2, unitCostMicros: "100", maxRetries: 0 };
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, "execution-output") });
  const sourcePath = join(directory, "original.wav"); writeFileSync(sourcePath, wave());
  const tool = name => process.env[`OPENSLATE_${name.toUpperCase()}_PATH`] ?? (existsSync(`/opt/homebrew/bin/${name}`) ? `/opt/homebrew/bin/${name}` : `/usr/bin/${name}`);
  const media = new LocalMediaService({ rootDir: join(directory, "media"), allowedInputRoots: [directory], ffmpegPath: tool("ffmpeg"), ffprobePath: tool("ffprobe") });
  const files = new TranscriptionAudioStore({ rootDir: join(directory, "audio-derivatives") }), preparation = new TranscriptionAudioService(store, media, files);
  const calls = { http: 0, credentials: 0, prepare: 0, upload: 0 };
  const credentials = new EnvironmentMediaCredentials(name => { calls.credentials++; assert.equal(name, "OPENSLATE_OPENAI_API_KEY"); return options.credential ? options.credential() : key; });
  const fetch = async (...args) => { calls.http++; return (options.fetch ?? (async () => response()))(...args); };
  const bridge = new OpenAITranscriptionExecution({ store, outputStore: outputs, preparation, credentials, fetch, timeoutMs: options.timeoutMs ?? 1000 });
  const policy = new DurableExternalAdmission(store, () => {});
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs, externalAdmission: policy });
  const production = new ProductionService(store, engine, [profile]), allowances = new ExternalAllowanceService(store);
  let project = production.createProject("Offline transcription bridge");
  const human = production.beginRequest(project.id, "offline-human", "Import and accept this synthetic recording");
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration);
  const view = () => narration.snapshot(project.id, human), version = () => view().state.version;
  narration.reviseSegments(project.id, human, version(), randomUUID(), { add: [{ text: "Leather boots.", meaning: "Leather boots.", textKind: "draft", language: "en", source: { kind: "uploaded" } }] });
  const audio = await narration.importAudio(project.id, human, { path: sourcePath, declaredOrigin: "uploaded", key: randomUUID() });
  const segment = view().segments[0]; narration.bindAudio(project.id, human, version(), randomUUID(), segment.entry.segmentId, audio.id);
  narration.recordHumanCue(project.id, human, version(), randomUUID(), { segmentId: segment.entry.segmentId, startSample: 0, endSample: 48000 });
  narration.accept(project.id, human, version(), randomUUID(), "script", [segment.script.id]);
  narration.acceptAudio(project.id, human, version(), randomUUID(), [{ segmentRevisionId: segment.script.id, audioId: audio.id }]);
  narration.accept(project.id, human, version(), randomUUID(), "timing", [view().segments[0].cue.id]);
  const prepared = canonical.prepare(project.id, human, { expectedHeadVersion: project.headVersion, expectedNarrationVersion: version(), shotMappings: [], key: randomUUID() });
  await canonical.apply(project.id, human, prepared.id); project = store.getProject(project.id);
  assert.ok(project.artifacts.some(item => item.artifactId === audio.id));
  const q = JSON.stringify, language = options.language ?? "auto", timing = options.timing ?? "word";
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{return p.transcription("transcript",{profile:${q(profile.id)},audio:p.asset(${q(audio.id)}),language:${q(language)},${options.omitTiming ? "" : `timing:${q(timing)},`}settings:${q(options.settings ?? {})}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID }), node = plan.nodes[0];
  const grant = production.authorize(project.id, human, [{ scopeId: project.id, kind: "transcription" }], randomUUID(), "initial_slot")[0], planId = randomUUID();
  engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  for (const hold of rows({ store, project }, "hold")) if (hold.active && hold.ownerId === human.requestId) engine.releaseHold(project.id, hold.id, human.requestId);
  const binding = store.get("node_binding", node.id);
  const allowanceInput = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
    selections: [{ candidateId: binding.candidateId, nodeId: node.id, specDigest: node.specDigest }], maxAttempts: 1,
    maxEstimatedMicros: "100", expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const actor = production.beginRequest(project.id, "offline-human", "Approve this exact transcription", { editing: false,
    scopeIds: [project.id], contextDigest: allowanceIssueContextDigest(project.id, allowanceInput) });
  const allowance = allowances.issue(project.id, actor, allowanceInput);
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint);
  const attempt = options.deferAdmission ? undefined : admit();
  const prepare = preparation.prepare.bind(preparation), upload = files.readUpload.bind(files);
  preparation.prepare = async (...args) => { calls.prepare++; return prepare(...args); };
  files.readUpload = async (...args) => { calls.upload++; return upload(...args); };
  return { directory, path, store, stores, project, profile, outputs, bridge, preparation, files, media, credentials, fetch, calls, engine, production, allowances, allowance,
    artifactRoot, sourcePath, audio, canonical, narration, node, grant, attempt, request: attempt?.request, admit, language, timing };
}
export function restart(f) {
  f.store.close(); const store = new Store(f.path); f.stores.push(store);
  const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "execution-output") });
  const forbidden = () => { throw Error("recovery cannot prepare audio or resolve credentials"); };
  const preparation = { store, prepare: forbidden, files: { readUpload: forbidden } };
  const bridge = new OpenAITranscriptionExecution({ store, outputStore: outputs, preparation,
    credentials: new EnvironmentMediaCredentials(forbidden), fetch: forbidden });
  return { store, outputs, bridge };
}
