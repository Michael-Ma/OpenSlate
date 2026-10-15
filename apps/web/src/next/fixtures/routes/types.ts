import type { FixtureWorld } from "../fixture-port.ts";

/** One simulated route. `match` gets the path below /api/projects/:projectId (or the full path for /api/... routes outside a project). */
export interface FixtureRoute {
  method: "GET" | "POST";
  match: RegExp;
  /** Return the response body; throw ApiError to refuse. `params` are the regex groups. */
  handle(world: FixtureWorld, params: string[], body: unknown): unknown;
}
