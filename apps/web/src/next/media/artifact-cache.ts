import type { StudioArtifactRef } from "@openslate/core/public";
import type { MediaSource } from "./media-source.ts";

type ArtifactKey = Pick<StudioArtifactRef, "artifactId" | "sha256" | "kind">;

interface Entry {
  refs: number;
  promise: Promise<string>;
  url: string | null;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface CacheClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

/** How long a URL nobody shows any more is kept, so switching scenes and back does not load it again. */
export const RELEASE_DELAY_MS = 30_000;

export const artifactKey = (artifact: ArtifactKey) => `${artifact.kind}:${artifact.artifactId}:${artifact.sha256}`;

/**
 * Shared, reference-counted artifact URLs (plan item WA-18). The same keyframe in the preview and in its
 * card is loaded and verified once. A URL is revoked 30 s after its last user releases it. A failed load
 * is not cached, so the next user tries again.
 */
export class ArtifactUrlCache {
  readonly #media: MediaSource;
  readonly #clock: CacheClock;
  readonly #entries = new Map<string, Entry>();

  constructor(media: MediaSource, clock: CacheClock = { setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: (timer) => clearTimeout(timer) }) {
    this.#media = media;
    this.#clock = clock;
  }

  /** Start (or join) the load of one artifact. Every acquire needs exactly one release. */
  acquire(artifact: ArtifactKey): Promise<string> {
    const key = artifactKey(artifact);
    let entry = this.#entries.get(key);
    if (!entry) {
      const abort = new AbortController();
      const created: Entry = { refs: 0, url: null, abort, timer: null, promise: Promise.resolve("") };
      created.promise = this.#media.url(artifact, abort.signal).then(
        (url) => {
          // Released and dropped while loading: nobody will revoke it later, so revoke it now.
          if (this.#entries.get(key) !== created) { this.#media.revoke(url); return url; }
          created.url = url;
          return url;
        },
        (error: unknown) => {
          if (this.#entries.get(key) === created) this.#entries.delete(key);
          throw error;
        },
      );
      entry = created;
      this.#entries.set(key, entry);
    }
    if (entry.timer) { this.#clock.clearTimeout(entry.timer); entry.timer = null; }
    entry.refs++;
    return entry.promise;
  }

  release(artifact: ArtifactKey): void {
    const key = artifactKey(artifact);
    const entry = this.#entries.get(key);
    if (!entry || entry.refs === 0) return;
    entry.refs--;
    if (entry.refs > 0) return;
    entry.timer = this.#clock.setTimeout(() => this.#drop(key, entry), RELEASE_DELAY_MS);
  }

  #drop(key: string, entry: Entry): void {
    if (this.#entries.get(key) !== entry || entry.refs > 0) return;
    this.#entries.delete(key);
    if (entry.url) this.#media.revoke(entry.url);
    else entry.abort.abort();
  }

  /** Entries alive or waiting to be revoked (for tests and diagnostics). */
  get size(): number {
    return this.#entries.size;
  }

  /** Revoke everything now, e.g. when the project changes. */
  clear(): void {
    for (const [key, entry] of this.#entries) {
      if (entry.timer) this.#clock.clearTimeout(entry.timer);
      this.#entries.delete(key);
      if (entry.url) this.#media.revoke(entry.url);
      else entry.abort.abort();
    }
  }
}

const caches = new WeakMap<MediaSource, ArtifactUrlCache>();

/** One cache per media source, shared by every component that shows an artifact. */
export function cacheFor(media: MediaSource): ArtifactUrlCache {
  let cache = caches.get(media);
  if (!cache) { cache = new ArtifactUrlCache(media); caches.set(media, cache); }
  return cache;
}
