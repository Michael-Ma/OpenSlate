import type { MediaSource } from "../media/media-source.ts";

const notFound = (error: unknown) => (error as { code?: unknown } | null)?.code === "NOT_FOUND";

/**
 * Asks `first` for a file; when it does not have it (NOT_FOUND), asks `second`. Any other failure, or a
 * cancelled load, is passed on as it is. Both sources check the file's SHA-256 themselves.
 *
 * The Assets view uses it for audio, which lives in the artifact store or in the narration store: imported
 * recordings are in the narration store, and so are some others the library lists without an artifact record.
 */
export function fallbackSource(first: MediaSource, second: MediaSource): MediaSource {
  return {
    async url(artifact, signal) {
      try {
        return await first.url(artifact, signal);
      } catch (error) {
        if (signal?.aborted || !notFound(error)) throw error;
        return second.url(artifact, signal);
      }
    },
    revoke: (url) => first.revoke(url),
  };
}
