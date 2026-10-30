/** Shared bounded Gemini JSON transport. No retries, redirects, query-string keys or configurable origins. */
export const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com";
export class GeminiAudioValidationError extends Error {
  constructor(readonly code: string, readonly httpStatus: number | null = null) { super(code); this.name = "GeminiAudioValidationError"; }
}
export class GeminiJsonClient {
  readonly #key: string; readonly #fetch: typeof globalThis.fetch; readonly #timeout: number;
  constructor(options: { apiKey: string; fetch?: typeof globalThis.fetch; timeoutMs?: number; defaultTimeoutMs: number }) {
    if (!options || typeof options.apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(options.apiKey)) throw new GeminiAudioValidationError("GEMINI_CREDENTIAL_INVALID");
    if (options.fetch !== undefined && typeof options.fetch !== "function") throw new GeminiAudioValidationError("GEMINI_OPTIONS_INVALID");
    const timeout = options.timeoutMs ?? options.defaultTimeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 600_000) throw new GeminiAudioValidationError("GEMINI_OPTIONS_INVALID");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? globalThis.fetch; this.#timeout = timeout;
  }
  async post(path: string, body: string, maxBytes: number, signal?: AbortSignal): Promise<{ status: number; body: unknown; retryAfterMs?: number }> {
    if (!/^\/v1beta\/(?:interactions|models\/gemini-[a-z0-9.-]+:generateContent)$/.test(path)) throw new GeminiAudioValidationError("GEMINI_PATH_INVALID");
    const controller = new AbortController(); let timedOut = false, status: number | null = null;
    const stop = (): void => controller.abort(); signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeout);
    try {
      if (signal?.aborted) controller.abort();
      const response = await this.#fetch(`${GEMINI_API_ORIGIN}${path}`, { method: "POST", redirect: "manual", signal: controller.signal, body,
        headers: { "x-goog-api-key": this.#key, "Content-Type": "application/json", Accept: "application/json" } });
      status = response.status;
      const ensure = (value: unknown, code: string): void => { if (!value) throw new GeminiAudioValidationError(code, status); };
      ensure(status >= 200 && status < 600 && !(status >= 300 && status < 400), "GEMINI_RESPONSE_REDIRECT");
      const size = response.headers.get("content-length");
      ensure(size === null || /^\d+$/.test(size) && Number(size) <= maxBytes, "GEMINI_RESPONSE_TOO_LARGE");
      const chunks: Buffer[] = []; let total = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const part = await reader.read(); if (part.done) break;
            total += part.value.byteLength; ensure(total <= maxBytes, "GEMINI_RESPONSE_TOO_LARGE"); chunks.push(Buffer.from(part.value));
          }
        } finally { await reader.cancel().catch(() => undefined); }
      }
      const raw = Buffer.concat(chunks, total), mime = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
      let parsed: unknown = null;
      if (raw.length && mime === "application/json") { try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { /* Caller classifies malformed JSON. */ } }
      const retry = response.headers.get("retry-after");
      return { status, body: parsed, ...(retry && /^\d{1,6}$/.test(retry) ? { retryAfterMs: Number(retry) * 1000 } : {}) };
    } catch (error) {
      if (controller.signal.aborted) throw new GeminiAudioValidationError(timedOut ? "GEMINI_CALL_TIMEOUT" : "GEMINI_CALL_ABORTED", status);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
  }
}
