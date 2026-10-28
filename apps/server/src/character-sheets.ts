import { canonical, characterSheetPromptDigest, invariant } from "@openslate/core";
import type { ArtifactRef, ProjectRecord } from "@openslate/core";
import type { ArtifactRecord } from "./execution/engine.js";
import type { Store } from "./persistence/store.js";

export const CHARACTER_SHEET_TAKE_KIND = "character_sheet_take";

/**
 * One generated or imported character sheet image for one planned character. Takes are immutable history;
 * approval lives on the character (`CharacterRecord.sheet`), so a regenerated sheet never rewrites an older take.
 */
export interface CharacterSheetTake {
  id: string;
  projectId: string;
  characterId: string;
  artifact: ArtifactRef;
  prompt: string;
  promptDigest: string;
  /** The image attempt that made it; null for an imported sheet. */
  attemptId: string | null;
  createdAt: string;
}

/** Record a sheet take for an existing character and an exact owned PNG of the same project. */
export function recordCharacterSheetTake(store: Store, input: Omit<CharacterSheetTake, "promptDigest" | "createdAt"> & { createdAt?: string }): CharacterSheetTake {
  return store.transaction(() => {
    const project = store.getProject(input.projectId);
    invariant((project.characters ?? []).some(character => character.id === input.characterId), "SCOPE_DENIED", "Character sheet names an unknown character");
    const record = store.get<ArtifactRecord>("artifact", input.artifact.artifactId);
    invariant(record && record.projectId === input.projectId && input.artifact.kind === "image" && record.mimeType === "image/png"
      && canonical(record.artifact) === canonical(input.artifact), "CHARACTER_SHEET_INVALID", "A character sheet must be one exact PNG of this film");
    invariant(!store.get(CHARACTER_SHEET_TAKE_KIND, input.id), "CHARACTER_SHEET_INVALID", "This sheet take already exists");
    invariant(typeof input.prompt === "string" && input.prompt.trim().length > 0 && input.prompt.length <= 16000, "VALIDATION_ERROR", "A sheet take keeps its prompt");
    const take: CharacterSheetTake = { id: input.id, projectId: input.projectId, characterId: input.characterId, artifact: { ...input.artifact },
      prompt: input.prompt, promptDigest: characterSheetPromptDigest(input.prompt), attemptId: input.attemptId, createdAt: input.createdAt ?? new Date().toISOString() };
    return store.insert(CHARACTER_SHEET_TAKE_KIND, take.id, take.projectId, take);
  });
}

export function characterSheetTakes(store: Store, projectId: string): CharacterSheetTake[] {
  return store.list<CharacterSheetTake>(CHARACTER_SHEET_TAKE_KIND, projectId);
}

/** Whether this take is the character's approved sheet: same artifact and the same bytes. */
export function isApprovedSheet(project: Pick<ProjectRecord, "characters">, take: Pick<CharacterSheetTake, "characterId" | "artifact">): boolean {
  const sheet = (project.characters ?? []).find(character => character.id === take.characterId)?.sheet;
  return !!sheet && sheet.artifactId === take.artifact.artifactId && sheet.sha256 === take.artifact.sha256;
}

/** Sheet images that are not any character's approved sheet. Binding removes them from shot references. */
export function retiredSheetArtifactIds(project: Pick<ProjectRecord, "characters">, takes: readonly CharacterSheetTake[]): string[] {
  const approved = new Set((project.characters ?? []).flatMap(character => character.sheet ? [character.sheet.artifactId] : []));
  return [...new Set(takes.map(take => take.artifact.artifactId))].filter(id => !approved.has(id));
}
