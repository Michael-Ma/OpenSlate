import { createHash } from "node:crypto";
import { connectFailureCode } from "./connect-failure.js";
import { GeminiJsonClient, GeminiAudioValidationError } from "./gemini-http.js";

export const LYRIA_MODEL = "lyria-3.5";
export const LYRIA_PRICE_MICROS = "80000";
// Six minutes of uncompressed 44.1 kHz stereo PCM16 plus base64/JSON. Raw spool cap stays 32 MiB.
export const LYRIA_LIMITS = Object.freeze({ responseBytes: 96 * 1024 * 1024, audioBytes: 32 * 1024 * 1024, timeoutMs: 300_000 });
export interface LyriaRequest { prompt: string; durationSeconds: number; instrumental?: boolean }
export type LyriaResult =
  | { kind: "completed"; bytes: Uint8Array; sha256: string; mimeType: "audio/mpeg" | "audio/wav" }
  | { kind: "rejected"; code: string; retry: "safe" | "none" }
  | { kind: "unknown"; code: string };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function lyriaBody(request: LyriaRequest): string {
  if (!object(request) || typeof request.prompt !== "string" || !request.prompt.trim() || Buffer.byteLength(request.prompt) > 32768
    || !Number.isFinite(request.durationSeconds) || request.durationSeconds <= 0 || request.durationSeconds > 360
    || request.instrumental !== undefined && typeof request.instrumental !== "boolean"
    || Object.keys(request).some(key => !["prompt", "durationSeconds", "instrumental"].includes(key))) throw new GeminiAudioValidationError("LYRIA_INPUT_INVALID");
  return JSON.stringify({ model: LYRIA_MODEL, input: `${request.prompt}\nAbout ${request.durationSeconds} seconds long, ending with a clean final chord.${request.instrumental !== false ? " Instrumental, no vocals." : ""}`,
    response_format: { type: "audio" } });
}
/** Never copy provider prose into diagnostics (it may echo prompts or credentials). */
export function parseLyriaResponse(status: number, body: unknown): LyriaResult {
  const error = object(body) && object(body.error) ? body.error : {};
  const diagnostic = `${error.status ?? ""} ${error.message ?? ""}`;
  if (status === 401 || status === 403 || status >= 400 && /billing|paid.?tier|free.?tier/i.test(diagnostic))
    return { kind: "rejected", code: "LYRIA_KEY_BILLING_REQUIRED", retry: "none" };
  if (status === 429) return { kind: "rejected", code: "LYRIA_BUSY", retry: "safe" };
  if (status >= 400 && /safety|prohibited|blocked|copyright|recitation/i.test(diagnostic)) return { kind: "rejected", code: "LYRIA_SAFETY_REFUSAL", retry: "none" };
  if (status >= 400 && status < 500) return { kind: "rejected", code: "LYRIA_INPUT_REJECTED", retry: "none" };
  if (status !== 200 || !object(body)) return { kind: "unknown", code: "LYRIA_RESPONSE_INVALID" };
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const blocks = steps.flatMap(step => object(step) && step.type === "model_output" && Array.isArray(step.content) ? step.content : []);
  if (/safety|prohibited|blocked|copyright|recitation/i.test(diagnostic) || blocks.some(block => object(block) && ["refusal", "safety"].includes(String(block.type)))
    || object(body.promptFeedback) && body.promptFeedback.blockReason) return { kind: "rejected", code: "LYRIA_SAFETY_REFUSAL", retry: "none" };
  if (body.status === "failed") return { kind: "unknown", code: "LYRIA_RESPONSE_INVALID" };
  const audio = blocks.filter(block => object(block) && block.type === "audio");
  if (audio.length !== 1 || !object(audio[0])) return { kind: "unknown", code: "LYRIA_AUDIO_MISSING" };
  const block = audio[0];
  if (!["audio/mpeg", "audio/wav"].includes(String(block.mime_type)) || typeof block.data !== "string" || !block.data.length
    || block.data.length > Math.ceil(LYRIA_LIMITS.audioBytes / 3) * 4) return { kind: "unknown", code: "LYRIA_AUDIO_INVALID" };
  const bytes = Buffer.from(block.data, "base64");
  if (!bytes.length || bytes.length > LYRIA_LIMITS.audioBytes || bytes.toString("base64") !== block.data) return { kind: "unknown", code: "LYRIA_AUDIO_INVALID" };
  return { kind: "completed", bytes, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: block.mime_type as "audio/mpeg" | "audio/wav" };
}
export class GeminiLyriaAdapter {
  readonly #client: GeminiJsonClient;
  constructor(options: { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    this.#client = new GeminiJsonClient({ ...options, defaultTimeoutMs: LYRIA_LIMITS.timeoutMs });
  }
  async generate(request: LyriaRequest, options: { signal?: AbortSignal } = {}): Promise<LyriaResult> {
    let body: string;
    try { body = lyriaBody(request); } catch { return { kind: "rejected", code: "LYRIA_INPUT_INVALID", retry: "none" }; }
    if (options.signal?.aborted) return { kind: "rejected", code: "LYRIA_NOT_SUBMITTED", retry: "safe" };
    try {
      const response = await this.#client.post("/v1beta/interactions", body, LYRIA_LIMITS.responseBytes, options.signal);
      return parseLyriaResponse(response.status, response.body);
    } catch (error) {
      if (connectFailureCode(error)) return { kind: "rejected", code: "LYRIA_NOT_SUBMITTED", retry: "safe" };
      return { kind: "unknown", code: error instanceof GeminiAudioValidationError ? error.code : "LYRIA_TRANSPORT_LOSS" };
    }
  }
}
