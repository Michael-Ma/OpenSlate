import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { parseOpenAITranscriptionResponse } from "@openslate/providers";
import type { ArtifactRecord } from "../execution/engine.js";
import { createTranscriptCandidate } from "../execution/transcript-candidate.js";
import { TRANSCRIPT_CANDIDATE_LIMITS } from "../execution/transcript-candidate.js";
import type { LocalMediaService } from "../media/local-media.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { assertTranscriptionAudioSource } from "../execution/transcription-audio.js";
import type { NarrationAudio } from "./types.js";
import { isVerifiedGeneratedNarrationAudio, resolveGeneratedNarrationAudio, verifyGeneratedNarrationAudio } from "./generated-audio.js";
import { resolvePublishedTranscriptCandidate, snapshotTranscriptSelectionData, transcriptSelectionRecord,
  transcriptSelectionByteHash, TRANSCRIPT_SELECTION_LIMITS } from "./transcript-selection.js";
import type { ResolvedPublishedTranscriptCandidate } from "./transcript-selection.js";

const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPT_SELECTION_CONFLICT", message);
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "TRANSCRIPT_SELECTION_CANCELLED", "Transcript selection verification cancelled");

async function readExact(path: string, expectedBytes: number | null, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  stopped(signal); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const before = await file.stat(); stopped(signal);
    fail(before.isFile() && before.size > 0 && before.size <= maximum && (expectedBytes === null || before.size === expectedBytes), "Owned transcript evidence size differs");
    bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { stopped(signal); const part = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset); stopped(signal);
      fail(part.bytesRead > 0, "Owned transcript evidence was truncated"); offset += part.bytesRead; }
    const tail = await file.read(Buffer.alloc(1), 0, 1, bytes.length), after = await file.stat(); stopped(signal);
    fail(tail.bytesRead === 0 && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, "Owned transcript evidence changed during reading");
  } finally { await file.close(); stopped(signal); }
  return bytes;
}
/** Existing completed evidence only: no repairs, provider calls, conversion, upload preparation, or active ingestion lease. */
export async function verifyTranscriptSelectionEvidence(store: Parameters<typeof resolvePublishedTranscriptCandidate>[0], media: Pick<LocalMediaService, "rootDir">,
  configuration: { artifactDir: string }, input: ResolvedPublishedTranscriptCandidate, audioInput: NarrationAudio,
  options: { signal?: AbortSignal } = {}): Promise<ResolvedPublishedTranscriptCandidate> {
  const signal = options.signal, artifactDir = configuration.artifactDir, mediaRoot = media.rootDir;
  const captured = snapshotTranscriptSelectionData(input, TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes + 4 * TRANSCRIPT_SELECTION_LIMITS.contextBytes);
  fail(captured?.candidate && typeof captured.candidateDigest === "string", "Missing selected transcript evidence");
  const audio = snapshotTranscriptSelectionData(audioInput), candidateId = captured.candidate.id, candidateDigest = captured.candidateDigest;
  stopped(signal); fail(typeof artifactDir === "string" && isAbsolute(artifactDir) && artifactDir !== "/" && typeof mediaRoot === "string" && isAbsolute(mediaRoot) && mediaRoot !== "/", "Configure private absolute transcript evidence roots");
  const initial = resolvePublishedTranscriptCandidate(store, audio.projectId, candidateId);
  fail(initial.candidateDigest === candidateDigest, "Transcript candidate changed before selection verification");
  const saved = transcriptSelectionRecord<NarrationAudio>(store, "narration_audio", audio.id, audio.projectId);
  assertTranscriptionAudioSource(audio.media);
  fail(canonical(saved) === canonical(audio) && audio.id === audio.media.artifactId && canonical(audio.media) === canonical(initial.candidate.source.descriptor)
    && initial.candidate.source.endSample === audio.media.probe.audio!.samples, "Transcript selection belongs to another attached recording");
  const root = await realpath(artifactDir); stopped(signal);
  fail(root === artifactDir, "Configure the canonical transcript artifact root");
  fail(/^[A-Za-z0-9_-]{1,128}$/.test(audio.projectId), "Invalid owned transcript project directory");
  const directory = join(root, audio.projectId), blobs = join(mediaRoot, "blobs"), sources = join(mediaRoot, "sources");
  const directories = async (): Promise<void> => { for (const path of [root, directory, mediaRoot, blobs, sources]) {
    stopped(signal); fail(await realpath(path) === path, "Owned transcript evidence directories cannot become links"); stopped(signal);
  } };
  await directories();
  if (isVerifiedGeneratedNarrationAudio(audio)) {
    const generated = resolveGeneratedNarrationAudio(store, audio.projectId, audio.id);
    fail(canonical(generated.audio) === canonical(audio), "Generated recording provenance differs");
    await verifyGeneratedNarrationAudio(store, media, { artifactDir: root }, generated, signal ? { signal } : {}); stopped(signal);
  } else {
    const descriptorBytes = await readExact(join(sources, `${audio.media.id}.json`), null, 32768, signal); stopped(signal);
    let descriptor: unknown; try { descriptor = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(descriptorBytes)); } catch { fail(false, "Malformed owned source descriptor"); }
    fail(canonical(descriptor) === canonical(audio.media), "Owned source descriptor differs from the recording");
    const artifact = transcriptSelectionRecord<ArtifactRecord>(store, "artifact", audio.id, audio.projectId), source = audio.media;
    fail(artifact.origin === "narration_audio" && artifact.fixture === false && artifact.attemptId === null && artifact.mimeType === "audio/wav"
      && artifact.byteLength === source.byteLength && artifact.sourceDescriptorId === source.id
      && canonical(artifact.artifact) === canonical({ artifactId: audio.id, kind: "audio", sha256: source.sha256 })
      && artifact.path === join(directory, `${source.sha256}.wav`) && artifact.physicalDurationSeconds === source.probe.audio!.samples! / 48000,
    "Attached recording lacks its exact installed audio artifact");
    for (const path of [join(blobs, `${source.sha256}.wav`), artifact.path]) {
      const observed = await inspectPcmWave(path, 256 * 1024 ** 2, signal); stopped(signal);
      fail(observed.sha256 === source.sha256 && observed.byteLength === source.byteLength && observed.pcm.sampleRate === 48000 && observed.pcm.channels === 2
        && observed.pcm.bitsPerSample === 16 && observed.pcm.sampleCount === source.probe.audio!.samples, "Owned normalized recording changed");
    }
  }
  await directories();
  const artifact = initial.artifact, path = join(directory, `${initial.candidate.raw.sha256}.json`);
  fail(artifact.path === path, "Raw transcript is outside its exact installed artifact path");
  const bytes = await readExact(path, initial.candidate.raw.byteLength, TRANSCRIPT_SELECTION_LIMITS.rawBytes, signal); stopped(signal);
  fail(transcriptSelectionByteHash(bytes) === initial.candidate.raw.sha256, "Raw transcript bytes changed");
  const parser = initial.candidate.parser, parsed = parseOpenAITranscriptionResponse({ bytes, mimeType: "application/json",
    sourceDurationSeconds: initial.lineage.preparation.receipt.audio.sampleCount / 16000 },
  { maxTextBytes: parser.maxTextBytes, maxWords: parser.maxWords, maxWordBytes: parser.maxWordBytes });
  fail(canonical(createTranscriptCandidate(initial.lineage, parsed)) === canonical(initial.candidate), "Saved transcript does not match its exact raw response and source mapping");
  await directories(); stopped(signal);
  const current = resolvePublishedTranscriptCandidate(store, audio.projectId, candidateId);
  fail(current.candidateDigest === initial.candidateDigest && digest(current.artifact) === digest(initial.artifact)
    && canonical(transcriptSelectionRecord(store, "narration_audio", audio.id, audio.projectId)) === canonical(audio), "Transcript selection evidence changed during verification");
  stopped(signal); return current;
}
