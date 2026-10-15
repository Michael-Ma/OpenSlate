import { ApiError, type EventOptions, type RequestOptions } from "../api/client.ts";
import type { MediaSource } from "../media/media-source.ts";
import type { StudioPort } from "../store/store.ts";
import { lastFerryDirector, lastFerryOverview, lastFerrySnapshot, pictureKey, PROJECT_ID } from "./last-ferry.ts";

/**
 * The Last Ferry sample film served in the browser, with no server (`?ui=next&fixture=last-ferry`).
 * Reads return the fixture; commands are simulated. Nothing is generated, charged or saved.
 */
export class FixturePort implements StudioPort {
  closed = false;
  #overview = lastFerryOverview();
  #snapshot = lastFerrySnapshot();
  readonly #listeners = new Set<() => void>();

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const base = `/api/projects/${PROJECT_ID}`;
    if (method === "GET") {
      if (path === "/api/projects") return { projects: [{ id: PROJECT_ID, name: this.#snapshot.project.name }] } as T;
      if (path === base) return structuredClone(this.#snapshot) as T;
      if (path === `${base}/generation`) return structuredClone(this.#overview) as T;
      if (path === `${base}/director`) return lastFerryDirector as T;
    }
    throw new ApiError("FIXTURE_UNSUPPORTED", 400);
  }

  /** No server events: the fixture notifies its own listeners after simulated changes. */
  events(_projectId: string, options: EventOptions): Promise<void> {
    options.onOpen();
    return new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(), { once: true }));
  }
}

export async function fixtureMedia(): Promise<MediaSource> {
  const { pictures } = await import("./last-ferry-pictures.ts");
  return {
    async url(artifact) {
      const svg = pictures[pictureKey(artifact.artifactId)];
      if (!svg) throw new ApiError("NOT_FOUND", 404);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    },
    revoke() { /* data URLs need no cleanup */ },
  };
}
