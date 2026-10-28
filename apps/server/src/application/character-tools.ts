import { DomainError } from "@openslate/core";
import type { ActorContext, JsonValue } from "@openslate/core";
import type { ProductionService } from "./service.js";

/**
 * Character tool seam for contract 7.0.0. The catalog schemas and dispatch live with the Director tools; the
 * character-sheet execution work replaces these bodies. Until then every call is a typed refusal.
 */
export interface CharacterToolContext { service: ProductionService; projectId: string; actor: ActorContext; invocationId: string; signal?: AbortSignal }
type Wardrobe = { sceneId: string; outfit: string; notes?: string };
export interface CharacterChangeInput {
  createCharacters?: Array<{ key: string; name: string; identity: string; baseOutfit?: string; wardrobe?: Wardrobe[] }>;
  updateCharacters?: Array<{ id: string; name?: string; identity?: string; baseOutfit?: string | null; setWardrobe?: Wardrobe[]; clearWardrobe?: string[] }>;
  deleteCharacterIds?: string[];
  /** characterIds may name keys from createCharacters. */
  casting?: Array<{ shotId: string; characterIds: string[] }>;
}
export interface MakeCharacterSheetsInput { characterIds: string[]; regenerate?: boolean }

function unavailable(): never {
  throw new DomainError("CHARACTERS_UNAVAILABLE", "Character planning is not available on this server yet. Saved work is unchanged.");
}
export function readCharacters(_ctx: CharacterToolContext): JsonValue { return unavailable(); }
export function applyCharacterChange(_ctx: CharacterToolContext, _input: CharacterChangeInput): JsonValue { return unavailable(); }
export function makeCharacterSheets(_ctx: CharacterToolContext, _input: MakeCharacterSheetsInput): JsonValue { return unavailable(); }
