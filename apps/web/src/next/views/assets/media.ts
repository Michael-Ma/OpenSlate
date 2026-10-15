import type { AssetItem, StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { artifactKey, cacheFor } from "../../media/artifact-cache.ts";
import type { MediaSource } from "../../media/media-source.ts";
import type { ArtifactUrl } from "../../media/useArtifactUrl.ts";
import { useMedia, useMode, useStore } from "../../store/react.tsx";
import type { StudioStore } from "../../store/store.ts";

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

/** Asks `first`; when it does not have the file (NOT_FOUND), asks `second`. Both check the SHA-256. */
function fallbackSource(first: MediaSource, second: MediaSource): MediaSource {
  return {
    async url(artifact, signal) {
      try {
        return await first.url(artifact, signal);
      } catch (error) {
        if (signal?.aborted || !(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
        return second.url(artifact, signal);
      }
    },
    revoke: (url) => first.revoke(url),
  };
}

interface AudioSources {
  /** Imported recordings: the narration store first. */
  narrationFirst: MediaSource;
  /** Everything else: the artifact store first. */
  artifactFirst: MediaSource;
}

const audioSources = new WeakMap<MediaSource, AudioSources>();

/**
 * Audio lives in the artifact store or the narration store. Imported recordings are in the narration store; so are
 * some others the library lists without an artifact record (generated narration not yet installed, say). Each is
 * asked where it most likely is, then the other store. One pair (and so one shared URL cache each) per media source.
 */
function audioSourcesFor(media: MediaSource, projectId: () => string | null): AudioSources {
  let sources = audioSources.get(media);
  if (!sources) {
    const narration = narrationSource(media, projectId);
    sources = { narrationFirst: fallbackSource(narration, media), artifactFirst: fallbackSource(media, narration) };
    audioSources.set(media, sources);
  }
  return sources;
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

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * In the sample film, the library's own pictures come from its fixture route file: the two sample uploads, and
 * PNGs imported in this tab, which that sample film keeps (read through its simulated route, so another sample
 * film never shows them). Every other picture comes from the shared fixture pictures.
 */
function fixturePictureSource(media: MediaSource, store: StudioStore): MediaSource {
  return {
    async url(artifact, signal) {
      const { fixtureAssetPicture, FIXTURE_PICTURE_ROUTE, isFixtureImport } = await import("../../fixtures/routes/assets.ts");
      const sample = fixtureAssetPicture(artifact.artifactId);
      if (sample) return svgUrl(sample);
      if (!isFixtureImport(artifact.artifactId)) return media.url(artifact, signal);
      const picture = await store.read<{ svg: string }>(`${FIXTURE_PICTURE_ROUTE}/${encodeURIComponent(artifact.artifactId)}`, signal);
      return svgUrl(picture.svg);
    },
    revoke: (url) => media.revoke(url),
  };
}

const fixtureSources = new WeakMap<StudioStore, MediaSource>();

/** A picture (an image artifact, or the keyframe a clip shows) from the shared, reference-counted cache. */
export function usePictureUrl(artifact: Ref | null): ArtifactUrl {
  const media = useMedia();
  const store = useStore();
  const mode = useMode();
  let source = media;
  if (mode === "fixture") {
    source = fixtureSources.get(store) ?? fixturePictureSource(media, store);
    fixtureSources.set(store, source);
  }
  return useSourceUrl(source, artifact);
}

/**
 * The verified file of one asset, for its player and Download, loaded only once `wanted` (a clip or an export can
 * be up to 256 MB). The sample film has pictures but no video or audio files, so those stay idle there.
 */
export function useAssetFile(item: AssetItem | null, wanted = true): ArtifactUrl {
  const media = useMedia();
  const store = useStore();
  const mode = useMode();
  let source = media;
  if (item?.artifact.kind === "audio") {
    const sources = audioSourcesFor(media, () => store.getState().projectId);
    source = item.source === "imported" ? sources.narrationFirst : sources.artifactFirst;
  }
  const skip = !item || !wanted || (mode === "fixture" && item.artifact.kind !== "image");
  return useSourceUrl(source, skip ? null : item.artifact);
}
