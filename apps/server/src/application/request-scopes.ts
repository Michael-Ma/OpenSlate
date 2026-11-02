import type { ProjectRecord } from "@openslate/core";

/** Project scopes cover everything; scene scopes cover their shots. Missing legacy scope is whole-film. */
export function requestScopesIntersect(
  project: ProjectRecord,
  left: readonly string[] = [],
  right: readonly string[] = [],
): boolean {
  if (!left.length || !right.length || left.includes(project.id) || right.includes(project.id)) return true;
  return left.some(a => right.some(b => a === b || project.shots.some(shot =>
    (shot.id === a && shot.sceneId === b) || (shot.id === b && shot.sceneId === a))));
}
