import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, DEFAULT_PROFILES, digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { NarrationService } from "../dist/narration/service.js";
import { OwnedTranscriptionService } from "../dist/narration/owned-transcription-service.js";
import { projectFixture } from "./execution-fixture.mjs";

export const key = () => randomUUID();
export const draft = (text = "Unreviewed draft section.") => ({ text, meaning: text, textKind: "draft", language: "en", source: { kind: "uploaded" } });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const bodies = (f, kinds) => canonical(Object.fromEntries(kinds.map(kind => [kind, rows(f, kind)])));
export const transcriptionProfile = Object.freeze({ id: "owned-recording-asr", revision: "offline-estimate-1", kind: "transcription",
  adapter: "openai-transcription", executionVersion: "1", configuration: { model: "whisper-1", settings: {} },
  maxConcurrency: 1, unitCostMicros: "100", maxRetries: 0 });

function wave() {
  const samples = 2400, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(3000 * Math.sin(index * Math.PI / 30)), 44 + index * 2);
  return bytes;
}
function fullSource(project) {
  let source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
  for (const [index, shot] of project.shots.entries()) source += `const shot${index}=p.shot(${JSON.stringify(shot.id)});`
    + `const image${index}=p.image("frame-${index}",{intent:shot${index},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`
    + `const review${index}=p.humanReview("review-${index}",{shots:[{intent:shot${index},keyframe:image${index},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});`
    + `const video${index}=p.video("take-${index}",{intent:shot${index},profile:"fake-video-v1",firstFrame:p.approvedImage(image${index},review${index}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});`;
  return source + `const edit=p.timeline("edit",{takes:[video0,video1],transition:"cut"});return p.render("preview",{timeline:edit,format:"mp4"});});`;
}

/** Real owned WAV import; preparation itself performs no derivative conversion or provider call. */
export async function ownedTranscriptionFixture(t, options = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "openslate-owned-transcription-"))), root = join(parent, "installation"), inputs = join(parent, "inputs");
  mkdirSync(root); mkdirSync(inputs); const originalPath = join(inputs, "original.wav"); writeFileSync(originalPath, wave());
  const profile = structuredClone(transcriptionProfile), profiles = [...DEFAULT_PROFILES, profile];
  const store = new Store(join(root, "openslate.sqlite")), provider = new FakeProvider(join(root, "fake-provider.sqlite")), artifactDir = join(root, "artifacts");
  const engine = new Engine(store, provider, { artifactDir, profiles }), production = new ProductionService(store, engine, profiles);
  let project = production.createProject("Owned recording proposal");
  if (options.plan) project = store.saveProject({ ...projectFixture(project.id, 2), capabilityLockId: project.capabilityLockId }, project.headVersion);
  const human = production.beginRequest(project.id, "human", "Prepare transcription of my owned recording."), actor = production.openEpoch(project.id, human).actor;
  const media = new LocalMediaService({ rootDir: join(root, "media"), allowedInputRoots: [inputs],
    ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg"),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") });
  const narration = new NarrationService(production, media), service = new OwnedTranscriptionService(narration, artifactDir);
  const f = { parent, root, directory: root, inputs, originalPath, artifactDir, store, provider, engine, production, media, narration, service, project, human, actor, profile, profiles };
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(parent, { recursive: true, force: true }); });
  if (options.plan) {
    const before = store.getProject(project.id);
    production.authorize(project.id, human, before.shots.flatMap(shot => ["image", "video"].map(kind => ({ scopeId: shot.id, kind }))), key(), "initial_slot");
    const prepared = await production.prepare(project.id, actor, { variant: "plan", expectedHeadVersion: before.headVersion, source: fullSource(before) });
    production.apply(project.id, actor, prepared.id);
  }
  f.audio = await narration.importAudio(project.id, human, { path: originalPath, declaredOrigin: "uploaded", key: key() }); f.source = f.audio.media;
  f.view = () => narration.snapshot(project.id, human);
  f.revise = patch => narration.reviseSegments(project.id, human, f.view().state.version, key(), patch);
  f.bind = (index, audioId = f.audio.id) => narration.bindAudio(project.id, human, f.view().state.version, key(), f.view().segments[index].entry.segmentId, audioId);
  if (options.section) { f.revise({ add: [draft(), draft("Keep this unrelated section.")] }); f.bind(0); f.bind(1); }
  f.input = (patch = {}) => ({ key: key(), expectedHeadVersion: store.getProject(project.id).headVersion, audioId: f.audio.id,
    sourceRecordDigest: digest(f.audio), profileId: profile.id, language: "auto",
    target: options.section ? { kind: "section", segmentId: f.view().segments[0].entry.segmentId,
      segmentRevisionId: f.view().segments[0].script.id, audioId: f.audio.id } : { kind: "recording" }, ...patch });
  f.prepare = (input = f.input(), prepareOptions = {}) => service.prepare(project.id, actor, input, prepareOptions);
  f.project = store.getProject(project.id); return f;
}
