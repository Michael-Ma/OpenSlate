import { digest, invariant } from "./common.js";
import type { CharacterRecord, CharacterWardrobe, Id, ProjectRecord, ShotRecord } from "./contracts.js";

/**
 * Character planning: per-scene wardrobe, the four-view character sheet and its binding into keyframes.
 * Pure functions over saved plan data. They issue no IDs, start no work and never call a provider.
 */
export const CHARACTER_LIMITS = Object.freeze({
  characters: 32,
  name: 80,
  identity: 1200,
  outfit: 600,
  notes: 300,
  /** Matches the Codex image worker's reference limit (CODEX_IMAGE_LIMITS.references). */
  referencesPerShot: 8,
});

/** Recommended canvas for the four-view sheet. The current Codex image worker accepts only 1024×1024. */
export const CHARACTER_SHEET_CANVAS = Object.freeze({
  recommended: { aspect: "3:2", width: 1536, height: 1024 },
  current: { aspect: "1:1", width: 1024, height: 1024 },
} as const);
export type CharacterSheetAspect = "3:2" | "1:1";

export type CharacterShot = Pick<ShotRecord, "id" | "sceneId" | "imagePrompt" | "referenceArtifactIds" | "characterIds">;
export type CharacterPlan = Pick<ProjectRecord, "scenes" | "characters"> & { shots: CharacterShot[] };

function text(value: unknown, max: number, label: string, required = true): void {
  invariant(typeof value === "string" && (!required || value.trim().length > 0) && value.length <= max,
    "VALIDATION_ERROR", `${label} must be ${required ? "nonempty " : ""}text of at most ${max} characters`);
}

/** Write-time validation for saved characters and shot casting. Throws VALIDATION_ERROR or SCOPE_DENIED. */
export function assertCharacterPlan(plan: CharacterPlan): void {
  const characters = plan.characters ?? [];
  invariant(Array.isArray(characters) && characters.length <= CHARACTER_LIMITS.characters, "VALIDATION_ERROR",
    `A film has at most ${CHARACTER_LIMITS.characters} characters`);
  const scenes = new Set(plan.scenes.map(scene => scene.id)), ids = new Set<string>(), names = new Set<string>();
  for (const character of characters) {
    text(character.id, 160, "Character id");
    invariant(!ids.has(character.id), "VALIDATION_ERROR", "Character ids must be unique");
    ids.add(character.id);
    text(character.name, CHARACTER_LIMITS.name, "Character name");
    const name = character.name.trim().toLocaleLowerCase();
    invariant(!names.has(name), "VALIDATION_ERROR", `Two characters are named ${character.name.trim()}`);
    names.add(name);
    text(character.identity, CHARACTER_LIMITS.identity, "Character identity");
    if (character.baseOutfit !== undefined) text(character.baseOutfit, CHARACTER_LIMITS.outfit, "Base outfit");
    invariant(Array.isArray(character.wardrobe), "VALIDATION_ERROR", "Wardrobe must be a list");
    const dressed = new Set<string>();
    for (const entry of character.wardrobe) {
      invariant(scenes.has(entry.sceneId), "SCOPE_DENIED", `${character.name} has wardrobe for an unknown scene`);
      invariant(!dressed.has(entry.sceneId), "VALIDATION_ERROR", `${character.name} has two outfits for one scene`);
      dressed.add(entry.sceneId);
      text(entry.outfit, CHARACTER_LIMITS.outfit, "Outfit");
      if (entry.notes !== undefined) text(entry.notes, CHARACTER_LIMITS.notes, "Wardrobe note", false);
    }
    const sheet = character.sheet;
    invariant(sheet === null || (typeof sheet === "object" && typeof sheet.artifactId === "string" && sheet.artifactId.length > 0
      && /^[a-f0-9]{64}$/.test(sheet.sha256) && /^[a-f0-9]{64}$/.test(sheet.promptDigest) && Number.isFinite(Date.parse(sheet.approvedAt))),
    "VALIDATION_ERROR", "A character sheet must name one exact approved image");
  }
  for (const shot of plan.shots) {
    const cast = shot.characterIds ?? [];
    invariant(Array.isArray(cast) && new Set(cast).size === cast.length, "VALIDATION_ERROR", "A shot lists each character once");
    for (const id of cast) invariant(ids.has(id), "SCOPE_DENIED", "Shot names an unknown character");
  }
}

/** The outfit a character wears in one scene: the scene's entry, else the base outfit, else null (unplanned). */
export function wardrobeFor(character: CharacterRecord, sceneId: Id): (CharacterWardrobe & { fallback: boolean }) | null {
  const entry = character.wardrobe.find(item => item.sceneId === sceneId);
  if (entry) return { ...entry, fallback: false };
  return character.baseOutfit?.trim() ? { sceneId, outfit: character.baseOutfit, fallback: true } : null;
}

/** Shots each character appears in, in plan order. */
export function characterAppearances(plan: CharacterPlan): Map<Id, { shotIds: Id[]; sceneIds: Id[] }> {
  const result = new Map<Id, { shotIds: Id[]; sceneIds: Id[] }>();
  for (const character of plan.characters ?? []) result.set(character.id, { shotIds: [], sceneIds: [] });
  for (const shot of plan.shots) for (const id of shot.characterIds ?? []) {
    const seen = result.get(id);
    if (!seen) continue;
    seen.shotIds.push(shot.id);
    if (!seen.sceneIds.includes(shot.sceneId)) seen.sceneIds.push(shot.sceneId);
  }
  return result;
}

/** Characters seen in more than one shot. Each needs an approved sheet before its keyframes are made. */
export function charactersNeedingSheets(plan: CharacterPlan): CharacterRecord[] {
  const seen = characterAppearances(plan);
  return (plan.characters ?? []).filter(character => (seen.get(character.id)?.shotIds.length ?? 0) > 1);
}

/**
 * One prompt for one image with four views of the same person. The sheet shows identity in a neutral outfit;
 * keyframes override clothing per scene, so the sheet never fixes a scene's wardrobe.
 */
export function characterSheetPrompt(character: Pick<CharacterRecord, "name" | "identity" | "baseOutfit">,
  options: { style?: string; aspect?: CharacterSheetAspect } = {}): string {
  text(character.name, CHARACTER_LIMITS.name, "Character name");
  text(character.identity, CHARACTER_LIMITS.identity, "Character identity");
  const aspect = options.aspect ?? "1:1", outfit = character.baseOutfit?.trim() || "plain, close-fitting neutral grey clothes and simple shoes";
  const canvas = aspect === "3:2"
    ? "Landscape 3:2 canvas divided into four equal vertical panels"
    : "Square canvas divided into four equal vertical panels";
  return [
    `Character reference sheet for ${character.name.trim()}.`,
    `${canvas}, left to right: 1) full-body front view; 2) full-body side view, facing left, in profile; 3) full-body back view; 4) face close-up, head and shoulders, facing the camera.`,
    "The same person in all four panels, at the same height and scale, standing relaxed with arms slightly away from the body, head to feet fully visible in panels 1 to 3.",
    `Person: ${character.identity.trim()}`,
    `Wearing: ${outfit}.`,
    "Neutral expression. Even, soft front light. Plain light-grey seamless background. No text, labels, logos, props, frames or other people.",
    ...(options.style?.trim() ? [`Rendering style: ${options.style.trim()}`] : []),
  ].join("\n");
}
export const characterSheetPromptDigest = (prompt: string): string => digest({ version: 1, kind: "character_sheet", prompt });

export interface CharacterBinding {
  /** Shot references with approved sheets first, in casting order, then the shot's other references. */
  referenceArtifactIds: Id[];
  /** Sheet reference position (1-based) for each bound character. */
  bound: Array<{ characterId: Id; reference: number }>;
  /** Cast characters with no approved sheet. Keyframes rely on text alone for them. */
  unbound: Id[];
  /** Reference count exceeds the image worker limit; nothing past the limit is sent. */
  overLimit: boolean;
}

/**
 * Bind approved sheets into one shot's keyframe references. `retiredSheetArtifactIds` are earlier sheet takes:
 * they are removed so a regenerated sheet replaces, rather than joins, the old one.
 */
export function bindCharacterReferences(plan: Pick<CharacterPlan, "characters">, shot: CharacterShot,
  retiredSheetArtifactIds: Iterable<Id> = []): CharacterBinding {
  const characters = new Map((plan.characters ?? []).map(character => [character.id, character]));
  const retired = new Set(retiredSheetArtifactIds), sheets: Id[] = [], bound: CharacterBinding["bound"] = [], unbound: Id[] = [];
  for (const id of shot.characterIds ?? []) {
    const sheet = characters.get(id)?.sheet;
    if (!sheet) { unbound.push(id); continue; }
    if (!sheets.includes(sheet.artifactId)) sheets.push(sheet.artifactId);
    bound.push({ characterId: id, reference: sheets.indexOf(sheet.artifactId) + 1 });
  }
  const current = new Set((plan.characters ?? []).flatMap(character => character.sheet ? [character.sheet.artifactId] : []));
  const others = shot.referenceArtifactIds.filter(id => !sheets.includes(id) && !retired.has(id) && !current.has(id));
  const all = [...sheets, ...others];
  return { referenceArtifactIds: all.slice(0, CHARACTER_LIMITS.referencesPerShot), bound, unbound, overLimit: all.length > CHARACTER_LIMITS.referencesPerShot };
}

const BLOCK_START = "Characters in this shot (OpenSlate):\n", BLOCK_END = "\nEnd of characters.";

/** The app-written character block for one shot: who, which reference shows them and what they wear here. */
export function characterDirection(plan: Pick<CharacterPlan, "characters">, shot: CharacterShot, binding = bindCharacterReferences(plan, shot)): string {
  const characters = new Map((plan.characters ?? []).map(character => [character.id, character]));
  const lines = (shot.characterIds ?? []).flatMap(id => {
    const character = characters.get(id);
    if (!character) return [];
    const reference = binding.bound.find(item => item.characterId === id)?.reference;
    const outfit = wardrobeFor(character, shot.sceneId);
    return [`- ${character.name.trim()}${reference && reference <= CHARACTER_LIMITS.referencesPerShot
      ? ` (reference image ${reference} is their character sheet: match face, hair, build and proportions; ignore the sheet's clothing and pose)` : ""}: ${character.identity.trim()}`
      + (outfit ? ` Wearing in this scene: ${outfit.outfit.trim()}${outfit.notes?.trim() ? ` (${outfit.notes.trim()})` : ""}.` : "")];
  });
  return lines.length ? `${BLOCK_START}${lines.join("\n")}${BLOCK_END}` : "";
}

/** Replace or remove the app-written character block, keeping every other part of the prompt as written. */
export function withCharacterDirection(prompt: string, block: string): string {
  const start = prompt.indexOf(BLOCK_START), end = start >= 0 ? prompt.indexOf(BLOCK_END, start) : -1;
  // Nothing to add or remove: the saved prompt stays byte-identical, so no keyframe goes stale.
  if (!block && (start < 0 || end < 0)) return prompt;
  const rest = start >= 0 && end >= 0 ? (prompt.slice(0, start) + prompt.slice(end + BLOCK_END.length)).replace(/\n{3,}/g, "\n\n").trim() : prompt.trim();
  const next = block ? (rest ? `${rest}\n\n${block}` : block) : rest;
  invariant(next.length <= 16000, "VALIDATION_ERROR", "This direction is too long. Shorten it before saving.");
  return next;
}

export type CharacterIssueCode =
  | "UNKNOWN_CHARACTER" | "WARDROBE_MISSING" | "WARDROBE_UNKNOWN_SCENE" | "WARDROBE_UNIFORM"
  | "WARDROBE_PROMPT_MISMATCH" | "SHEET_REQUIRED" | "SHEET_NOT_BOUND" | "SHEET_STALE_BINDING" | "TOO_MANY_REFERENCES";
export interface CharacterIssue {
  code: CharacterIssueCode;
  /** blocking: keyframes would contradict the plan; warning: likely drift; info: worth a look. */
  severity: "blocking" | "warning" | "info";
  characterId?: Id;
  sceneId?: Id;
  shotId?: Id;
}

/** Read-only continuity checks for Plan and Keyframes. Never mutates or starts work. */
export function characterContinuityIssues(plan: CharacterPlan, retiredSheetArtifactIds: Iterable<Id> = []): CharacterIssue[] {
  const issues: CharacterIssue[] = [], characters = new Map((plan.characters ?? []).map(character => [character.id, character]));
  const scenes = new Set(plan.scenes.map(scene => scene.id)), retired = new Set(retiredSheetArtifactIds);
  const seen = characterAppearances(plan), recurring = new Set(charactersNeedingSheets(plan).map(character => character.id));
  for (const character of characters.values()) {
    for (const entry of character.wardrobe) if (!scenes.has(entry.sceneId)) issues.push({ code: "WARDROBE_UNKNOWN_SCENE", severity: "warning", characterId: character.id, sceneId: entry.sceneId });
    const appearances = seen.get(character.id)!;
    for (const sceneId of appearances.sceneIds) if (!wardrobeFor(character, sceneId)) issues.push({ code: "WARDROBE_MISSING", severity: "blocking", characterId: character.id, sceneId });
    const outfits = appearances.sceneIds.map(sceneId => wardrobeFor(character, sceneId)?.outfit.trim().toLocaleLowerCase()).filter(Boolean);
    if (outfits.length > 1 && new Set(outfits).size === 1) issues.push({ code: "WARDROBE_UNIFORM", severity: "info", characterId: character.id });
    if (recurring.has(character.id) && !character.sheet) issues.push({ code: "SHEET_REQUIRED", severity: "blocking", characterId: character.id });
  }
  for (const shot of plan.shots) {
    const prompt = shot.imagePrompt.toLocaleLowerCase();
    for (const id of shot.characterIds ?? []) {
      const character = characters.get(id);
      if (!character) { issues.push({ code: "UNKNOWN_CHARACTER", severity: "blocking", characterId: id, shotId: shot.id }); continue; }
      if (character.sheet && !shot.referenceArtifactIds.includes(character.sheet.artifactId))
        issues.push({ code: "SHEET_NOT_BOUND", severity: "blocking", characterId: id, shotId: shot.id });
      const here = wardrobeFor(character, shot.sceneId)?.outfit.trim().toLocaleLowerCase();
      const elsewhere = character.wardrobe.filter(entry => entry.sceneId !== shot.sceneId && entry.outfit.trim().toLocaleLowerCase() !== here)
        .some(entry => prompt.includes(entry.outfit.trim().toLocaleLowerCase()));
      if (here && elsewhere && !prompt.includes(here)) issues.push({ code: "WARDROBE_PROMPT_MISMATCH", severity: "warning", characterId: id, sceneId: shot.sceneId, shotId: shot.id });
    }
    if (shot.referenceArtifactIds.some(id => retired.has(id))) issues.push({ code: "SHEET_STALE_BINDING", severity: "blocking", shotId: shot.id });
    if (bindCharacterReferences(plan, shot, retired).overLimit) issues.push({ code: "TOO_MANY_REFERENCES", severity: "warning", shotId: shot.id });
  }
  return issues;
}
