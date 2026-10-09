import { invariant } from "@openslate/core";
import type { ProductionService } from "./service.js";

/** Optional concurrency fence for a sequence of already authenticated human operations. Never grants or renews authority. */
export function assertExpectedHumanRequest(
  production: ProductionService,
  projectId: string,
  expected: string | null | undefined,
): void {
  if (expected === undefined) return;
  const current = production.store.db
    .prepare(
      "SELECT id FROM entities WHERE kind='message' AND project_id=? AND json_extract(body,'$.editing')=1 AND json_extract(body,'$.state')='active' ORDER BY rowid DESC LIMIT 1",
    )
    .get(projectId) as { id: string } | undefined;
  invariant(
    (current?.id ?? null) === expected,
    "SCENE_REVIEW_STALE",
    "A newer request changed this scene action. Review the current project before continuing.",
  );
}
