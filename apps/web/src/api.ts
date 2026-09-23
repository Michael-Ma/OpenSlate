import { EventStreamParser, type StreamEvent } from "./event-stream";
import { errorMessage, hex } from "./model";
import type { Artifact } from "./model";

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(errorMessage(code)); this.name = "ApiError"; this.code = code; }
}
type RequestOptions = { method?: "GET" | "POST"; body?: unknown; rawBody?: Blob; key?: string; signal?: AbortSignal; timeoutMs?: number };
/** Authentication stays in an HttpOnly cookie; only the CSRF value lives in tab memory. */
export class StudioApi {
  #csrf: string;
  #controllers = new Set<AbortController>();
  #closed = false;
  get closed(): boolean { return this.#closed; }
  constructor(csrf: string) { this.#csrf = csrf; }
  onSessionExpired?: () => void;
  static async connect(code?: string): Promise<StudioApi> {
    const api = new StudioApi("");
    try {
      const result = await api.request<{ csrf: string }>("/api/session", code === undefined ? {} : { method: "POST", body: { code } });
      if (!/^[A-Za-z0-9_-]{43}$/.test(result.csrf)) throw new ApiError("AUTH_REQUIRED");
      api.#csrf = result.csrf; return api;
    } catch (error) { api.close(); throw error; }
  }
  close() { this.#closed = true; for (const controller of this.#controllers) controller.abort(); this.#controllers.clear(); this.#csrf = ""; }
  async events(projectId: string, options: { after?: number; signal: AbortSignal; onOpen(): void; onEvent(event: StreamEvent): void }): Promise<void> {
    const signal = options.signal, onOpen = options.onOpen, onEvent = options.onEvent, after = options.after;
    if (this.#closed) throw new ApiError("SESSION_CLOSED");
    if (!projectId || projectId.length > 160 || after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new ApiError("INVALID_PATH");
    const controller = new AbortController(); this.#controllers.add(controller);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, idle: ReturnType<typeof setTimeout> | undefined;
    const cancelReader = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", cancelReader, { once: true });
    const abort = () => controller.abort();
    const activity = () => { clearTimeout(idle); idle = setTimeout(abort, 45000); };
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); activity();
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/events`, { credentials: "same-origin", redirect: "error", signal: controller.signal,
        headers: { "x-openslate-csrf": this.#csrf, accept: "text/event-stream", ...(after === undefined ? {} : { "last-event-id": String(after) }) } });
      if (!response.ok) {
        // These statuses are sufficient for cursor reset/auth handling; never accumulate an error page as JSON.
        void response.body?.cancel().catch(() => {});
        if (response.status === 403) this.onSessionExpired?.();
        throw new ApiError(response.status === 400 ? "VALIDATION_ERROR" : response.status === 403 ? "AUTH_REQUIRED" : "EVENT_STREAM_UNAVAILABLE");
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") || !response.body) throw new ApiError("EVENT_STREAM_UNAVAILABLE");
      if (controller.signal.aborted) throw new DOMException("Stream cancelled", "AbortError");
      reader = response.body.getReader(); onOpen(); activity();
      const parser = new EventStreamParser(event => { if (!controller.signal.aborted) onEvent(event); });
      for (;;) {
        if (controller.signal.aborted) throw new DOMException("Stream cancelled", "AbortError");
        const next = await reader.read(); if (next.done) break;
        activity(); parser.push(next.value);
      }
      parser.finish();
      if (!controller.signal.aborted) throw new ApiError("EVENT_STREAM_ENDED");
    } catch (error) {
      if (signal.aborted || this.#closed) throw new DOMException("Stream cancelled", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("EVENT_STREAM_UNAVAILABLE");
    } finally {
      clearTimeout(idle); signal.removeEventListener("abort", abort); controller.abort(); controller.signal.removeEventListener("abort", cancelReader);
      void reader?.cancel().catch(() => {}); this.#controllers.delete(controller);
    }
  }
  async request<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; key?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    return this.#fetch(path, options, response => response.json() as Promise<T>);
  }
  async upload<T>(path: string, file: Blob, key: string, signal?: AbortSignal): Promise<T> {
    if (!file.size || file.size > 128 * 1024 * 1024) throw new ApiError("UPLOAD_TOO_LARGE");
    return this.#fetch(path, { method: "POST", rawBody: file, key, ...(signal ? { signal } : {}), timeoutMs: 180000 }, response => response.json() as Promise<T>);
  }
  async #fetch<T>(path: string, options: RequestOptions, consume: (response: Response) => Promise<T>): Promise<T> {
    if (this.#closed) throw new ApiError("SESSION_CLOSED");
    if (!path.startsWith("/api/")) throw new ApiError("INVALID_PATH");
    const controller = new AbortController(); this.#controllers.add(controller);
    const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, Math.min(180000, Math.max(1000, options.timeoutMs ?? 15000)));
    try {
      const response = await fetch(path, { method: options.method ?? "GET", credentials: "same-origin", redirect: "error", signal: controller.signal,
        headers: { "x-openslate-client": "studio", "x-openslate-csrf": this.#csrf, ...(options.rawBody ? { "content-type": "application/octet-stream" } : options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.key ? { "idempotency-key": options.key } : {}) },
        ...(options.rawBody ? { body: options.rawBody } : options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: { code?: string } }; if (body.error?.code === "AUTH_REQUIRED") this.onSessionExpired?.(); throw new ApiError(body.error?.code ?? "REQUEST_FAILED"); }
      return await consume(response);
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("NETWORK_ERROR");
    } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); this.#controllers.delete(controller); }
  }
  async artifact(projectId: string, artifact: Artifact, signal: AbortSignal): Promise<string> {
    return this.verifiedMedia(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/content`, artifact.sha256, signal, artifact.kind === "image" ? 32 * 1024 * 1024 : 256 * 1024 * 1024);
  }
  async narrationAudio(projectId: string, audioId: string, sha256: string, signal: AbortSignal): Promise<string> {
    return this.verifiedMedia(`/api/projects/${encodeURIComponent(projectId)}/narration/audio/${encodeURIComponent(audioId)}/content`, sha256, signal, 80 * 1024 * 1024);
  }
  private async verifiedMedia(path: string, sha256: string, signal: AbortSignal, limit: number): Promise<string> {
    return this.#fetch(path, { signal, timeoutMs: 90000 }, async response => {
    if (Number(response.headers.get("content-length") ?? 0) > limit || !response.body) throw new ApiError("ARTIFACT_TOO_LARGE");
    const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
    try {
      while (true) { if (signal.aborted) throw new DOMException("Request cancelled", "AbortError"); const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > limit) throw new ApiError("ARTIFACT_TOO_LARGE"); chunks.push(new Uint8Array(chunk.value)); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== sha256) throw new ApiError("ARTIFACT_CHANGED");
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
  }
}
