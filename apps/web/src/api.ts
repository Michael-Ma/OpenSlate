import { errorMessage, hex } from "./model";
import type { Artifact } from "./model";

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(errorMessage(code)); this.name = "ApiError"; this.code = code; }
}
/** Access tokens exist only in this tab's memory and are never placed in URLs. */
export class StudioApi {
  #token: string;
  #controllers = new Set<AbortController>();
  constructor(token: string) { this.#token = token; }
  close() { for (const controller of this.#controllers) controller.abort(); this.#controllers.clear(); this.#token = ""; }
  async request<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; key?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    return this.#fetch(path, options, response => response.json() as Promise<T>);
  }
  async #fetch<T>(path: string, options: { method?: "GET" | "POST"; body?: unknown; key?: string; signal?: AbortSignal; timeoutMs?: number }, consume: (response: Response) => Promise<T>): Promise<T> {
    if (!path.startsWith("/api/")) throw new ApiError("INVALID_PATH");
    const controller = new AbortController(); this.#controllers.add(controller);
    const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timer = setTimeout(abort, Math.min(90000, Math.max(1000, options.timeoutMs ?? 15000)));
    try {
      const response = await fetch(path, { method: options.method ?? "GET", credentials: "omit", redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${this.#token}`, ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.key ? { "idempotency-key": options.key } : {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: { code?: string } }; throw new ApiError(body.error?.code ?? "REQUEST_FAILED"); }
      return await consume(response);
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError("NETWORK_ERROR");
    } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); this.#controllers.delete(controller); }
  }
  async artifact(projectId: string, artifact: Artifact, signal: AbortSignal): Promise<string> {
    return this.#fetch(`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/content`, { signal }, async response => {
    const limit = 32 * 1024 * 1024;
    if (Number(response.headers.get("content-length") ?? 0) > limit || !response.body) throw new ApiError("ARTIFACT_TOO_LARGE");
    const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let length = 0;
    try {
      while (true) { if (signal.aborted) throw new DOMException("Request cancelled", "AbortError"); const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength; if (length > limit) throw new ApiError("ARTIFACT_TOO_LARGE"); chunks.push(new Uint8Array(chunk.value)); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== artifact.sha256) throw new ApiError("ARTIFACT_CHANGED");
    const mime = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
    });
  }
}
