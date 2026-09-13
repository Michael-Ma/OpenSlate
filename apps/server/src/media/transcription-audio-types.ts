import { invariant } from "@openslate/core";

export const TRANSCRIPTION_AUDIO_LIMITS = Object.freeze({ maxInputBytes: 256 * 1024 * 1024, maxOutputBytes: 25000000,
  maxSourceSamples: 17280000, maxOutputSamples: 5760000, headerBytes: 65536, timeoutMs: 120000 });
export interface TranscriptionAudioRecipe {
  version: 1; recipe: "pcm-s16le-16khz-mono-half-sum-v1"; toolchainDigest: string;
  maxInputBytes: number; maxOutputBytes: number; maxSourceSamples: number; maxOutputSamples: number; timeoutMs: number;
}
export interface MeasuredTranscriptionAudio {
  sha256: string; byteLength: number; sampleRate: 16000; channels: 1; bitsPerSample: 16;
  sampleCount: number; endDelta48kSamples: number;
}
export interface TranscriptionAudioOptions {
  signal: AbortSignal;
  /** Original application lease/recovery guard, checked before new tool work. */
  assertCanStart: () => void;
  /** Trusted filesystem-only sink, awaited before cleanup. Preserve measured evidence even after late lease loss. */
  persistCompletion: (measured: Readonly<MeasuredTranscriptionAudio>, temporaryPath: string) => Promise<void>;
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
function exact(value: unknown, keys: string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}
export function assertTranscriptionAudioRecipe(recipe: TranscriptionAudioRecipe): void {
  invariant(exact(recipe, ["version", "recipe", "toolchainDigest", "maxInputBytes", "maxOutputBytes", "maxSourceSamples", "maxOutputSamples", "timeoutMs"])
    && recipe.version === 1 && recipe.recipe === "pcm-s16le-16khz-mono-half-sum-v1" && hash(recipe.toolchainDigest)
    && integer(recipe.maxInputBytes, 1024, TRANSCRIPTION_AUDIO_LIMITS.maxInputBytes)
    && integer(recipe.maxOutputBytes, 1024, TRANSCRIPTION_AUDIO_LIMITS.maxOutputBytes)
    && integer(recipe.maxSourceSamples, 1, TRANSCRIPTION_AUDIO_LIMITS.maxSourceSamples)
    && integer(recipe.maxOutputSamples, 1, TRANSCRIPTION_AUDIO_LIMITS.maxOutputSamples)
    && recipe.maxOutputSamples === Math.ceil(recipe.maxSourceSamples / 3)
    && integer(recipe.timeoutMs, 50, TRANSCRIPTION_AUDIO_LIMITS.timeoutMs),
  "TRANSCRIPTION_AUDIO_RECIPE_INVALID", "Unsupported transcription audio recipe or bounds");
}
export function assertTranscriptionAudioCapacity(sourceSamples: number, recipe: TranscriptionAudioRecipe): void {
  assertTranscriptionAudioRecipe(recipe);
  invariant(integer(sourceSamples, 1, recipe.maxSourceSamples), "TRANSCRIPTION_AUDIO_SOURCE_INVALID", "Source exceeds its complete-range sample bound");
  const idealCeiling = Math.ceil(sourceSamples / 3), reserved = Math.min(recipe.maxOutputSamples, idealCeiling + 1);
  invariant(idealCeiling <= recipe.maxOutputSamples && reserved * 2 + TRANSCRIPTION_AUDIO_LIMITS.headerBytes <= recipe.maxOutputBytes,
    "TRANSCRIPTION_AUDIO_OUTPUT_LIMIT", "Worker cannot preserve the complete transcription derivative");
}
export function assertTranscriptionAudioMeasurement(audio: MeasuredTranscriptionAudio, sourceSamples: number, recipe: TranscriptionAudioRecipe, requireCompleteEndpoint = true): void {
  assertTranscriptionAudioCapacity(sourceSamples, recipe);
  invariant(exact(audio, ["sha256", "byteLength", "sampleRate", "channels", "bitsPerSample", "sampleCount", "endDelta48kSamples"])
    && hash(audio.sha256) && integer(audio.byteLength, 44, recipe.maxOutputBytes)
    && audio.sampleRate === 16000 && audio.channels === 1 && audio.bitsPerSample === 16
    && integer(audio.sampleCount, 1, recipe.maxOutputSamples)
    && audio.byteLength >= audio.sampleCount * 2 + 44 && audio.byteLength <= audio.sampleCount * 2 + TRANSCRIPTION_AUDIO_LIMITS.headerBytes
    && audio.endDelta48kSamples === audio.sampleCount * 3 - sourceSamples,
  "TRANSCRIPTION_AUDIO_MEASUREMENT_INVALID", "Measured derivative differs from its complete PCM contract");
  if (requireCompleteEndpoint) invariant(Math.abs(audio.endDelta48kSamples) <= 3,
    "TRANSCRIPTION_AUDIO_ENDPOINT_MISMATCH", "Transcription derivative did not preserve the complete source endpoint");
}
