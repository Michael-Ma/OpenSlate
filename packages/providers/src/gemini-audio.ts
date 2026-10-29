import { createHash } from "node:crypto";

/**
 * Gemini audio understanding over `models.generateContent` with inline audio and a JSON response schema. Wire
 * contract reviewed against the Gemini API docs (audio understanding, structured output, models, pricing, files)
 * on 2026-10-28. generateContent is "legacy" next to the newer Interactions API but "remains fully supported"; it is
 * used because its request and response shapes are fully documented. One call per method; nothing here retries.
 */
export const GEMINI_AUDIO_ADAPTER_VERSION = "1";
export const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com";
export type GeminiAudioModel = "gemini-3.8-flash" | "gemini-3.5-flash-lite";
export const GEMINI_AUDIO_MODELS: readonly GeminiAudioModel[] = Object.freeze(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);
/** "Our most intelligent Flash model"; stable; audio input, structured output, thinking low/medium/high. */
export const GEMINI_AUDIO_DEFAULT_MODEL: GeminiAudioModel = "gemini-3.8-flash";
/** "Each second of audio is represented as 32 tokens." */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 32;
export const GEMINI_AUDIO_LIMITS = Object.freeze({
  /** "Maximum request size is 20 MB total (including prompts and all files)" for inline data. */
  inlineRequestBytes: 20 * 1024 * 1024,
  /** Output plus thinking tokens. The model allows 65,536; a song's sections and lyrics need far fewer. */
  maxOutputTokens: 16_384,
  promptBytes: 64 * 1024, responseBytes: 4 * 1024 * 1024, timeoutMs: 240_000,
});

/** USD micros per 1M tokens, by the date a price stops applying (inclusive, UTC). The last row has no end. */
interface PriceRow { until: string | null; inputMicrosPerMillion: number; outputMicrosPerMillion: number }
export const GEMINI_AUDIO_PRICES: Readonly<Record<GeminiAudioModel, readonly PriceRow[]>> = Object.freeze({
  // Paid tier: input "$0.75 through December 31, 2026", "$1.50 starting January 1, 2027"; output (including
  // thinking) "$3.75 …", "$7.50 …". The page gives one input price, with no separate audio row, for this model.
  "gemini-3.8-flash": Object.freeze([
    { until: "2026-12-31", inputMicrosPerMillion: 750_000, outputMicrosPerMillion: 3_750_000 },
    { until: null, inputMicrosPerMillion: 1_500_000, outputMicrosPerMillion: 7_500_000 }]),
  // "$0.30 (text / image / video / audio)" input, "$2.50" output.
  "gemini-3.5-flash-lite": Object.freeze([{ until: null, inputMicrosPerMillion: 300_000, outputMicrosPerMillion: 2_500_000 }]),
});

export interface GeminiAudioQuote {
  model: GeminiAudioModel; audioSeconds: number; inputTokens: number;
  /** A typical answer (sections, vocals, a lyric line every few seconds, low thinking). */
  typicalOutputTokens: number; maxOutputTokens: number;
  typicalMicros: number; maxMicros: number;
  /** The price row used: the date it applies until, or null for the open-ended one. */
  priceUntil: string | null;
}
/** Estimated USD micros for one listen. Pure; the ceiling assumes every allowed output token is used. */
export function geminiAudioQuote(model: GeminiAudioModel, audioSeconds: number, promptTokens: number, at: Date): GeminiAudioQuote {
  ensure(GEMINI_AUDIO_MODELS.includes(model) && Number.isFinite(audioSeconds) && audioSeconds > 0 && audioSeconds <= 4 * 3600
    && Number.isSafeInteger(promptTokens) && promptTokens >= 0 && !Number.isNaN(at.getTime()), "GEMINI_QUOTE_INVALID");
  const day = at.toISOString().slice(0, 10);
  const row = GEMINI_AUDIO_PRICES[model].find(price => price.until === null || day <= price.until)!;
  const inputTokens = Math.ceil(audioSeconds * GEMINI_AUDIO_TOKENS_PER_SECOND) + promptTokens;
  const maxOutputTokens = GEMINI_AUDIO_LIMITS.maxOutputTokens;
  const typicalOutputTokens = Math.min(maxOutputTokens, 1500 + Math.ceil(audioSeconds * 12));
  const cost = (input: number, output: number) => Math.ceil((input * row.inputMicrosPerMillion + output * row.outputMicrosPerMillion) / 1_000_000);
  return { model, audioSeconds, inputTokens, typicalOutputTokens, maxOutputTokens,
    typicalMicros: cost(inputTokens, typicalOutputTokens), maxMicros: cost(inputTokens, maxOutputTokens), priceUntil: row.until };
}

export interface GeminiAudioRequest {
  model: GeminiAudioModel;
  /** Mono PCM16 WAV prepared by the host; sent inline (base64), never through the Files API. */
  audio: { bytes: Uint8Array; sha256: string; mediaType: "audio/wav" };
  prompt: string;
  /** JSON Schema for `responseJsonSchema`; the reply is still validated by the caller. */
  responseSchema: Record<string, unknown>;
}
export interface GeminiUsage { inputTokens: number | null; audioTokens: number | null; outputTokens: number | null; thoughtTokens: number | null }
export type GeminiCharge = "no" | "maybe";
export interface GeminiDiagnostic {
  code: string;
  category: "invalid_input" | "auth" | "quota" | "throttled" | "transport" | "protocol" | "aborted" | "provider_failure" | "truncated";
  /** Whether the call may have been billed; only a refusal before the model ran is "no". */
  charged: GeminiCharge;
  httpStatus: number | null;
  retryAfterMs?: number;
}
export type GeminiAudioResult =
  | { kind: "completed"; text: string; usage: GeminiUsage; modelVersion: string | null }
  /** The model or its safety filters declined (blockReason or a SAFETY/RECITATION/... finish). */
  | { kind: "refused"; reason: string; usage: GeminiUsage; charged: GeminiCharge }
  | { kind: "failed"; error: GeminiDiagnostic };
export interface GeminiAudioTransport {
  generate(request: GeminiAudioRequest, options?: { signal?: AbortSignal }): Promise<GeminiAudioResult>;
}

export class GeminiAudioValidationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "GeminiAudioValidationError"; }
}
function ensure(condition: unknown, code = "GEMINI_AUDIO_REQUEST_INVALID"): asserts condition {
  if (!condition) throw new GeminiAudioValidationError(code);
}
const HASH = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const REFUSALS = new Set(["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "OTHER"]);
const SAFE_WORD = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The exact generateContent body. Thinking stays low: the work is listening, not reasoning. */
export function geminiAudioBody(request: GeminiAudioRequest): string {
  ensure(object(request) && GEMINI_AUDIO_MODELS.includes(request.model) && object(request.responseSchema)
    && typeof request.prompt === "string" && request.prompt.length > 0 && Buffer.byteLength(request.prompt) <= GEMINI_AUDIO_LIMITS.promptBytes);
  const audio = request.audio;
  ensure(object(audio) && audio.bytes instanceof Uint8Array && audio.mediaType === "audio/wav" && typeof audio.sha256 === "string" && HASH.test(audio.sha256)
    && audio.bytes.byteLength > 44 && createHash("sha256").update(audio.bytes).digest("hex") === audio.sha256, "GEMINI_AUDIO_INVALID");
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(audio.bytes.buffer, audio.bytes.byteOffset, audio.bytes.byteLength).toString("base64") } }, { text: request.prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: request.responseSchema,
      maxOutputTokens: GEMINI_AUDIO_LIMITS.maxOutputTokens, thinkingConfig: { thinkingLevel: "low" } },
  });
  ensure(Buffer.byteLength(body) <= GEMINI_AUDIO_LIMITS.inlineRequestBytes, "GEMINI_AUDIO_TOO_LARGE");
  return body;
}

function usage(value: unknown): GeminiUsage {
  const meta = object(value) ? value : {};
  const details = Array.isArray(meta.promptTokensDetails) ? meta.promptTokensDetails : [];
  const audio = details.find(item => object(item) && item.modality === "AUDIO");
  return { inputTokens: count(meta.promptTokenCount), audioTokens: object(audio) ? count(audio.tokenCount) : null,
    outputTokens: count(meta.candidatesTokenCount), thoughtTokens: count(meta.thoughtsTokenCount) };
}
function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return;
  return Number(value) * 1000;
}
function classify(status: number, retryAfterMs?: number): GeminiDiagnostic {
  const extra = { httpStatus: status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  // Google bills processed tokens; a request refused before the model ran (4xx) is not processed.
  if (status === 400 || status === 404 || status === 413) return { code: "GEMINI_INVALID_REQUEST", category: "invalid_input", charged: "no", ...extra };
  if (status === 401 || status === 403) return { code: "GEMINI_AUTH_REJECTED", category: "auth", charged: "no", ...extra };
  if (status === 429) return { code: "GEMINI_RATE_LIMITED", category: "throttled", charged: "no", ...extra };
  return { code: status >= 500 ? "GEMINI_PROVIDER_ERROR" : "GEMINI_UNEXPECTED_STATUS", category: status >= 500 ? "provider_failure" : "protocol", charged: "maybe", ...extra };
}

/** Parse one generateContent reply. Pure; exported for tests and fakes. */
export function parseGeminiAudioResponse(status: number, body: unknown, retryAfterMs?: number): GeminiAudioResult {
  if (status !== 200) return { kind: "failed", error: classify(status, retryAfterMs) };
  if (!object(body)) return { kind: "failed", error: { code: "GEMINI_RESPONSE_MALFORMED", category: "protocol", charged: "maybe", httpStatus: status } };
  const used = usage(body.usageMetadata);
  const feedback = object(body.promptFeedback) ? body.promptFeedback : {};
  if (typeof feedback.blockReason === "string")
    return { kind: "refused", reason: SAFE_WORD.test(feedback.blockReason) ? feedback.blockReason : "BLOCKED", usage: used, charged: "maybe" };
  const candidate = Array.isArray(body.candidates) && object(body.candidates[0]) ? body.candidates[0] : null;
  if (!candidate) return { kind: "failed", error: { code: "GEMINI_RESPONSE_MALFORMED", category: "protocol", charged: "maybe", httpStatus: status } };
  const finish = typeof candidate.finishReason === "string" ? candidate.finishReason : "STOP";
  if (REFUSALS.has(finish)) return { kind: "refused", reason: finish, usage: used, charged: "maybe" };
  if (finish === "MAX_TOKENS") return { kind: "failed", error: { code: "GEMINI_OUTPUT_TRUNCATED", category: "truncated", charged: "maybe", httpStatus: status } };
  const parts = object(candidate.content) && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.filter(part => object(part) && part.thought !== true && typeof part.text === "string").map(part => (part as { text: string }).text).join("");
  if (finish !== "STOP" || !text) return { kind: "failed", error: { code: finish === "STOP" ? "GEMINI_EMPTY_OUTPUT" : "GEMINI_UNEXPECTED_FINISH", category: "protocol", charged: "maybe", httpStatus: status } };
  const version = typeof body.modelVersion === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(body.modelVersion) ? body.modelVersion : null;
  return { kind: "completed", text, usage: used, modelVersion: version };
}

export interface GeminiHttpTransportOptions { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }

/** The real transport. The key travels only in the `x-goog-api-key` header and never appears in a result. */
export class GeminiHttpTransport implements GeminiAudioTransport {
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number;
  constructor(options: GeminiHttpTransportOptions) {
    ensure(object(options) && typeof options.apiKey === "string" && /^[\x21-\x7e]{1,4096}$/.test(options.apiKey), "GEMINI_CREDENTIAL_INVALID");
    ensure(options.fetch === undefined || typeof options.fetch === "function", "GEMINI_OPTIONS_INVALID");
    const timeout = options.timeoutMs ?? GEMINI_AUDIO_LIMITS.timeoutMs;
    ensure(Number.isSafeInteger(timeout) && timeout >= 1 && timeout <= 600_000, "GEMINI_OPTIONS_INVALID");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = timeout;
  }

  async generate(request: GeminiAudioRequest, options: { signal?: AbortSignal } = {}): Promise<GeminiAudioResult> {
    let body: string;
    try { body = geminiAudioBody(request); }
    catch (error) { return { kind: "failed", error: { code: error instanceof GeminiAudioValidationError ? error.code : "GEMINI_AUDIO_REQUEST_INVALID", category: "invalid_input", charged: "no", httpStatus: null } }; }
    if (options.signal?.aborted) return { kind: "failed", error: { code: "GEMINI_ABORTED_BEFORE_DISPATCH", category: "aborted", charged: "no", httpStatus: null } };
    const controller = new AbortController(); let timedOut = false;
    const stop = (): void => controller.abort(); options.signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    let status: number | null = null;
    try {
      const response = await this.#fetch(`${GEMINI_API_ORIGIN}/v1beta/models/${request.model}:generateContent`, {
        method: "POST", redirect: "manual", signal: controller.signal, body,
        headers: { "x-goog-api-key": this.#key, "Content-Type": "application/json", Accept: "application/json" } });
      status = response.status;
      ensure(status >= 200 && status < 600 && !(status >= 300 && status < 400), "GEMINI_RESPONSE_REDIRECT");
      const size = response.headers.get("content-length");
      ensure(size === null || /^\d+$/.test(size) && Number(size) <= GEMINI_AUDIO_LIMITS.responseBytes, "GEMINI_RESPONSE_TOO_LARGE");
      const chunks: Buffer[] = []; let total = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            total += part.value.byteLength; ensure(total <= GEMINI_AUDIO_LIMITS.responseBytes, "GEMINI_RESPONSE_TOO_LARGE"); chunks.push(Buffer.from(part.value));
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      const raw = Buffer.concat(chunks, total), mime = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      let parsed: unknown = null;
      if (raw.length && mime === "application/json") { try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { parsed = null; } }
      return parseGeminiAudioResponse(status, parsed, retryAfter(response.headers.get("retry-after")));
    } catch (error) {
      // Once the body may have been sent, the call may have been billed.
      const code = error instanceof GeminiAudioValidationError ? error.code : controller.signal.aborted ? timedOut ? "GEMINI_CALL_TIMEOUT" : "GEMINI_CALL_ABORTED" : "GEMINI_TRANSPORT_OR_RESPONSE_LOSS";
      return { kind: "failed", error: { code, category: error instanceof GeminiAudioValidationError ? "protocol" : controller.signal.aborted && !timedOut ? "aborted" : "transport", charged: "maybe", httpStatus: status } };
    } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", stop); }
  }
}
