import { canonical, digest, invariant } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { Attempt } from "./engine.js";
import type { SuppliedMedia } from "../media/types.js";
import { assertTranscriptionAudioRecipe, assertTranscriptionAudioMeasurement } from "../media/transcription-audio-types.js";
import type { MeasuredTranscriptionAudio, TranscriptionAudioRecipe } from "../media/transcription-audio-types.js";

export interface TranscriptionAudioSourceRecord { kind: "media_source" | "narration_audio"; record: { id: string; projectId: string; source?: SuppliedMedia; media?: SuppliedMedia } }
export interface TranscriptionAudioIntent {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string;
  sourceRecord: { kind: TranscriptionAudioSourceRecord["kind"]; id: string; digest: string };
  source: SuppliedMedia; sourceStartSample: 0; sourceEndSample: number; recipe: TranscriptionAudioRecipe;
}
export interface TranscriptionAudioReceipt {
  id: string; version: 1; projectId: string; attemptId: string; intentDigest: string; audio: MeasuredTranscriptionAudio;
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const exact = (value: unknown, fields: string[]): boolean => !!value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\0") === [...fields].sort().join("\0");
const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPTION_AUDIO_CONFLICT", message);
export function transcriptionAudioId(projectId: string, attemptId: string): string {
  return digest({ version: 1, kind: "transcription_audio", projectId, attemptId });
}
export function transcriptionAudioInput(attempt: Attempt): ArtifactRef {
  const inputs = attempt.request?.inputs;
  fail(attempt.request?.attemptId === attempt.id && attempt.request.kind === "transcription" && Array.isArray(inputs) && inputs.length === 1
    && inputs[0]?.kind === "audio" && hash(inputs[0].sha256) && typeof inputs[0].artifactId === "string"
    && inputs[0].artifactId.length > 0 && inputs[0].artifactId.length <= 160, "Transcription requires exactly one frozen audio input");
  return inputs[0]!;
}

export function assertTranscriptionAudioSource(source: SuppliedMedia): void {
  const audio = source?.probe?.audio;
  fail(exact(source, ["id", "artifactId", "kind", "originalSha256", "originalByteLength", "sha256", "byteLength", "probe", "toolchainDigest"])
    && source.kind === "audio" && typeof source.artifactId === "string" && source.artifactId.length > 0 && source.artifactId.length <= 160
    && hash(source.id) && hash(source.sha256) && hash(source.originalSha256) && hash(source.toolchainDigest)
    && integer(source.originalByteLength, 1, 1024 ** 3) && integer(source.byteLength, 44, 256 * 1024 ** 2)
    && exact(source.probe, ["durationSeconds", "audio"]) && exact(audio, ["streamIndex", "sampleRate", "channels", "samples", "durationSeconds", "codec"])
    && audio?.streamIndex === 0 && audio.sampleRate === 48000 && audio.channels === 2 && audio.codec === "pcm_s16le"
    && integer(audio.samples, 1, 17_280_000), "Transcription requires a complete owned 48 kHz stereo PCM source");
  const samples = audio!.samples!;
  fail(source.byteLength >= samples * 4 + 44 && source.byteLength <= samples * 4 + 65536
    && Number.isFinite(source.probe.durationSeconds) && Number.isFinite(audio!.durationSeconds)
    && Math.abs(source.probe.durationSeconds - samples / 48000) <= 1 / 48000 + 0.000001
    && Math.abs(audio!.durationSeconds - samples / 48000) <= 1 / 48000 + 0.000001,
  "Owned audio descriptor differs from its measured complete PCM");
  const { id, ...body } = source; fail(id === digest(body), "Source descriptor digest differs");
}

/** Resolve only stored same-project records. An equivalent additional record does not replace a pinned provenance reference. */
export function resolveTranscriptionAudioSource(attempt: Attempt, records: TranscriptionAudioSourceRecord[], pinned?: TranscriptionAudioIntent["sourceRecord"]): TranscriptionAudioSourceRecord {
  const input = transcriptionAudioInput(attempt);
  const matching = records.filter(({ kind, record }) => record?.projectId === attempt.projectId
    && (kind === "media_source" || kind === "narration_audio")
    && ((kind === "media_source" ? record.source : record.media)?.artifactId === input.artifactId || record.id === input.artifactId));
  fail(matching.length > 0, "No owned source matches this transcription input");
  let descriptor: string | undefined;
  for (const entry of matching) {
    const source = (entry.kind === "media_source" ? entry.record.source : entry.record.media)!;
    assertTranscriptionAudioSource(source);
    fail(entry.record.id === input.artifactId && source.artifactId === input.artifactId && source.sha256 === input.sha256, "Matching source record differs from the frozen audio input");
    const next = canonical(source); fail(descriptor === undefined || descriptor === next, "Matching source records conflict"); descriptor = next;
  }
  if (pinned) {
    const found = matching.find(entry => entry.kind === pinned.kind && entry.record.id === pinned.id);
    fail(found && digest(found.record) === pinned.digest, "Pinned source provenance is missing or changed"); return found!;
  }
  return [...matching].sort((a, b) => a.kind.localeCompare(b.kind) || a.record.id.localeCompare(b.record.id))[0]!;
}

export function assertTranscriptionAudioIntent(intent: TranscriptionAudioIntent, attempt: Attempt, sourceRecord: TranscriptionAudioSourceRecord): void {
  fail(exact(intent, ["id", "version", "projectId", "attemptId", "requestDigest", "sourceRecord", "source", "sourceStartSample", "sourceEndSample", "recipe"])
    && intent.version === 1 && intent.id === transcriptionAudioId(attempt.projectId, attempt.id) && intent.projectId === attempt.projectId
    && intent.attemptId === attempt.id && intent.requestDigest === digest(attempt.request)
    && exact(intent.sourceRecord, ["kind", "id", "digest"]), "Transcription intent differs from its admitted request");
  const selected = resolveTranscriptionAudioSource(attempt, [sourceRecord], intent.sourceRecord);
  const source = selected.kind === "media_source" ? selected.record.source : selected.record.media;
  fail(canonical(source) === canonical(intent.source) && intent.sourceStartSample === 0 && intent.sourceEndSample === source!.probe.audio!.samples,
    "Transcription intent must retain the full original source and time origin");
  assertTranscriptionAudioRecipe(intent.recipe);
  fail(intent.source.byteLength <= intent.recipe.maxInputBytes && intent.sourceEndSample <= intent.recipe.maxSourceSamples,
    "Source exceeds the pinned preparation bounds");
  const expected = Math.ceil(intent.sourceEndSample / 3), reserve = Math.min(intent.recipe.maxOutputSamples, expected + 1);
  invariant(expected <= intent.recipe.maxOutputSamples && reserve * 2 + 65536 <= intent.recipe.maxOutputBytes,
    "TRANSCRIPTION_AUDIO_OUTPUT_LIMIT", "Preparation cannot preserve the complete recording within its output bound");
  fail(Buffer.byteLength(canonical(intent)) <= 32768, "Transcription intent exceeds its metadata bound");
}

export function assertTranscriptionAudioReceipt(intent: TranscriptionAudioIntent, receipt: TranscriptionAudioReceipt, requireCompleteEndpoint = true): void {
  fail(exact(receipt, ["id", "version", "projectId", "attemptId", "intentDigest", "audio"]) && receipt.version === 1
    && receipt.id === intent.id && receipt.projectId === intent.projectId && receipt.attemptId === intent.attemptId
    && receipt.intentDigest === digest(intent), "Transcription receipt differs from its exact preparation intent");
  assertTranscriptionAudioMeasurement(receipt.audio, intent.sourceEndSample, intent.recipe, requireCompleteEndpoint);
  fail(Buffer.byteLength(canonical(receipt)) <= 32768, "Transcription receipt exceeds its metadata bound");
}
