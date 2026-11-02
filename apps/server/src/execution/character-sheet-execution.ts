import { canonical, CHARACTER_SHEET_CANVAS, characterSheetPrompt, characterSheetPromptDigest, digest, invariant, providerProfileArguments } from "@openslate/core";
import type { CharacterRecord, PlanNode, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { NodeBinding } from "./engine.js";

/**
 * Character-sheet images run as ordinary image bindings that no shot owns. They live outside the shot plan under
 * this fixed plan identity, so plan installs never retire them and shot views never list them.
 */
export const CHARACTER_SHEET_PLAN_ID = "character-sheets";
export const CHARACTER_SHEET_JOB_KIND = "character_sheet_job";
/** Image adapters whose execution path accepts a sheet node. Other adapters keep their shot-only guards. */
export const CHARACTER_SHEET_ADAPTERS: readonly string[] = Object.freeze(["codex-image", "fake"]);

/** The immutable record of one requested sheet: the exact node a human (or their fresh Director request) asked for. */
export interface CharacterSheetJob {
  id: string;
  projectId: string;
  characterId: string;
  node: PlanNode;
  requestId: string;
  regenerate: boolean;
  createdAt: string;
}

export function isCharacterSheetBinding(binding: Pick<NodeBinding, "planId" | "node"> | undefined | null): boolean {
  return !!binding && binding.planId === CHARACTER_SHEET_PLAN_ID && binding.node.kind === "image" && binding.node.shotId === null
    && typeof binding.node.characterId === "string" && binding.node.characterId.length > 0;
}

/** The only prompt a sheet may carry: the app template for the character's current identity, on the 1:1 canvas. */
export function currentCharacterSheetPrompt(character: Pick<CharacterRecord, "name" | "identity" | "baseOutfit">): string {
  return characterSheetPrompt(character, { aspect: CHARACTER_SHEET_CANVAS.current.aspect });
}
const sheetIntent = (characterId: string, prompt: string): string =>
  digest({ kind: "character_sheet", characterId, promptDigest: characterSheetPromptDigest(prompt) });

/** Build the sheet node exactly as the planning compiler builds an image node: same args shape and spec digest rule. */
export function characterSheetNode(id: string, character: CharacterRecord, profile: ProviderProfile): PlanNode {
  invariant(profile.kind === "image" && CHARACTER_SHEET_ADAPTERS.includes(profile.adapter), "CHARACTER_SHEET_PROFILE_UNSUPPORTED",
    "Character sheets need the Codex image model (or the labelled fixture model)");
  const prompt = currentCharacterSheetPrompt(character), { width, height } = CHARACTER_SHEET_CANVAS.current;
  const args = { ...providerProfileArguments(profile), prompt, width, height, settings: {} };
  const intentDigest = sheetIntent(character.id, prompt);
  return { id, alias: `character-sheet:${character.id}`, kind: "image", shotId: null, shotRevisionId: null, profileId: profile.id, args,
    inputs: [], requires: [], intentDigest, specDigest: digest({ kind: "image", args, intent: intentDigest, inputs: [] }), characterId: character.id };
}

/** The recorded job node when it is exactly the bound node; undefined for any forged or changed binding. */
export function characterSheetJobNode(store: Pick<Store, "get">, binding: NodeBinding): PlanNode | undefined {
  if (!isCharacterSheetBinding(binding)) return undefined;
  const job = store.get<CharacterSheetJob>(CHARACTER_SHEET_JOB_KIND, binding.id);
  return job && job.id === binding.id && job.projectId === binding.projectId && job.characterId === binding.node.characterId
    && canonical(job.node) === canonical(binding.node) ? job.node : undefined;
}

/**
 * Intent freshness for a sheet node, the counterpart of the shot prompt check: the character still exists and the
 * node carries exactly the current sheet prompt, at 1:1, with no references.
 */
export function assertCharacterSheetIntent(project: Pick<ProjectRecord, "characters">, node: PlanNode, code = "STALE_PROMPT_INTENT"): void {
  const character = (project.characters ?? []).find(item => item.id === node.characterId);
  invariant(character, code, "The character of this sheet is no longer in the film");
  const prompt = currentCharacterSheetPrompt(character);
  invariant(node.kind === "image" && node.shotId === null && node.inputs.length === 0 && node.requires.length === 0
    && node.args.prompt === prompt && node.args.width === CHARACTER_SHEET_CANVAS.current.width && node.args.height === CHARACTER_SHEET_CANVAS.current.height
    && node.intentDigest === sheetIntent(character.id, prompt), code, "The sheet prompt differs from the character's current sheet prompt");
}

/** Current-selection check for a sheet binding: recorded job, exact node, current character prompt. */
export function assertCharacterSheetSelection(store: Pick<Store, "get" | "getProject">, binding: NodeBinding, code: string): void {
  invariant(characterSheetJobNode(store, binding), code, "This sheet is not an exact recorded character sheet request");
  assertCharacterSheetIntent(store.getProject(binding.projectId), binding.node, code);
}
