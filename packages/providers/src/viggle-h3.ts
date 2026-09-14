import { createHash } from "node:crypto";
import { setImmediate as yieldEventLoop } from "node:timers/promises";

/** Viggle V1 H3 text/first/last-frame contract; no reference or animation mode. */
export const VIGGLE_H3_ADAPTER_VERSION = "1";
/** Conservative host bounds, not a claim about the provider's maximum upload size. */
export const VIGGLE_H3_LIMITS = Object.freeze({ imageBytes: 32 * 1024 * 1024, requestBytes: 65 * 1024 * 1024,
  promptBytes: 32 * 1024, responseBytes: 1024 * 1024, timeoutMs: 30_000 });
export type ViggleH3Quality = "low" | "high";
export type ViggleH3Resolution = "480p" | "768p" | "1080p";
export type ViggleH3AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9";
export interface ViggleH3ImageDescription { sha256: string; byteLength: number; width: number; height: number; mediaType: "image/png" }
/** Bytes must come from owned, verified image ingestion; this transport does not decode pixels. */
export interface ViggleH3Image extends ViggleH3ImageDescription { bytes: Uint8Array }
export interface ViggleH3Settings { quality: ViggleH3Quality; resolution: ViggleH3Resolution; aspectRatio: ViggleH3AspectRatio }
export interface ViggleH3Request {
  prompt: string; quality: ViggleH3Quality; durationSeconds: number; resolution: ViggleH3Resolution;
  aspectRatio: ViggleH3AspectRatio; watermark: false; seed?: number; firstFrame?: ViggleH3Image; lastFrame?: ViggleH3Image;
}
export interface ViggleH3Description {
  adapterVersion: "1"; model: "MiniMax-H3"; mode: "text" | "first_frame" | "first_last_frame";
  quality: ViggleH3Quality; durationSeconds: number; resolution: ViggleH3Resolution; aspectRatio: ViggleH3AspectRatio;
  watermark: false; seed?: number; firstFrame?: ViggleH3ImageDescription; lastFrame?: ViggleH3ImageDescription;
  requestDigest: string; bodySha256: string; bodyByteLength: number;
}
export interface ViggleH3Options { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number; maxResponseBytes?: number }
export interface ViggleH3CallOptions { signal?: AbortSignal; expectedRequestDigest?: string; expectedBodySha256?: string }
export interface ViggleH3Receipt { requestId: string | null; httpStatus: number | null }
export interface ViggleH3Diagnostic {
  code: string; category: "invalid_input" | "auth" | "quota" | "policy" | "throttled" | "transport" | "protocol" | "aborted" | "provider_failure";
  retryAfterMs?: number;
}
export type ViggleH3SubmitResult =
  | { kind: "accepted"; taskId: string; requestedModel: "MiniMax-H3"; receipt: ViggleH3Receipt }
  | { kind: "rejected"; certainty: "not_accepted"; source: "local" | "provider"; error: ViggleH3Diagnostic; receipt: ViggleH3Receipt }
  | { kind: "unknown"; error: ViggleH3Diagnostic; receipt: ViggleH3Receipt };
export type ViggleH3PollResult =
  | { kind: "pending"; taskId: string; status: "queued" | "processing"; receipt: ViggleH3Receipt }
  | { kind: "completed"; taskId: string; requestedModel: "MiniMax-H3"; reportedModel: null;
      output: { url: string; expiresAt: null }; reported: { seed: number | null }; receipt: ViggleH3Receipt }
  | { kind: "failed"; taskId: string; error: ViggleH3Diagnostic; receipt: ViggleH3Receipt }
  | { kind: "cancelled"; taskId: string; receipt: ViggleH3Receipt }
  | { kind: "unknown"; taskId?: string; error: ViggleH3Diagnostic; receipt: ViggleH3Receipt };
export class ViggleH3ValidationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ViggleH3ValidationError"; }
}
const ensure: (condition: unknown, code?: string) => asserts condition = (condition, code = "VIGGLE_H3_REQUEST_INVALID") => {
  if (!condition) throw new ViggleH3ValidationError(code);
};
const HASH = /^[a-f0-9]{64}$/, TASK = /^vid_[A-Za-z0-9_-]{1,156}$/, TRACE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const sha = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function own(value: unknown, fields: readonly string[], code = "VIGGLE_H3_REQUEST_INVALID"): Record<string, unknown> {
  ensure(object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code);
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    ensure(typeof key === "string" && fields.includes(key), code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    ensure(descriptor && Object.hasOwn(descriptor, "value"), code); copy[key] = descriptor.value;
  }
  return copy;
}
function copyBytes(value: unknown, maximum: number): Buffer {
  ensure(value instanceof Uint8Array, "VIGGLE_H3_IMAGE_INVALID");
  try {
    const typed = Object.getPrototypeOf(Uint8Array.prototype) as object;
    const get = (name: string): unknown => Object.getOwnPropertyDescriptor(typed, name)!.get!.call(value);
    const buffer = get("buffer"), offset = get("byteOffset"), length = get("byteLength");
    ensure(buffer instanceof ArrayBuffer && typeof offset === "number" && typeof length === "number"
      && length > 0 && length <= maximum, "VIGGLE_H3_IMAGE_INVALID");
    return Buffer.from(new Uint8Array(buffer, offset, length));
  } catch { throw new ViggleH3ValidationError("VIGGLE_H3_IMAGE_INVALID"); }
}
function imageMetadata(value: unknown): ViggleH3ImageDescription {
  const row = own(value, ["sha256", "byteLength", "width", "height", "mediaType"], "VIGGLE_H3_IMAGE_INVALID");
  ensure(typeof row.sha256 === "string" && HASH.test(row.sha256) && row.mediaType === "image/png"
    && Number.isSafeInteger(row.byteLength) && Number(row.byteLength) >= 45 && Number(row.byteLength) <= VIGGLE_H3_LIMITS.imageBytes
    && Number.isSafeInteger(row.width) && Number(row.width) >= 1 && Number(row.width) <= 8192
    && Number.isSafeInteger(row.height) && Number(row.height) >= 1 && Number(row.height) <= 8192, "VIGGLE_H3_IMAGE_INVALID");
  return { sha256: row.sha256, byteLength: row.byteLength as number, width: row.width as number,
    height: row.height as number, mediaType: "image/png" };
}
function prepareImage(value: unknown): ViggleH3Image {
  const row = own(value, ["bytes", "sha256", "byteLength", "width", "height", "mediaType"], "VIGGLE_H3_IMAGE_INVALID");
  const { bytes: input, ...rest } = row, metadata = imageMetadata(rest), bytes = copyBytes(input, VIGGLE_H3_LIMITS.imageBytes);
  ensure(bytes.length === metadata.byteLength && sha(bytes) === metadata.sha256 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString("latin1",12,16) === "IHDR"
    && bytes.readUInt32BE(16) === metadata.width && bytes.readUInt32BE(20) === metadata.height, "VIGGLE_H3_IMAGE_INVALID");
  // Check complete bounded container, not decompression or pixel validity (owned ingestion supplies that proof).
  let offset = 8, chunks = 0, data = false, end = false;
  while (offset < bytes.length) {
    ensure(++chunks <= 4096 && bytes.length - offset >= 12, "VIGGLE_H3_IMAGE_INVALID");
    const length = bytes.readUInt32BE(offset), type = bytes.toString("latin1", offset + 4, offset + 8);
    ensure(length <= bytes.length - offset - 12 && /^[A-Za-z]{4}$/.test(type), "VIGGLE_H3_IMAGE_INVALID");
    ensure(offset === 8 || type !== "IHDR", "VIGGLE_H3_IMAGE_INVALID");
    if (type === "IDAT") data = true;
    offset += length + 12;
    if (type === "IEND") { ensure(length === 0 && offset === bytes.length, "VIGGLE_H3_IMAGE_INVALID"); end = true; }
  }
  ensure(data && end, "VIGGLE_H3_IMAGE_INVALID");
  return { ...metadata, bytes };
}
export function validateViggleH3Settings(input: ViggleH3Settings): void {
  const row = own(input, ["quality", "resolution", "aspectRatio"]);
  settings({ ...row, durationSeconds: 3, watermark: false });
}
function settings(row: Record<string, unknown>): Pick<ViggleH3Description, "quality" | "durationSeconds" | "resolution" | "aspectRatio" | "watermark" | "seed"> {
  ensure(row.quality === "low" || row.quality === "high");
  ensure(typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds) && row.durationSeconds >= 3 && row.durationSeconds <= 15);
  ensure(row.resolution === "480p" || row.resolution === "768p" || row.resolution === "1080p");
  ensure(typeof row.aspectRatio === "string" && ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(row.aspectRatio));
  ensure(row.watermark === false && (row.seed === undefined || Number.isSafeInteger(row.seed) && Number(row.seed) >= 0));
  return { quality: row.quality, durationSeconds: row.durationSeconds, resolution: row.resolution,
    aspectRatio: row.aspectRatio as ViggleH3AspectRatio, watermark: false, ...(row.seed === undefined ? {} : { seed: row.seed as number }) };
}
function promptText(value: unknown): string {
  ensure(typeof value === "string" && value.length <= VIGGLE_H3_LIMITS.promptBytes && value.trim().length > 0
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    && Buffer.byteLength(value) <= VIGGLE_H3_LIMITS.promptBytes);
  return value;
}
type DescriptionBase = Omit<ViggleH3Description, "requestDigest" | "bodySha256" | "bodyByteLength">;
/** Metadata-only identity; exact upload bytes are bound independently by bodySha256. */
export function viggleH3MetadataDigest(prompt: string, description: DescriptionBase): string {
  const row = own(description, ["adapterVersion", "model", "mode", "quality", "durationSeconds", "resolution", "aspectRatio", "watermark", "seed", "firstFrame", "lastFrame"]);
  const text = promptText(prompt), values = settings(row);
  ensure(row.adapterVersion === VIGGLE_H3_ADAPTER_VERSION && row.model === "MiniMax-H3");
  const firstFrame = row.firstFrame === undefined ? undefined : imageMetadata(row.firstFrame);
  const lastFrame = row.lastFrame === undefined ? undefined : imageMetadata(row.lastFrame);
  ensure(!lastFrame || firstFrame);
  const mode = lastFrame ? "first_last_frame" : firstFrame ? "first_frame" : "text";
  ensure(row.mode === mode);
  return sha(JSON.stringify({ adapterVersion: VIGGLE_H3_ADAPTER_VERSION, model: "MiniMax-H3", mode, prompt: text, ...values,
    ...(firstFrame ? { firstFrame } : {}), ...(lastFrame ? { lastFrame } : {}) }));
}
function prepare(input: ViggleH3Request): { description: ViggleH3Description; body: Buffer; contentType: string } {
  const row = own(input, ["prompt", "quality", "durationSeconds", "resolution", "aspectRatio", "watermark", "seed", "firstFrame", "lastFrame"]);
  const prompt = promptText(row.prompt), values = settings(row);
  const firstFrame = row.firstFrame === undefined ? undefined : prepareImage(row.firstFrame);
  const lastFrame = row.lastFrame === undefined ? undefined : prepareImage(row.lastFrame); ensure(!lastFrame || firstFrame);
  const describe = ({ bytes: _bytes, ...metadata }: ViggleH3Image): ViggleH3ImageDescription => metadata;
  const base: DescriptionBase = { adapterVersion: VIGGLE_H3_ADAPTER_VERSION, model: "MiniMax-H3",
    mode: lastFrame ? "first_last_frame" : firstFrame ? "first_frame" : "text", ...values,
    ...(firstFrame ? { firstFrame: describe(firstFrame) } : {}), ...(lastFrame ? { lastFrame: describe(lastFrame) } : {}) };
  const requestDigest = viggleH3MetadataDigest(prompt, base), boundary = `openslate-viggle-h3-${requestDigest}`;
  const parts: Buffer[] = [];
  const field = (name: string, value: string): void => { parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)); };
  field("prompt", prompt); field("quality", values.quality); field("duration_s", String(values.durationSeconds)); field("resolution", values.resolution);
  field("aspect_ratio", values.aspectRatio); if (values.seed !== undefined) field("seed", String(values.seed)); field("watermark", "false");
  for (const [name, image] of [["first_frame_image", firstFrame], ["last_frame_image", lastFrame]] as const) {
    if (image) {
      ensure(!Buffer.from(image.bytes).includes(Buffer.from(`--${boundary}`)), "VIGGLE_H3_MULTIPART_COLLISION");
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(image.bytes), Buffer.from("\r\n"));
    }
  }
  ensure(!prompt.includes(`--${boundary}`), "VIGGLE_H3_MULTIPART_COLLISION");
  parts.push(Buffer.from(`--${boundary}--\r\n`)); const length = parts.reduce((n, part) => n + part.length, 0);
  ensure(length <= VIGGLE_H3_LIMITS.requestBytes, "VIGGLE_H3_REQUEST_TOO_LARGE"); const body = Buffer.concat(parts, length);
  return { description: Object.freeze({ ...base, ...(base.firstFrame ? { firstFrame: Object.freeze(base.firstFrame) } : {}),
    ...(base.lastFrame ? { lastFrame: Object.freeze(base.lastFrame) } : {}), requestDigest, bodySha256: sha(body), bodyByteLength: length }), body,
    contentType: `multipart/form-data; boundary=${boundary}` };
}
export function describeViggleH3Request(input: ViggleH3Request): ViggleH3Description { return prepare(input).description; }
const blankReceipt = (): ViggleH3Receipt => ({ requestId: null, httpStatus: null });
function callOptions(value: unknown): ViggleH3CallOptions {
  const row = own(value, ["signal", "expectedRequestDigest", "expectedBodySha256"], "VIGGLE_H3_CALL_INVALID");
  ensure((row.signal === undefined || row.signal instanceof AbortSignal)
    && [row.expectedRequestDigest, row.expectedBodySha256].every(v => v === undefined || typeof v === "string" && HASH.test(v)), "VIGGLE_H3_CALL_INVALID");
  return row as ViggleH3CallOptions;
}
function https(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192 || /[\s\x00-\x1f\x7f\\]/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 20) return;
  const ms = Number(value) * 1000; return Number.isFinite(ms) && ms >= 0 && ms <= 600000 ? Math.ceil(ms) : undefined;
}
type HttpResponse = { ok: true; body: Record<string, unknown>; receipt: ViggleH3Receipt; retryAfterMs?: number }
  | { ok: false; error: ViggleH3Diagnostic; receipt: ViggleH3Receipt };
/** Explicit single-call transport; only the host owns durable admission, polling schedules and recovery. */
export class ViggleH3Provider {
  readonly id = "viggle-h3-v1";
  readonly model = "MiniMax-H3";
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number; readonly #maximum: number;
  constructor(options: ViggleH3Options) {
    const row = own(options, ["apiKey", "fetch", "timeoutMs", "maxResponseBytes"], "VIGGLE_H3_OPTIONS_INVALID");
    ensure(typeof row.apiKey === "string" && /^[\x21-\x7e]{1,4096}$/.test(row.apiKey), "VIGGLE_H3_CREDENTIAL_INVALID");
    ensure(row.fetch === undefined || typeof row.fetch === "function", "VIGGLE_H3_OPTIONS_INVALID");
    const timeout = row.timeoutMs ?? VIGGLE_H3_LIMITS.timeoutMs, maximum = row.maxResponseBytes ?? VIGGLE_H3_LIMITS.responseBytes;
    ensure(Number.isSafeInteger(timeout) && Number(timeout) >= 1 && Number(timeout) <= 120000
      && Number.isSafeInteger(maximum) && Number(maximum) >= 1 && Number(maximum) <= VIGGLE_H3_LIMITS.responseBytes, "VIGGLE_H3_OPTIONS_INVALID");
    this.#key = row.apiKey; this.#fetch = (row.fetch ?? globalThis.fetch) as typeof globalThis.fetch; this.#timeout = Number(timeout); this.#maximum = Number(maximum);
  }
  describe(input: ViggleH3Request): ViggleH3Description { return describeViggleH3Request(input); }
  async submit(input: ViggleH3Request, options: ViggleH3CallOptions = {}): Promise<ViggleH3SubmitResult> {
    let prepared: ReturnType<typeof prepare>, context: ViggleH3CallOptions;
    try {
      context = callOptions(options); prepared = prepare(input);
      ensure(context.expectedRequestDigest === undefined || context.expectedRequestDigest === prepared.description.requestDigest, "VIGGLE_H3_REQUEST_DIGEST_MISMATCH");
      ensure(context.expectedBodySha256 === undefined || context.expectedBodySha256 === prepared.description.bodySha256, "VIGGLE_H3_BODY_DIGEST_MISMATCH");
      ensure(!context.signal?.aborted, "VIGGLE_H3_ABORTED_BEFORE_DISPATCH");
    } catch (error) { return { kind: "rejected", certainty: "not_accepted", source: "local", receipt: blankReceipt(),
      error: { code: error instanceof ViggleH3ValidationError ? error.code : "VIGGLE_H3_REQUEST_INVALID",
        category: error instanceof ViggleH3ValidationError && error.code === "VIGGLE_H3_ABORTED_BEFORE_DISPATCH" ? "aborted" : "invalid_input" } }; }
    const response = await this.call("POST", "/v1/videos", context.signal, prepared);
    if (!response.ok) return { kind: "unknown", error: response.error, receipt: response.receipt };
    const data = response.body;
    if (response.receipt.httpStatus === 200 && this.safeTask(data.id) && data.status === "queued" && data.error == null
      && data.video_url == null && data.alpha_url == null && data.type !== "error" && !Object.hasOwn(data, "task"))
      return { kind: "accepted", taskId: data.id, requestedModel: "MiniMax-H3", receipt: response.receipt };
    const rejection = this.rejection(response);
    return rejection ? { kind: "rejected", certainty: "not_accepted", source: "provider", error: rejection, receipt: response.receipt }
      : { kind: "unknown", error: { code: "VIGGLE_H3_SUBMISSION_UNRESOLVED", category: "protocol" }, receipt: response.receipt };
  }
  async poll(taskId: string, options: ViggleH3CallOptions = {}): Promise<ViggleH3PollResult> {
    let context: ViggleH3CallOptions;
    try { context = callOptions(options); ensure(this.safeTask(taskId), "VIGGLE_H3_TASK_ID_INVALID"); }
    catch { return { kind: "unknown", error: { code: "VIGGLE_H3_TASK_ID_INVALID", category: "invalid_input" }, receipt: blankReceipt() }; }
    const response = await this.call("GET", `/v1/videos/${taskId}`, context.signal);
    if (!response.ok) return { kind: "unknown", taskId, error: response.error, receipt: response.receipt };
    const data = response.body, unknown = (): ViggleH3PollResult => ({ kind: "unknown", taskId, receipt: response.receipt,
      error: this.rejection(response) ?? { code: "VIGGLE_H3_POLL_UNRESOLVED", category: "protocol" } });
    if (response.receipt.httpStatus !== 200 || data.id !== taskId || data.stage != null || data.alpha_url != null) return unknown();
    if (data.status === "failed" && data.video_url == null)
      return { kind: "failed", taskId, error: { code: "VIGGLE_H3_TASK_FAILED", category: "provider_failure" }, receipt: response.receipt };
    if (data.error != null) return unknown();
    if (data.status === "cancelled" && data.video_url == null) return { kind: "cancelled", taskId, receipt: response.receipt };
    if ((data.status === "queued" || data.status === "processing") && data.video_url == null)
      return { kind: "pending", taskId, status: data.status, receipt: response.receipt };
    if (data.status !== "ready" || !https(data.video_url) || data.video_url.includes(this.#key)) return unknown();
    return { kind: "completed", taskId, requestedModel: "MiniMax-H3", reportedModel: null, output: { url: data.video_url, expiresAt: null },
      reported: { seed: Number.isSafeInteger(data.seed) && Number(data.seed) >= 0 ? data.seed as number : null }, receipt: response.receipt };
  }
  async reconcile(receipt: { taskId?: string }, options: ViggleH3CallOptions = {}): Promise<ViggleH3PollResult> {
    try { const row = own(receipt, ["taskId"], "VIGGLE_H3_TASK_ID_INVALID"); if (this.safeTask(row.taskId)) return this.poll(row.taskId, options); }
    catch { /* Missing/invalid saved identity cannot justify a new submission. */ }
    return { kind: "unknown", error: { code: "VIGGLE_H3_ACCEPTANCE_UNKNOWN_NO_TASK_ID", category: "protocol" }, receipt: blankReceipt() };
  }
  private safeTask(value: unknown): value is string { return typeof value === "string" && TASK.test(value) && !value.includes(this.#key); }
  private trace(value: unknown): string | null { return typeof value === "string" && TRACE.test(value) && !value.includes(this.#key) ? value : null; }
  private rejection(response: Extract<HttpResponse, { ok: true }>): ViggleH3Diagnostic | undefined {
    const data = response.body, error = data.error, status = response.receipt.httpStatus;
    const allowed: Record<number, readonly string[]> = { 400: ["INVALID_REQUEST", "UNSUPPORTED_MEDIA"], 401: ["UNAUTHENTICATED", "INVALID_CREDENTIAL"],
      402: ["INSUFFICIENT_CREDITS"], 403: ["FORBIDDEN"], 422: ["UNSUPPORTED_MEDIA", "CONTENT_POLICY_VIOLATION", "NO_HUMANS_DETECTED"], 429: ["RATE_LIMITED"] };
    if (status === null || !object(error) || typeof error.code !== "string" || !allowed[status]?.includes(error.code)
      || typeof error.message !== "string" || typeof error.retryable !== "boolean" || !object(error.details) || !object(error.remediation)
      || typeof error.remediation.action !== "string" || !(error.request_id === null || this.trace(error.request_id))
      || ["id", "status", "video_url", "task", "task_id", "output", "result"].some(key => Object.hasOwn(data, key))) return;
    const delay = error.remediation.retry_after_ms;
    const retryAfterMs = Number.isSafeInteger(delay) && Number(delay) >= 0 && Number(delay) <= 600000 ? Number(delay) : response.retryAfterMs;
    const category: ViggleH3Diagnostic["category"] = status === 401 || status === 403 ? "auth" : status === 402 ? "quota"
      : status === 429 ? "throttled" : status === 422 ? "policy" : "invalid_input";
    return { code: error.code, category, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }
  private async call(method: "POST" | "GET", path: string, signal: AbortSignal | undefined,
    prepared?: { body: Buffer; contentType: string }): Promise<HttpResponse> {
    const receipt = blankReceipt();
    if (signal?.aborted) return { ok: false, receipt, error: { code: "VIGGLE_H3_CALL_ABORTED", category: "aborted" } };
    const controller = new AbortController(); let timedOut = false, cancelBody: (() => void) | undefined;
    let observed: Extract<HttpResponse, { ok: true }> | undefined;
    const stop = (): void => controller.abort(); signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    let reject!: () => void;
    const interrupted = new Promise<never>((_, fail) => { reject = () => { cancelBody?.(); fail(new ViggleH3ValidationError(timedOut ? "VIGGLE_H3_CALL_TIMEOUT" : "VIGGLE_H3_CALL_ABORTED")); };
      controller.signal.addEventListener("abort", reject, { once: true }); });
    const operation = async (): Promise<HttpResponse> => {
      const response = await this.#fetch(`https://apis.viggle.ai${path}`, { method, redirect: "manual", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.#key}`, Accept: "application/json", ...(prepared ? { "Content-Type": prepared.contentType } : {}) },
        ...(prepared ? { body: prepared.body as Uint8Array<ArrayBuffer> } : {}) });
      const safeCancel = (): void => { void Promise.resolve().then(() => response.body?.cancel()).catch(() => undefined); };
      if (controller.signal.aborted) { safeCancel(); throw new ViggleH3ValidationError("VIGGLE_H3_CALL_ABORTED"); }
      receipt.httpStatus = response.status; receipt.requestId = this.trace(response.headers.get("x-request-id")); cancelBody = safeCancel;
      const size = response.headers.get("content-length"), mime = (response.headers.get("content-type") ?? "").split(";",1)[0]!.trim().toLowerCase();
      ensure(!response.redirected && response.status >= 200 && response.status < 600 && !(response.status >= 300 && response.status < 400)
        && mime === "application/json" && (size === null || /^\d+$/.test(size) && Number(size) <= this.#maximum), "VIGGLE_H3_RESPONSE_INVALID");
      ensure(response.body, "VIGGLE_H3_RESPONSE_INVALID"); const reader = response.body.getReader(); let cancellation: Promise<void> | undefined;
      const cancel = (): Promise<void> => cancellation ??= Promise.resolve().then(() => reader.cancel()).catch(() => undefined);
      cancelBody = () => { void cancel(); }; let buffer = Buffer.alloc(Math.min(this.#maximum,65536)), total = 0, reads = 0;
      try {
        for (;;) {
          if (++reads % 256 === 0) await yieldEventLoop(); ensure(!controller.signal.aborted, "VIGGLE_H3_CALL_ABORTED");
          const part = await reader.read(); ensure(!controller.signal.aborted, "VIGGLE_H3_CALL_ABORTED"); if (part.done) break;
          ensure(part.value instanceof Uint8Array && part.value.byteLength <= this.#maximum-total, "VIGGLE_H3_RESPONSE_TOO_LARGE");
          const required = total+part.value.byteLength;
          if (required > buffer.length) { const next = Buffer.alloc(Math.min(this.#maximum,Math.max(required,buffer.length*2))); buffer.copy(next,0,0,total); buffer=next; }
          buffer.set(part.value,total); total=required;
        }
        const body: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer.subarray(0,total))); ensure(object(body), "VIGGLE_H3_RESPONSE_INVALID");
        if (receipt.requestId === null && object(body.error)) receipt.requestId = this.trace(body.error.request_id);
        const delay = retryAfter(response.headers.get("retry-after"));
        observed = { ok:true, body, receipt:{...receipt}, ...(delay === undefined ? {} : {retryAfterMs:delay}) };
        return observed;
      } finally { await cancel(); reader.releaseLock(); }
    };
    try { return await Promise.race([operation(),interrupted]);
    } catch(error) {
      // Complete parsed evidence survives a later cleanup/abort race. Cancellation
      // cannot erase an observed provider job and justify another paid submission.
      if (observed) return observed;
      return {ok:false,receipt:{...receipt},error:{code:error instanceof ViggleH3ValidationError ? error.code : "VIGGLE_H3_TRANSPORT_OR_RESPONSE_LOSS",
      category:controller.signal.aborted ? timedOut ? "transport" : "aborted" : "protocol"}};
    } finally {clearTimeout(timer);signal?.removeEventListener("abort",stop);controller.signal.removeEventListener("abort",reject);controller.abort();cancelBody?.();}
  }
}
