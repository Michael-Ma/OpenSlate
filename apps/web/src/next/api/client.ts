import { EventStreamParser, type StreamEvent } from "../../shared/event-stream.ts";
import type { StudioArtifactRef } from "@openslate/core/public";

/** A refused or failed request. The web shows `code` through a message id, never a server sentence. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>> | undefined;
  constructor(code: string, status = 0, details?: Record<string, unknown>) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Idempotency-Key. Required by the server on every paid or state-changing command. */
  key?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EventOptions {
  after?: number;
  signal: AbortSignal;
  onOpen(): void;
  onEvent(event: StreamEvent): void;
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");

/**
 * The next UI's client. Authentication stays in an HttpOnly cookie; only the CSRF value lives in memory.
 * `fetch` is injectable for tests.
 */
export class StudioClient {
  #csrf: string;
  #closed = false;
  readonly #controllers = new Set<AbortController>();
  readonly #fetch: typeof fetch;
  onSessionExpired?: () => void;

  constructor(csrf: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.#csrf = csrf;
    this.#fetch = fetchImpl;
  }

  get closed(): boolean { return this.#closed; }

  static async connect(code?: string, fetchImpl?: typeof fetch): Promise<StudioClient> {
    const client = new StudioClient("", fetchImpl);
    try {
      const result = await client.request<{ csrf: string }>("/api/session", code === undefined ? {} : { method: "POST", body: { code } });
      if (!/^[A-Za-z0-9_-]{43}$/.test(result.csrf)) throw new ApiError("AUTH_REQUIRED");
      client.#csrf = result.csrf;
      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  close(): void {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
    this.#csrf = "";
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.#send(path, options);
    return (await response.json()) as T;
  }

  async #send(path: string, options: RequestOptions & { accept?: string }): Promise<Response> {
    if (this.#closed) throw new ApiError("SESSION_CLOSED");
    if (!path.startsWith("/api/")) throw new ApiError("INVALID_PATH");
    const controller = new AbortController();
    this.#controllers.add(controller);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, Math.min(180000, Math.max(1000, options.timeoutMs ?? 15000)));
    try {
      const response = await this.#fetch(path, {
        method: options.method ?? "GET",
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "x-openslate-client": "studio",
          "x-openslate-csrf": this.#csrf,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.key ? { "idempotency-key": options.key } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; details?: Record<string, unknown> } };
        const code = body.error?.code ?? (response.status === 403 ? "AUTH_REQUIRED" : "REQUEST_FAILED");
        if (code === "AUTH_REQUIRED") this.onSessionExpired?.();
        throw new ApiError(code, response.status, body.error?.details);
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("NETWORK_ERROR");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.#controllers.delete(controller);
    }
  }

  /** Server-sent invalidations for one project. Resolves when the stream ends; rejects with ApiError. */
  async events(projectId: string, options: EventOptions): Promise<void> {
    if (this.#closed) throw new ApiError("SESSION_CLOSED");
    if (!projectId || projectId.length > 160 || (options.after !== undefined && (!Number.isSafeInteger(options.after) || options.after < 0))) throw new ApiError("INVALID_PATH");
    const controller = new AbortController();
    this.#controllers.add(controller);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    const activity = () => { clearTimeout(idle); idle = setTimeout(abort, 45000); };
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    activity();
    try {
      const response = await this.#fetch(`/api/projects/${encodeURIComponent(projectId)}/events`, {
        credentials: "same-origin",
        redirect: "error",
        signal: controller.signal,
        headers: { "x-openslate-csrf": this.#csrf, accept: "text/event-stream", ...(options.after === undefined ? {} : { "last-event-id": String(options.after) }) },
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 403) this.onSessionExpired?.();
        throw new ApiError(response.status === 400 ? "VALIDATION_ERROR" : response.status === 403 ? "AUTH_REQUIRED" : "EVENT_STREAM_UNAVAILABLE", response.status);
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream") || !response.body) throw new ApiError("EVENT_STREAM_UNAVAILABLE");
      reader = response.body.getReader();
      options.onOpen();
      activity();
      const parser = new EventStreamParser((event) => { if (!controller.signal.aborted) options.onEvent(event); });
      for (;;) {
        if (controller.signal.aborted) throw new DOMException("Stream cancelled", "AbortError");
        const next = await reader.read();
        if (next.done) break;
        activity();
        parser.push(next.value);
      }
      parser.finish();
      if (!controller.signal.aborted) throw new ApiError("EVENT_STREAM_ENDED");
    } catch (error) {
      if (options.signal.aborted || this.#closed) throw new DOMException("Stream cancelled", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("EVENT_STREAM_UNAVAILABLE");
    } finally {
      clearTimeout(idle);
      options.signal.removeEventListener("abort", abort);
      controller.abort();
      void reader?.cancel().catch(() => {});
      this.#controllers.delete(controller);
    }
  }

  /** Download an artifact, verify its SHA-256 and return an object URL. The caller revokes it. */
  async artifactUrl(projectId: string, artifact: Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">, signal?: AbortSignal): Promise<string> {
    const limit = artifact.kind === "image" ? 32 * 1024 * 1024 : 256 * 1024 * 1024;
    const response = await this.#send(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/content`, { ...(signal ? { signal } : {}), timeoutMs: 90000 });
    if (Number(response.headers.get("content-length") ?? 0) > limit) throw new ApiError("ARTIFACT_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new ApiError("ARTIFACT_TOO_LARGE");
    if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== artifact.sha256) throw new ApiError("ARTIFACT_CHANGED");
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }
}
