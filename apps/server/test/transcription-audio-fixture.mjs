import { randomUUID, createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { TranscriptionAudioStore } from "../dist/media/transcription-audio-store.js";
import { TranscriptionAudioService } from "../dist/execution/transcription-audio-service.js";
import { projectFixture } from "./execution-fixture.mjs";

export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export function wav(samples = 48000, rate = 48000, channels = 2) {
  const bytes = Buffer.alloc(44 + samples * channels * 2); bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32);
  bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = Math.floor(samples / 5); i < samples * 4 / 5; i++) for (let c = 0; c < channels; c++)
    bytes.writeInt16LE(Math.round(12000 * Math.sin(i * (c ? 0.19 : 0.11))), 44 + (i * channels + c) * 2);
  return bytes;
}
export function clean(path) { if (!existsSync(path)) return; if (lstatSync(path).isDirectory()) {
  chmodSync(path, 0o700); for (const name of readdirSync(path)) clean(join(path, name)); } rmSync(path, { recursive: true, force: true }); }
export async function fixture(t, { sourceKind = "media_source", samples = 48000 } = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "openslate-transcription-audio-"))), root = join(parent, "installation"), inputDir = join(parent, "input");
  mkdirSync(root); mkdirSync(inputDir); const sourcePath = join(inputDir, "recording.wav"); writeFileSync(sourcePath, wav(samples));
  const options = { rootDir: join(root, "media"), allowedInputRoots: [inputDir],
    ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg"),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") };
  const fake = new FakeProvider(join(root, "fake-provider.sqlite")); fake.close();
  let store = new Store(join(root, "openslate.sqlite")), media = new LocalMediaService(options), files, service;
  const project = projectFixture(randomUUID(), 0); store.createProject(project);
  const source = await media.importMedia({ artifactId: randomUUID(), path: sourcePath, kind: "audio" });
  const requestId = randomUUID(); store.insert("message", requestId, project.id, { role: "user", principalId: "human", text: "Import this recording", editing: true });
  const record = sourceKind === "media_source"
    ? store.insert(sourceKind, source.artifactId, project.id, { source, requestId })
    : store.insert(sourceKind, source.artifactId, project.id, { media: source, declaredOrigin: "uploaded", requestId });
  const attemptId = randomUUID(), request = { attemptId, nodeId: "transcript", kind: "transcription", fingerprint: "frozen-input",
    args: { profileIdentity: "fake-transcription-v1", language: "en" }, inputs: [{ artifactId: source.artifactId, kind: "audio", sha256: source.sha256 }] };
  const grantId = randomUUID(), candidateId = randomUUID();
  store.insert("grant", grantId, project.id, { scopeId: project.id, kind: "transcription", authorityId: requestId, origin: "initial_slot" });
  store.insert("candidate", candidateId, project.id, { nodeId: request.nodeId, grantId, origin: "initial_slot" });
  const attempt = store.insert("attempt", attemptId, project.id, { nodeId: request.nodeId, candidateId, ordinal: 1, specDigest: digest(request), fingerprint: request.fingerprint,
    request, workKey: null, phase: "submitting", leaseOwner: "original-owner", leaseEpoch: 1, leaseExpiresAt: Date.now() + 120000,
    taskId: null, reservationId: null, failure: null, outputs: {}, createdAt: new Date().toISOString() });
  const calls = { describe: 0, derive: 0 }, controller = new AbortController();
  const setup = (forbid = false) => {
    files = new TranscriptionAudioStore({ rootDir: join(root, "audio-derivatives") });
    const describe = media.describeTranscriptionAudio.bind(media), derive = media.deriveTranscriptionAudio.bind(media);
    media.describeTranscriptionAudio = async (...args) => { if (forbid) throw Error("recipe lookup forbidden during completion recovery"); calls.describe++; return describe(...args); };
    media.deriveTranscriptionAudio = async (...args) => { if (forbid) throw Error("repeat conversion forbidden"); calls.derive++; return derive(...args); };
    service = new TranscriptionAudioService(store, media, files);
  };
  setup();
  t.after(() => { if (store.db.open) store.close(); clean(parent); });
  return { root, parent, project, source, sourceKind, record, request, attempt, calls, controller,
    originalBytes: readFileSync(join(root, "media", "blobs", `${source.sha256}.wav`)),
    get store() { return store; }, get media() { return media; }, get files() { return files; }, get service() { return service; },
    options(value = attempt) { return { expectedLease: { owner: value.leaseOwner, epoch: value.leaseEpoch }, signal: controller.signal }; },
    prepare(value = attempt) { return service.prepare(value, this.options(value)); },
    reopen(forbid = true) { if (store.db.open) store.close(); store = new Store(join(root, "openslate.sqlite")); media = new LocalMediaService(options); setup(forbid); },
  };
}
