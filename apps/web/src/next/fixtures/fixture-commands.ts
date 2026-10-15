import { ApiError } from "../api/client.ts";
import type { FixtureWorld } from "./fixture-port.ts";

/**
 * Simulated commands for the fixture film: frame views, scene generation reads and presses,
 * storyboard edits, controls and attempt release. Owned by the Keyframes view work.
 */
export function fixtureCommand(_world: FixtureWorld, _method: "GET" | "POST", path: string, _body: unknown): unknown {
  throw new ApiError("FIXTURE_UNSUPPORTED", 400, { path });
}
