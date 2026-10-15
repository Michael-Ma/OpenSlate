import { assetsRoutes } from "./assets.ts";
import { filmRoutes } from "./film.ts";
import { planRoutes } from "./plan.ts";
import { settingsRoutes } from "./settings.ts";
import { startRoutes } from "./start.ts";
import type { FixtureRoute } from "./types.ts";

/** Per-view simulated routes, checked before the Keyframes commands in fixture-commands.ts. */
export const extraRoutes: FixtureRoute[] = [...planRoutes, ...filmRoutes, ...assetsRoutes, ...settingsRoutes, ...startRoutes];
