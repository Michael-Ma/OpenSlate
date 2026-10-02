import type { Artifact } from './model';
export function artifactIdentity(projectId: string, artifact: Artifact | null): string | null {
  return artifact ? JSON.stringify([projectId,artifact.artifactId,artifact.sha256,artifact.kind]) : null;
}
export interface ArtifactViewState<T> { api: T; identity: string; signal: AbortSignal; url: string | null; error: string }
/** The bytes visible in this render must belong to the exact current identity. */
export function artifactView<T>(result: ArtifactViewState<T> | null, api: T, identity: string | null) {
  return result?.api === api && result.identity === identity && !result.signal.aborted
    ? { url: result.url, error: result.error } : { url: null, error: '' };
}
