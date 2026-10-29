import { Ajv } from "ajv";
import { digest, invariant, newId } from "../common.js";
import { filmKindInputSchema, LEGACY_FILM_KIND_VALUES, normalizeFilmKind, parseFilmKind } from "../film-kind.js";
import type { FilmKindInput, LegacyFilmKindValue } from "../film-kind.js";
import type { CompiledPlan, CueRecord, ProjectRecord, ShotRecord, VisualStyle } from "../contracts.js";
import { shotVideoTiming } from '../video-timing.js';

export const STAGES = ["intake", "story", "scene_plan", "shot_plan", "narration", "storyboard", "video", "assembly", "review"] as const;
export type StageId = typeof STAGES[number];
export const RECIPE = Object.freeze({ id: "narrated-video", version: "1", stages: STAGES });
export const RECIPE_DIGEST = digest(RECIPE);
export const STAGE_CONTRACTS = Object.fromEntries(STAGES.map(stageId => [stageId, Object.freeze({
  stageId, version: "1", schemaVersion: "1", checkVersion: "1",
  promptRef: `production/${stageId}@1`,
  instructions: `Propose scoped ${stageId} work from saved project evidence. Report missing requirements. Human decisions remain pending until a human responds.`,
})]));
export const STAGE_CONTRACTS_DIGEST = digest(STAGE_CONTRACTS);

export interface StageProposal {
  stageId: StageId;
  scopeId: string;
  reason: string;
  gaps?: Array<{ key: string; message: string }>;
}

export interface ShotDraft {
  narration?: NonNullable<ShotRecord['narration']>;
  key: string;
  sceneId: string;
  purpose: string;
  action: string;
  framing: string;
  motion: string;
  desiredFrames: number;
  imagePrompt: string;
  videoPrompt: string;
  referenceArtifactIds: string[];
  cueId: string | null;
  /** 7.0.0: an existing shot ID, or the key of a shot created earlier in this patch, in the same scene. */
  beforeId?: string;
}

export interface ShotUpdate {
  /** 7.0.0 casting; applied by the character tools, never by applyCreativePatch. */
  characterIds?: string[];
  narration?: NonNullable<ShotRecord['narration']>;
  id: string;
  purpose?: string;
  action?: string;
  framing?: string;
  motion?: string;
  desiredFrames?: number;
  imagePrompt?: string;
  videoPrompt?: string;
  reauthorPrompts?: boolean;
}

/** Contract 7.0.0 project fields. A visual style's revisionId is issued by the application. */
export interface ProjectPatch {
  /** The whole structured record (film-kind@1). A pre-structure string is accepted only from held 7.0.0 proposals. */
  filmKind?: FilmKindInput | LegacyFilmKindValue;
  visualStyle?: Omit<VisualStyle, "revisionId"> | null;
}

/** Contract 7.0.0 character fields. They are applied by the character tools, never by applyCreativePatch. */
export interface CharacterPatchFields {
  createCharacters?: Array<{ key: string; name: string; identity: string; baseOutfit?: string; wardrobe?: Array<{ sceneId: string; outfit: string; notes?: string }> }>;
  updateCharacters?: Array<{ id: string; name?: string; identity?: string; baseOutfit?: string | null;
    setWardrobe?: Array<{ sceneId: string; outfit: string; notes?: string }>; clearWardrobe?: string[] }>;
  deleteCharacterIds?: string[];
}

export interface CreativePatch extends CharacterPatchFields {
  brief?: string;
  story?: string;
  project?: ProjectPatch;
  /** beforeId (7.0.0): an existing scene ID; omitted appends. */
  createScenes?: Array<{ key: string; title?: string; purpose: string; beforeId?: string }>;
  updateScenes?: Array<{ id: string; title?: string | null; purpose?: string }>;
  createShots?: ShotDraft[];
  updateShots?: ShotUpdate[];
  narrationScript?: string;
  narrationSource?: "undecided" | "uploaded" | "generated" | "mixed";
}

export interface ChangeProposal {
  variant: "workflow" | "project" | "plan";
  expectedHeadVersion: number;
  stages?: StageProposal[];
  creative?: CreativePatch;
  source?: string;
  requestNewTakes?: string[];
}

const text = { type: "string", minLength: 1, maxLength: 16000 };
const short = { type: "string", minLength: 1, maxLength: 160 };
const arr = (items: object) => ({ type: "array", maxItems: 400, items });
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const shotProperties = {
  purpose: text, action: text, framing: text, motion: text,
  desiredFrames: { type: "integer", minimum: 1, maximum: 10800 }, imagePrompt: text, videoPrompt: text,
};
const narrationIntent = object({ mode: { enum: ['undecided', 'none', 'generated', 'uploaded'] }, text: { type: 'string', maxLength: 16000 }, voice: { enum: ['stock', 'personal'] } }, ['mode', 'text', 'voice']);

export const changeProposalSchema = object({
  variant: { enum: ["workflow", "project", "plan"] },
  expectedHeadVersion: { type: "integer", minimum: 0 },
  source: { type: "string", minLength: 1, maxLength: 2 * 1024 * 1024 },
  requestNewTakes: arr(short),
  stages: arr(object({ stageId: { enum: STAGES }, scopeId: short, reason: text, gaps: arr(object({ key: short, message: text }, ["key", "message"])) }, ["stageId", "scopeId", "reason"])),
  creative: object({
    brief: text, story: text,
    createScenes: arr(object({ key: short, purpose: text }, ["key", "purpose"])),
    updateScenes: arr(object({ id: short, purpose: text }, ["id", "purpose"])),
    createShots: arr(object({ key: short, sceneId: short, ...shotProperties, narration: narrationIntent, referenceArtifactIds: arr(short), cueId: { type: ["string", "null"], maxLength: 160 } }, ["key", "sceneId", ...Object.keys(shotProperties), "referenceArtifactIds", "cueId"])),
    updateShots: arr(object({ id: short, ...shotProperties, narration: narrationIntent, reauthorPrompts: { type: "boolean" } }, ["id"])),
    narrationScript: text, narrationSource: { enum: ["undecided", "uploaded", "generated", "mixed"] },
  }),
}, ["variant", "expectedHeadVersion"]);

/** Shipped catalogs copy changeProposalSchema. Additions must never mutate it. */
export const shortFramingSchema = { type: "string", minLength: 1, maxLength: 40, pattern: "^\\S+(?: \\S+){0,2}(?![\\s\\S])", examples: ["Close-up", "Medium", "Wide"] };
export const sceneTitleSchema = { type: "string", minLength: 1, maxLength: 60, pattern: "^\\S+(?: \\S+){0,5}(?![\\s\\S])" };
const compatibleChangeProposalSchema = structuredClone(changeProposalSchema);
type CreativeSchema = { properties: Record<string, { items: { properties: Record<string, object>; required: string[] } }> };
const compatibleCreative = (compatibleChangeProposalSchema.properties as { creative: { properties: Record<string, object> } }).creative.properties;
compatibleCreative.createScenes = arr(object({ key: short, title: text, purpose: text }, ["key", "purpose"]));
compatibleCreative.updateScenes = arr({ ...object({ id: short, title: { anyOf: [text, { type: 'null' }] }, purpose: text }, ["id"]), minProperties: 2 });
export const successorChangeProposalSchema = structuredClone(compatibleChangeProposalSchema);
const successorCreative = (successorChangeProposalSchema.properties as { creative: CreativeSchema }).creative.properties;
successorCreative.createScenes!.items.properties.title = structuredClone(sceneTitleSchema);
successorCreative.updateScenes!.items.properties.title = structuredClone(sceneTitleSchema);
successorCreative.createShots!.items.properties.framing = structuredClone(shortFramingSchema);
successorCreative.updateShots!.items.properties.framing = structuredClone(shortFramingSchema);

// Contract 7.0.0 additions. Cloned from the successor after every shipped schema has been captured, so 1.0.0–6.0.0
// catalogs stay byte-for-byte unchanged. The application-side parser accepts them too; older catalogs reject them first.
const line = (max: number) => ({ type: "string", minLength: 1, maxLength: max });
const visualStyleTraits = object(Object.fromEntries(["palette", "lighting", "lensFormat", "texture", "composition", "productionDesign"].map(key => [key, line(600)])),
  ["palette", "lighting", "lensFormat", "texture", "composition", "productionDesign"]);
export const visualStyleInputSchema = object({
  styleId: line(80), libraryVersion: line(40), label: line(80), traits: visualStyleTraits,
  imageBlock: line(600), motionBlock: line(240),
  motion: object({ cameraGrammar: line(300), frameRateFeel: { enum: ["24fps-cinematic", "30fps-video", "12fps-on-twos", "8-12fps-stop-motion", "60fps-smooth"] },
    motionScale: { enum: ["still", "subtle", "moderate", "energetic"] } }, ["cameraGrammar", "frameRateFeel", "motionScale"]),
  negatives: { type: "array", maxItems: 24, items: line(160) },
  anchors: object({ referenceArtifactIds: { type: "array", maxItems: 8, uniqueItems: true, items: short }, characterSheets: { type: "array", maxItems: 32, uniqueItems: true, items: short } },
    ["referenceArtifactIds", "characterSheets"]),
  variationAxes: { type: "array", maxItems: 5, uniqueItems: true, items: { enum: ["timeOfDay", "paletteShift", "lightingKey", "weather", "treatment"] } },
  overrides: { ...object(Object.fromEntries(["palette", "lighting", "lensFormat", "texture", "composition", "productionDesign"].map(key => [key, line(600)]))), minProperties: 1 },
  rationale: line(300),
}, ["styleId", "libraryVersion", "label", "traits", "imageBlock", "motionBlock", "motion", "negatives", "anchors", "variationAxes", "rationale"]);
const wardrobeEntry = object({ sceneId: short, outfit: line(600), notes: { type: "string", maxLength: 300 } }, ["sceneId", "outfit"]);
function addContractSevenFields(input: unknown, legacyFilmKind = false): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON Schema surgery on a cloned literal.
  const creative = input as Record<string, any>;
  // The application parser also reads the pre-structure 7.0.0 strings a held proposal may carry; the catalog does not offer them.
  const filmKind = legacyFilmKind ? { anyOf: [structuredClone(filmKindInputSchema), { enum: LEGACY_FILM_KIND_VALUES }] } : structuredClone(filmKindInputSchema);
  creative.project = { ...object({ filmKind, visualStyle: { anyOf: [visualStyleInputSchema, { type: "null" }] } }), minProperties: 1 };
  creative.createScenes!.items.properties.beforeId = short;
  creative.createShots!.items.properties.beforeId = short;
  creative.updateShots!.items.properties.characterIds = { type: "array", maxItems: 32, uniqueItems: true, items: short };
  creative.createCharacters = { type: "array", minItems: 1, maxItems: 32, items: object({ key: short, name: line(80), identity: line(1200), baseOutfit: line(600),
    wardrobe: { type: "array", maxItems: 64, items: wardrobeEntry } }, ["key", "name", "identity"]) };
  creative.updateCharacters = { type: "array", minItems: 1, maxItems: 32, items: { ...object({ id: short, name: line(80), identity: line(1200),
    baseOutfit: { anyOf: [line(600), { type: "null" }] }, setWardrobe: { type: "array", maxItems: 64, items: wardrobeEntry },
    clearWardrobe: { type: "array", maxItems: 64, uniqueItems: true, items: short } }, ["id"]), minProperties: 2 } };
  creative.deleteCharacterIds = { type: "array", minItems: 1, maxItems: 32, uniqueItems: true, items: short };
}
export const contractSevenChangeProposalSchema = structuredClone(successorChangeProposalSchema);
addContractSevenFields((contractSevenChangeProposalSchema.properties as { creative: CreativeSchema }).creative.properties);
addContractSevenFields((compatibleChangeProposalSchema.properties as { creative: CreativeSchema }).creative.properties, true);

/** Whether a creative patch carries 7.0.0 character fields, which the character tools apply. */
export function hasCharacterPatchFields(patch: CreativePatch | undefined): boolean {
  return !!patch && (patch.createCharacters !== undefined || patch.updateCharacters !== undefined || patch.deleteCharacterIds !== undefined
    || (patch.updateShots ?? []).some(row => row.characterIds !== undefined));
}

const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
// The application also reads historical preparations and restores human titles,
// which may exceed the Director's short-label bounds. Epoch-specific tools validate first.
const validate = ajv.compile(compatibleChangeProposalSchema);

export function parseChangeProposal(value: unknown): ChangeProposal {
  invariant(validate(value), "VALIDATION_ERROR", ajv.errorsText(validate.errors));
  const result = value as unknown as ChangeProposal;
  invariant(result.source || result.creative || result.stages?.length, "VALIDATION_ERROR", "Empty change proposal");
  invariant(!result.requestNewTakes?.length || result.source, "VALIDATION_ERROR", "An extra take requires a current compiled plan");
  return structuredClone(result);
}

export function applyCreativePatch(
  before: ProjectRecord,
  patch: CreativePatch,
  bind: (shot: ShotRecord, cue: CueRecord | undefined) => ShotRecord,
): ProjectRecord {
  const next = structuredClone(before);
  if (patch.brief !== undefined) next.brief = patch.brief;
  if (patch.story !== undefined) next.story = patch.story;
  invariant(!hasCharacterPatchFields(patch), "VALIDATION_ERROR", "Character changes are applied by the character tools, not a creative patch");
  if (patch.project?.filmKind !== undefined) {
    const input = typeof patch.project.filmKind === "string" ? normalizeFilmKind(patch.project.filmKind) : patch.project.filmKind;
    invariant(input, "VALIDATION_ERROR", "Unknown filmKind");
    next.filmKind = parseFilmKind(input);
  }
  if (patch.project?.visualStyle === null) delete next.visualStyle;
  else if (patch.project?.visualStyle !== undefined) {
    const style = structuredClone(patch.project.visualStyle);
    const unchanged = next.visualStyle && digest({ ...next.visualStyle, revisionId: null }) === digest({ ...style, revisionId: null });
    if (!unchanged) {
      invariant(style.anchors.referenceArtifactIds.every(id => next.artifacts.some(a => a.artifactId === id)), "SCOPE_DENIED", "Style references an unknown artifact");
      next.visualStyle = { ...style, revisionId: newId() };
    }
  }
  if (patch.narrationSource !== undefined) next.narration.source = patch.narrationSource;
  if (patch.narrationScript !== undefined && patch.narrationScript !== next.narration.script) {
    next.narration.script = patch.narrationScript;
    // Existing recordings remain in history. Changed script cannot claim their acceptance.
    next.cues = next.cues.map(cue => ({ ...cue, accepted: false }));
  }
  const sceneKeys = new Map<string, string>();
  for (const scene of patch.createScenes ?? []) {
    invariant(!sceneKeys.has(scene.key), "VALIDATION_ERROR", "Duplicate scene key");
    const id = newId();
    sceneKeys.set(scene.key, id);
    const created = { id, revisionId: newId(), purpose: scene.purpose, ...(scene.title !== undefined ? { title: scene.title } : {}) };
    if (scene.beforeId === undefined) next.scenes.push(created);
    else {
      const at = next.scenes.findIndex(item => item.id === (sceneKeys.get(scene.beforeId!) ?? scene.beforeId));
      invariant(at >= 0 && scene.beforeId !== scene.key, "SCOPE_DENIED", "Insert the scene before an existing scene of this film");
      next.scenes.splice(at, 0, created);
    }
  }
  const changedScenes = new Set<string>();
  for (const update of patch.updateScenes ?? []) {
    invariant(!changedScenes.has(update.id), "VALIDATION_ERROR", "Duplicate scene update");
    changedScenes.add(update.id);
    const scene = next.scenes.find(item => item.id === update.id);
    invariant(scene, "SCOPE_DENIED", "Scene does not belong to project");
    if (update.purpose !== undefined) scene.purpose = update.purpose;
    if (update.title === null) delete scene.title;
    else if (update.title !== undefined) scene.title = update.title;
    scene.revisionId = newId();
  }
  const keys = new Set<string>(), shotKeys = new Map<string, string>();
  for (const draft of patch.createShots ?? []) {
    invariant(!keys.has(draft.key), "VALIDATION_ERROR", "Duplicate shot key"); keys.add(draft.key);
    const sceneId = sceneKeys.get(draft.sceneId) ?? draft.sceneId;
    invariant(next.scenes.some(scene => scene.id === sceneId), "SCOPE_DENIED", "Shot references an unknown scene");
    invariant(draft.referenceArtifactIds.every(id => next.artifacts.some(a => a.artifactId === id)), "SCOPE_DENIED", "Shot references an unknown artifact");
    invariant(draft.cueId === null || next.cues.some(cue => cue.id === draft.cueId), "SCOPE_DENIED", "Shot references an unknown cue");
    invariant(draft.narration?.mode !== 'none' || draft.cueId === null, 'VALIDATION_ERROR', 'A shot with no narration cannot reference an audio cue');
    const { key: _key, beforeId, ...fields } = draft;
    const shot: ShotRecord = { ...fields, sceneId, id: newId(), revisionId: newId(), promptIntent: { image: "", video: "" } };
    shotKeys.set(draft.key, shot.id);
    const bound = bind(shot, next.cues.find(cue => cue.id === shot.cueId));
    if (beforeId === undefined) next.shots.push(bound);
    else {
      // Same rule as the person's moveShot: the target belongs to the destination scene.
      const at = next.shots.findIndex(item => item.id === (shotKeys.get(beforeId) ?? beforeId) && item.sceneId === sceneId && item.id !== shot.id);
      invariant(at >= 0, "SCOPE_DENIED", "Insert the shot before an existing shot of the same scene");
      next.shots.splice(at, 0, bound);
    }
  }
  const updated = new Set<string>();
  for (const update of patch.updateShots ?? []) {
    invariant(!updated.has(update.id), "VALIDATION_ERROR", "Duplicate shot update"); updated.add(update.id);
    const index = next.shots.findIndex(shot => shot.id === update.id);
    invariant(index >= 0, "SCOPE_DENIED", "Shot does not belong to project");
    const original = next.shots[index]!;
    const { id: _id, reauthorPrompts, ...fields } = update;
    const changedFields = Object.entries(fields).filter(([key, value]) => digest(original[key as keyof ShotRecord] ?? null) !== digest(value ?? null));
    if (!changedFields.length && !reauthorPrompts) continue;
    invariant(reauthorPrompts === true, "STALE_PROMPT_INTENT", "Shot changes require explicit prompt reauthoring or reconfirmation");
    const writingChanged = fields.narration !== undefined && digest(fields.narration) !== digest(original.narration ?? null);
    const onlyWriting = writingChanged && changedFields.every(([key]) => key === 'narration');
    const shot = { ...original, ...fields, ...(fields.narration?.mode === 'none' ? { cueId: null } : {}),
      ...(writingChanged ? { narrationPending: fields.narration?.mode !== 'none' } : {}),
      revisionId: onlyWriting && (fields.narration?.mode !== 'none' || original.cueId === null || original.narrationTimingMode === 'within_shot') ? original.revisionId : newId() };
    if (original.promptState === "placeholder" && ["action", "framing", "imagePrompt", "videoPrompt"].some(key => Object.hasOwn(fields, key))) shot.promptState = "ready";
    if (writingChanged) delete shot.narrationFit;
    next.shots[index] = bind(shot, next.cues.find(cue => cue.id === shot.cueId));
  }
  invariant(next.scenes.length <= 400 && next.shots.length <= 400, "VALIDATION_ERROR", "Project exceeds current planning limits");
  return next;
}

export interface StageRequirement { stageId: StageId; scopeId: string }

/** Derived from mutations, never selected by the model's proposed stage label. */
export function requiredStages(before: ProjectRecord, next: ProjectRecord, plan: CompiledPlan | null): StageRequirement[] {
  const requirements = new Map<string, StageRequirement>();
  const add = (stageId: StageId, scopeId: string) => requirements.set(`${stageId}:${scopeId}`, { stageId, scopeId });
  if (before.brief !== next.brief || digest(before.filmKind ?? null) !== digest(next.filmKind ?? null) || digest(before.visualStyle ?? null) !== digest(next.visualStyle ?? null)) add("intake", next.id);
  if (before.story !== next.story) add("story", next.id);
  if (digest(before.narration) !== digest(next.narration)) add("narration", next.id);
  for (const scene of next.scenes) if (digest(before.scenes.find(s => s.id === scene.id) ?? null) !== digest(scene)) add("scene_plan", scene.id);
  for (const shot of next.shots) if (digest(before.shots.find(s => s.id === shot.id) ?? null) !== digest(shot)) add("shot_plan", shot.id);
  for (const node of plan?.nodes ?? []) {
    const stage = { image: "storyboard", video: "video", speech: "narration", transcription: "narration", timeline: "assembly", render: "assembly" }[node.kind] as StageId;
    add(stage, node.shotId ?? next.id);
  }
  return [...requirements.values()];
}

export function validateStageScope(project: ProjectRecord, scopeId: string): void {
  invariant(scopeId === project.id || project.scenes.some(s => s.id === scopeId) || project.shots.some(s => s.id === scopeId), "SCOPE_DENIED", "Stage scope is not in this project");
}

export function validateStageRequirements(project: ProjectRecord, stages: StageRequirement[]): void {
  for (const stage of stages) {
    validateStageScope(project, stage.scopeId);
    if (["story", "scene_plan", "shot_plan"].includes(stage.stageId)) {
      invariant(project.brief.trim() || project.narration.script.trim(), "WORKFLOW_REQUIREMENT", "A brief or narration is required for creative planning");
    }
    if (stage.stageId === "shot_plan" || stage.stageId === "video" || stage.stageId === "storyboard") {
      const shots = project.shots.filter(s => stage.scopeId === project.id || s.id === stage.scopeId || s.sceneId === stage.scopeId);
      invariant(shots.length, "WORKFLOW_REQUIREMENT", "This stage requires a shot intent");
      for (const shot of shots) invariant(project.scenes.some(s => s.id === shot.sceneId), "WORKFLOW_REQUIREMENT", "Shot scene intent is missing");
    }
  }
}

export function stageInputDigest(project: ProjectRecord, stage: StageRequirement): string {
  const shots = project.shots.filter(s => stage.scopeId === project.id || s.id === stage.scopeId || s.sceneId === stage.scopeId);
  const sceneIds = new Set(shots.map(s => s.sceneId));
  const scenes = project.scenes.filter(s => stage.scopeId === project.id || s.id === stage.scopeId || sceneIds.has(s.id));
  const normalizedShots = shots.map(({ revisionId: _revision, ...s }) => s);
  const normalizedScenes = scenes.map(({ revisionId: _revision, ...s }) => s);
  return digest({ recipe: RECIPE_DIGEST, stage, brief: project.brief, story: project.story, scenes: normalizedScenes, shots: normalizedShots,
    narration: stage.stageId === "narration" ? project.narration : null });
}

export function workflowReadiness(project: ProjectRecord) {
  const timings = project.shots.map(shot => shotVideoTiming(project, shot));
  const readyShots = timings.filter(timing => timing.ready).length;
  const noNarration = project.shots.length > 0 && project.shots.every(shot => shot.narration?.mode === 'none' && shot.cueId === null);
  const hasShotWriting = project.shots.some(shot => Boolean(shot.narration?.text.trim())), pendingWriting = project.shots.some(shot => shot.narrationPending
    || shot.narration?.mode !== 'none' && Boolean(shot.narration?.text.trim()) && !shotVideoTiming(project, shot).ready);
  const activeCueIds = new Set(project.shots.filter(shot => { const timing = shotVideoTiming(project, shot); return timing.ready && timing.source === 'accepted_audio'; }).map(shot => shot.cueId).filter(id => id !== null));
  const activeCues = project.shots.length ? project.cues.filter(cue => activeCueIds.has(cue.id)) : project.cues;
  return {
    recipe: RECIPE,
    narration: { hasScript: !!project.narration.script.trim() || hasShotWriting, source: project.narration.source,
      inputState: noNarration ? 'no_narration' : activeCues.length && activeCues.every(c => c.accepted && c.measured) ? "accepted_audio" : pendingWriting || project.narration.script.trim() || hasShotWriting ? "script_without_accepted_audio" : project.brief.trim() ? "notes_only" : "missing",
      timingCoverage: { total: timings.length, ready: readyShots, pending: timings.length - readyShots },
      acceptedMeasuredCues: activeCues.filter(c => c.accepted && c.measured).map(c => c.id) },
    scopes: project.shots.map((shot, index) => { const timing = timings[index]!; return {
      shotId: shot.id,
      sceneId: shot.sceneId,
      planning: "available" as const,
      videoTiming: timing.ready ? "ready" : "waiting_evidence",
      timing: timing.ready ? { source: timing.source, frames: timing.frames } : { reason: timing.reason },
    }; }),
  };
}
