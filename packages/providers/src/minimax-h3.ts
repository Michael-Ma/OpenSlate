import { createHash } from "node:crypto";

/** Wire contract reviewed against official MiniMax v2 docs on 2026-09-12. */
export const MINIMAX_H3_ADAPTER_VERSION = "1.0.0";
export const MINIMAX_H3_LIMITS = Object.freeze({ requestBytes: 64_000_000, responseBytes: 1024 * 1024,
  imageBytes: 30_000_000, promptBytes: 32 * 1024, timeoutMs: 30_000 });
export type MiniMaxH3Model = "MiniMax-H3" | "MiniMax-H3-Max";
export type MiniMaxH3Resolution = "480P" | "768P" | "2K";
export type MiniMaxH3ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
/** Measurements/hash come from trusted artifact ingestion; HTTPS transport must preserve those bytes. */
export interface MiniMaxH3Image {
  url: string;
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
  mediaType: MiniMaxH3ImageType;
}
export interface MiniMaxH3Request {
  prompt: string;
  durationSeconds: number;
  resolution: MiniMaxH3Resolution;
  firstFrame: MiniMaxH3Image;
  lastFrame?: MiniMaxH3Image;
}
export interface MiniMaxH3Options {
  apiKey: string;
  model: MiniMaxH3Model;
  /** Injection is for trusted hosts/tests. Construction never performs I/O. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}
export interface MiniMaxH3CallOptions { signal?: AbortSignal }
export interface MiniMaxH3Diagnostic {
  code: string;
  category: "invalid_input" | "auth" | "quota" | "policy" | "throttled" | "transport" | "protocol" | "aborted" | "provider_failure";
  httpStatus?: number;
  requestId?: string;
  retryAfterSeconds?: number;
}
export type MiniMaxH3SubmitResult =
  | { kind: "accepted"; taskId: string; requestedModel: MiniMaxH3Model }
  | { kind: "rejected"; certainty: "not_accepted"; error: MiniMaxH3Diagnostic }
  | { kind: "unknown"; error: MiniMaxH3Diagnostic };
export type MiniMaxH3PollResult =
  | { kind: "pending"; taskId: string; status: "queued" | "running" }
  | { kind: "completed"; taskId: string; requestedModel: MiniMaxH3Model; reportedModel: MiniMaxH3Model;
      output: { url: string; expiresAt: null }; reported: { durationSeconds: number | null; resolution: MiniMaxH3Resolution | null;
        ratio: string | null; usage: Readonly<Record<string, number>> | null } }
  | { kind: "failed"; taskId: string; error: MiniMaxH3Diagnostic }
  | { kind: "cancelled"; taskId: string }
  | { kind: "unknown"; taskId?: string; error: MiniMaxH3Diagnostic };

export class MiniMaxH3ValidationError extends Error {
  readonly code = "H3_REQUEST_INVALID";
  constructor(message: string) { super(message); this.name = "MiniMaxH3ValidationError"; }
}
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new MiniMaxH3ValidationError(message);
}
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => {
  const row = record(value); return !!row && Object.keys(row).every(key => keys.includes(key));
};
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const mediaTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const models = ["MiniMax-H3", "MiniMax-H3-Max"];
const resolutions = (model: MiniMaxH3Model): MiniMaxH3Resolution[] => model === "MiniMax-H3" ? ["768P", "2K"] : ["480P", "768P"];
function httpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192 || /[\s\u0000-\u001f]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash && !!url.hostname; }
  catch { return false; }
}
function validateImage(value: unknown): asserts value is MiniMaxH3Image {
  requireValue(exact(value, ["url", "sha256", "width", "height", "byteLength", "mediaType"]), "Unsupported image fields");
  requireValue(typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) && mediaTypes.includes(String(value.mediaType)),
    "Image requires an immutable SHA-256 and supported media type");
  requireValue(Number.isInteger(value.width) && Number.isInteger(value.height) && Number(value.width) >= 256 && Number(value.width) <= 5760 &&
    Number(value.height) >= 256 && Number(value.height) <= 5760 && Number(value.width) / Number(value.height) >= 0.4 &&
    Number(value.width) / Number(value.height) <= 2.5 && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0 &&
    Number(value.byteLength) <= MINIMAX_H3_LIMITS.imageBytes, "Image measurements exceed H3 limits");
  requireValue(typeof value.url === "string", "Image transport must be HTTPS or an embedded image");
  if (value.url.startsWith("data:")) {
    requireValue(value.url.length <= 4 * Math.ceil(MINIMAX_H3_LIMITS.imageBytes / 3) + 64, "Embedded image exceeds the byte limit");
    const prefix = `data:${String(value.mediaType)};base64,`;
    requireValue(value.url.startsWith(prefix), "Embedded image media type differs from its artifact");
    const encoded = value.url.slice(prefix.length);
    requireValue(encoded.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), "Invalid embedded image encoding");
    const bytes = Buffer.from(encoded, "base64");
    requireValue(bytes.length === value.byteLength && bytes.toString("base64") === encoded &&
      createHash("sha256").update(bytes).digest("hex") === value.sha256, "Embedded image differs from its artifact identity");
  } else requireValue(httpsUrl(value.url), "Image transport must use an explicit HTTPS URL");
}

/** A single-call transport. Durable admission, retries, polling schedules and ingestion belong to the host. */
export class MiniMaxH3Provider {
  readonly id = "minimax-h3-v2";
  readonly model: MiniMaxH3Model;
  #key: string;
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;
  constructor(options: MiniMaxH3Options) {
    requireValue(options && typeof options.apiKey === "string" && /^[\x21-\x7e]{1,16384}$/.test(options.apiKey), "Supply an explicit API key");
    requireValue(models.includes(options.model), "Select an exact supported H3 model");
    const timeout = options.timeoutMs ?? MINIMAX_H3_LIMITS.timeoutMs;
    requireValue(Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 120_000, "Invalid H3 request timeout");
    requireValue(options.fetch === undefined || typeof options.fetch === "function", "Invalid HTTP transport");
    this.model = options.model; this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeoutMs = timeout;
  }
  async capabilities() {
    return { providerId: this.id, modelId: this.model, execution: "cloud" as const,
      conditioningModes: ["first_frame", "first_last_frame"] as const,
      durationSeconds: { min: this.model === "MiniMax-H3" ? 4 : 5, max: 15 }, durationStepSeconds: 1,
      resolutions: resolutions(this.model), aspectRatio: "input_image" as const, inputTransport: ["https_url", "data_url"] as const,
      supportsCancellation: false, submissionIdempotency: "unverified" as const, reconciliation: "task_id_only" as const,
      queryWindowDays: 7, adapterVersion: MINIMAX_H3_ADAPTER_VERSION };
  }
  validate(input: unknown): MiniMaxH3Request {
    requireValue(exact(input, ["prompt", "durationSeconds", "resolution", "firstFrame", "lastFrame"]), "Unsupported H3 request fields");
    requireValue(typeof input.prompt === "string" && input.prompt.trim().length > 0 && Buffer.byteLength(input.prompt) <= MINIMAX_H3_LIMITS.promptBytes,
      "Supply a nonempty prompt within the adapter byte limit");
    requireValue(Number.isInteger(input.durationSeconds) && Number(input.durationSeconds) >= (this.model === "MiniMax-H3" ? 4 : 5) &&
      Number(input.durationSeconds) <= 15 && resolutions(this.model).includes(input.resolution as MiniMaxH3Resolution), "Unsupported model duration or resolution");
    validateImage(input.firstFrame); if (input.lastFrame !== undefined) validateImage(input.lastFrame);
    const request = structuredClone(input) as unknown as MiniMaxH3Request;
    requireValue(Buffer.byteLength(this.body(request)) <= MINIMAX_H3_LIMITS.requestBytes, "H3 request exceeds the byte limit");
    return request;
  }
  private body(request: MiniMaxH3Request): string {
    const content: unknown[] = [{ type: "text", text: request.prompt },
      { type: "image_url", image_url: { url: request.firstFrame.url }, role: "first_frame" }];
    if (request.lastFrame) content.push({ type: "image_url", image_url: { url: request.lastFrame.url }, role: "last_frame" });
    return JSON.stringify({ model: this.model, content, resolution: request.resolution, duration: request.durationSeconds, ratio: "adaptive" });
  }
  async submit(input: MiniMaxH3Request, options: MiniMaxH3CallOptions = {}): Promise<MiniMaxH3SubmitResult> {
    let body: string;
    try { body = this.body(this.validate(input)); }
    catch { return { kind: "rejected", certainty: "not_accepted", error: { code: "H3_REQUEST_INVALID", category: "invalid_input" } }; }
    if (options.signal?.aborted) return { kind: "rejected", certainty: "not_accepted", error: { code: "H3_ABORTED_BEFORE_DISPATCH", category: "aborted" } };
    const response = await this.request("POST", "/v2/video_generation", body, options.signal);
    if (!response.ok) return { kind: "unknown", error: response.error };
    if (response.status === 200 && this.safeId(response.body.task_id) && response.body.type !== "error" && response.body.error === undefined)
      return { kind: "accepted", taskId: response.body.task_id as string, requestedModel: this.model };
    const rejection = this.rejection(response);
    return rejection ? { kind: "rejected", certainty: "not_accepted", error: rejection } :
      { kind: "unknown", error: { code: "H3_SUBMISSION_UNRESOLVED", category: "protocol", httpStatus: response.status } };
  }
  async poll(taskId: string, options: MiniMaxH3CallOptions = {}): Promise<MiniMaxH3PollResult> {
    if (!this.safeId(taskId)) return { kind: "unknown", error: { code: "H3_TASK_ID_INVALID", category: "invalid_input" } };
    const response = await this.request("GET", `/v2/query/video_generation/${taskId}`, undefined, options.signal);
    if (!response.ok) return { kind: "unknown", taskId, error: response.error };
    const task = record(response.body.task);
    const unknown = (): MiniMaxH3PollResult => ({ kind: "unknown", taskId, error: this.rejection(response) ??
      { code: "H3_POLL_UNRESOLVED", category: "protocol", httpStatus: response.status } });
    if (response.status !== 200 || response.body.type === "error" || response.body.error !== undefined ||
      !task || task.id !== taskId || task.model !== this.model ||
      (task.task_type !== undefined && task.task_type !== "generation") || (task.modality !== undefined && task.modality !== "video")) return unknown();
    if (task.status === "queued" || task.status === "running") return { kind: "pending", taskId, status: task.status };
    if (task.status === "cancelled") return { kind: "cancelled", taskId };
    if (task.status === "failed") return { kind: "failed", taskId, error: { code: "H3_TASK_FAILED", category: "provider_failure" } };
    const url = record(task.content)?.url;
    if (task.status !== "succeeded" || !httpsUrl(url) || url.includes(this.#key)) return unknown();
    const duration = typeof task.duration === "number" && Number.isFinite(task.duration) && task.duration > 0 ? task.duration : null;
    const resolution = resolutions(this.model).includes(task.resolution as MiniMaxH3Resolution) ? task.resolution as MiniMaxH3Resolution : null;
    const ratio = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(String(task.ratio)) ? String(task.ratio) : null;
    const usage: Record<string, number> = {};
    for (const name of ["total_seconds", "input_seconds", "output_seconds", "input_image_count", "input_audio_seconds", "total_tokens", "prompt_tokens", "completion_tokens"]) {
      const value = record(task.usage)?.[name];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) usage[name] = value;
    }
    return { kind: "completed", taskId, requestedModel: this.model, reportedModel: task.model as MiniMaxH3Model,
      output: { url, expiresAt: null }, reported: { durationSeconds: duration, resolution, ratio, usage: Object.keys(usage).length ? usage : null } };
  }
  async reconcile(receipt: { taskId?: string }, options: MiniMaxH3CallOptions = {}): Promise<MiniMaxH3PollResult> {
    return receipt.taskId ? this.poll(receipt.taskId, options) : { kind: "unknown", error: { code: "H3_ACCEPTANCE_UNKNOWN_NO_TASK_ID", category: "protocol" } };
  }
  private safeId(value: unknown): value is string { return identifier(value) && !value.includes(this.#key); }
  private rejection(response: HttpResult): MiniMaxH3Diagnostic | undefined {
    const expected: Record<number, [string, MiniMaxH3Diagnostic["category"]]> = {
      400: ["bad_request_error", "invalid_input"], 401: ["authorized_error", "auth"], 402: ["insufficient_balance_error", "quota"],
      422: ["unprocessable_entity_error", "policy"], 429: ["rate_limit_error", "throttled"],
    };
    const pair = expected[response.status], error = record(response.body.error);
    // Only an intact, documented rejection envelope proves this request was rejected. A proxy/5xx does not.
    if (!pair || response.body.type !== "error" || response.body.task_id !== undefined || response.body.task !== undefined ||
      error?.type !== pair[0] || error.http_code !== String(response.status)) return;
    return { code: `H3_HTTP_${response.status}`, category: pair[1], httpStatus: response.status,
      ...(this.safeId(response.body.request_id) ? { requestId: response.body.request_id } : {}),
      ...(response.retryAfterSeconds !== undefined ? { retryAfterSeconds: response.retryAfterSeconds } : {}) };
  }
  private async request(method: "GET" | "POST", path: string, body: string | undefined, signal?: AbortSignal): Promise<HttpResponse> {
    if (signal?.aborted) return { ok: false, error: { code: "H3_CALL_ABORTED", category: "aborted" } };
    const controller = new AbortController(); let stopped = "H3_CALL_TIMEOUT";
    let reject!: () => void; const interruption = new Promise<never>((_, failure) => { reject = () => failure(new Error("interrupted")); });
    const stop = (code: string) => { stopped = code; controller.abort(); reject(); };
    const abort = () => stop("H3_CALL_ABORTED"); signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("H3_CALL_TIMEOUT"), this.#timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const operation = async (): Promise<HttpResult> => {
      const response = await this.#fetch(`https://api.minimax.io${path}`, { method,
        headers: { Authorization: `Bearer ${this.#key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body }), redirect: "manual", signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw new Error("interrupted"); }
      const length = response.headers.get("content-length");
      if (response.redirected || (length !== null && (!/^\d+$/.test(length) || Number(length) > MINIMAX_H3_LIMITS.responseBytes))) throw new Error("invalid response");
      reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      while (reader) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
        if (bytes > MINIMAX_H3_LIMITS.responseBytes) throw new Error("response limit"); chunks.push(chunk.value); }
      const data = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
      if (!data) throw new Error("invalid response");
      const retry = response.headers.get("retry-after");
      return { ok: true, status: response.status, body: data,
        ...(retry !== null && /^\d+$/.test(retry) && Number(retry) <= 86400 ? { retryAfterSeconds: Number(retry) } : {}) };
    };
    try { return await Promise.race([operation(), interruption]); }
    catch { return { ok: false, error: { code: controller.signal.aborted ? stopped : "H3_TRANSPORT_OR_RESPONSE_FAILED",
      category: controller.signal.aborted && stopped === "H3_CALL_ABORTED" ? "aborted" : "transport" } }; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort(); void reader?.cancel().catch(() => {}); }
  }
}
interface HttpResult { ok: true; status: number; body: Record<string, unknown>; retryAfterSeconds?: number }
type HttpResponse = HttpResult | { ok: false; error: MiniMaxH3Diagnostic };
