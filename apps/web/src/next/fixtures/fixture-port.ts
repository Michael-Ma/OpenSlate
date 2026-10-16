import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import { ApiError, type EventOptions, type RequestOptions } from "../api/client.ts";
import type { MediaSource } from "../media/media-source.ts";
import type { DirectorStatus, ProjectSnapshot } from "../model/types.ts";
import type { StudioPort } from "../store/store.ts";
import { fixtureCommand } from "./fixture-commands.ts";
import { fixtureRoute } from "./routes/index.ts";
import { recoveryRequest } from "./routes/recovery.ts";
import { DECLINE } from "./routes/types.ts";
import { applyDirectorPresets, fixtureMessage } from "./fixture-director.ts";
import { lastFerryDirector, lastFerryOverview, lastFerryProposals, lastFerrySnapshot, pictureKey, PROJECT_ID } from "./last-ferry.ts";

/** Mutable fixture state that simulated commands change. */
export interface FixtureWorld {
  overview: GenerationOverview;
  snapshot: ProjectSnapshot;
  director: DirectorStatus;
  /** Held and settled Director proposals (GET /director/proposals). */
  proposals: DirectorProposal[];
  /** Apply a change, bump the cursor and notify the open event stream, like a server event would. */
  update(change: (world: FixtureWorld) => void): void;
  /** Run a change later (simulated provider time). Cancelled when the port closes. */
  later(ms: number, change: (world: FixtureWorld) => void): void;
}

/**
 * The Last Ferry sample film served in the browser, with no server (`?ui=next&fixture=last-ferry`).
 * Reads return the fixture; commands are simulated in fixture-commands.ts and fixture-director.ts.
 * Nothing is generated, charged or saved.
 */
export class FixturePort implements StudioPort {
  closed = false;
  readonly #emitters = new Set<() => void>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly world: FixtureWorld;

  constructor() {
    const port = this;
    this.world = {
      overview: lastFerryOverview(),
      snapshot: lastFerrySnapshot(),
      director: { ...lastFerryDirector },
      proposals: lastFerryProposals(),
      update(change) {
        change(port.world);
        const cursor = port.world.overview.cursor + 1;
        port.world.overview = { ...port.world.overview, cursor };
        port.world.snapshot = { ...port.world.snapshot, cursor };
        for (const emit of port.#emitters) emit();
      },
      later(ms, change) {
        const timer = setTimeout(() => { port.#timers.delete(timer); if (!port.closed) port.world.update(change); }, ms);
        port.#timers.add(timer);
      },
    };
    // The sample Director's `?director=` presets (Codex with pictures, a held edit, a failed reply…).
    applyDirectorPresets(this.world);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const base = `/api/projects/${PROJECT_ID}`;
    // Installation recovery and the session first: a studio in recovery review refuses every write, messages included.
    const installation = recoveryRequest(this.world, method, path, options);
    if (installation !== DECLINE) return installation as T;
    if (method === "GET") {
      if (path === base) return structuredClone(this.world.snapshot) as T;
      if (path === `${base}/generation`) return structuredClone(this.world.overview) as T;
      if (path === `${base}/director`) return { ...this.world.director } as T;
      if (path === `${base}/director/proposals`) return { proposals: structuredClone(this.world.proposals) } as T;
    }
    if (method === "POST" && path === `${base}/messages`) return fixtureMessage(this.world, options.body) as T;
    // The views' routes first (a route may decline: the next one gets the request), then the Keyframes commands.
    const below = path.startsWith(base) ? path.slice(base.length) : path;
    const answer = fixtureRoute(this.world, method, below, options.body);
    if (answer !== DECLINE) return answer as T;
    if (path.startsWith(base)) return fixtureCommand(this.world, method, below, options.body) as T;
    throw new ApiError("FIXTURE_UNSUPPORTED", 400);
  }

  /** Simulated server events: one project.invalidate per change. */
  events(projectId: string, options: EventOptions): Promise<void> {
    options.onOpen();
    const emit = () => {
      const cursor = this.world.overview.cursor;
      options.onEvent({ event: "project.invalidate", id: null, data: JSON.stringify({ projectId, version: 1, cursor }) });
    };
    this.#emitters.add(emit);
    return new Promise((resolve) => options.signal.addEventListener("abort", () => { this.#emitters.delete(emit); resolve(); }, { once: true }));
  }

  close(): void {
    this.closed = true;
    for (const timer of this.#timers) clearTimeout(timer);
  }
}

export async function fixtureMedia(): Promise<MediaSource> {
  const { pictures } = await import("./last-ferry-pictures.ts");
  return {
    async url(artifact) {
      const svg = pictures[pictureKey(artifact.artifactId)];
      if (!svg) throw new ApiError("NOT_FOUND", 404);
      // A standalone SVG image needs its namespace; the illustrations were written for inline use.
      const standalone = /^<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standalone)}`;
    },
    revoke() { /* data URLs need no cleanup */ },
  };
}
