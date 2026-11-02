import type { GenerationOverview, PriceQuote, StudioArtifactRef } from "@openslate/core/public";
import { keyframeEstimate, priceMsg } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Plan › Cast (v8 step 5; docs/ai/characters/wardrobe-and-reference-sheets.md §2.8 and §4.2). The read model of
 * GET /characters, the body of PUT /characters, and what the cast views say. Pure: the views render and send.
 *
 * Routes (apps/server/src/characters.ts):
 *   GET  /characters                          → CastRead
 *   PUT  /characters                          { expectedHeadVersion, characters, casting? } (the person's edit)
 *   POST /characters/:id/sheet/generate       { expectedHeadVersion, expectedEstimateMicros, regenerate? }
 *   POST /characters/:id/sheet/import         { artifactId, sha256 } (an image already uploaded to the film)
 *   POST /characters/:id/sheet/approve        { expectedHeadVersion, takeId }
 * Approving rebinds every cast shot in one revision; their keyframes go out of date and nothing is remade.
 */

export type SheetState = "none" | "pending" | "review" | "approved" | "outdated";

export interface CastWardrobe { sceneId: string; outfit: string; notes?: string }

export interface CastTake {
  takeId: string;
  artifact: StudioArtifactRef;
  source: "generated" | "imported";
  promptDigest: string;
  createdAt: string;
  approved: boolean;
  /** Made from an older identity or base outfit than the character has now. */
  outdated: boolean;
}

export interface CastCharacter {
  id: string;
  revisionId: string;
  name: string;
  identity: string;
  baseOutfit?: string;
  wardrobe: CastWardrobe[];
  sheet: { artifactId: string; sha256: string; promptDigest: string; approvedAt: string } | null;
  appearances: { shotIds: string[]; sceneIds: string[] };
  /** Seen in more than one shot: keyframes need an approved sheet. */
  needsSheet: boolean;
  sheetPrompt: string;
  sheetPromptDigest: string;
  sheetState: SheetState;
  takes: CastTake[];
  job: { nodeId: string; state: "queued" | "running" | "failed" | "stopped" | "done"; attemptId: string | null } | null;
}

export type CastIssueCode =
  | "UNKNOWN_CHARACTER" | "WARDROBE_MISSING" | "WARDROBE_UNKNOWN_SCENE" | "WARDROBE_UNIFORM"
  | "WARDROBE_PROMPT_MISMATCH" | "SHEET_REQUIRED" | "SHEET_NOT_BOUND" | "SHEET_STALE_BINDING" | "TOO_MANY_REFERENCES";

export interface CastIssue { code: CastIssueCode; severity: "blocking" | "warning" | "info"; characterId?: string; sceneId?: string; shotId?: string }

export interface CastRead {
  projectId: string;
  headVersion: number;
  revisionId: string;
  imageProfile: { id: string; adapter: string } | null;
  sheetSupported: boolean;
  canvas: { aspect: "1:1"; width: number; height: number };
  sheetQuote: PriceQuote;
  characters: CastCharacter[];
  casting: { shotId: string; sceneId: string; characterIds: string[] }[];
  issues: CastIssue[];
}

/** The body of PUT /characters. Ids of existing characters; `key` names one created in the same save. */
export interface CastSaveInput {
  expectedHeadVersion: number;
  characters: { id?: string; key?: string; name: string; identity: string; baseOutfit?: string | null; wardrobe: CastWardrobe[] }[];
  casting?: { shotId: string; characterIds: string[] }[];
}

export interface CastSaveReceipt { headVersion: number; revisionId: string; characterIds: string[]; keys: Record<string, string>; changedShotIds: string[]; outdatedNodeIds: string[] }
export interface ApproveReceipt { headVersion: number; characterId: string; takeId: string; changedShotIds: string[]; outdatedNodeIds: string[] }

export const CAST_PATH = "/characters";
export const sheetPath = (characterId: string, action: "generate" | "import" | "approve") => `/characters/${encodeURIComponent(characterId)}/sheet/${action}`;

// ---- reading -------------------------------------------------------------------------------

/** The take shown for a character: the approved one, else the newest. */
export function shownTake(character: CastCharacter): CastTake | null {
  return character.takes.find((take) => take.approved) ?? [...character.takes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** "M" for Mara: the avatar's letter when there is no sheet to show. */
export const initialOf = (name: string): string => [...name.trim()][0]?.toLocaleUpperCase() ?? "?";

const STATE_MSG: Record<SheetState, Msg> = {
  none: msg("cast.state.none"),
  pending: msg("cast.state.pending"),
  review: msg("cast.state.review"),
  approved: msg("cast.state.approved"),
  outdated: msg("cast.state.outdated"),
};

/** The chip: a recurring character without a sheet needs one; a one-shot character simply has none. */
export function sheetStateMsg(character: Pick<CastCharacter, "sheetState" | "needsSheet" | "job">): Msg {
  if (character.sheetState === "none") return character.job?.state === "failed" ? msg("cast.state.failed") : character.needsSheet ? STATE_MSG.none : msg("cast.state.optional");
  return STATE_MSG[character.sheetState];
}

/** ok: approved; attention: the person has something to do (review, needs one, out of date); busy; quiet. */
export function sheetTone(character: Pick<CastCharacter, "sheetState" | "needsSheet">): "ok" | "attention" | "busy" | "quiet" {
  if (character.sheetState === "approved") return "ok";
  if (character.sheetState === "pending") return "busy";
  if (character.sheetState === "none" && !character.needsSheet) return "quiet";
  return "attention";
}

const labelOf = (overview: GenerationOverview, shotId: string) => overview.shots[shotId]?.label ?? "?";
const ordinalOf = (overview: GenerationOverview, sceneId: string) => overview.scenes.find((scene) => scene.sceneId === sceneId)?.ordinal ?? 0;

/** "4 shots in Scenes 1–3" / "Not cast in any shot yet". */
export function appearanceMsg(character: CastCharacter, overview: GenerationOverview): Msg {
  const shots = character.appearances.shotIds.filter((id) => overview.shots[id]);
  if (!shots.length) return msg("cast.appears.none");
  const scenes = [...new Set(character.appearances.sceneIds.map((id) => ordinalOf(overview, id)).filter((n) => n > 0))].sort((a, b) => a - b);
  return msg("cast.appears", { count: shots.length, scenes: scenes.join(", "), sceneCount: scenes.length });
}

/** Characters cast in one shot, in reference order, with what an avatar shows. */
export interface CastChip { characterId: string; name: string; initial: string; picture: StudioArtifactRef | null; approved: boolean; state: SheetState }
export function castChips(read: CastRead | null, shotId: string): CastChip[] {
  if (!read) return [];
  const ids = read.casting.find((row) => row.shotId === shotId)?.characterIds ?? [];
  return ids.flatMap((id) => {
    const character = read.characters.find((c) => c.id === id);
    if (!character) return [];
    const take = character.sheetState === "approved" || character.sheetState === "outdated" ? character.takes.find((t) => t.approved) : null;
    return [{ characterId: id, name: character.name, initial: initialOf(character.name), picture: take?.artifact ?? null, approved: character.sheetState === "approved", state: character.sheetState }];
  });
}

// ---- the wardrobe grid -----------------------------------------------------------------------

export interface WardrobeCell {
  characterId: string;
  sceneId: string;
  /** Cast in at least one shot of this scene. */
  appears: boolean;
  outfit: string;
  notes: string;
  /** No outfit written: the base outfit is used, or nothing (then the cell is a blocking check). */
  fallback: string | null;
  missing: boolean;
  /** A shot prompt in this scene describes another scene's outfit (the "same coat pasted everywhere" symptom). */
  mismatch: boolean;
}

export interface WardrobeGrid {
  scenes: { sceneId: string; ordinal: number; title: string }[];
  rows: { characterId: string; name: string; cells: WardrobeCell[] }[];
}

export function wardrobeGrid(read: CastRead, overview: GenerationOverview): WardrobeGrid {
  const scenes = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).map((scene) => ({ sceneId: scene.sceneId, ordinal: scene.ordinal, title: scene.title }));
  const has = (code: CastIssueCode, characterId: string, sceneId: string) => read.issues.some((issue) => issue.code === code && issue.characterId === characterId && issue.sceneId === sceneId);
  return {
    scenes,
    rows: read.characters.map((character) => ({
      characterId: character.id,
      name: character.name,
      cells: scenes.map(({ sceneId }) => {
        const entry = character.wardrobe.find((w) => w.sceneId === sceneId);
        const appears = character.appearances.sceneIds.includes(sceneId);
        const missing = appears && !entry && (has("WARDROBE_MISSING", character.id, sceneId) || !character.baseOutfit);
        return {
          characterId: character.id, sceneId, appears,
          outfit: entry?.outfit ?? "", notes: entry?.notes ?? "",
          fallback: !entry && appears && character.baseOutfit ? character.baseOutfit : null,
          missing,
          mismatch: has("WARDROBE_PROMPT_MISMATCH", character.id, sceneId),
        };
      }),
    })),
  };
}

// ---- edits (PUT /characters) -------------------------------------------------------------------

/** The film's characters as PUT /characters takes them: every character, sheets left out (never written here). */
export function saveInput(read: CastRead): CastSaveInput {
  return {
    expectedHeadVersion: read.headVersion,
    characters: read.characters.map((c) => ({ id: c.id, name: c.name, identity: c.identity, ...(c.baseOutfit ? { baseOutfit: c.baseOutfit } : {}),
      wardrobe: c.wardrobe.map((w) => ({ sceneId: w.sceneId, outfit: w.outfit, ...(w.notes ? { notes: w.notes } : {}) })) })),
  };
}

/** One scene's outfit for one character; an empty outfit removes the entry (the base outfit is used). */
export function withOutfit(read: CastRead, characterId: string, sceneId: string, outfit: string, notes: string): CastSaveInput {
  const input = saveInput(read);
  const character = input.characters.find((c) => c.id === characterId);
  if (!character) return input;
  const rest = character.wardrobe.filter((w) => w.sceneId !== sceneId);
  const trimmed = outfit.trim();
  character.wardrobe = trimmed ? [...rest, { sceneId, outfit: trimmed, ...(notes.trim() ? { notes: notes.trim() } : {}) }] : rest;
  return input;
}

export interface CharacterDraft { name: string; identity: string; baseOutfit: string }

/** Add a character (id absent) or change one's name, identity and base outfit. */
export function withCharacter(read: CastRead, draft: CharacterDraft, characterId?: string): CastSaveInput {
  const input = saveInput(read);
  const fields = { name: draft.name.trim(), identity: draft.identity.trim(), baseOutfit: draft.baseOutfit.trim() || null };
  if (!characterId) {
    input.characters.push({ key: "new", ...fields, wardrobe: [] });
    return input;
  }
  input.characters = input.characters.map((c) => (c.id === characterId ? { ...c, ...fields } : c));
  return input;
}

/** Remove a character; the server takes it off every shot in the same save. */
export function withoutCharacter(read: CastRead, characterId: string): CastSaveInput {
  const input = saveInput(read);
  input.characters = input.characters.filter((c) => c.id !== characterId);
  return input;
}

/** A shot's cast, in reference order (the order shown). */
export function withCasting(read: CastRead, shotId: string, characterIds: string[]): CastSaveInput {
  return { ...saveInput(read), casting: [{ shotId, characterIds: read.characters.map((c) => c.id).filter((id) => characterIds.includes(id)) }] };
}

/** Why a character draft cannot be saved yet, or null. Names are unique, ignoring case (assertCharacterPlan). */
export function draftIssue(read: CastRead, draft: CharacterDraft, characterId?: string): Msg | null {
  if (!draft.name.trim()) return msg("cast.edit.need_name");
  if (!draft.identity.trim()) return msg("cast.edit.need_identity");
  const name = draft.name.trim().toLocaleLowerCase();
  if (read.characters.some((c) => c.id !== characterId && c.name.trim().toLocaleLowerCase() === name)) return msg("cast.edit.name_taken");
  return null;
}

// ---- the sheet and its approval -----------------------------------------------------------------

/** "Included in your Codex plan · $0", "About $0.04", or price unknown (never "$0.00"). */
export function sheetPrice(read: CastRead, locale: string): Msg {
  return priceMsg(read.sheetQuote, locale);
}

/**
 * What approving a take changes, said before the press: every cast shot is rebound to the sheet, the keyframes they
 * have go out of date (and the clips made from them), and nothing is made again until the person makes keyframes.
 */
export interface ApprovalImpact {
  shots: string[];
  keyframes: string[];
  clips: string[];
  /** Remaking those keyframes, at the film's keyframe price. */
  remake: Msg | null;
}

export function approvalImpact(character: CastCharacter, overview: GenerationOverview, locale: string): ApprovalImpact {
  const shots = character.appearances.shotIds.filter((id) => overview.shots[id]);
  const withKeyframe = shots.filter((id) => !!overview.shots[id]!.keyframe.artifact);
  const withClip = shots.filter((id) => overview.shots[id]!.video.state === "ready");
  const quote = withKeyframe.length ? keyframeEstimate(withKeyframe, overview) : null;
  return {
    shots: shots.map((id) => labelOf(overview, id)),
    keyframes: withKeyframe.map((id) => labelOf(overview, id)),
    clips: withClip.map((id) => labelOf(overview, id)),
    remake: quote ? priceMsg({ ...quote, units: 1, unitMicros: "0" }, locale) : null,
  };
}

/** After approval: the keyframes the server marked out of date, by shot label (from the changed shots it names). */
export function approvalOutcome(receipt: Pick<ApproveReceipt, "changedShotIds">, before: GenerationOverview): { changed: string[]; outdated: string[] } {
  const changed = receipt.changedShotIds.filter((id) => before.shots[id]);
  return { changed: changed.map((id) => labelOf(before, id)), outdated: changed.filter((id) => !!before.shots[id]!.keyframe.artifact).map((id) => labelOf(before, id)) };
}

// ---- the Keyframes check ------------------------------------------------------------------------

export interface CastCheck {
  characterId: string;
  name: string;
  /** Every shot of the character (the line counts them all), and those in this scene. */
  shots: number;
  sceneShots: string[];
  state: SheetState;
  title: Msg;
  body: Msg;
}

/**
 * A recurring character cast in this scene without an approved sheet (SHEET_REQUIRED, or an approved sheet not yet
 * bound / an earlier one still bound): Make keyframes would draw them without a reference. One check per character.
 */
export function castChecks(read: CastRead | null, overview: GenerationOverview, sceneId: string, locale: string): CastCheck[] {
  if (!read) return [];
  const scene = overview.scenes.find((s) => s.sceneId === sceneId);
  if (!scene) return [];
  return read.characters.flatMap((character) => {
    const sceneShots = character.appearances.shotIds.filter((id) => scene.shotIds.includes(id));
    if (!sceneShots.length || !character.needsSheet) return [];
    const unbound = read.issues.some((issue) => (issue.code === "SHEET_NOT_BOUND" || issue.code === "SHEET_STALE_BINDING") && issue.characterId === character.id && (!issue.shotId || sceneShots.includes(issue.shotId)));
    if (character.sheetState === "approved" && !unbound) return [];
    const shots = character.appearances.shotIds.length;
    const price = priceMsg(read.sheetQuote, locale);
    const title = character.sheetState === "outdated" ? msg("cast.check.outdated_title", { name: character.name })
      : character.sheetState === "approved" ? msg("cast.check.unbound_title", { name: character.name })
      : msg("cast.check.title", { name: character.name, count: shots });
    const body = character.sheetState === "review" ? msg("cast.check.review_body", { name: character.name })
      : character.sheetState === "pending" ? msg("cast.check.pending_body", { name: character.name })
      : character.sheetState === "outdated" ? msg("cast.check.outdated_body", { name: character.name })
      : character.sheetState === "approved" ? msg("cast.check.unbound_body")
      : { ...msg("cast.check.none_body", { name: character.name }), messages: { price } };
    return [{ characterId: character.id, name: character.name, shots, sceneShots: sceneShots.map((id) => labelOf(overview, id)), state: character.sheetState, title, body }];
  });
}
