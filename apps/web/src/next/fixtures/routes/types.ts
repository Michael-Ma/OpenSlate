import type { FixtureWorld } from "../fixture-port.ts";

/**
 * A route's answer when the request is not its to answer (e.g. Plan's /storyboard route for the Film view's music
 * edit): the next matching route gets it, then the Keyframes commands. Return it synchronously, never in a promise.
 */
export const DECLINE: unique symbol = Symbol("fixture route declines");
export type Decline = typeof DECLINE;

/** One simulated route. `match` gets the path below /api/projects/:projectId (or the full path for /api/... routes outside a project). */
export interface FixtureRoute {
  method: "GET" | "POST" | "PUT";
  match: RegExp;
  /** Return the response body (or a promise of it); throw ApiError to refuse; return DECLINE to pass. `params` are the regex groups. */
  handle(world: FixtureWorld, params: string[], body: unknown): unknown;
}
