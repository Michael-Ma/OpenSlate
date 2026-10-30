import { createHash } from "node:crypto";

/**
 * fal queue transport for MiniMax H3 Max lip sync (`minimax/h3-max/lip-sync/image-to-video`): one keyframe and one
 * audio file become a video whose mouth follows the audio. Wire contract reviewed against the fal model page, the
 * fal queue REST reference and the fal-js storage client on 2026-10-28. Single calls only: the host owns durable
 * admission, the polling schedule and recovery, and never resubmits a request whose acceptance is unknown.
 */
export const FAL_H3_LIPSYNC_ADAPTER_VERSION = "1";
export const FAL_H3_LIPSYNC_MODEL = "minimax/h3-max/lip-sync/image-to-video";
/** Queue status and result URLs use only the owner/app part of the endpoint id. */
export const FAL_H3_LIPSYNC_APP = "minimax/h3-max";
export { FAL_QUEUE_ORIGIN, FAL_REST_ORIGIN } from "./fal-queue.js";
export const FAL_H3_LIPSYNC_LIMITS = Object.freeze({ imageBytes: 30_000_000, audioBytes: 32 * 1024 * 1024,
  minAudioSeconds: 5, maxAudioSeconds: 900, responseBytes: 1024 * 1024, timeoutMs: 30_000, uploadTimeoutMs: 120_000 });
export type FalH3LipSyncResolution = "480P" | "768P" | "1080P" | "2K";
export const FAL_H3_LIPSYNC_RESOLUTIONS: readonly FalH3LipSyncResolution[] = Object.freeze(["480P", "768P", "1080P", "2K"]);
/** Published price per second of output (output length equals the audio length), in USD micros. */
export const FAL_H3_LIPSYNC_PRICE_MICROS_PER_SECOND: Readonly<Record<FalH3LipSyncResolution, number>> = Object.freeze({
  "480P": 50_000, "768P": 80_000, "1080P": 160_000, "2K": 320_000 });
/** "A 1.2x multiplier is added to videos over 15 seconds." */
export const FAL_H3_LIPSYNC_LONG_SECONDS = 15;

/** Estimated USD micros for one clip whose audio lasts `seconds`. Pure; rounds up to a whole micro. */
export function falH3LipSyncPriceMicros(resolution: FalH3LipSyncResolution, seconds: number): number {
  ensure(FAL_H3_LIPSYNC_RESOLUTIONS.includes(resolution) && Number.isFinite(seconds) && seconds > 0 && seconds <= FAL_H3_LIPSYNC_LIMITS.maxAudioSeconds,
    "FAL_H3_LIPSYNC_PRICE_INVALID");
  const rate = FAL_H3_LIPSYNC_PRICE_MICROS_PER_SECOND[resolution] * (seconds > FAL_H3_LIPSYNC_LONG_SECONDS ? 1.2 : 1);
  return Math.ceil(Math.round(rate * seconds * 1000) / 1000);
}

export interface FalH3LipSyncImageDescription { sha256: string; byteLength: number; width: number; height: number; mediaType: "image/png" }
export interface FalH3LipSyncAudioDescription { sha256: string; byteLength: number; samples: number; sampleRate: 48000; channels: 1; mediaType: "audio/wav" }
/** Bytes come from owned, verified ingestion (keyframe) and an owned derivation (song segment). */
export interface FalH3LipSyncRequest {
  resolution: FalH3LipSyncResolution;
  image: FalH3LipSyncImageDescription & { bytes: Uint8Array };
  audio: FalH3LipSyncAudioDescription & { bytes: Uint8Array };
  /** Transcribe the audio to guide the mouth. Off by default: song lyrics under music transcribe poorly. */
  enableTranscription?: boolean;
}
export interface FalH3LipSyncDescription {
  adapterVersion: "1"; model: typeof FAL_H3_LIPSYNC_MODEL; resolution: FalH3LipSyncResolution; enableTranscription: boolean;
  image: FalH3LipSyncImageDescription; audio: FalH3LipSyncAudioDescription; audioSeconds: number; requestDigest: string;
}
export type { FalDiagnostic, FalReceipt, FalUploadResult, FalQueueOptions as FalH3LipSyncOptions,
  FalQueueCallOptions as FalH3LipSyncCallOptions, FalQueueSubmitResult as FalH3LipSyncSubmitResult, FalQueuePollResult as FalH3LipSyncPollResult } from "./fal-queue.js";
import { FalQueueClient } from "./fal-queue.js";
import type { FalQueueOptions as FalH3LipSyncOptions } from "./fal-queue.js";
export class FalH3LipSyncValidationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FalH3LipSyncValidationError"; }
}
function ensure(condition: unknown, code = "FAL_H3_LIPSYNC_REQUEST_INVALID"): asserts condition {
  if (!condition) throw new FalH3LipSyncValidationError(code);
}
const HASH = /^[a-f0-9]{64}$/;
const sha = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

function image(value: FalH3LipSyncRequest["image"]): FalH3LipSyncImageDescription {
  ensure(object(value) && value.bytes instanceof Uint8Array && value.mediaType === "image/png" && typeof value.sha256 === "string" && HASH.test(value.sha256)
    && integer(value.byteLength, 33, FAL_H3_LIPSYNC_LIMITS.imageBytes) && value.bytes.byteLength === value.byteLength
    && integer(value.width, 1, 8192) && integer(value.height, 1, 8192), "FAL_H3_LIPSYNC_IMAGE_INVALID");
  const bytes = Buffer.from(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength), ratio = value.width / value.height;
  // "The aspect ratio must be between 0.4 and 2.5."
  ensure(sha(bytes) === value.sha256 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.readUInt32BE(16) === value.width && bytes.readUInt32BE(20) === value.height && ratio >= 0.4 && ratio <= 2.5, "FAL_H3_LIPSYNC_IMAGE_INVALID");
  return { sha256: value.sha256, byteLength: value.byteLength, width: value.width, height: value.height, mediaType: "image/png" };
}
function audio(value: FalH3LipSyncRequest["audio"]): FalH3LipSyncAudioDescription {
  ensure(object(value) && value.bytes instanceof Uint8Array && value.mediaType === "audio/wav" && value.sampleRate === 48000 && value.channels === 1
    && typeof value.sha256 === "string" && HASH.test(value.sha256) && integer(value.byteLength, 45, FAL_H3_LIPSYNC_LIMITS.audioBytes)
    && value.bytes.byteLength === value.byteLength
    && integer(value.samples, FAL_H3_LIPSYNC_LIMITS.minAudioSeconds * 48000, FAL_H3_LIPSYNC_LIMITS.maxAudioSeconds * 48000), "FAL_H3_LIPSYNC_AUDIO_INVALID");
  const bytes = Buffer.from(value.bytes.buffer, value.bytes.byteOffset, value.bytes.byteLength);
  // A canonical 44-byte header written by the host: mono PCM16 at 48 kHz holding exactly `samples` samples.
  ensure(sha(bytes) === value.sha256 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 16) === "WAVEfmt "
    && bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1 && bytes.readUInt32LE(24) === 48000 && bytes.readUInt16LE(34) === 16
    && bytes.toString("ascii", 36, 40) === "data" && bytes.readUInt32LE(40) === value.samples * 2 && bytes.length === 44 + value.samples * 2,
  "FAL_H3_LIPSYNC_AUDIO_INVALID");
  return { sha256: value.sha256, byteLength: value.byteLength, samples: value.samples, sampleRate: 48000, channels: 1, mediaType: "audio/wav" };
}
/** Metadata-only identity of one lip-sync job. Upload URLs are per upload and are not part of it. */
export function describeFalH3LipSyncRequest(input: FalH3LipSyncRequest): FalH3LipSyncDescription {
  ensure(object(input) && FAL_H3_LIPSYNC_RESOLUTIONS.includes(input.resolution)
    && (input.enableTranscription === undefined || typeof input.enableTranscription === "boolean"));
  const picture = image(input.image), sound = audio(input.audio), enableTranscription = input.enableTranscription === true;
  const base = { adapterVersion: FAL_H3_LIPSYNC_ADAPTER_VERSION, model: FAL_H3_LIPSYNC_MODEL, resolution: input.resolution, enableTranscription,
    image: picture, audio: sound, audioSeconds: sound.samples / 48000 } as const;
  return Object.freeze({ ...base, requestDigest: falH3LipSyncMetadataDigest(base) });
}
export function falH3LipSyncMetadataDigest(description: Omit<FalH3LipSyncDescription, "requestDigest">): string {
  // Fixed field order: stored copies may come back with their keys in another order.
  const { adapterVersion, model, resolution, enableTranscription, image: i, audio: a, audioSeconds } = description;
  return sha(JSON.stringify({ adapterVersion, model, resolution, enableTranscription,
    image: { sha256: i.sha256, byteLength: i.byteLength, width: i.width, height: i.height, mediaType: i.mediaType },
    audio: { sha256: a.sha256, byteLength: a.byteLength, samples: a.samples, sampleRate: a.sampleRate, channels: a.channels, mediaType: a.mediaType }, audioSeconds }));
}
/** The exact queue body for already uploaded files. */
export function falH3LipSyncBody(description: FalH3LipSyncDescription, files: { imageUrl: string; audioUrl: string }): string {
  ensure(https(files.imageUrl) && https(files.audioUrl), "FAL_H3_LIPSYNC_FILE_URL_INVALID");
  return JSON.stringify({ image_url: files.imageUrl, audio_url: files.audioUrl, resolution: description.resolution,
    enable_transcription: description.enableTranscription, enable_safety_checker: true });
}
function https(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096 || /[\s\x00-\x1f\x7f\\]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
export class FalH3LipSyncProvider extends FalQueueClient {
  readonly id = "fal-h3-lipsync-v1";
  constructor(options: FalH3LipSyncOptions) { super({ ...options, model: FAL_H3_LIPSYNC_MODEL }); }
  describe(input: FalH3LipSyncRequest): FalH3LipSyncDescription { return describeFalH3LipSyncRequest(input); }
}
