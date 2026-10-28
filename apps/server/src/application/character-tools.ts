import { canonical, digest, invariant } from "@openslate/core";
import type { ActorContext, CharacterRecord, CharacterWardrobe, JsonValue } from "@openslate/core";
import type { ProductionService, RequestRecord } from "./service.js";
import { characterRecords, characterView, generateCharacterSheets, publishCharacters } from "../characters.js";
import type { CharacterInput } from "../characters.js";

/**
 * Director handlers for characters (tool contract 7.0.0). Each receives the same context the dispatcher gives other
 * tools: the production service, the project, the calling Director epoch and the transport invocation identity.
 * Approving a sheet is never a Director call: the Director offers an approve_character_sheet note choice and a person acts.
 */
export interface CharacterToolContext {
  service: ProductionService;
  projectId: string;
  actor: ActorContext;
  /** The tool invocation id; it keys the domain command so a replayed call never repeats its effect. */
  invocationId: string;
  signal?: AbortSignal;
}
export interface CharacterChangeInput {
  createCharacters?: Array<{ key: string; name: string; identity: string; baseOutfit?: string; wardrobe?: CharacterWardrobe[] }>;
  updateCharacters?: Array<{ id: string; name?: string; identity?: string; baseOutfit?: string | null; setWardrobe?: CharacterWardrobe[]; clearWardrobe?: string[] }>;
  deleteCharacterIds?: string[];
  /** Each shot's complete cast, in reference order. Ids may be keys from createCharacters. */
  casting?: Array<{ shotId: string; characterIds: string[] }>;
}
export interface MakeCharacterSheetsInput { characterIds: string[]; regenerate?: boolean }

const director = (ctx: CharacterToolContext): Extract<ActorContext, { kind: "director" }> => {
  invariant(ctx.actor.kind === "director", "ACTOR_DENIED", "A director epoch is required");
  invariant(!ctx.signal?.aborted, "TOOL_CALL_CANCELLED", "Tool invocation was cancelled");
  return ctx.actor;
};

/** read_context-style projection: characters, appearances, wardrobe, sheet state and takes, continuity issues, sheet price. */
export function readCharacters(ctx: CharacterToolContext): JsonValue {
  ctx.service.assertActor(ctx.projectId, director(ctx));
  const view = characterView(ctx.service, ctx.projectId);
  return JSON.parse(canonical({ ...view, next: "A person approves sheets: offer approve_character_sheet or regenerate_character_sheet note choices. Never approve a sheet yourself." })) as JsonValue;
}

/**
 * Create, edit or delete characters and set shot casting. The application rewrites each affected shot's character block
 * and sheet references. Shots that already have keyframes or clips refuse with PROPOSAL_REQUIRED; nothing is regenerated.
 */
export function applyCharacterChange(ctx: CharacterToolContext, input: CharacterChangeInput): JsonValue {
  const actor = director(ctx), { service, projectId } = ctx, store = service.store;
  service.assertActor(projectId, actor, true);
  return store.command(`${actor.principalId}:${projectId}:${actor.requestId}:characters`, `director-tool:${ctx.invocationId}`, digest(input), () => {
    service.assertActor(projectId, actor, true);
    const before = store.getProject(projectId), request = store.get<RequestRecord>("message", actor.requestId)!;
    invariant(request.editing, "ORIGIN_NOT_AUTHORIZED", "Only an editing conversation may change characters");
    const filmScope = request.scopeIds.includes(projectId);
    const touchesCharacters = !!(input.createCharacters?.length || input.updateCharacters?.length || input.deleteCharacterIds?.length);
    invariant(!touchesCharacters || filmScope, "SCOPE_DENIED", "Characters belong to the whole film; this conversation is scoped to part of it");
    const existing = before.characters ?? [], deleted = new Set(input.deleteCharacterIds ?? []);
    for (const id of deleted) invariant(existing.some(c => c.id === id), "NOT_FOUND", "A character to delete is no longer in the film");
    const updates = new Map((input.updateCharacters ?? []).map(update => [update.id, update]));
    invariant(updates.size === (input.updateCharacters ?? []).length, "VALIDATION_ERROR", "Update each character once");
    for (const id of updates.keys()) invariant(existing.some(c => c.id === id) && !deleted.has(id), "NOT_FOUND", "A character to update is no longer in the film");
    const inputs: CharacterInput[] = existing.filter(c => !deleted.has(c.id)).map((c: CharacterRecord): CharacterInput => {
      const update = updates.get(c.id), clear = new Set(update?.clearWardrobe ?? []), set = new Map((update?.setWardrobe ?? []).map(w => [w.sceneId, w]));
      const wardrobe = c.wardrobe.filter(w => !clear.has(w.sceneId) && !set.has(w.sceneId)).concat([...set.values()]);
      const baseOutfit = update && "baseOutfit" in update ? update.baseOutfit : c.baseOutfit;
      return { id: c.id, name: update?.name ?? c.name, identity: update?.identity ?? c.identity, ...(baseOutfit ? { baseOutfit } : {}), wardrobe };
    }).concat((input.createCharacters ?? []).map((c): CharacterInput => ({ key: c.key, name: c.name, identity: c.identity, ...(c.baseOutfit ? { baseOutfit: c.baseOutfit } : {}), wardrobe: c.wardrobe ?? [] })));
    const { characters, keys } = characterRecords(before, inputs, { allowNew: true });
    const casting = input.casting ? new Map<string, string[]>() : null;
    for (const row of input.casting ?? []) {
      const shot = before.shots.find(item => item.id === row.shotId);
      invariant(shot, "NOT_FOUND", "A cast shot no longer belongs to this film");
      invariant(filmScope || request.scopeIds.includes(shot.id) || request.scopeIds.includes(shot.sceneId), "SCOPE_DENIED", "Casting exceeds this conversation's scope");
      invariant(!casting!.has(row.shotId), "VALIDATION_ERROR", "Cast each shot once");
      casting!.set(row.shotId, row.characterIds.map(id => keys.get(id) ?? id));
    }
    for (const ids of casting?.values() ?? []) for (const id of ids)
      invariant(characters.some(c => c.id === id), "SCOPE_DENIED", "Casting names an unknown character");
    const published = publishCharacters(service, projectId, before, characters, casting, "director_change", { refuseShotsWithMedia: true });
    return { headVersion: published.project.headVersion, revisionId: published.project.revisionId, keys: Object.fromEntries(keys),
      characterIds: characters.map(c => c.id), changedShotIds: published.changedShotIds,
      next: "Saved. The cast shots were rewritten. Read the characters again to see who still needs a sheet." };
  }) as JsonValue;
}

/** Start sheet takes for exactly the named characters. Same authority as make_keyframes: a fresh human editing request. */
export function makeCharacterSheets(ctx: CharacterToolContext, input: MakeCharacterSheetsInput): JsonValue {
  const actor = director(ctx);
  const receipt = generateCharacterSheets(ctx.service, ctx.projectId, { characterIds: input.characterIds, ...(input.regenerate ? { regenerate: true } : {}) },
    `director-tool:${ctx.invocationId}`, { directorActor: actor });
  return JSON.parse(canonical({ ...receipt,
    next: "Sheet takes were started. When a take returns, offer approve_character_sheet and regenerate_character_sheet note choices; a person approves in chat or Plan › Cast." })) as JsonValue;
}
