import type { AssetItem, StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { artifactKey, cacheFor } from "../../media/artifact-cache.ts";
import type { MediaSource } from "../../media/media-source.ts";
import type { ArtifactUrl } from "../../media/useArtifactUrl.ts";
import { useMedia, useMode, useStore } from "../../store/react.tsx";

type Ref = Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
const NARRATION_LIMIT = 80 * 1024 * 1024;

/**
 * Imported audio lives in the narration store, not the artifact store, so it is read from
 * GET /narration/audio/:audioId/content and checked against its SHA-256 like any artifact.
 * GET needs no CSRF value; the session cookie is enough.
 */
function narrationSource(media: MediaSource, projectId: () => string | null): MediaSource {
  return {
    async url(artifact, signal) {
      const project = projectId();
      if (!project) throw new ApiError("NOT_FOUND", 404);
      let response: Response;
      try {
        response = await fetch(`/api/projects/${encodeURIComponent(project)}/narration/audio/${encodeURIComponent(artifact.artifactId)}/content`, {
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
    revoke: (url) => media.revoke(url),
  };
}

const narrationSources = new WeakMap<MediaSource, MediaSource>();

/** One narration source (and so one shared URL cache) per media source. */
function narrationSourceFor(media: MediaSource, projectId: () => string | null): MediaSource {
  let source = narrationSources.get(media);
  if (!source) { source = narrationSource(media, projectId); narrationSources.set(media, source); }
  return source;
}

/** useArtifactUrl with the source chosen by the caller; URLs come from that source's shared, reference-counted cache. */
function useSourceUrl(source: MediaSource, artifact: Ref | null): ArtifactUrl {
  const key = artifact ? artifactKey(artifact) : null;
  const [state, setState] = useState<{ key: string | null; value: ArtifactUrl }>({ key: null, value: { status: "idle", url: null } });
  useEffect(() => {
    if (!artifact || !key) return;
    const cache = cacheFor(source);
    const ref: Ref = { artifactId: artifact.artifactId, sha256: artifact.sha256, kind: artifact.kind };
    let live = true;
    setState((current) => (current.key === key && current.value.status === "ready" ? current : { key, value: { status: "loading", url: null } }));
    cache.acquire(ref).then(
      (url) => { if (live) setState({ key, value: { status: "ready", url } }); },
      (error: unknown) => { if (live) setState({ key, value: { status: "failed", url: null, code: (error as { code?: string })?.code ?? "NETWORK_ERROR" } }); },
    );
    return () => { live = false; cache.release(ref); };
    // The key covers the artifact's identity.
  }, [source, key]);
  if (!key) return { status: "idle", url: null };
  return state.key === key ? state.value : { status: "loading", url: null };
}

/**
 * The verified file of one asset, for its player and Download. The sample film has pictures but no
 * video or audio files, so those stay idle there.
 */
export function useAssetFile(item: AssetItem | null): ArtifactUrl {
  const media = useMedia();
  const store = useStore();
  const mode = useMode();
  const imported = item?.artifact.kind === "audio" && item.source === "imported";
  const source = imported ? narrationSourceFor(media, () => store.getState().projectId) : media;
  const skip = !item || (mode === "fixture" && item.artifact.kind !== "image");
  return useSourceUrl(source, skip ? null : item.artifact);
}
