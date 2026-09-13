import { canonical, digest, invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { IngestibleExecutionOutput } from "@openslate/providers";
import type { Attempt, ArtifactRecord } from "./engine.js";
import type { GeneratedAudioMediaSource } from "../media/application-types.js";
import type { AudioPcmGeometry, MediaAudioNormalizationIdentity, SuppliedMedia } from "../media/types.js";

export const AUDIO_DERIVATION_LIMITS = Object.freeze({ inputBytes: 32 * 1024 * 1024, outputBytes: 256 * 1024 * 1024,
  metadataBytes: 32768, headerBytes: 65536, maxSamples: 48000 * 360, timeoutMs: 120000 });
export const AUDIO_PCM_SAMPLE_RATES = Object.freeze([8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000]);
export interface AudioDerivationIntent {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string;
  slotId: string; spoolId: string; rawSha256: string; rawByteLength: number;
  artifactId: string; recipe: "generated-audio-v1"; rawPcm: AudioPcmGeometry; normalization: MediaAudioNormalizationIdentity;
}
export interface AudioDerivationReceipt {
  id: string; version: 1; projectId: string; attemptId: string; intentDigest: string; source: SuppliedMedia;
  normalizedSamples: number; endpointDeltaNumerator: number;
}
export interface NormalizedAudioIngestion {
  type: "normalized_audio"; artifact: ArtifactRecord; derivation: AudioDerivationReceipt; mediaSource: GeneratedAudioMediaSource;
}
export function audioDerivationId(projectId: string, attemptId: string): string {
  return digest({ version: 1, kind: "generated_audio_derivation", slotId: digest({ projectId, attemptId, port: "audio" }) });
}
export function audioArtifactId(derivationId: string): string { return digest({ version: 1, kind: "generated_audio_artifact", derivationId }); }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

/** Capacity is checked before conversion; the human importer's 0.1-second tolerance is never an audio completion rule. */
export function assertAudioNormalizationCapacity(intent: AudioDerivationIntent): void {
  const pcm = intent.rawPcm, recipe = intent.normalization;
  const idealCeiling = Math.ceil(pcm.sampleCount * 48000 / pcm.sampleRate);
  const capacitySamples = Math.min(recipe.maxSamples, idealCeiling + (pcm.sampleRate === 48000 ? 0 : 1));
  invariant(idealCeiling <= recipe.maxSamples && capacitySamples * 4 + AUDIO_DERIVATION_LIMITS.headerBytes <= recipe.maxOutputBytes,
    "AUDIO_NORMALIZATION_OUTPUT_LIMIT", "The configured worker cannot preserve the complete normalized PCM output");
}

export function assertAudioDerivationIntent(intent: AudioDerivationIntent, attempt: Attempt, output: IngestibleExecutionOutput): void {
  invariant(isSpoolOutput(output) && output.kind === "audio" && output.port === "audio" && output.mimeType === "audio/wav" && output.extension === "wav"
    && intent?.version === 1 && intent.recipe === "generated-audio-v1" && intent.projectId === attempt.projectId && intent.attemptId === attempt.id
    && intent.id === audioDerivationId(attempt.projectId, attempt.id) && intent.artifactId === audioArtifactId(intent.id)
    && intent.requestDigest === digest(attempt.request) && attempt.request.kind === "speech"
    && intent.slotId === digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "audio" })
    && hash(intent.spoolId) && hash(intent.rawSha256) && intent.spoolId === output.storage.spoolId && intent.rawSha256 === output.sha256 && intent.rawByteLength === output.byteLength
    && integer(intent.rawByteLength, 44, AUDIO_DERIVATION_LIMITS.inputBytes),
  "AUDIO_DERIVATION_CONFLICT", "Audio derivation differs from its exact admitted raw output");
  const pcm = intent.rawPcm, recipe = intent.normalization;
  invariant(pcm && AUDIO_PCM_SAMPLE_RATES.includes(pcm.sampleRate) && (pcm.channels === 1 || pcm.channels === 2) && pcm.bitsPerSample === 16
    && integer(pcm.sampleCount, 1, pcm.sampleRate * 360) && pcm.sampleCount * pcm.channels * 2 + 44 <= intent.rawByteLength
    && intent.rawByteLength <= pcm.sampleCount * pcm.channels * 2 + AUDIO_DERIVATION_LIMITS.headerBytes
    && recipe?.version === 1 && recipe.recipe === "pcm-s16le-48khz-stereo-v1" && hash(recipe.toolchainDigest)
    && integer(recipe.maxInputBytes, 1024, 1024 * 1024 * 1024) && intent.rawByteLength <= recipe.maxInputBytes
    && integer(recipe.maxOutputBytes, 1024, AUDIO_DERIVATION_LIMITS.outputBytes)
    && integer(recipe.maxSamples, 1, AUDIO_DERIVATION_LIMITS.maxSamples) && integer(recipe.timeoutMs, 50, AUDIO_DERIVATION_LIMITS.timeoutMs),
  "AUDIO_DERIVATION_CONFLICT", "Unsupported PCM geometry or normalization recipe");
  assertAudioNormalizationCapacity(intent);
}

export function assertAudioDerivationReceipt(intent: AudioDerivationIntent, receipt: AudioDerivationReceipt, requireCompleteEndpoint = true): void {
  const source = receipt?.source, audio = source?.probe?.audio, samples = receipt?.normalizedSamples;
  invariant(receipt?.version === 1 && receipt.id === intent.id && receipt.projectId === intent.projectId && receipt.attemptId === intent.attemptId
    && receipt.intentDigest === digest(intent) && source?.artifactId === intent.artifactId && source.kind === "audio"
    && source.originalSha256 === intent.rawSha256 && source.originalByteLength === intent.rawByteLength
    && hash(source.sha256) && integer(source.byteLength, 44, intent.normalization.maxOutputBytes)
    && source.toolchainDigest === intent.normalization.toolchainDigest && audio?.codec === "pcm_s16le" && audio.streamIndex === 0
    && audio.sampleRate === 48000 && audio.channels === 2 && integer(samples, 1, intent.normalization.maxSamples) && audio.samples === samples
    && source.byteLength >= samples * 4 + 44 && source.byteLength <= samples * 4 + AUDIO_DERIVATION_LIMITS.headerBytes
    && !source.probe.video && Number.isFinite(source.probe.durationSeconds) && Number.isFinite(audio.durationSeconds)
    && Math.abs(source.probe.durationSeconds - samples / 48000) <= 1 / 48000 + 0.000001
    && Math.abs(audio.durationSeconds - samples / 48000) <= 1 / 48000 + 0.000001,
  "AUDIO_DERIVATION_CONFLICT", "Normalized audio differs from its raw bytes, recipe, or measured PCM");
  const { id, ...body } = source;
  invariant(id === digest(body), "AUDIO_DERIVATION_CONFLICT", "Normalized source descriptor identity differs");
  const delta = samples * intent.rawPcm.sampleRate - intent.rawPcm.sampleCount * 48000;
  invariant(receipt.endpointDeltaNumerator === delta, "AUDIO_DERIVATION_CONFLICT", "Measured endpoint delta differs");
  if (requireCompleteEndpoint) invariant(intent.rawPcm.sampleRate === 48000 ? delta === 0 : Math.abs(delta) <= intent.rawPcm.sampleRate,
    "AUDIO_PCM_ENDPOINT_MISMATCH", "Normalized PCM did not preserve the complete source endpoint");
}

export function assertNormalizedAudioIngestion(intent: AudioDerivationIntent, attempt: Attempt, output: IngestibleExecutionOutput, result: NormalizedAudioIngestion): void {
  assertAudioDerivationIntent(intent, attempt, output); assertAudioDerivationReceipt(intent, result.derivation);
  const record = result.artifact, source = result.derivation.source;
  invariant(result.type === "normalized_audio" && record?.id === intent.artifactId && record.projectId === intent.projectId && record.attemptId === attempt.id
    && canonical(record.artifact) === canonical({ artifactId: intent.artifactId, kind: "audio", sha256: source.sha256 })
    && record.mimeType === "audio/wav" && record.fixture === false && record.origin === "generated_audio"
    && record.outputReceiptId === intent.spoolId && record.outputSpoolId === intent.spoolId
    && record.derivationId === intent.id && record.sourceDescriptorId === source.id && record.byteLength === source.byteLength
    && record.physicalDurationSeconds === result.derivation.normalizedSamples / 48000
    && canonical(result.mediaSource) === canonical({ id: intent.artifactId, projectId: intent.projectId, source,
      origin: "generated_audio", attemptId: attempt.id, derivationId: intent.id }),
  "AUDIO_DERIVATION_CONFLICT", "Generated audio artifact lost its exact derivation provenance");
}
