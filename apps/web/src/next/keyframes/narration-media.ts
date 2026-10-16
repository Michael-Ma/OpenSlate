import type { StudioArtifactRef } from "@openslate/core/public";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client.ts";
import { artifactKey, cacheFor } from "../media/artifact-cache.ts";
import type { MediaSource } from "../media/media-source.ts";
import type { ArtifactUrl } from "../media/useArtifactUrl.ts";
import { useMode, useStore } from "../store/react.tsx";
import type { StudioStore } from "../store/store.ts";
import { liveUploader, type Uploader } from "../views/assets/upload.ts";

type Ref = Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
/** The studio's own preview limit for one narration recording. */
const NARRATION_LIMIT = 80 * 1024 * 1024;
const abortError = () => new DOMException("Cancelled", "AbortError");

/**
 * A shot's voice line or recording lives in the narration store: GET /narration/audio/:audioId/content, checked
 * against its SHA-256 before it is played (the studio sends X-Content-SHA256 too). GET needs no CSRF value.
 */
function liveNarrationSource(store: StudioStore): MediaSource {
  return {
    async url(artifact, signal) {
      const projectId = store.getState().projectId;
      if (!projectId) throw new ApiError("NOT_FOUND", 404);
      let response: Response;
      try {
        response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/narration/audio/${encodeURIComponent(artifact.artifactId)}/content`, {
          credentials: "same-origin",
          redirect: "error",
          headers: { "x-openslate-client": "studio" },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiError("NETWORK_ERROR");
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
        throw new ApiError(body.error?.code ?? "REQUEST_FAILED", response.status);
      }
      if (Number(response.headers.get("content-length") ?? 0) > NARRATION_LIMIT) throw new ApiError("ARTIFACT_TOO_LARGE");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > NARRATION_LIMIT) throw new ApiError("ARTIFACT_TOO_LARGE");
      if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== artifact.sha256) throw new ApiError("ARTIFACT_CHANGED");
      return URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type")?.split(";")[0] ?? "audio/wav" }));
    },
    revoke: (url) => URL.revokeObjectURL(url),
  };
}

/** The sample film has no audio files: its simulated route says how long a take is, and a quiet stand-in of that length plays. */
function fixtureNarrationSource(store: StudioStore): MediaSource {
  return {
    async url(artifact, signal) {
      const { FIXTURE_AUDIO_ROUTE, fixtureVoiceWav } = await import("../fixtures/routes/narration.ts");
      const take = await store.read<{ seconds: number }>(`${FIXTURE_AUDIO_ROUTE}/${encodeURIComponent(artifact.artifactId)}`, signal);
      if (signal?.aborted) throw abortError();
      return URL.createObjectURL(new Blob([fixtureVoiceWav(take.seconds)], { type: "audio/wav" }));
    },
    revoke: (url) => URL.revokeObjectURL(url),
  };
}

/** One source (and so one shared, reference-counted URL cache) per store and mode. */
const sources = new WeakMap<StudioStore, { mode: "live" | "fixture"; source: MediaSource }>();
function narrationSource(store: StudioStore, mode: "live" | "fixture"): MediaSource {
  const known = sources.get(store);
  if (known?.mode === mode) return known.source;
  const source = mode === "fixture" ? fixtureNarrationSource(store) : liveNarrationSource(store);
  sources.set(store, { mode, source });
  return source;
}

/**
 * The verified URL of a shot's current voice line or recording, for the native player. Null shows nothing.
 * `retry` loads it again after a failure (a failed load is never cached).
 */
export function useNarrationAudio(audio: Ref | null): ArtifactUrl & { retry(): void } {
  const store = useStore();
  const mode = useMode();
  const source = narrationSource(store, mode);
  const key = audio ? artifactKey(audio) : null;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string | null; value: ArtifactUrl }>({ key: null, value: { status: "idle", url: null } });
  useEffect(() => {
    if (!audio || !key) return;
    const cache = cacheFor(source);
    const ref: Ref = { artifactId: audio.artifactId, sha256: audio.sha256, kind: audio.kind };
    let live = true;
    setState((current) => (current.key === key && current.value.status === "ready" ? current : { key, value: { status: "loading", url: null } }));
    cache.acquire(ref).then(
      (url) => { if (live) setState({ key, value: { status: "ready", url } }); },
      (error: unknown) => { if (live) setState({ key, value: { status: "failed", url: null, code: (error as { code?: string })?.code ?? "NETWORK_ERROR" } }); },
    );
    return () => { live = false; cache.release(ref); };
    // The key covers the recording's identity; the nonce asks again after a failure.
  }, [source, key, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  if (!key) return { status: "idle", url: null, retry };
  return { ...(state.key === key ? state.value : { status: "loading", url: null }), retry };
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(abortError()); };
  signal.addEventListener("abort", stop, { once: true });
});

/**
 * Sends a recording. The studio takes raw bytes (application/octet-stream) with upload progress, as the Assets
 * import does (liveUploader). The sample film sends nothing: progress runs on a clock and the simulated route
 * answers from the file's name, size, type and the length the browser read, replaying a known key and refusing
 * the way the studio would (in its reply, so the panel says it in place instead of a toast).
 */
export function recordingUploader(store: StudioStore, mode: "live" | "fixture"): Uploader {
  if (mode === "live") return liveUploader(store);
  return {
    async send(request, progress) {
      const total = request.file.size;
      for (let step = 0; step <= 5; step++) {
        progress.sending(Math.round((total * step) / 5), total);
        if (step < 5) await wait(120, request.signal);
      }
      progress.checking();
      await wait(500, request.signal);
      const body = { name: request.file.name, size: total, type: request.file.type, key: request.key, refusalInBody: true, ...(request.durationSeconds ? { durationSeconds: request.durationSeconds } : {}) };
      const receipt = await store.command<unknown>(`narration-recording:${request.key}`, { key: request.key, path: request.path }, () => ({ path: request.path, body }));
      const refused = (receipt as { refused?: { code?: unknown } } | undefined)?.refused;
      if (refused) throw new ApiError(typeof refused.code === "string" ? refused.code : "REQUEST_FAILED", 409);
      // Undefined: the store could not send it and said why in a toast.
      if (receipt === undefined) throw new ApiError("REQUEST_FAILED");
      return receipt;
    },
  };
}
