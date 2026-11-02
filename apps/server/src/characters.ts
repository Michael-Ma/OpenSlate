import type { FastifyInstance } from "fastify";
import {
  assertCharacterPlan, bindCharacterReferences, canonical, characterAppearances, characterContinuityIssues, characterDirection,
  characterSheetPromptDigest, charactersNeedingSheets, digest, DomainError, invariant, newId, shotIntentDigest, withCharacterDirection,
} from "@openslate/core";
import type { ActorContext, CharacterRecord, CharacterWardrobe, PriceQuote, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { ProductionService, RequestRecord } from "./application/service.js";
import { assertDirectorGenerationAuthority } from "./application/director-generation-authority.js";
import { requiredCommandKey } from "./application/command-key.js";
import { characterSheetTakes, recordCharacterSheetTake, retiredSheetArtifactIds } from "./character-sheets.js";
import type { CharacterSheetTake } from "./character-sheets.js";
import { characterSheetQuote } from "./generation-quotes.js";
import type { QuoteLock } from "./generation-quotes.js";
import type { ArtifactRecord, Attempt, Candidate, NodeBinding } from "./execution/engine.js";
import {
  CHARACTER_SHEET_ADAPTERS, CHARACTER_SHEET_JOB_KIND, CHARACTER_SHEET_PLAN_ID, characterSheetNode, currentCharacterSheetPrompt, isCharacterSheetBinding,
} from "./execution/character-sheet-execution.js";
import type { CharacterSheetJob } from "./execution/character-sheet-execution.js";

/** Characters in plan order, with every shot's cast. Ids may be keys of characters created in the same change. */
export interface CharacterInput { id?: string; key?: string; name: string; identity: string; baseOutfit?: string | null; wardrobe: CharacterWardrobe[] }
export interface CastingInput { shotId: string; characterIds: string[] }
export interface SaveCharactersInput { expectedHeadVersion: number; characters: CharacterInput[]; casting?: CastingInput[] }
export interface GenerateSheetsInput { characterIds: string[]; regenerate?: boolean; expectedHeadVersion?: number; expectedEstimateMicros?: string }
export type SheetJobState = "queued" | "running" | "failed" | "stopped" | "done";
export type SheetState = "none" | "pending" | "review" | "approved" | "outdated";

type Lock = QuoteLock & { projectId: string };
const lockOf = (production: ProductionService, project: ProjectRecord): Lock => {
  const lock = production.store.get<Lock>("capability_lock", project.capabilityLockId);
  invariant(lock?.projectId === project.id, "PROFILE_INCOMPATIBLE", "The film's model selection is unavailable");
  return lock;
};
/** Same selection rule as keyframe quotes: the preferred image profile, else the first image profile. */
function imageProfile(lock: QuoteLock): ProviderProfile | undefined {
  const id = lock.preferredProfileIds?.image;
  return id ? lock.profiles.find(p => p.id === id && p.kind === "image") : lock.profiles.find(p => p.kind === "image");
}

function sheetJobs(production: ProductionService, projectId: string, characterId?: string): { binding: NodeBinding; state: SheetJobState; attemptId: string | null }[] {
  const attempts = production.engine.attempts(projectId) as Attempt[];
  return production.store.list<NodeBinding>("node_binding", projectId)
    .filter(binding => binding.state === "active" && isCharacterSheetBinding(binding) && (!characterId || binding.node.characterId === characterId))
    .map(binding => {
      const latest = attempts.filter(a => a.nodeId === binding.id && !a.released).sort((a, b) => b.ordinal - a.ordinal)[0];
      // An attempt sent before Stop still finishes and becomes a take, so it stays "running" until it ends.
      const state: SheetJobState = Object.keys(binding.outputs).length || latest?.phase === "succeeded" ? "done"
        : latest && latest.phase !== "failed" ? "running" : binding.candidateId === null ? "stopped" : !latest ? "queued" : "failed";
      return { binding, state, attemptId: latest?.id ?? null };
    });
}
const pending = (state: SheetJobState): boolean => state === "queued" || state === "running";

/** Read model for Plan › Cast and the Director: characters, appearances, sheet takes and state, issues and the sheet price. */
export function characterView(production: ProductionService, projectId: string) {
  const store = production.store, project = store.getProject(projectId), lock = lockOf(production, project), profile = imageProfile(lock);
  const takes = characterSheetTakes(store, projectId), seen = characterAppearances(project);
  const recurring = new Set(charactersNeedingSheets(project).map(character => character.id));
  const jobs = sheetJobs(production, projectId);
  return {
    projectId, headVersion: project.headVersion, revisionId: project.revisionId,
    imageProfile: profile ? { id: profile.id, adapter: profile.adapter } : null,
    sheetSupported: !!profile && CHARACTER_SHEET_ADAPTERS.includes(profile.adapter),
    canvas: { aspect: "1:1" as const, width: 1024, height: 1024 },
    sheetQuote: characterSheetQuote(lock, 1),
    characters: (project.characters ?? []).map(character => {
      const prompt = currentCharacterSheetPrompt(character), promptDigest = characterSheetPromptDigest(prompt);
      const own = takes.filter(take => take.characterId === character.id);
      const job = jobs.filter(item => item.binding.node.characterId === character.id && item.state !== "done")
        .sort((a, b) => (pending(b.state) ? 1 : 0) - (pending(a.state) ? 1 : 0))[0];
      const sheetState: SheetState = job && pending(job.state) ? "pending"
        : character.sheet ? (character.sheet.promptDigest === promptDigest ? "approved" : "outdated")
        : own.length ? "review" : "none";
      return { ...character, appearances: seen.get(character.id)!, needsSheet: recurring.has(character.id), sheetPrompt: prompt, sheetPromptDigest: promptDigest, sheetState,
        takes: own.map(take => ({ takeId: take.id, artifact: take.artifact, source: take.attemptId ? "generated" as const : "imported" as const,
          promptDigest: take.promptDigest, createdAt: take.createdAt,
          approved: !!character.sheet && character.sheet.artifactId === take.artifact.artifactId && character.sheet.sha256 === take.artifact.sha256,
          outdated: take.promptDigest !== promptDigest })),
        job: job ? { nodeId: job.binding.id, state: job.state, attemptId: job.attemptId } : null };
    }),
    casting: project.shots.map(shot => ({ shotId: shot.id, sceneId: shot.sceneId, characterIds: shot.characterIds ?? [] })),
    issues: characterContinuityIssues(project, retiredSheetArtifactIds(project, takes)),
  };
}

/** Whether a shot's keyframe or clip is current, retained or being made: changing its direction then needs a proposal. */
function shotsWithMedia(production: ProductionService, project: ProjectRecord): Set<string> {
  const attempts = production.engine.attempts(project.id) as Attempt[], shots = new Set<string>();
  for (const binding of production.store.list<NodeBinding>("node_binding", project.id)) {
    if (binding.state !== "active" || binding.planId !== project.activePlanId || !binding.node.shotId || !["image", "video"].includes(binding.node.kind)) continue;
    const running = attempts.some(a => a.nodeId === binding.id && a.candidateId === binding.candidateId && !a.released && !["failed", "succeeded"].includes(a.phase));
    if (running || Object.keys({ ...binding.retainedTake?.outputs, ...binding.outputs }).length) shots.add(binding.node.shotId);
  }
  return shots;
}

export interface CharacterPublication { project: ProjectRecord; changedShotIds: string[]; outdatedNodeIds: string[] }
/**
 * The one character write path. In a single revision: validate, bind approved sheets into every cast shot, rewrite the
 * app-owned "Characters in this shot" block, and mark the affected keyframes (and their dependents) out of date.
 * Nothing is regenerated: detached bindings carry no candidate, so no work can start from this command.
 */
export function publishCharacters(production: ProductionService, projectId: string, before: ProjectRecord, characters: CharacterRecord[],
  casting: Map<string, string[]> | null, reason: string, options: { refuseShotsWithMedia?: boolean } = {}): CharacterPublication {
  const store = production.store;
  const next: ProjectRecord = structuredClone(before);
  next.characters = structuredClone(characters);
  const kept = new Set(characters.map(character => character.id));
  for (const shot of next.shots) {
    const cast = casting?.get(shot.id) ?? shot.characterIds;
    if (cast !== undefined) shot.characterIds = cast.filter(id => kept.has(id));
  }
  // Approved sheets become project references so the planning compiler can bind them like any registered asset.
  for (const character of next.characters) if (character.sheet && !next.artifacts.some(a => a.artifactId === character.sheet!.artifactId)) {
    const record = store.get<ArtifactRecord>("artifact", character.sheet.artifactId);
    invariant(record?.projectId === projectId && record.artifact.sha256 === character.sheet.sha256, "CHARACTER_SHEET_INVALID", "The approved sheet image is unavailable");
    next.artifacts.push({ ...record.artifact });
  }
  assertCharacterPlan(next);
  const retired = retiredSheetArtifactIds(next, characterSheetTakes(store, projectId));
  const changed = new Set<string>();
  for (const shot of next.shots) {
    const binding = bindCharacterReferences(next, shot, retired);
    const prompt = withCharacterDirection(shot.imagePrompt, characterDirection(next, shot, binding));
    if (canonical(binding.referenceArtifactIds) === canonical(shot.referenceArtifactIds) && prompt === shot.imagePrompt) continue;
    shot.referenceArtifactIds = binding.referenceArtifactIds; shot.imagePrompt = prompt; shot.revisionId = newId();
    const cue = shot.cueId ? next.cues.find(item => item.id === shot.cueId) : undefined;
    shot.promptIntent = { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) };
    changed.add(shot.id);
  }
  if (options.refuseShotsWithMedia) {
    const media = shotsWithMedia(production, before), blocked = [...changed].filter(id => media.has(id));
    if (blocked.length) throw new DomainError("PROPOSAL_REQUIRED", "These shots already have keyframes or clips. Propose this change for the person to accept.", { shotIds: blocked });
  }
  // Keyframes and clips of changed shots, then everything that consumes them (storyboard edit rule).
  const bindings = store.list<NodeBinding>("node_binding", projectId).filter(b => b.state === "active" && b.planId === before.activePlanId);
  const affected = new Set(bindings.filter(b => b.node.shotId && changed.has(b.node.shotId) && ["image", "video"].includes(b.node.kind)).map(b => b.id));
  for (let grew = true; grew;) {
    grew = false;
    for (const b of bindings) if (!affected.has(b.id) && (b.node.inputs.some(i => i.source.kind === "output" && affected.has(i.source.nodeId)) || b.node.requires.some(id => affected.has(id)))) {
      affected.add(b.id); grew = true;
    }
  }
  const at = new Date().toISOString();
  for (const b of bindings.filter(b => affected.has(b.id))) {
    const { retainedTake, ...detached } = b;
    const previous = Object.values(retainedTake?.outputs ?? b.outputs)[0] ?? b.outdated?.previous;
    store.put("node_binding", b.id, projectId, { ...detached, candidateId: null, outputs: {},
      ...(previous ? { outdated: { at, fields: [...new Set([...(b.outdated?.fields ?? []), "characters"])], previous } } : {}) });
  }
  const saved = store.saveProject({ ...next, revisionId: newId() }, before.headVersion);
  store.insert("project_revision", saved.revisionId, projectId, { project: saved });
  store.appendEvent(projectId, "characters.changed", { reason, headVersion: saved.headVersion, changedShotIds: [...changed], outdatedNodeIds: [...affected] });
  return { project: saved, changedShotIds: [...changed], outdatedNodeIds: [...affected] };
}

const humanEdit = (production: ProductionService, projectId: string, text: string, key: string): ActorContext =>
  production.beginRequest(projectId, "local-user", text, { source: "app", key, editing: true, concurrency: "alongside", holdScopeIds: [], scopeIds: [projectId] });

/** Turn edited characters into saved records. Sheets are never written here; an existing character keeps its approval. */
export function characterRecords(before: ProjectRecord, inputs: CharacterInput[], options: { allowNew: boolean }): { characters: CharacterRecord[]; keys: Map<string, string> } {
  invariant(Array.isArray(inputs), "VALIDATION_ERROR", "Send the film's characters as a list");
  const existing = new Map((before.characters ?? []).map(character => [character.id, character])), keys = new Map<string, string>();
  const characters = inputs.map(input => {
    const old = input.id ? existing.get(input.id) : undefined;
    invariant(!input.id || old, "NOT_FOUND", "A character no longer belongs to this film");
    invariant(old || options.allowNew, "VALIDATION_ERROR", "Name an existing character");
    const draft = { name: input.name, identity: input.identity, ...(input.baseOutfit ? { baseOutfit: input.baseOutfit } : {}),
      wardrobe: (input.wardrobe ?? []).map(w => ({ sceneId: w.sceneId, outfit: w.outfit, ...(w.notes !== undefined ? { notes: w.notes } : {}) })) };
    const id = old?.id ?? newId();
    if (!old && input.key) { invariant(!keys.has(input.key), "VALIDATION_ERROR", "Character keys must be unique"); keys.set(input.key, id); }
    const same = old && canonical({ name: old.name, identity: old.identity, ...(old.baseOutfit ? { baseOutfit: old.baseOutfit } : {}), wardrobe: old.wardrobe }) === canonical(draft);
    return { id, revisionId: same ? old!.revisionId : newId(), ...draft, sheet: old?.sheet ?? null } as CharacterRecord;
  });
  return { characters, keys };
}

/** PUT: the person's own Plan › Cast edit. Direct, like a storyboard edit; affected keyframes go out of date. */
export function saveCharacters(production: ProductionService, projectId: string, input: SaveCharactersInput, key: string) {
  production.recovery.assertWritable(projectId);
  return production.store.command(`local-user:${projectId}:characters`, key, digest(input), () => {
    const before = production.store.getProject(projectId);
    invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "The film changed; reload before saving characters.");
    const { characters, keys } = characterRecords(before, input.characters, { allowNew: true });
    const casting = input.casting ? new Map<string, string[]>() : null;
    for (const row of input.casting ?? []) {
      invariant(before.shots.some(shot => shot.id === row.shotId), "NOT_FOUND", "A cast shot no longer belongs to this film");
      invariant(!casting!.has(row.shotId), "VALIDATION_ERROR", "Cast each shot once");
      casting!.set(row.shotId, row.characterIds.map(id => keys.get(id) ?? id));
    }
    for (const ids of casting?.values() ?? []) for (const id of ids) invariant(characters.some(c => c.id === id), "SCOPE_DENIED", "Shot names an unknown character");
    const actor = humanEdit(production, projectId, "Edit the film's characters and casting. Preserve unaffected work.", `characters:${key}`);
    const published = publishCharacters(production, projectId, before, characters, casting, "edit");
    return { headVersion: published.project.headVersion, revisionId: published.project.revisionId, requestId: actor.requestId,
      characterIds: characters.map(c => c.id), keys: Object.fromEntries(keys), changedShotIds: published.changedShotIds, outdatedNodeIds: published.outdatedNodeIds };
  });
}

/**
 * Approve one take as the character's sheet. In the same revision every cast shot is rebound to it and its character
 * block rewritten; their keyframes go out of date and wait for Make keyframes. A human action only.
 */
export function approveCharacterSheet(production: ProductionService, projectId: string, characterId: string,
  input: { expectedHeadVersion: number; takeId: string }, key: string) {
  production.recovery.assertWritable(projectId);
  return production.store.command(`local-user:${projectId}:character-sheet-approve`, key, digest({ characterId, ...input }), () => {
    const before = production.store.getProject(projectId);
    invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "The film changed; review the sheet again before approving.");
    const character = (before.characters ?? []).find(item => item.id === characterId);
    invariant(character, "NOT_FOUND", "This character is no longer in the film");
    const take = characterSheetTakes(production.store, projectId).find(item => item.id === input.takeId);
    invariant(take && take.characterId === characterId, "NOT_FOUND", "This sheet take does not belong to this character");
    invariant(!(character.sheet?.artifactId === take.artifact.artifactId && character.sheet.sha256 === take.artifact.sha256),
      "CHARACTER_SHEET_ALREADY_APPROVED", "This take is already the approved sheet");
    production.engine.verifyArtifact(projectId, take.artifact);
    const actor = humanEdit(production, projectId, `Approve ${character.name}'s character sheet and use it for every keyframe of ${character.name}.`, `character-sheet-approve:${key}`);
    const characters = (before.characters ?? []).map(item => item.id !== characterId ? item : { ...item, revisionId: newId(),
      sheet: { artifactId: take.artifact.artifactId, sha256: take.artifact.sha256, promptDigest: take.promptDigest, approvedAt: new Date().toISOString() } });
    const published = publishCharacters(production, projectId, before, characters, null, "approve_sheet");
    return { headVersion: published.project.headVersion, revisionId: published.project.revisionId, requestId: actor.requestId, characterId, takeId: take.id,
      sheet: characters.find(item => item.id === characterId)!.sheet, changedShotIds: published.changedShotIds, outdatedNodeIds: published.outdatedNodeIds };
  });
}

/** Use an image the person already uploaded (Assets › Upload) as a sheet take. Approval stays a separate step. */
export function importCharacterSheet(production: ProductionService, projectId: string, characterId: string,
  input: { artifactId: string; sha256: string }, key: string) {
  production.recovery.assertWritable(projectId);
  return production.store.command(`local-user:${projectId}:character-sheet-import`, key, digest({ characterId, ...input }), () => {
    const project = production.store.getProject(projectId);
    const character = (project.characters ?? []).find(item => item.id === characterId);
    invariant(character, "NOT_FOUND", "This character is no longer in the film");
    const record = production.store.get<ArtifactRecord>("artifact", input.artifactId);
    invariant(record?.projectId === projectId && record.origin === "supplied_image" && record.fixture === false && record.artifact.sha256 === input.sha256,
      "CHARACTER_SHEET_INVALID", "Choose an image uploaded to this film");
    invariant(!characterSheetTakes(production.store, projectId).some(take => take.characterId === characterId && take.artifact.artifactId === record.id),
      "CHARACTER_SHEET_EXISTS", "This image is already one of the character's sheets");
    production.engine.verifyArtifact(projectId, record.artifact);
    const take: CharacterSheetTake = recordCharacterSheetTake(production.store, { id: newId(), projectId, characterId, artifact: record.artifact,
      prompt: currentCharacterSheetPrompt(character), attemptId: null });
    production.store.appendEvent(projectId, "character_sheet.take_recorded", { characterId, takeId: take.id, source: "imported" });
    return { characterId, takeId: take.id, artifact: take.artifact, promptDigest: take.promptDigest };
  });
}

export interface SheetGenerationReceipt { projectId: string; requestId: string; quote: PriceQuote; started: { characterId: string; nodeId: string; takeId: string; prompt: string }[] }
/**
 * Start one sheet take per named character: a fresh human grant, one candidate, one image node that no shot owns.
 * A person confirms the quoted price; a Director may only spend its own fresh human editing request.
 */
export function generateCharacterSheets(production: ProductionService, projectId: string, input: GenerateSheetsInput, key: string,
  options: { directorActor?: ActorContext } = {}): SheetGenerationReceipt {
  const director = options.directorActor, store = production.store;
  production.recovery.assertWritable(projectId);
  if (director) assertDirectorGenerationAuthority(production, projectId, director);
  const scope = director ? `${director.principalId}:${projectId}:${director.requestId}:character-sheets` : `local-user:${projectId}:character-sheets`;
  return store.command(scope, key, digest(input), () => {
    const human = director ? assertDirectorGenerationAuthority(production, projectId, director) : undefined;
    const project = store.getProject(projectId), lock = lockOf(production, project), profile = imageProfile(lock);
    invariant(Array.isArray(input.characterIds) && input.characterIds.length > 0 && input.characterIds.length <= 32
      && new Set(input.characterIds).size === input.characterIds.length, "VALIDATION_ERROR", "Name one to 32 different characters");
    invariant(input.expectedHeadVersion === undefined || input.expectedHeadVersion === project.headVersion, "REVISION_CONFLICT", "The film changed; review the sheet before making it.");
    invariant(!project.archived, "PROJECT_ARCHIVED", "Restore this film before making new work");
    invariant(!store.get<{ paused: boolean }>("execution_control", projectId)?.paused, "EXECUTION_PAUSED", "The film is stopped. Continue before starting new generation.");
    invariant(profile && CHARACTER_SHEET_ADAPTERS.includes(profile.adapter), "CHARACTER_SHEET_PROFILE_UNSUPPORTED",
      "Character sheets need the Codex image model. Choose it in Settings before making sheets.");
    const takes = characterSheetTakes(store, projectId), appearances = characterAppearances(project);
    const characters = input.characterIds.map(id => {
      const character = (project.characters ?? []).find(item => item.id === id);
      invariant(character, "NOT_FOUND", "A named character is no longer in the film");
      invariant(!sheetJobs(production, projectId, id).some(job => pending(job.state)), "ATTEMPT_EXISTS", `${character.name}'s sheet is already being made`);
      invariant(input.regenerate === true || !takes.some(take => take.characterId === id), "CHARACTER_SHEET_EXISTS",
        `${character.name} already has a sheet. Choose "Make another" to add a new take.`);
      if (director) {
        const request = store.get<RequestRecord>("message", director.requestId)!, seen = appearances.get(id)!;
        invariant(request.scopeIds.includes(projectId) || [...seen.shotIds, ...seen.sceneIds].some(scopeId => request.scopeIds.includes(scopeId)),
          "SCOPE_DENIED", "This sheet is outside the conversation's scope");
      }
      return character;
    });
    const quote = characterSheetQuote(lock, characters.length);
    invariant(input.expectedEstimateMicros === undefined || input.expectedEstimateMicros === quote.micros, "ESTIMATE_CHANGED",
      "The price changed. Review the current price before making sheets.");
    invariant(director || input.expectedEstimateMicros !== undefined, "VALIDATION_ERROR", "Confirm the reviewed price before making sheets");
    const actor = human ?? production.beginRequest(projectId, "local-user",
      `${input.regenerate ? "Make another" : "Make a"} character sheet for ${characters.map(c => c.name).join(", ")}.`,
      { source: "app", key: `character-sheets:${key}`, editing: true, concurrency: "alongside", holdScopeIds: [], scopeIds: [projectId] });
    // A sheet is project-scoped. Like a scene press, narrow a whole-film editing hold to the film's scenes so the
    // sheet can run while every shot stays held (a Director only narrows its own request's hold).
    for (const hold of store.list<{ id: string; scopeId: string; ownerId: string; active: boolean }>("hold", projectId)
      .filter(h => h.active && h.scopeId === projectId && (!director || h.ownerId === director.requestId))) {
      production.engine.releaseHold(projectId, hold.id, hold.ownerId);
      for (const scene of project.scenes) production.engine.setHold(projectId, { scopeId: scene.id, ownerId: hold.ownerId });
    }
    const started: SheetGenerationReceipt["started"] = [], now = new Date().toISOString();
    for (const character of characters) {
      // Earlier finished, failed or stopped jobs of this character leave execution; their takes stay in history.
      for (const job of sheetJobs(production, projectId, character.id)) store.put("node_binding", job.binding.id, projectId, { ...job.binding, state: "retired" });
      const node = characterSheetNode(newId(), character, profile);
      const grant = production.engine.createGrant(projectId, projectId, "image", actor.requestId, "user_change");
      const candidate = store.insert<Omit<Candidate, "id" | "projectId">>("candidate", newId(), projectId, { nodeId: node.id, grantId: grant.id, origin: grant.origin }) as unknown as Candidate;
      store.insert<CharacterSheetJob>(CHARACTER_SHEET_JOB_KIND, node.id, projectId, { id: node.id, projectId, characterId: character.id, node, requestId: actor.requestId,
        regenerate: input.regenerate === true, createdAt: now });
      store.put<NodeBinding>("node_binding", node.id, projectId, { id: node.id, projectId, planId: CHARACTER_SHEET_PLAN_ID, node, candidateId: candidate.id, state: "active", outputs: {} });
      store.appendEvent(projectId, "character_sheet.requested", { characterId: character.id, nodeId: node.id, requestId: actor.requestId });
      started.push({ characterId: character.id, nodeId: node.id, takeId: node.id, prompt: String(node.args.prompt) });
    }
    return { projectId, requestId: actor.requestId, quote, started };
  });
}

const text = { type: "string", minLength: 1, maxLength: 160 };
const wardrobeSchema = { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, required: ["sceneId", "outfit"],
  properties: { sceneId: text, outfit: { type: "string", minLength: 1, maxLength: 600 }, notes: { type: "string", maxLength: 300 } } } };
export const characterInputSchema = { type: "object", additionalProperties: false, required: ["name", "identity", "wardrobe"], properties: {
  id: text, key: text, name: { type: "string", minLength: 1, maxLength: 80 }, identity: { type: "string", minLength: 1, maxLength: 1200 },
  baseOutfit: { type: ["string", "null"], maxLength: 600 }, wardrobe: wardrobeSchema } };
export const castingSchema = { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, required: ["shotId", "characterIds"],
  properties: { shotId: text, characterIds: { type: "array", maxItems: 32, uniqueItems: true, items: text } } } };

/** Plan › Cast routes. Generation, import and approval are explicit person actions with their own command keys. */
export function registerCharacters(app: FastifyInstance, service: () => ProductionService): void {
  type P = { projectId: string }; type C = P & { characterId: string };
  app.get<{ Params: P }>("/api/projects/:projectId/characters", async request => characterView(service(), request.params.projectId));
  app.put<{ Params: P; Body: SaveCharactersInput }>("/api/projects/:projectId/characters", {
    schema: { body: { type: "object", additionalProperties: false, required: ["expectedHeadVersion", "characters"], properties: {
      expectedHeadVersion: { type: "integer", minimum: 0 }, characters: { type: "array", maxItems: 32, items: characterInputSchema }, casting: castingSchema } } },
  }, async request => saveCharacters(service(), request.params.projectId, request.body, requiredCommandKey(request)));
  app.post<{ Params: C; Body: { expectedHeadVersion: number; expectedEstimateMicros: string; regenerate?: boolean } }>("/api/projects/:projectId/characters/:characterId/sheet/generate", {
    schema: { body: { type: "object", additionalProperties: false, required: ["expectedHeadVersion", "expectedEstimateMicros"], properties: {
      expectedHeadVersion: { type: "integer", minimum: 0 }, expectedEstimateMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 32 }, regenerate: { type: "boolean" } } } },
  }, async request => {
    const { projectId, characterId } = request.params;
    return generateCharacterSheets(service(), projectId, { characterIds: [characterId], ...request.body }, requiredCommandKey(request));
  });
  app.post<{ Params: C; Body: { artifactId: string; sha256: string } }>("/api/projects/:projectId/characters/:characterId/sheet/import", {
    schema: { body: { type: "object", additionalProperties: false, required: ["artifactId", "sha256"], properties: { artifactId: text, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } } } },
  }, async request => importCharacterSheet(service(), request.params.projectId, request.params.characterId, request.body, requiredCommandKey(request)));
  app.post<{ Params: C; Body: { expectedHeadVersion: number; takeId: string } }>("/api/projects/:projectId/characters/:characterId/sheet/approve", {
    schema: { body: { type: "object", additionalProperties: false, required: ["expectedHeadVersion", "takeId"], properties: { expectedHeadVersion: { type: "integer", minimum: 0 }, takeId: text } } },
  }, async request => approveCharacterSheet(service(), request.params.projectId, request.params.characterId, request.body, requiredCommandKey(request)));
}

