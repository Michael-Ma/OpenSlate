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
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
export const FAL_REST_ORIGIN = "https://rest.fal.ai";
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
export interface FalH3LipSyncOptions { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }
export interface FalH3LipSyncCallOptions { signal?: AbortSignal }
export interface FalReceipt { requestId: string | null; httpStatus: number | null }
export interface FalDiagnostic {
  code: string;
  category: "invalid_input" | "auth" | "quota" | "policy" | "throttled" | "transport" | "protocol" | "aborted" | "provider_failure";
  /** fal's machine-readable error type, when the provider gave one. */
  errorType?: string;
  retryAfterMs?: number;
}
export type FalUploadResult = { kind: "uploaded"; fileUrl: string } | { kind: "failed"; error: FalDiagnostic };
export type FalH3LipSyncSubmitResult =
  | { kind: "accepted"; taskId: string; receipt: FalReceipt }
  | { kind: "rejected"; certainty: "not_accepted"; error: FalDiagnostic; receipt: FalReceipt }
  | { kind: "unknown"; error: FalDiagnostic; receipt: FalReceipt };
export type FalH3LipSyncPollResult =
  | { kind: "pending"; taskId: string; status: "queued" | "running"; receipt: FalReceipt }
  | { kind: "completed"; taskId: string; output: { url: string; expiresAt: null }; reported: { durationSeconds: number | null; seed: number | null }; receipt: FalReceipt }
  | { kind: "failed"; taskId: string; error: FalDiagnostic; receipt: FalReceipt }
  | { kind: "unknown"; taskId: string; error: FalDiagnostic; receipt: FalReceipt };

export class FalH3LipSyncValidationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FalH3LipSyncValidationError"; }
}
function ensure(condition: unknown, code = "FAL_H3_LIPSYNC_REQUEST_INVALID"): asserts condition {
  if (!condition) throw new FalH3LipSyncValidationError(code);
}
const HASH = /^[a-f0-9]{64}$/, TASK = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/, TRACE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
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
function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}(?:\.\d+)?$/.test(value)) return;
  const ms = Math.ceil(Number(value) * 1000); return ms >= 0 && ms <= 86_400_000 ? ms : undefined;
}
const blank = (): FalReceipt => ({ requestId: null, httpStatus: null });
type Http = { ok: true; status: number; body: unknown; receipt: FalReceipt; retryAfterMs?: number } | { ok: false; error: FalDiagnostic; receipt: FalReceipt };

/** fal model errors: `{detail: [{type, msg, loc, ...}]}`; request errors: `{detail: string, error_type}`. */
function errorType(body: unknown): string | undefined {
  if (!object(body)) return;
  const pick = (value: unknown): string | undefined => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined;
  if (Array.isArray(body.detail)) for (const item of body.detail) { const type = object(item) ? pick(item.type) : undefined; if (type) return type; }
  return pick(body.error_type);
}
function classify(status: number, body: unknown, retryAfterMs?: number): FalDiagnostic {
  const type = errorType(body), extra = { ...(type ? { errorType: type } : {}), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  if (status === 401 || status === 403) return { code: "FAL_AUTH_REJECTED", category: "auth", ...extra };
  if (status === 402) return { code: "FAL_BALANCE_REQUIRED", category: "quota", ...extra };
  if (status === 429) return { code: "FAL_RATE_LIMITED", category: "throttled", ...extra };
  if (status === 422 && type === "content_policy_violation") return { code: "FAL_CONTENT_POLICY", category: "policy", ...extra };
  if (status === 400 || status === 404 || status === 413 || status === 422) return { code: "FAL_INVALID_REQUEST", category: "invalid_input", ...extra };
  return { code: status >= 500 ? "FAL_PROVIDER_ERROR" : "FAL_UNEXPECTED_STATUS", category: status >= 500 ? "provider_failure" : "protocol", ...extra };
}

/** Explicit single-call transport. No method here retries, polls in a loop or submits twice. */
export class FalH3LipSyncProvider {
  readonly id = "fal-h3-lipsync-v1";
  readonly model = FAL_H3_LIPSYNC_MODEL;
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number;
  constructor(options: FalH3LipSyncOptions) {
    ensure(object(options) && typeof options.apiKey === "string" && /^[\x21-\x7e]{1,4096}$/.test(options.apiKey), "FAL_CREDENTIAL_INVALID");
    ensure(options.fetch === undefined || typeof options.fetch === "function", "FAL_OPTIONS_INVALID");
    const timeout = options.timeoutMs ?? FAL_H3_LIPSYNC_LIMITS.timeoutMs;
    ensure(integer(timeout, 1, 120_000), "FAL_OPTIONS_INVALID");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = timeout;
  }
  describe(input: FalH3LipSyncRequest): FalH3LipSyncDescription { return describeFalH3LipSyncRequest(input); }

  /**
   * fal CDN upload: initiate (authenticated) returns a presigned `upload_url` and the public `file_url`; the bytes are
   * PUT to the presigned URL without the API key. Uploading is not billed, so any failure here is a refusal.
   */
  async upload(bytes: Uint8Array, mediaType: "image/png" | "audio/wav", fileName: string, options: FalH3LipSyncCallOptions = {}): Promise<FalUploadResult> {
    try { ensure(bytes instanceof Uint8Array && bytes.byteLength > 0 && /^[a-z0-9-]{1,64}\.(png|wav)$/.test(fileName), "FAL_UPLOAD_INVALID"); }
    catch { return { kind: "failed", error: { code: "FAL_UPLOAD_INVALID", category: "invalid_input" } }; }
    const initiated = await this.call("POST", `${FAL_REST_ORIGIN}/storage/upload/initiate?storage_type=fal-cdn-v3`, options.signal,
      { body: JSON.stringify({ content_type: mediaType, file_name: fileName }), contentType: "application/json" }, true);
    if (!initiated.ok) return { kind: "failed", error: initiated.error };
    const body = initiated.body;
    if (initiated.status !== 200 || !object(body) || !https(body.upload_url) || !https(body.file_url)
      || body.upload_url.includes(this.#key) || body.file_url.includes(this.#key))
      return { kind: "failed", error: initiated.status === 200 ? { code: "FAL_UPLOAD_PROTOCOL", category: "protocol" } : classify(initiated.status, body) };
    const put = await this.call("PUT", body.upload_url, options.signal, { body: Buffer.from(bytes), contentType: mediaType }, false, FAL_H3_LIPSYNC_LIMITS.uploadTimeoutMs);
    if (!put.ok) return { kind: "failed", error: put.error };
    if (put.status < 200 || put.status >= 300) return { kind: "failed", error: classify(put.status, put.body) };
    return { kind: "uploaded", fileUrl: body.file_url };
  }

  /** POST the queue request once. Only an explicit fal refusal without a request id counts as not accepted. */
  async submit(body: string, expectedBodySha256: string, options: FalH3LipSyncCallOptions = {}): Promise<FalH3LipSyncSubmitResult> {
    if (typeof body !== "string" || sha(body) !== expectedBodySha256 || options.signal?.aborted)
      return { kind: "rejected", certainty: "not_accepted", receipt: blank(),
        error: { code: options.signal?.aborted ? "FAL_ABORTED_BEFORE_DISPATCH" : "FAL_BODY_DIGEST_MISMATCH", category: options.signal?.aborted ? "aborted" : "invalid_input" } };
    const response = await this.call("POST", `${FAL_QUEUE_ORIGIN}/${FAL_H3_LIPSYNC_MODEL}`, options.signal, { body, contentType: "application/json" }, true);
    if (!response.ok) return { kind: "unknown", error: response.error, receipt: response.receipt };
    const data = response.body, taskId = object(data) ? data.request_id : undefined;
    if (response.status >= 200 && response.status < 300 && this.task(taskId)) return { kind: "accepted", taskId, receipt: { ...response.receipt, requestId: taskId } };
    // A queue refusal is a 4xx before any request id exists. 5xx and malformed success are ambiguous: never resubmitted.
    if (response.status >= 400 && response.status < 500 && !(object(data) && "request_id" in data))
      return { kind: "rejected", certainty: "not_accepted", error: classify(response.status, data, response.retryAfterMs), receipt: response.receipt };
    return { kind: "unknown", error: { code: "FAL_SUBMISSION_UNRESOLVED", category: response.status >= 500 ? "provider_failure" : "protocol" }, receipt: response.receipt };
  }

  /** One status read and, once completed, one result read. */
  async poll(taskId: string, options: FalH3LipSyncCallOptions = {}): Promise<FalH3LipSyncPollResult> {
    if (!this.task(taskId)) return { kind: "unknown", taskId: String(taskId).slice(0, 128), error: { code: "FAL_TASK_ID_INVALID", category: "invalid_input" }, receipt: blank() };
    const base = `${FAL_QUEUE_ORIGIN}/${FAL_H3_LIPSYNC_APP}/requests/${taskId}`;
    const status = await this.call("GET", `${base}/status`, options.signal, undefined, true);
    if (!status.ok) return { kind: "unknown", taskId, error: status.error, receipt: status.receipt };
    const data = status.body, receipt = { ...status.receipt, requestId: taskId };
    if (status.status !== 200 && status.status !== 202 || !object(data) || (data.request_id !== undefined && data.request_id !== taskId))
      return { kind: "unknown", taskId, error: status.status === 200 || status.status === 202 ? { code: "FAL_STATUS_UNRESOLVED", category: "protocol" } : classify(status.status, data, status.retryAfterMs), receipt };
    if (data.status === "IN_QUEUE") return { kind: "pending", taskId, status: "queued", receipt };
    if (data.status === "IN_PROGRESS") return { kind: "pending", taskId, status: "running", receipt };
    if (data.status !== "COMPLETED") return { kind: "unknown", taskId, error: { code: "FAL_STATUS_UNRESOLVED", category: "protocol" }, receipt };
    // "includes error and error_type only if the request failed"
    if (data.error != null || data.error_type != null) {
      const type = typeof data.error_type === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(data.error_type) ? data.error_type : undefined;
      return { kind: "failed", taskId, error: { code: "FAL_REQUEST_FAILED", category: type === "content_policy_violation" ? "policy" : "provider_failure", ...(type ? { errorType: type } : {}) }, receipt };
    }
    const result = await this.call("GET", base, options.signal, undefined, true);
    if (!result.ok) return { kind: "unknown", taskId, error: result.error, receipt };
    const output = result.body, video = object(output) ? output.video : undefined;
    if (result.status === 200 && object(video) && https(video.url) && !video.url.includes(this.#key)) {
      const duration = object(output) && typeof output.duration === "number" && Number.isFinite(output.duration) && output.duration > 0 ? output.duration : null;
      const seed = object(output) && Number.isSafeInteger(output.seed) ? output.seed as number : null;
      return { kind: "completed", taskId, output: { url: video.url, expiresAt: null }, reported: { durationSeconds: duration, seed }, receipt };
    }
    // A completed request whose result is a model error is a terminal provider failure, not an unanswered one.
    if (result.status >= 400 && result.status < 500 && errorType(output))
      return { kind: "failed", taskId, error: classify(result.status, output), receipt };
    return { kind: "unknown", taskId, error: { code: "FAL_RESULT_UNRESOLVED", category: "protocol" }, receipt };
  }

  private task(value: unknown): value is string { return typeof value === "string" && TASK.test(value) && !value.includes(this.#key); }

  private async call(method: "GET" | "POST" | "PUT", url: string, signal: AbortSignal | undefined,
    payload?: { body: string | Buffer; contentType: string }, authenticated = true, timeoutMs = this.#timeout): Promise<Http> {
    const receipt = blank();
    if (signal?.aborted) return { ok: false, receipt, error: { code: "FAL_CALL_ABORTED", category: "aborted" } };
    const controller = new AbortController(); let timedOut = false;
    const stop = (): void => controller.abort(); signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await this.#fetch(url, { method, redirect: "manual", signal: controller.signal,
        headers: { ...(authenticated ? { Authorization: `Key ${this.#key}` } : {}), Accept: "application/json", ...(payload ? { "Content-Type": payload.contentType } : {}) },
        ...(payload ? { body: payload.body as BodyInit } : {}) });
      receipt.httpStatus = response.status;
      const trace = response.headers.get("x-fal-request-id"); receipt.requestId = trace && TRACE.test(trace) && !trace.includes(this.#key) ? trace : null;
      ensure(response.status >= 200 && response.status < 600 && !(response.status >= 300 && response.status < 400), "FAL_RESPONSE_REDIRECT");
      const size = response.headers.get("content-length");
      ensure(size === null || /^\d+$/.test(size) && Number(size) <= FAL_H3_LIPSYNC_LIMITS.responseBytes, "FAL_RESPONSE_TOO_LARGE");
      const chunks: Buffer[] = []; let total = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            total += part.value.byteLength; ensure(total <= FAL_H3_LIPSYNC_LIMITS.responseBytes, "FAL_RESPONSE_TOO_LARGE"); chunks.push(Buffer.from(part.value));
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      const text = Buffer.concat(chunks, total), mime = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      let body: unknown = null;
      if (text.length && mime === "application/json") body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
      const delay = retryAfter(response.headers.get("retry-after"));
      return { ok: true, status: response.status, body, receipt: { ...receipt }, ...(delay === undefined ? {} : { retryAfterMs: delay }) };
    } catch (error) {
      return { ok: false, receipt: { ...receipt }, error: { code: error instanceof FalH3LipSyncValidationError ? error.code
        : controller.signal.aborted ? timedOut ? "FAL_CALL_TIMEOUT" : "FAL_CALL_ABORTED" : "FAL_TRANSPORT_OR_RESPONSE_LOSS",
      category: controller.signal.aborted && !timedOut ? "aborted" : timedOut ? "transport" : error instanceof FalH3LipSyncValidationError ? "protocol" : "transport" } };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
  }
}
