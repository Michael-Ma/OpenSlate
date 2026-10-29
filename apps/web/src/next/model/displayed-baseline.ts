import type { GenerationOverview } from "@openslate/core/public";
import type { ProjectSnapshot } from "./types.ts";

/** A command may use a projection's values only with the exact version those values describe. */
export function displayedHead(projectId: string | null, snapshot: ProjectSnapshot | null, overview: GenerationOverview | null): number | null {
  if (!projectId || snapshot?.project.id !== projectId || overview?.projectId !== projectId) return null;
  return snapshot.project.headVersion === overview.headVersion && snapshot.project.revisionId === overview.revisionId ? overview.headVersion : null;
}
