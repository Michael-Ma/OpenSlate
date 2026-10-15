import type { StudioArtifactRef } from "@openslate/core/public";

/** Where pictures come from: the studio server (verified by SHA-256) or the fixture's illustrations. */
export interface MediaSource {
  url(artifact: Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">, signal?: AbortSignal): Promise<string>;
  /** Object URLs must be revoked; data URLs need nothing. */
  revoke(url: string): void;
}
