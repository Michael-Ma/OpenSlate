import { ApiError } from "../../api/client.ts";
import type { ImportKind } from "../../model/assets-import.ts";
import type { StudioStore } from "../../store/store.ts";

export interface UploadRequest {
  /** Project-relative path with its query, from uploadPath(). */
  path: string;
  file: File;
  kind: ImportKind;
  /** Idempotency-Key: the same key resends the same import after a lost reply. */
  key: string;
  signal: AbortSignal;
}

export interface UploadProgress {
  /** Bytes sent so far: a real fraction. */
  sending(loaded: number, total: number): void;
  /** Everything is sent; the studio checks and stores the file (no fraction). */
  checking(): void;
}

export interface Uploader {
  send(request: UploadRequest, progress: UploadProgress): Promise<unknown>;
}

const abortError = () => new DOMException("Upload cancelled", "AbortError");

/**
 * The studio's upload routes take raw bytes (application/octet-stream), which the JSON client does not
 * send, so the live uploader posts with XMLHttpRequest for upload progress. The CSRF value comes from
 * GET /api/session, which returns the session's existing value without changing it.
 */
export function liveUploader(store: StudioStore): Uploader {
  let csrf: string | null = null;
  const token = async () => {
    if (csrf) return csrf;
    const session = await store.read<{ csrf?: string }>("/api/session");
    if (typeof session.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf)) throw new ApiError("AUTH_REQUIRED", 403);
    csrf = session.csrf;
    return csrf;
  };
  return {
    async send(request, progress) {
      const projectId = store.getState().projectId;
      if (!projectId) throw new ApiError("NOT_FOUND", 404);
      const value = await token();
      if (request.signal.aborted) throw abortError();
      return new Promise<unknown>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const onAbort = () => xhr.abort();
        xhr.open("POST", `/api/projects/${encodeURIComponent(projectId)}${request.path}`);
        xhr.setRequestHeader("content-type", "application/octet-stream");
        xhr.setRequestHeader("x-openslate-client", "studio");
        xhr.setRequestHeader("x-openslate-csrf", value);
        xhr.setRequestHeader("idempotency-key", request.key);
        xhr.responseType = "text";
        xhr.upload.onprogress = (event) => progress.sending(event.loaded, event.lengthComputable ? event.total : request.file.size);
        xhr.upload.onload = () => progress.checking();
        xhr.onload = () => {
          request.signal.removeEventListener("abort", onAbort);
          let body: unknown = null;
          try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch { body = null; }
          if (xhr.status >= 200 && xhr.status < 300) { resolve(body); return; }
          const code = (body as { error?: { code?: string } } | null)?.error?.code ?? (xhr.status === 413 ? "UPLOAD_TOO_LARGE" : xhr.status === 404 ? "NOT_FOUND" : xhr.status === 403 ? "AUTH_REQUIRED" : "REQUEST_FAILED");
          if (code === "CSRF_DENIED" || code === "AUTH_REQUIRED") csrf = null;
          if (code === "AUTH_REQUIRED") store.dispatch({ type: "connection", connection: "expired" });
          reject(new ApiError(code, xhr.status));
        };
        xhr.onerror = () => { request.signal.removeEventListener("abort", onAbort); reject(new ApiError("NETWORK_ERROR")); };
        xhr.onabort = () => { request.signal.removeEventListener("abort", onAbort); reject(abortError()); };
        request.signal.addEventListener("abort", onAbort, { once: true });
        progress.sending(0, request.file.size);
        xhr.send(request.file);
      });
    },
  };
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(abortError()); };
  signal.addEventListener("abort", stop, { once: true });
});

/** The file's length, read by the browser, so the sample library can show it. Null when it cannot tell. */
function probeLength(file: File, kind: ImportKind): Promise<number | null> {
  if (kind === "image") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind === "video" ? "video" : "audio");
    const done = (value: number | null) => { clearTimeout(timer); URL.revokeObjectURL(url); element.removeAttribute("src"); resolve(value); };
    const timer = setTimeout(() => done(null), 2000);
    element.preload = "metadata";
    element.onloadedmetadata = () => done(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => done(null);
    element.src = url;
  });
}

function dataUrl(file: File): Promise<string | null> {
  if (file.type !== "image/png" || file.size > 4 * 1024 * 1024) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * The sample film: nothing leaves the page. Sending is simulated on a clock; the import itself goes
 * through the store to the fixture's simulated route, which refuses the way the studio would.
 */
export function fixtureUploader(store: StudioStore): Uploader {
  return {
    async send(request, progress) {
      const total = request.file.size;
      for (let step = 0; step <= 6; step++) {
        progress.sending(Math.round((total * step) / 6), total);
        if (step < 6) await wait(110, request.signal);
      }
      progress.checking();
      const [durationSeconds, preview] = await Promise.all([probeLength(request.file, request.kind), dataUrl(request.file), wait(450, request.signal)]);
      if (request.signal.aborted) throw abortError();
      const body = { name: request.file.name, size: total, type: request.file.type, ...(durationSeconds ? { durationSeconds } : {}), ...(preview ? { preview } : {}) };
      const receipt = await store.command<unknown>(`assets-import:${request.key}`, { key: request.key, path: request.path, size: total }, () => ({ path: request.path, body }));
      if (receipt !== undefined) return receipt;
      // The store reports a refusal as an error toast; the import sheet says it in place instead.
      const toast = store.getState().toast;
      let code = "REQUEST_FAILED";
      if (toast?.tone === "error") {
        const id = toast.message.id as string;
        code = id === "error.unknown" ? String(toast.message.values?.code ?? code) : id.startsWith("error.") ? id.slice("error.".length) : code;
        store.dismissToast();
      }
      throw new ApiError(code);
    },
  };
}
