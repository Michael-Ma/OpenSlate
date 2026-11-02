import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, digest } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { OpenAITranscriptionExecution } from "../dist/execution/openai-transcription-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { TranscriptionAudioService } from "../dist/execution/transcription-audio-service.js";
import { TranscriptionAudioStore } from "../dist/media/transcription-audio-store.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { NarrationService, NarrationCanonicalService } from "../dist/narration/index.js";
import { ConfiguredExternalAdmission } from "../dist/execution/configured-external-admission.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ProductionService } from "../dist/application/service.js";
import { projectFixture } from './execution-fixture.mjs';
import { createShotNarrationSession } from '../dist/narration/narration-scope.js';
import { createShotAudioWorkspace } from '../dist/narration/shot-audio-routes.js';
import { wave } from "./speech-execution-fixture.mjs";

export const key = "offline-transcription-bridge-fixture", hash = value => createHash("sha256").update(value).digest("hex");
export const payload = extra => ({ text: "Leather boots.", language: "english", duration: 1,
  words: [{ word: "Leather", start: 0.1, end: 0.45 }, { word: "boots.", start: 0.5, end: 0.9 }], ...extra });
export const raw = Buffer.from(` \n${JSON.stringify(payload({ model: "whisper-1", usage: { type: "duration", seconds: 1 } }))}\n`);
export const response = (bytes = raw) => new Response(bytes, { headers: { "content-type": "application/json", "x-request-id": "req-transcription-diagnostic" } });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });

/** Real accepted canonical narration, grant and configured provider admission; API and estimates are explicitly synthetic. */
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
  const policy = new ConfiguredExternalAdmission(store, () => {});
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs, externalAdmission: policy });
  const production = new ProductionService(store, engine, [profile]);
  const created = production.createProject("Offline transcription bridge"), shape = projectFixture(created.id, 1);
  let project = store.saveProject({ ...created, revisionId: shape.revisionId, scenes: shape.scenes, shots: shape.shots }, created.headVersion);
  store.insert('project_revision', project.revisionId, project.id, { project });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration);
  const session = createShotNarrationSession(production, project.id, project.shots[0].id, randomUUID());
  const human = { kind: 'human', principalId: session.principalId, requestId: session.requestId };
  const workspace = createShotAudioWorkspace({ production, narration, canonical, actorFor: () => human });
  const view = () => narration.workspaceSnapshot(project.id), version = () => view().state.version;
  const writing = workspace.saveWriting(project.id, project.shots[0].id, { sessionId: session.id, expectedHeadVersion: project.headVersion,
    expectedVersion: version(), text: 'Leather boots.', language: 'en', mode: 'uploaded', voice: null, profileRevisionId: null }, randomUUID());
  const audio = await narration.importAudio(project.id, human, { path: sourcePath, declaredOrigin: "uploaded", key: randomUUID() });
  const segment = writing.segment; narration.bindAudio(project.id, human, version(), randomUUID(), segment.entry.segmentId, audio.id);
  await workspace.accept(project.id, project.shots[0].id, { sessionId: session.id, expectedHeadVersion: store.getProject(project.id).headVersion,
    expectedVersion: version(), segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id, audioId: audio.id,
    sha256: audio.media.sha256, startSample: 0, endSample: 48000 }, randomUUID());
  project = store.getProject(project.id);
  assert.ok(project.artifacts.some(item => item.artifactId === audio.id));
  const q = JSON.stringify, language = options.language ?? "auto", timing = options.timing ?? "word";
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{return p.transcription("transcript",{profile:${q(profile.id)},audio:p.asset(${q(audio.id)}),language:${q(language)},${options.omitTiming ? "" : `timing:${q(timing)},`}settings:${q(options.settings ?? {})}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID }), node = plan.nodes[0];
  const transcriptionHuman = production.beginRequest(project.id, 'offline-human', 'Transcribe this accepted recording');
  const grant = production.authorize(project.id, transcriptionHuman, [{ scopeId: project.id, kind: "transcription" }], randomUUID(), "initial_slot")[0], planId = randomUUID();
  engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  for (const hold of rows({ store, project }, "hold")) if (hold.active && hold.ownerId === transcriptionHuman.requestId) engine.releaseHold(project.id, hold.id, transcriptionHuman.requestId);
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint);
  const attempt = options.deferAdmission ? undefined : admit();
  const prepare = preparation.prepare.bind(preparation), upload = files.readUpload.bind(files);
  preparation.prepare = async (...args) => { calls.prepare++; return prepare(...args); };
  files.readUpload = async (...args) => { calls.upload++; return upload(...args); };
  return { directory, path, store, stores, project, profile, outputs, bridge, preparation, files, media, credentials, fetch, calls, engine, production,
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
