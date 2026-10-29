import type { StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useState } from "react";
import { useMedia } from "../store/react.tsx";
import { artifactKey, cacheFor } from "./artifact-cache.ts";

export type ArtifactUrl =
  | { status: "idle"; url: null }
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "failed"; url: null; code: string };

type Ref = Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">;

/**
 * The verified URL of one artifact from the shared, reference-counted cache (plan item WA-18).
 * Pass null to show nothing. The URL stays valid while any component holds it.
 */
export function useArtifactUrl(artifact: Ref | null): ArtifactUrl {
  const media = useMedia();
  const key = artifact ? artifactKey(artifact) : null;
  const [state, setState] = useState<{ key: string | null; value: ArtifactUrl }>({ key: null, value: { status: "idle", url: null } });

  useEffect(() => {
    if (!artifact || !key) return;
    const cache = cacheFor(media);
    const ref: Ref = { artifactId: artifact.artifactId, sha256: artifact.sha256, kind: artifact.kind };
    let live = true;
    setState((current) => (current.key === key && current.value.status === "ready" ? current : { key, value: { status: "loading", url: null } }));
    cache.acquire(ref).then(
      (url) => { if (live) setState({ key, value: { status: "ready", url } }); },
      (error: unknown) => { if (live) setState({ key, value: { status: "failed", url: null, code: (error as { code?: string })?.code ?? "NETWORK_ERROR" } }); },
    );
    return () => { live = false; cache.release(ref); };
    // The key covers the artifact's identity; the object itself changes on every overview read.
  }, [media, key]);

  if (!key) return { status: "idle", url: null };
  return state.key === key ? state.value : { status: "loading", url: null };
}
