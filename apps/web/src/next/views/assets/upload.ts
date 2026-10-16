import { ApiError } from "../../api/client.ts";
import { checkLength, checkPngHeader, PNG_HEADER_BYTES, type FileCheck, type ImportKind } from "../../model/assets-import.ts";
import { recoveryReadOnly } from "../../model/recovery.ts";
import type { StudioStore } from "../../store/store.ts";

export interface UploadRequest {
  /** Frozen project-absolute path, or a project-relative path captured at send entry. */
  path: string;
  file: File;
  kind: ImportKind;
  /** Idempotency-Key: the same key resends the same import after a lost reply. */
  key: string;
  /** The length the browser read before sending (video and audio), or null. */
  durationSeconds: number | null;
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
 * A restored studio in recovery review is read-only: an import is refused here, before anything is sent, as the store
 * refuses its own presses. The sheet says it in place, as it would the studio's own refusal.
 */
function refuseInReview(store: StudioStore): void {
  if (recoveryReadOnly(store.getState())) throw new ApiError("INSTALLATION_QUARANTINED", 409);
}

/** A check of a long video can take a while, but not forever: past this the answer counts as lost (same key next time). */
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

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
      refuseInReview(store);
      const projectId = store.getState().projectId;
      if (!projectId) throw new ApiError("NOT_FOUND", 404);
      const target = request.path.startsWith("/api/") ? request.path : `/api/projects/${encodeURIComponent(projectId)}${request.path}`;
      const value = await token();
      if (request.signal.aborted) throw abortError();
      return new Promise<unknown>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const onAbort = () => xhr.abort();
        xhr.open("POST", target);
        xhr.setRequestHeader("content-type", "application/octet-stream");
        xhr.setRequestHeader("x-openslate-client", "studio");
        xhr.setRequestHeader("x-openslate-csrf", value);
        xhr.setRequestHeader("idempotency-key", request.key);
        xhr.responseType = "text";
        xhr.timeout = UPLOAD_TIMEOUT_MS;
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
          // The studio is in recovery review while this page did not know: the page reads it and turns read-only.
          if (code === "INSTALLATION_QUARANTINED") void store.readRecovery();
          reject(new ApiError(code, xhr.status));
        };
        xhr.onerror = () => { request.signal.removeEventListener("abort", onAbort); reject(new ApiError("NETWORK_ERROR")); };
        xhr.ontimeout = () => { request.signal.removeEventListener("abort", onAbort); reject(new ApiError("TIMEOUT")); };
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

/** What the browser can tell about a chosen file before anything is sent. */
export interface Inspection {
  check: FileCheck;
  /** Video and audio length in seconds, or null when the browser cannot tell. */
  seconds: number | null;
}

/**
 * Read what the studio would refuse, before sending: a PNG's signature and size in pixels (its first bytes), or
 * the length of video and audio (their metadata). Anything the browser cannot read is left to the studio.
 */
export async function inspectFile(file: File, kind: ImportKind): Promise<Inspection> {
  if (kind === "image") {
    const header = await file.slice(0, PNG_HEADER_BYTES).arrayBuffer().then((bytes) => new Uint8Array(bytes), () => null);
    return { check: checkPngHeader(header), seconds: null };
  }
  const seconds = await probeLength(file, kind);
  return { check: checkLength(kind, seconds), seconds };
}

/**
 * The file's length, read by the browser from its metadata, so a file over the studio's limit is refused before
 * it is sent. Null when the browser cannot tell (the studio then decides).
 */
function probeLength(file: File, kind: ImportKind): Promise<number | null> {
  if (kind === "image") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const element = document.createElement(kind === "video" ? "video" : "audio");
    const done = (value: number | null) => { clearTimeout(timer); URL.revokeObjectURL(url); element.removeAttribute("src"); element.load(); resolve(value); };
    const timer = setTimeout(() => done(null), 3000);
    element.preload = "metadata";
    element.muted = true;
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
 * The sample film: nothing leaves the page. Sending is simulated on a clock; the import itself goes through
 * the store to the fixture's simulated route, which replays a known key and refuses the way the studio would.
 * It answers refusals in its reply (the store would show a thrown one as a toast), and the picture of an
 * imported PNG is staged beside the request so the request the store remembers stays small.
 */
export function fixtureUploader(store: StudioStore): Uploader {
  return {
    async send(request, progress) {
      refuseInReview(store);
      const projectId = store.getState().projectId;
      if (!projectId) throw new ApiError("NOT_FOUND", 404);
      const target = request.path.startsWith("/api/") ? request.path : `/api/projects/${encodeURIComponent(projectId)}${request.path}`;
      const total = request.file.size;
      for (let step = 0; step <= 6; step++) {
        progress.sending(Math.round((total * step) / 6), total);
        if (step < 6) await wait(110, request.signal);
      }
      progress.checking();
      const [{ stageFixturePreview }, preview] = await Promise.all([import("../../fixtures/routes/assets.ts"), dataUrl(request.file), wait(450, request.signal)]);
      if (request.signal.aborted) throw abortError();
      if (preview) stageFixturePreview(request.key, preview);
      const body = { name: request.file.name, size: total, type: request.file.type, key: request.key, refusalInBody: true, ...(request.durationSeconds ? { durationSeconds: request.durationSeconds } : {}) };
      const receipt = await store.command<unknown>(`assets-import:${request.key}`, { key: request.key, path: request.path }, () => ({ path: target, body }));
      const refused = (receipt as { refused?: { code?: unknown } } | undefined)?.refused;
      if (refused) throw new ApiError(typeof refused.code === "string" ? refused.code : "REQUEST_FAILED", 409);
      // Undefined: the store could not send it and has said why in a toast.
      if (receipt === undefined) throw new ApiError("REQUEST_FAILED");
      return receipt;
    },
  };
}
