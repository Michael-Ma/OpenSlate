import { ApiError } from "../api/client.ts";
import type { FixtureWorld } from "./fixture-port.ts";

/** Simulated Director replies for the fixture film. Owned by the Director column work. */
export function fixtureMessage(_world: FixtureWorld, _body: unknown): unknown {
  throw new ApiError("FIXTURE_UNSUPPORTED", 400);
}
