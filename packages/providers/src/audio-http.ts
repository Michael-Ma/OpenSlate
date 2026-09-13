import { createHash } from "node:crypto";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

export type AudioAdapterId = "openai-speech-v1" | "openai-transcription-v1";
export interface AudioSubmitContext {
  attemptId: string; expectedRequestDigest: string; expectedBodySha256: string; signal?: AbortSignal;
}
export interface AudioTransportReceipt {
  adapter: AudioAdapterId; attemptId: string; requestDigest: string; bodySha256: string;
  requestedModel: string; requestId: string | null; httpStatus: number | null;
}
export type AudioTransportOutcome<T> =
  | { kind: "completed"; receipt: AudioTransportReceipt; reportedModel: string | null; result: T }
  | { kind: "rejected"; certainty: "not_accepted"; source: "local" | "provider";
      code: string; receipt: AudioTransportReceipt; retryAfterMs: number | null }
  | { kind: "unknown"; code: string; receipt: AudioTransportReceipt; retryAfterMs: number | null };
export interface AudioHttpOptions {
  apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number; maxResponseBytes?: number;
}
export interface PreparedAudioRequest {
  model: string; requestDigest: string; bodySha256: string; body: Uint8Array; contentType: string;
}
export interface DecodedAudioResult<T> { reportedModel: string | null; result: T }

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ERROR_BYTES = 64 * 1024;
const ENDPOINTS: Record<AudioAdapterId, string> = {
  "openai-speech-v1": "https://api.openai.com/v1/audio/speech",
  "openai-transcription-v1": "https://api.openai.com/v1/audio/transcriptions",
};
export class AudioValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}
export function audioEnsure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AudioValidationError(code);
}
/** Snapshot own data properties without invoking caller accessors or toJSON. */
export function audioDataObject(value: unknown, fields: readonly string[], code = "INVALID_REQUEST"): Record<string, unknown> {
  audioEnsure(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const name of Reflect.ownKeys(value)) {
    audioEnsure(typeof name === "string" && fields.includes(name), code);
    const property = Object.getOwnPropertyDescriptor(value, name);
    audioEnsure(property && Object.hasOwn(property, "value"), code);
    result[name] = property.value;
  }
  return result;
}
export function audioSha256(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
export function audioUtf8(value: unknown, maxBytes: number, code: string, allowEmpty = false): string {
  audioEnsure(typeof value === "string" && value.length <= maxBytes && (allowEmpty || value.trim().length > 0)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    && Buffer.byteLength(value, "utf8") <= maxBytes, code);
  return value;
}
export function audioBoundedOption(value: unknown, maximum: number, minimum = 1): number {
  const selected = value === undefined ? maximum : value;
  audioEnsure(Number.isSafeInteger(selected) && Number(selected) >= minimum && Number(selected) <= maximum, "INVALID_ADAPTER_OPTION");
  return Number(selected);
}
export function audioJson(bytes: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new AudioValidationError("INVALID_JSON_RESPONSE"); }
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function protocolRejection(status: number, body: unknown): boolean {
  if (!object(body) || !object(body.error) || typeof body.error.message !== "string") return false;
  if (["audio", "data", "output", "outputs", "result", "text", "words", "segments", "duration", "usage", "created"]
    .some(key => Object.hasOwn(body, key))) return false;
  const error = body.error;
  if (error.code === "content_policy_violation" || error.code === "moderation_blocked" || error.moderation_details !== undefined) return false;
  if ([400, 404, 413, 415, 422].includes(status)) return error.type === "invalid_request_error";
  if (status === 401) return error.type === "authentication_error" || error.type === "invalid_request_error";
  if (status === 403) return error.type === "permission_error" || error.type === "invalid_request_error";
  return status === 429 && (error.type === "rate_limit_error" || error.type === "insufficient_quota");
}
function retryAfter(value: string | null): number | null {
  if (!value || value.length > 128) return null;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay >= 0 ? Math.min(600000, Math.ceil(delay)) : null;
}

async function readResponse(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    await response.body?.cancel(); throw new AudioValidationError("RESPONSE_TOO_LARGE");
  }
  audioEnsure(response.body, "EMPTY_RESPONSE");
  const reader = response.body.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => cancellation ??= Promise.resolve().then(() => reader.cancel()).catch(() => undefined);
  const abort = (): void => { void cancel(); };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = Buffer.alloc(Math.min(limit, 65536)), size = 0, reads = 0;
  try {
    audioEnsure(!signal.aborted, "SUBMISSION_ABORTED");
    for (;;) {
      // Immediate tiny/empty chunks must not starve deadline and abort delivery.
      if (++reads % 256 === 0) await yieldEventLoop();
      audioEnsure(!signal.aborted, "SUBMISSION_ABORTED");
      const next = await reader.read();
      audioEnsure(!signal.aborted, "SUBMISSION_ABORTED");
      if (next.done) break;
      audioEnsure(next.value instanceof Uint8Array && next.value.byteLength <= limit - size, "RESPONSE_TOO_LARGE");
      const required = size + next.value.byteLength;
      if (required > bytes.length) {
        const larger = Buffer.alloc(Math.min(limit, Math.max(required, bytes.length * 2)));
        bytes.copy(larger, 0, 0, size); bytes = larger;
      }
      bytes.set(next.value, size); size = required;
    }
    audioEnsure(size > 0, "EMPTY_RESPONSE");
    return bytes.subarray(0, size);
  } finally {
    // Keep the outer deadline/original signal alive through this awaited cleanup.
    await cancel(); signal.removeEventListener("abort", abort); reader.releaseLock();
  }
}

/** One bounded POST. This transport is not an application allowance or durable dispatch ledger. */
export class AudioHttpClient {
  readonly #adapter: AudioAdapterId;
  readonly #key: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeout: number;
  readonly #maximum: number;
  constructor(adapter: AudioAdapterId, options: AudioHttpOptions, bounds: Readonly<{ timeoutMs: number; maxResponseBytes: number }>) {
    const own = audioDataObject(options, ["apiKey", "fetch", "timeoutMs", "maxResponseBytes"], "INVALID_ADAPTER_OPTION");
    audioEnsure(Object.hasOwn(ENDPOINTS, adapter), "INVALID_ADAPTER_OPTION");
    audioEnsure(typeof own.apiKey === "string" && own.apiKey.length > 0 && own.apiKey.length <= 4096
      && !/[\s\x00-\x1f\x7f]/.test(own.apiKey), "INVALID_CREDENTIAL_CONFIGURATION");
    audioEnsure(own.fetch === undefined || typeof own.fetch === "function", "INVALID_ADAPTER_OPTION");
    this.#adapter = adapter; this.#key = own.apiKey; this.#fetch = (own.fetch ?? globalThis.fetch) as typeof globalThis.fetch;
    this.#timeout = audioBoundedOption(own.timeoutMs, bounds.timeoutMs);
    this.#maximum = audioBoundedOption(own.maxResponseBytes, bounds.maxResponseBytes);
  }
  async post<T>(context: AudioSubmitContext, prepare: () => PreparedAudioRequest,
    decode: (bytes: Uint8Array, mimeType: string) => DecodedAudioResult<T>): Promise<AudioTransportOutcome<T>> {
    const receipt: AudioTransportReceipt = { adapter: this.#adapter, attemptId: "invalid", requestDigest: "invalid", bodySha256: "invalid",
      requestedModel: "unknown", requestId: null, httpStatus: null };
    let prepared: PreparedAudioRequest, signal: AbortSignal | undefined;
    try {
      const own = audioDataObject(context, ["attemptId", "expectedRequestDigest", "expectedBodySha256", "signal"], "INVALID_SUBMIT_CONTEXT");
      audioEnsure(typeof own.attemptId === "string" && ID.test(own.attemptId) && typeof own.expectedRequestDigest === "string"
        && HASH.test(own.expectedRequestDigest) && typeof own.expectedBodySha256 === "string" && HASH.test(own.expectedBodySha256)
        && (own.signal === undefined || own.signal instanceof AbortSignal), "INVALID_SUBMIT_CONTEXT");
      signal = own.signal as AbortSignal | undefined;
      receipt.attemptId = own.attemptId; receipt.requestDigest = own.expectedRequestDigest; receipt.bodySha256 = own.expectedBodySha256;
      prepared = prepare(); receipt.requestedModel = prepared.model;
      audioEnsure(prepared.requestDigest === receipt.requestDigest && prepared.bodySha256 === receipt.bodySha256, "REQUEST_DIGEST_MISMATCH");
      prepared = { ...prepared, body: Buffer.from(prepared.body) };
      audioEnsure(audioSha256(prepared.body) === receipt.bodySha256, "REQUEST_BODY_MISMATCH");
      audioEnsure(!signal?.aborted, "ABORTED_BEFORE_SUBMISSION");
    } catch (error) {
      return { kind: "rejected", certainty: "not_accepted", source: "local", receipt: { ...receipt }, retryAfterMs: null,
        code: error instanceof AudioValidationError ? error.code : "INVALID_REQUEST" };
    }
    const controller = new AbortController(); let timedOut = false, delay: number | null = null;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    const abort = (): void => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    let rejectAborted: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(new AudioValidationError(timedOut ? "SUBMISSION_TIMEOUT" : "SUBMISSION_ABORTED"));
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    const operation = async (): Promise<AudioTransportOutcome<T>> => {
      const response = await this.#fetch(ENDPOINTS[this.#adapter], { method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.#key}`, "Content-Type": prepared.contentType }, body: prepared.body as Uint8Array<ArrayBuffer> });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new AudioValidationError("SUBMISSION_ABORTED"); }
      receipt.httpStatus = response.status;
      const requestId = response.headers.get("x-request-id");
      receipt.requestId = requestId && ID.test(requestId) && !requestId.includes(this.#key) ? requestId : null;
      delay = retryAfter(response.headers.get("retry-after"));
      const bytes = await readResponse(response, response.ok ? this.#maximum : Math.min(this.#maximum, ERROR_BYTES), controller.signal);
      audioEnsure(!controller.signal.aborted && !signal?.aborted, "SUBMISSION_ABORTED");
      if (!response.ok) {
        const payload = audioJson(bytes);
        if (protocolRejection(response.status, payload)) return { kind: "rejected", certainty: "not_accepted", source: "provider",
          code: `HTTP_${response.status}`, receipt: { ...receipt }, retryAfterMs: delay };
        return { kind: "unknown", code: "UNCONFIRMED_HTTP_FAILURE", receipt: { ...receipt }, retryAfterMs: delay };
      }
      const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      const result = decode(bytes, mime);
      audioEnsure(!controller.signal.aborted && !signal?.aborted, "SUBMISSION_ABORTED");
      return { kind: "completed", receipt: { ...receipt }, ...result };
    };
    try {
      const result = await Promise.race([operation(), aborted]);
      // An abort may arrive between the operation's synchronous final check and
      // this await resuming. Do not hand off a completion after that cancellation.
      audioEnsure(!controller.signal.aborted && !signal?.aborted, timedOut ? "SUBMISSION_TIMEOUT" : "SUBMISSION_ABORTED");
      return result;
    }
    catch (error) { return { kind: "unknown", receipt: { ...receipt }, retryAfterMs: delay,
      code: error instanceof AudioValidationError ? error.code : "TRANSPORT_OR_RESPONSE_LOSS" }; }
    finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted);
      controller.abort();
    }
  }
}
