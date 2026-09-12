import { Ajv } from "ajv";
import { digest, invariant, newId } from "../common.js";
import type { CompiledPlan, CueRecord, ProjectRecord, ShotRecord } from "../contracts.js";

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
}

export interface ShotUpdate {
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

export interface CreativePatch {
  brief?: string;
  story?: string;
  createScenes?: Array<{ key: string; purpose: string }>;
  updateScenes?: Array<{ id: string; purpose: string }>;
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
    createShots: arr(object({ key: short, sceneId: short, ...shotProperties, referenceArtifactIds: arr(short), cueId: { type: ["string", "null"], maxLength: 160 } }, ["key", "sceneId", ...Object.keys(shotProperties), "referenceArtifactIds", "cueId"])),
    updateShots: arr(object({ id: short, ...shotProperties, reauthorPrompts: { type: "boolean" } }, ["id"])),
    narrationScript: text, narrationSource: { enum: ["undecided", "uploaded", "generated", "mixed"] },
  }),
}, ["variant", "expectedHeadVersion"]);

const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validate = ajv.compile(changeProposalSchema);

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
    next.scenes.push({ id, revisionId: newId(), purpose: scene.purpose });
  }
  const changedScenes = new Set<string>();
  for (const update of patch.updateScenes ?? []) {
    invariant(!changedScenes.has(update.id), "VALIDATION_ERROR", "Duplicate scene update");
    changedScenes.add(update.id);
    const scene = next.scenes.find(item => item.id === update.id);
    invariant(scene, "SCOPE_DENIED", "Scene does not belong to project");
    scene.purpose = update.purpose;
    scene.revisionId = newId();
  }
  const keys = new Set<string>();
  for (const draft of patch.createShots ?? []) {
    invariant(!keys.has(draft.key), "VALIDATION_ERROR", "Duplicate shot key"); keys.add(draft.key);
    const sceneId = sceneKeys.get(draft.sceneId) ?? draft.sceneId;
    invariant(next.scenes.some(scene => scene.id === sceneId), "SCOPE_DENIED", "Shot references an unknown scene");
    invariant(draft.referenceArtifactIds.every(id => next.artifacts.some(a => a.artifactId === id)), "SCOPE_DENIED", "Shot references an unknown artifact");
    invariant(draft.cueId === null || next.cues.some(cue => cue.id === draft.cueId), "SCOPE_DENIED", "Shot references an unknown cue");
    const { key: _key, ...fields } = draft;
    const shot: ShotRecord = { ...fields, sceneId, id: newId(), revisionId: newId(), promptIntent: { image: "", video: "" } };
    next.shots.push(bind(shot, next.cues.find(cue => cue.id === shot.cueId)));
  }
  const updated = new Set<string>();
  for (const update of patch.updateShots ?? []) {
    invariant(!updated.has(update.id), "VALIDATION_ERROR", "Duplicate shot update"); updated.add(update.id);
    const index = next.shots.findIndex(shot => shot.id === update.id);
    invariant(index >= 0, "SCOPE_DENIED", "Shot does not belong to project");
    const original = next.shots[index]!;
    const { id: _id, reauthorPrompts, ...fields } = update;
    const changed = Object.entries(fields).some(([key, value]) => original[key as keyof ShotRecord] !== value);
    if (!changed && !reauthorPrompts) continue;
    invariant(reauthorPrompts === true, "STALE_PROMPT_INTENT", "Shot changes require explicit prompt reauthoring or reconfirmation");
    const shot = { ...original, ...fields, revisionId: newId() };
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
  if (before.brief !== next.brief) add("intake", next.id);
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
  return {
    recipe: RECIPE,
    narration: { hasScript: !!project.narration.script.trim(), source: project.narration.source,
      inputState: project.cues.length && project.cues.every(c => c.accepted && c.measured) ? "accepted_audio" : project.narration.script.trim() ? "script_without_accepted_audio" : project.brief.trim() ? "notes_only" : "missing",
      acceptedMeasuredCues: project.cues.filter(c => c.accepted && c.measured).map(c => c.id) },
    scopes: project.shots.map(shot => ({
      shotId: shot.id,
      sceneId: shot.sceneId,
      planning: "available" as const,
      videoTiming: project.cues.some(c => c.id === shot.cueId && c.accepted && c.measured && c.durationFrames === shot.desiredFrames) ? "ready" : "waiting_evidence",
    })),
  };
}
