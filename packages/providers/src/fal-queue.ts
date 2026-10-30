import { createHash } from "node:crypto";
import { isConnectPhaseFailure } from "./video-http.js";
export const FAL_QUEUE_ORIGIN = "https://queue.fal.run";
export const FAL_REST_ORIGIN = "https://rest.fal.ai";
const FAL_QUEUE_LIMITS = Object.freeze({ responseBytes: 1024 * 1024, timeoutMs: 30000, uploadTimeoutMs: 120000 });
class FalQueueValidationError extends Error { constructor(readonly code: string) { super(code); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new FalQueueValidationError(code); }
const TASK = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/, TRACE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export interface FalQueueOptions { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }
export interface FalQueueCallOptions { signal?: AbortSignal }
export interface FalReceipt { requestId: string | null; httpStatus: number | null }
export interface FalDiagnostic {
  code: string;
  category: "invalid_input" | "auth" | "quota" | "policy" | "throttled" | "transport" | "protocol" | "aborted" | "provider_failure";
  /** fal's machine-readable error type, when the provider gave one. */
  errorType?: string;
  retryAfterMs?: number;
}
export type FalUploadResult = { kind: "uploaded"; fileUrl: string } | { kind: "failed"; error: FalDiagnostic };
export type FalQueueSubmitResult =
  | { kind: "accepted"; taskId: string; receipt: FalReceipt }
  | { kind: "rejected"; certainty: "not_accepted"; error: FalDiagnostic; receipt: FalReceipt }
  | { kind: "unknown"; error: FalDiagnostic; receipt: FalReceipt };
export type FalQueuePollResult =
  | { kind: "pending"; taskId: string; status: "queued" | "running"; receipt: FalReceipt }
  | { kind: "completed"; taskId: string; output: { url: string; expiresAt: null }; reported: { durationSeconds: number | null; seed: number | null }; receipt: FalReceipt }
  | { kind: "failed"; taskId: string; error: FalDiagnostic; receipt: FalReceipt }
  | { kind: "unknown"; taskId: string; error: FalDiagnostic; receipt: FalReceipt };

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

export class FalQueueClient {
  readonly model: string;
  readonly app: string;
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number;
  constructor(options: FalQueueOptions & { model: string }) {
    ensure(object(options) && typeof options.apiKey === "string" && /^[\x21-\x7e]{1,4096}$/.test(options.apiKey), "FAL_CREDENTIAL_INVALID");
    ensure(options.fetch === undefined || typeof options.fetch === "function", "FAL_OPTIONS_INVALID");
    const timeout = options.timeoutMs ?? FAL_QUEUE_LIMITS.timeoutMs;
    ensure(integer(timeout, 1, 120_000), "FAL_OPTIONS_INVALID");
    ensure(/^[a-z0-9_-]+\/[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/.test(options.model), "FAL_MODEL_INVALID");
    this.model = options.model; this.app = options.model.split("/").slice(0, 2).join("/");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = timeout;
  }

  /**
   * fal CDN upload: initiate (authenticated) returns a presigned `upload_url` and the public `file_url`; the bytes are
   * PUT to the presigned URL without the API key. Uploading is not billed, so any failure here is a refusal.
   */
  async upload(bytes: Uint8Array, mediaType: "image/png" | "audio/wav", fileName: string, options: FalQueueCallOptions = {}): Promise<FalUploadResult> {
    try { ensure(bytes instanceof Uint8Array && bytes.byteLength > 0 && /^[a-z0-9-]{1,64}\.(png|wav)$/.test(fileName), "FAL_UPLOAD_INVALID"); }
    catch { return { kind: "failed", error: { code: "FAL_UPLOAD_INVALID", category: "invalid_input" } }; }
    const initiated = await this.call("POST", `${FAL_REST_ORIGIN}/storage/upload/initiate?storage_type=fal-cdn-v3`, options.signal,
      { body: JSON.stringify({ content_type: mediaType, file_name: fileName }), contentType: "application/json" }, true);
    if (!initiated.ok) return { kind: "failed", error: initiated.error };
    const body = initiated.body;
    if (initiated.status !== 200 || !object(body) || !https(body.upload_url) || !https(body.file_url)
      || body.upload_url.includes(this.#key) || body.file_url.includes(this.#key))
      return { kind: "failed", error: initiated.status === 200 ? { code: "FAL_UPLOAD_PROTOCOL", category: "protocol" } : classify(initiated.status, body) };
    const put = await this.call("PUT", body.upload_url, options.signal, { body: Buffer.from(bytes), contentType: mediaType }, false, FAL_QUEUE_LIMITS.uploadTimeoutMs);
    if (!put.ok) return { kind: "failed", error: put.error };
    if (put.status < 200 || put.status >= 300) return { kind: "failed", error: classify(put.status, put.body) };
    return { kind: "uploaded", fileUrl: body.file_url };
  }

  /** POST the queue request once. Only an explicit fal refusal without a request id counts as not accepted. */
  async submit(body: string, expectedBodySha256: string, options: FalQueueCallOptions = {}): Promise<FalQueueSubmitResult> {
    if (typeof body !== "string" || sha(body) !== expectedBodySha256 || options.signal?.aborted)
      return { kind: "rejected", certainty: "not_accepted", receipt: blank(),
        error: { code: options.signal?.aborted ? "FAL_ABORTED_BEFORE_DISPATCH" : "FAL_BODY_DIGEST_MISMATCH", category: options.signal?.aborted ? "aborted" : "invalid_input" } };
    const response = await this.call("POST", `${FAL_QUEUE_ORIGIN}/${this.model}`, options.signal, { body, contentType: "application/json" }, true);
    if (!response.ok) return response.error.code === "FAL_CONNECT_NOT_SUBMITTED"
      ? { kind: "rejected", certainty: "not_accepted", error: response.error, receipt: response.receipt }
      : { kind: "unknown", error: response.error, receipt: response.receipt };
    const data = response.body, taskId = object(data) ? data.request_id : undefined;
    if (response.status >= 200 && response.status < 300 && this.task(taskId)) return { kind: "accepted", taskId, receipt: { ...response.receipt, requestId: taskId } };
    // A queue refusal is a 4xx before any request id exists. 5xx and malformed success are ambiguous: never resubmitted.
    if (response.status >= 400 && response.status < 500 && !(object(data) && "request_id" in data))
      return { kind: "rejected", certainty: "not_accepted", error: classify(response.status, data, response.retryAfterMs), receipt: response.receipt };
    return { kind: "unknown", error: { code: "FAL_SUBMISSION_UNRESOLVED", category: response.status >= 500 ? "provider_failure" : "protocol" }, receipt: response.receipt };
  }

  /** One status read and, once completed, one result read. */
  async poll(taskId: string, options: FalQueueCallOptions = {}): Promise<FalQueuePollResult> {
    if (!this.task(taskId)) return { kind: "unknown", taskId: String(taskId).slice(0, 128), error: { code: "FAL_TASK_ID_INVALID", category: "invalid_input" }, receipt: blank() };
    const base = `${FAL_QUEUE_ORIGIN}/${this.app}/requests/${taskId}`;
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
      ensure(size === null || /^\d+$/.test(size) && Number(size) <= FAL_QUEUE_LIMITS.responseBytes, "FAL_RESPONSE_TOO_LARGE");
      const chunks: Buffer[] = []; let total = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            total += part.value.byteLength; ensure(total <= FAL_QUEUE_LIMITS.responseBytes, "FAL_RESPONSE_TOO_LARGE"); chunks.push(Buffer.from(part.value));
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      const text = Buffer.concat(chunks, total), mime = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      let body: unknown = null;
      if (text.length && mime === "application/json") body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(text));
      const delay = retryAfter(response.headers.get("retry-after"));
      return { ok: true, status: response.status, body, receipt: { ...receipt }, ...(delay === undefined ? {} : { retryAfterMs: delay }) };
    } catch (error) {
      return { ok: false, receipt: { ...receipt }, error: { code: error instanceof FalQueueValidationError ? error.code
        : controller.signal.aborted ? timedOut ? "FAL_CALL_TIMEOUT" : "FAL_CALL_ABORTED" : isConnectPhaseFailure(error) && receipt.httpStatus === null ? "FAL_CONNECT_NOT_SUBMITTED" : "FAL_TRANSPORT_OR_RESPONSE_LOSS",
      category: controller.signal.aborted && !timedOut ? "aborted" : timedOut ? "transport" : error instanceof FalQueueValidationError ? "protocol" : "transport" } };
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
  }
}
