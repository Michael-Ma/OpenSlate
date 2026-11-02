import { connectFailureCode } from "./connect-failure.js";

/** The one rule for "never reached the vendor", shared with the Viggle and MiniMax adapters. */
export const isConnectPhaseFailure = (error: unknown): boolean => connectFailureCode(error) !== undefined;
export const videoObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export function videoEnsure(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
export interface VideoApiOptions { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number }
export type VideoJsonReply = { status: number; body: unknown } | { error: "CONNECT_NOT_SUBMITTED" | "RESPONSE_UNKNOWN" };
/** Bounded JSON transport. No redirects, retries or vendor discovery. All URLs are built by the fixed adapter. */
export class VideoJsonClient {
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number;
  constructor(options: VideoApiOptions) {
    videoEnsure(typeof options.apiKey === "string" && /^[\x21-\x7e]{1,4096}$/.test(options.apiKey), "VIDEO_CREDENTIAL_INVALID");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = options.timeoutMs ?? 30000;
    videoEnsure(Number.isSafeInteger(this.#timeout) && this.#timeout > 0 && this.#timeout <= 120000, "VIDEO_TIMEOUT_INVALID");
  }
  async call(method: "POST" | "GET" | "DELETE", url: string, body?: string, signal?: AbortSignal): Promise<VideoJsonReply> {
    const controller = new AbortController(), stop = () => controller.abort();
    signal?.addEventListener("abort", stop, { once: true }); if (signal?.aborted) stop();
    const timer = setTimeout(stop, this.#timeout); let responseSeen = false;
    try {
      const response = await this.#fetch(url, { method, redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${this.#key}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body } : {}) });
      responseSeen = true;
      const chunks: Uint8Array[] = []; let size = 0; const reader = response.body?.getReader();
      try { if (reader) for (;;) {
        videoEnsure(!controller.signal.aborted, "VIDEO_ABORTED");
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; videoEnsure(size <= 1024 * 1024, "VIDEO_RESPONSE_TOO_LARGE"); chunks.push(part.value);
      } } finally { await reader?.cancel().catch(() => undefined); }
      videoEnsure(!controller.signal.aborted, "VIDEO_ABORTED");
      const text = Buffer.concat(chunks).toString("utf8");
      // Never retain provider text, signed URLs or credentials in diagnostics.
      return { status: response.status, body: text ? JSON.parse(text) as unknown : null };
    } catch (error) { return { error: !responseSeen && !controller.signal.aborted && isConnectPhaseFailure(error) ? "CONNECT_NOT_SUBMITTED" : "RESPONSE_UNKNOWN" }; }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); controller.abort(); }
  }
}
