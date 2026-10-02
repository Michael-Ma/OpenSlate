/** Shipped V1–V3 proposal grammar. Keep independent of evolving workflow schemas. */
const STAGES = ["intake", "story", "scene_plan", "shot_plan", "narration", "storyboard", "video", "assembly", "review"] as const;

const text = { type: "string", minLength: 1, maxLength: 16000 };
const short = { type: "string", minLength: 1, maxLength: 160 };
const arr = (items: object) => ({ type: "array", maxItems: 400, items });
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const shotProperties = {
  purpose: text, action: text, framing: text, motion: text,
  desiredFrames: { type: "integer", minimum: 1, maximum: 10800 }, imagePrompt: text, videoPrompt: text,
};

export const legacyChangeProposalSchema = object({
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
