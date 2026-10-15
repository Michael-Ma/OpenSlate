import type { FixtureWorld } from "../fixture-port.ts";
import { assetsRoutes } from "./assets.ts";
import { computerRoutes } from "./computer.ts";
import { filmRoutes } from "./film.ts";
import { narrationRoutes } from "./narration.ts";
import { planRoutes } from "./plan.ts";
import { settingsRoutes } from "./settings.ts";
import { startRoutes } from "./start.ts";
import { DECLINE, type Decline, type FixtureRoute } from "./types.ts";

/**
 * Per-view simulated routes, checked before the Keyframes commands in fixture-commands.ts. Each endpoint has one
 * owner; the only shared one is POST /storyboard, which Plan owns (its common rules, the outline and the Keyframes
 * fields it hands to fixture-commands.ts) and declines for the Film view's music edits and the Undo of commands it
 * never answered.
 *
 * Owners of endpoints more than one view reads: GET /api/providers (computer.ts, this computer's catalog), GET and
 * POST /director/setup of the sample film (settings.ts; Start's routes answer the other films'), GET /api/projects
 * (start.ts), GET /audio-library (film.ts; Assets' audio imports join it). Plan declines the shot's narration voice for
 * narration.ts, which also owns a shot's recording and the Undo of both.
 */
export const extraRoutes: FixtureRoute[] = [...planRoutes, ...narrationRoutes, ...filmRoutes, ...assetsRoutes, ...settingsRoutes, ...startRoutes, ...computerRoutes];

/**
 * The answer of the first route for this request that does not decline, or DECLINE when none answers (the caller
 * then tries the Keyframes commands). `path` is below the sample film's /api/projects/:id, or a full /api/... path.
 */
export function fixtureRoute(world: FixtureWorld, method: string, path: string, body: unknown): unknown | Decline {
  for (const route of extraRoutes) {
    const match = route.method === method ? route.match.exec(path) : null;
    if (!match) continue;
    const answer = route.handle(world, match.slice(1), body);
    if (answer !== DECLINE) return answer;
  }
  return DECLINE;
}
