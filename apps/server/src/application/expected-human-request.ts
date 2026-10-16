import { invariant } from "@openslate/core";
import type { ProductionService } from "./service.js";

type EditingRequest = { id: string; editing: boolean; state: string };

/** Alongside edits preserve the Director's epoch but still fence a previously prepared human press. */
export function currentHumanRequestId(messages: readonly EditingRequest[]): string | null {
  return messages.filter(message => message.editing && message.state === "active").at(-1)?.id ?? null;
}

/** Optional concurrency fence for a sequence of already authenticated human operations. Never grants or renews authority. */
export function assertExpectedHumanRequest(
  production: ProductionService,
  projectId: string,
  expected: string | null | undefined,
): void {
  if (expected === undefined) return;
  const current = currentHumanRequestId(production.store.list<EditingRequest>("message", projectId));
  invariant(
    current === expected,
    "SCENE_REVIEW_STALE",
    "A newer request changed this scene action. Review the current project before continuing.",
  );
}
