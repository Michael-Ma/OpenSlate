import { createHash } from "node:crypto";

export const OPENAI_IMAGE_MODEL = "gpt-image-2-2026-04-21" as const;
export type OpenAIImageModel = typeof OPENAI_IMAGE_MODEL | "gpt-image-2";
export type OpenAIImageQuality = "low" | "medium" | "high";
export type OpenAIInputMime = "image/png" | "image/jpeg" | "image/webp";

/** Host-owned bytes, already decoded/inspected during artifact ingestion. No paths or URLs. */
export interface OpenAIImageInput {
  artifactId: string;
  sha256: string;
  mimeType: OpenAIInputMime;
  bytes: Uint8Array;
}
interface ImageParameters {
  model: OpenAIImageModel;
  prompt: string;
  width: number;
  height: number;
  quality: OpenAIImageQuality;
}
export type OpenAIImageRequest = ImageParameters & (
  | { mode: "generate" }
  | { mode: "edit"; images: readonly OpenAIImageInput[] }
);
export interface OpenAIImageDescription {
  adapter: "openai-image-v1";
  requestDigest: string;
  model: OpenAIImageModel;
  mode: "generate" | "edit";
  width: number;
  height: number;
  quality: OpenAIImageQuality;
  inputs: { artifactId: string; sha256: string; mimeType: OpenAIInputMime; byteLength: number }[];
}
export interface OpenAIImageReceipt {
  attemptId: string;
  requestDigest: string;
  requestedModel: OpenAIImageModel;
  /** The synchronous API has no task ID. This header is diagnostic evidence only. */
  requestId: string | null;
  httpStatus: number | null;
}
export interface OpenAIImageUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputImageTokens: number | null;
  inputTextTokens: number | null;
}
export type OpenAIImageOutcome =
  | {
      kind: "completed";
      receipt: OpenAIImageReceipt;
      created: number;
      /** Null when the response does not disclose a resolved model. Never inferred from the request. */
      reportedModel: OpenAIImageModel | null;
      usage: OpenAIImageUsage | null;
      output: { port: "image"; kind: "image"; mimeType: "image/png"; extension: "png";
        bytes: Uint8Array; sha256: string; width: number; height: number; fixture: false };
    }
  | { kind: "rejected"; certainty: "not_accepted"; source: "local" | "provider";
      receipt: OpenAIImageReceipt; code: string }
  | { kind: "unknown"; receipt: OpenAIImageReceipt; code: string };

export interface OpenAIImageSubmitContext {
  attemptId: string;
  /** Persist this digest with the paid intent before calling submit. */
  expectedRequestDigest: string;
  signal?: AbortSignal;
}
export interface OpenAIImageAdapterOptions {
  /** Trusted host supplies credentials; never include this constructor configuration in logs. */
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Host can lower, but cannot raise, the transport's memory bounds. */
  maxResponseBytes?: number;
  maxOutputBytes?: number;
}

const MiB = 1024 * 1024;
const MAX_INPUT_BYTES = 4 * MiB;
const MAX_TOTAL_INPUT_BYTES = 24 * MiB;
const MAX_RESPONSE_BYTES = 48 * MiB;
const MAX_OUTPUT_BYTES = 32 * MiB;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class TransportValidationError extends Error {
  constructor(readonly code: string) { super(code); }
}
function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new TransportValidationError(code);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  ensure(Object.keys(value).every((key) => allowed.includes(key)), "UNSUPPORTED_REQUEST_FIELD");
}
function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function boundedOption(value: number | undefined, fallback: number, minimum: number): number {
  const result = value ?? fallback;
  ensure(Number.isSafeInteger(result) && result >= minimum && result <= fallback, "INVALID_ADAPTER_OPTION");
  return result;
}
function magicMatches(bytes: Uint8Array, mime: OpenAIInputMime): boolean {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png") return data.length >= 33 && data.subarray(0, 8).equals(PNG)
    && data.readUInt32BE(8) === 13 && data.toString("ascii", 12, 16) === "IHDR";
  if (mime === "image/jpeg") return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  return data.length >= 16 && data.toString("ascii", 0, 4) === "RIFF"
    && data.toString("ascii", 8, 12) === "WEBP";
}

interface PreparedRequest {
  description: OpenAIImageDescription;
  body: Record<string, unknown>;
}
function prepare(request: OpenAIImageRequest): PreparedRequest {
  ensure(object(request), "INVALID_REQUEST");
  keys(request, request.mode === "edit"
    ? ["model", "mode", "prompt", "width", "height", "quality", "images"]
    : ["model", "mode", "prompt", "width", "height", "quality"]);
  ensure(request.model === OPENAI_IMAGE_MODEL || request.model === "gpt-image-2", "UNSUPPORTED_MODEL");
  ensure(request.mode === "edit" || request.mode === "generate", "UNSUPPORTED_MODE");
  ensure(typeof request.prompt === "string" && request.prompt.trim().length > 0 && request.prompt.length <= 32000,
    "INVALID_PROMPT");
  const { width, height } = request;
  ensure(Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    && width <= 3840 && height <= 3840 && width % 16 === 0 && height % 16 === 0
    && Math.max(width, height) <= 3 * Math.min(width, height)
    && width * height >= 655360 && width * height <= 8294400, "INVALID_IMAGE_SIZE");
  ensure(["low", "medium", "high"].includes(request.quality), "UNSUPPORTED_QUALITY");
  const inputs: OpenAIImageDescription["inputs"] = [];
  const images: { image_url: string }[] = [];
  let totalBytes = 0;
  if (request.mode === "edit") {
    ensure(Array.isArray(request.images) && request.images.length >= 1 && request.images.length <= 8,
      "INVALID_IMAGE_COUNT");
    for (const source of request.images) {
      ensure(object(source), "INVALID_IMAGE_INPUT");
      keys(source, ["artifactId", "sha256", "mimeType", "bytes"]);
      ensure(typeof source.artifactId === "string" && ID.test(source.artifactId), "INVALID_ARTIFACT_ID");
      ensure(typeof source.sha256 === "string" && HASH.test(source.sha256), "INVALID_INPUT_HASH");
      ensure(source.mimeType === "image/png" || source.mimeType === "image/jpeg" || source.mimeType === "image/webp",
        "UNSUPPORTED_INPUT_FORMAT");
      ensure(source.bytes instanceof Uint8Array && source.bytes.byteLength > 0
        && source.bytes.byteLength <= MAX_INPUT_BYTES, "INPUT_TOO_LARGE");
      totalBytes += source.bytes.byteLength;
      ensure(totalBytes <= MAX_TOTAL_INPUT_BYTES, "INPUTS_TOO_LARGE");
      // Copy before the first await: mutable caller buffers cannot change the transmitted identity.
      const bytes = Buffer.from(source.bytes);
      ensure(sha256(bytes) === source.sha256, "INPUT_HASH_MISMATCH");
      ensure(magicMatches(bytes, source.mimeType), "INPUT_FORMAT_MISMATCH");
      inputs.push({ artifactId: source.artifactId, sha256: source.sha256,
        mimeType: source.mimeType, byteLength: bytes.byteLength });
      images.push({ image_url: `data:${source.mimeType};base64,${bytes.toString("base64")}` });
    }
  }
  const body: Record<string, unknown> = {
    model: request.model, prompt: request.prompt, n: 1, size: `${width}x${height}`,
    quality: request.quality, output_format: "png", background: "opaque", moderation: "auto", stream: false,
  };
  if (request.mode === "edit") body.images = images;
  // Hash a fixed-order semantic envelope, not authentication or incidental transport headers.
  const requestDigest = sha256(JSON.stringify({ adapter: "openai-image-v1", mode: request.mode,
    model: request.model, prompt: request.prompt, width, height, quality: request.quality,
    n: 1, outputFormat: "png", background: "opaque", moderation: "auto", stream: false, inputs }));
  return { description: { adapter: "openai-image-v1", requestDigest, model: request.model,
    mode: request.mode, width, height, quality: request.quality, inputs }, body };
}

/** Pure validation/fingerprint helper; it performs no network or filesystem access. */
export function describeOpenAIImageRequest(request: OpenAIImageRequest): OpenAIImageDescription {
  return prepare(request).description;
}

async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body?.cancel().catch(() => undefined);
    throw new TransportValidationError("RESPONSE_TOO_LARGE");
  }
  ensure(response.body, "EMPTY_RESPONSE");
  const reader = response.body.getReader();
  const cancel = (): void => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    ensure(!signal.aborted, "SUBMISSION_ABORTED");
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      ensure(size <= limit, "RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown; }
    catch { throw new TransportValidationError("INVALID_JSON_RESPONSE"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    // Do not wait indefinitely for a remote stream's cancellation callback.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isProtocolRejection(status: number, payload: unknown): boolean {
  if (!object(payload) || !object(payload.error) || typeof payload.error.message !== "string") return false;
  // Output or usage evidence contradicts a no-work rejection, even on a documented 4xx status.
  if (payload.data !== undefined || payload.created !== undefined || payload.usage !== undefined) return false;
  const error = payload.error;
  // Output moderation may happen after generation. Do not classify it as a no-work rejection.
  if (error.type === "image_generation_user_error" || error.code === "moderation_blocked"
    || error.code === "content_policy_violation" || error.moderation_details !== undefined) return false;
  if ([400, 404, 413, 415, 422].includes(status)) return error.type === "invalid_request_error";
  if (status === 401) return error.type === "authentication_error" || error.type === "invalid_request_error";
  if (status === 403) return error.type === "permission_error" || error.type === "invalid_request_error";
  if (status === 429) return error.type === "rate_limit_error" || error.type === "insufficient_quota";
  return false;
}

function usageFrom(value: unknown): OpenAIImageUsage | null {
  if (!object(value) || !safeInteger(value.input_tokens) || !safeInteger(value.output_tokens)
    || !safeInteger(value.total_tokens)) return null;
  const details = object(value.input_tokens_details) ? value.input_tokens_details : {};
  return { inputTokens: value.input_tokens, outputTokens: value.output_tokens, totalTokens: value.total_tokens,
    inputImageTokens: safeInteger(details.image_tokens) ? details.image_tokens : null,
    inputTextTokens: safeInteger(details.text_tokens) ? details.text_tokens : null };
}

/** Synchronous Images API transport only. It never retries, polls, creates jobs or promotes artifacts. */
export class OpenAIImageAdapter {
  #apiKey: string;
  #fetch: typeof globalThis.fetch;
  #timeoutMs: number;
  #maxResponseBytes: number;
  #maxOutputBytes: number;

  constructor(options: OpenAIImageAdapterOptions) {
    ensure(typeof options.apiKey === "string" && options.apiKey.length >= 1 && options.apiKey.length <= 4096
      && !/[\s\x00-\x1f\x7f]/.test(options.apiKey), "INVALID_CREDENTIAL_CONFIGURATION");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = boundedOption(options.timeoutMs, 600000, 1);
    this.#maxResponseBytes = boundedOption(options.maxResponseBytes, MAX_RESPONSE_BYTES, 256);
    this.#maxOutputBytes = boundedOption(options.maxOutputBytes, MAX_OUTPUT_BYTES, 33);
  }

  describe(request: OpenAIImageRequest): OpenAIImageDescription { return describeOpenAIImageRequest(request); }

  async submit(request: OpenAIImageRequest, context: OpenAIImageSubmitContext): Promise<OpenAIImageOutcome> {
    const receipt: OpenAIImageReceipt = { attemptId: typeof context.attemptId === "string" && ID.test(context.attemptId)
      ? context.attemptId : "invalid", requestDigest: HASH.test(context.expectedRequestDigest)
      ? context.expectedRequestDigest : "invalid", requestedModel: OPENAI_IMAGE_MODEL, requestId: null, httpStatus: null };
    let prepared: PreparedRequest;
    try {
      ensure(typeof context.attemptId === "string" && ID.test(context.attemptId)
        && typeof context.expectedRequestDigest === "string" && HASH.test(context.expectedRequestDigest), "INVALID_SUBMIT_CONTEXT");
      prepared = prepare(request);
      receipt.requestedModel = prepared.description.model;
      ensure(prepared.description.requestDigest === context.expectedRequestDigest, "REQUEST_DIGEST_MISMATCH");
      ensure(!context.signal?.aborted, "ABORTED_BEFORE_SUBMISSION");
    } catch (error) {
      return { kind: "rejected", source: "local", certainty: "not_accepted", receipt,
        code: error instanceof TransportValidationError ? error.code : "INVALID_REQUEST" };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeoutMs);
    const externalAbort = (): void => controller.abort();
    context.signal?.addEventListener("abort", externalAbort, { once: true });
    let rejectAborted: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(new TransportValidationError(timedOut ? "SUBMISSION_TIMEOUT" : "SUBMISSION_ABORTED"));
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      const endpoint = prepared.description.mode === "edit" ? "edits" : "generations";
      // No SDK retry layer, redirects, configurable URL, Files API upload or remote image fetch.
      const operation = async (): Promise<OpenAIImageOutcome> => {
        const response = await this.#fetch(`https://api.openai.com/v1/images/${endpoint}`, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(prepared.body),
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          throw new TransportValidationError("SUBMISSION_ABORTED");
        }
        receipt.httpStatus = response.status;
        const requestId = response.headers.get("x-request-id");
        receipt.requestId = requestId && ID.test(requestId) && !requestId.includes(this.#apiKey) ? requestId : null;
        const payload = await readBounded(response, response.ok ? this.#maxResponseBytes : Math.min(this.#maxResponseBytes, MiB),
          controller.signal);
        if (!response.ok) {
          // Definite protocol rejections only. 408/409/5xx and unrecognized bodies remain uncertain.
          if (isProtocolRejection(response.status, payload)) {
            return { kind: "rejected", source: "provider", certainty: "not_accepted", receipt,
              code: `HTTP_${response.status}` };
          }
          return { kind: "unknown", receipt, code: "UNCONFIRMED_HTTP_FAILURE" };
        }
        ensure(object(payload) && payload.error === undefined && payload.type !== "error"
          && safeInteger(payload.created) && Array.isArray(payload.data)
          && payload.data.length === 1 && object(payload.data[0]), "INVALID_IMAGE_RESPONSE");
        const item = payload.data[0];
        ensure(item.error === undefined && item.type !== "error", "INVALID_IMAGE_RESPONSE");
        ensure(typeof item.b64_json === "string" && item.b64_json.length > 0 && item.url === undefined,
          "MISSING_INLINE_IMAGE");
        ensure(item.b64_json.length <= Math.ceil(this.#maxOutputBytes / 3) * 4, "OUTPUT_TOO_LARGE");
        ensure(item.b64_json.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(item.b64_json),
          "INVALID_IMAGE_BASE64");
        const bytes = Buffer.from(item.b64_json, "base64");
        ensure(bytes.byteLength <= this.#maxOutputBytes && bytes.toString("base64") === item.b64_json, "INVALID_IMAGE_BASE64");
        ensure(magicMatches(bytes, "image/png"), "OUTPUT_FORMAT_MISMATCH");
        const width = bytes.readUInt32BE(16);
        const height = bytes.readUInt32BE(20);
        ensure(width === prepared.description.width && height === prepared.description.height, "OUTPUT_SIZE_MISMATCH");
        ensure(payload.size === undefined || payload.size === `${width}x${height}`, "OUTPUT_SIZE_MISMATCH");
        ensure(payload.output_format === undefined || payload.output_format === "png", "OUTPUT_FORMAT_MISMATCH");
        ensure(payload.quality === undefined || payload.quality === prepared.description.quality, "OUTPUT_QUALITY_MISMATCH");
        ensure(payload.background === undefined || payload.background === "opaque", "OUTPUT_BACKGROUND_MISMATCH");
        ensure(payload.model === undefined || payload.model === "gpt-image-2" || payload.model === OPENAI_IMAGE_MODEL,
          "OUTPUT_MODEL_MISMATCH");
        return { kind: "completed", receipt, created: payload.created,
          reportedModel: payload.model === undefined ? null : payload.model as OpenAIImageModel,
          usage: usageFrom(payload.usage), output: { port: "image", kind: "image", mimeType: "image/png", extension: "png",
            bytes, sha256: sha256(bytes), width, height, fixture: false } };
      };
      return await Promise.race([operation(), aborted]);
    } catch (error) {
      // Never return vendor error text, request bodies, credentials or fetch exception messages.
      return { kind: "unknown", receipt: { ...receipt },
        code: error instanceof TransportValidationError ? error.code : "TRANSPORT_OR_RESPONSE_LOSS" };
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", externalAbort);
      if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted);
      controller.abort();
    }
  }
}
