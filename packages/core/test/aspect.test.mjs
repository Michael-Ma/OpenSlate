import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compilePlan, shotIntentDigest } from "../dist/planning/index.js";
import { composeScenePlan } from "../dist/planning/scene-composition.js";
import { DEFAULT_PROFILES } from "../dist/contracts.js";
import { explicitProjectAspect, frameMatchesAspect, projectAspect, projectExportSize, projectFormat } from "../dist/aspect.js";

const hash = character => character.repeat(64);
const codex = { id: "codex-image-v1", revision: "v1", kind: "image", adapter: "codex-image", executionVersion: "1", maxConcurrency: 1, unitCostMicros: "0", maxRetries: 0,
  configuration: { model: "codex-image-generation", settings: { runtimeVersion: "0.153.4", directorModel: "gpt-6-astra", width: 1024, height: 1024 } } };
const viggle = { id: "viggle", revision: "v1", kind: "video", adapter: "viggle-h3", executionVersion: "1", minFrames: 90, maxFrames: 450, maxConcurrency: 1,
  unitCostMicros: "60000", maxRetries: 0, configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "768p", aspectRatio: "16:9" } } };

function fixture(filmKind) {
  const shot = { id: "shot-a", revisionId: "shot-a-r1", sceneId: "scene-a", purpose: "Cat steals toast", action: "Cat leaps", framing: "Medium", motion: "Handheld",
    desiredFrames: 180, imagePrompt: "A cat eyeing toast", videoPrompt: "The cat leaps for the toast", referenceArtifactIds: [], promptIntent: { image: "", video: "" } };
  shot.promptIntent.image = shotIntentDigest(shot, "image", undefined); shot.promptIntent.video = shotIntentDigest(shot, "video", undefined);
  const project = { id: "project", revisionId: "r1", headVersion: 1, name: "Toast", brief: "A funny reel", story: "", scenes: [{ id: "scene-a", revisionId: "scene-r1", purpose: "Gag" }],
    narration: { script: "", source: "undecided" }, maxFrames: 10800, capabilityLockId: "lock", shots: [shot], cues: [], artifacts: [], activePlanId: null,
    ...(filmKind === undefined ? {} : { filmKind }) };
  return { project, profiles: [...structuredClone(DEFAULT_PROFILES), structuredClone(codex), structuredClone(viggle)], logicalIds: {}, allocateId: randomUUID };
}
const source = (context, { image = "codex-image-v1", video = "viggle", frame = "", render = "" } = {}) => `definePlan({ baseRevision: ${JSON.stringify(context.project.revisionId)} }, (p) => {
  const shot = p.shot("shot-a");
  const frame = p.image("frame", { intent: shot, profile: "${image}", prompt: "A cat eyeing toast" ${frame} });
  const review = p.humanReview("review", { shots: [{ intent: shot, keyframe: frame, videoProfile: "${video}", motionPrompt: "The cat leaps for the toast", seconds: 6 }] });
  const take = p.video("take", { intent: shot, profile: "${video}", firstFrame: p.approvedImage(frame, review), prompt: "The cat leaps for the toast", seconds: 6 });
  const edit = p.timeline("edit", { takes: [take] });
  return p.render("film", { timeline: edit ${render} });
});`;
const reels = { version: "film-kind@1", kind: "social", format: { platform: "ig_reels", aspect: "9:16" } };

test("projectAspect reads film-kind@1 format defensively and defaults to 16:9", () => {
  assert.deepEqual(projectFormat({}), { aspect: "16:9", explicit: false, requested: null });
  assert.equal(projectAspect(undefined), "16:9"); assert.equal(projectAspect({ filmKind: "narrative_short" }), "16:9");
  assert.equal(explicitProjectAspect({ filmKind: "narrative_short" }), null);
  assert.equal(explicitProjectAspect({ filmKind: { kind: "narrative" } }), null, "a kind without format keeps legacy sizes");
  assert.equal(projectAspect({ filmKind: reels }), "9:16");
  assert.equal(projectAspect({ filmKind: { format: { platform: "tiktok" } } }), "9:16", "platform default when the aspect is unset");
  assert.equal(projectAspect({ filmKind: { format: { platform: "linkedin" } } }), "1:1");
  assert.equal(projectAspect({ filmKind: { format: { platform: "other" } } }), "16:9");
  assert.equal(explicitProjectAspect({ filmKind: { format: { platform: "other" } } }), null);
  assert.deepEqual(projectFormat({ filmKind: { format: { aspect: "4:5" } } }), { aspect: "1:1", explicit: true, requested: "4:5" });
  assert.equal(projectAspect({ filmKind: { format: { aspect: "21:9" } } }), "16:9");
  assert.equal(projectAspect({ filmKind: { format: { aspect: "2:1" } } }), "16:9", "unknown values are ignored");
  assert.equal(projectAspect({ filmKind: "social_vertical" }), "9:16");
  assert.deepEqual(projectExportSize({}), { width: 1280, height: 720 });
  assert.deepEqual(projectExportSize({ filmKind: reels }), { width: 720, height: 1280 });
  assert.deepEqual(projectExportSize({ filmKind: { format: { aspect: "16:9" } } }), { width: 1280, height: 720 });
  assert.deepEqual(projectExportSize({ filmKind: { format: { aspect: "1:1" } } }), { width: 720, height: 720 });
});

test("first frames match an aspect by orientation and close ratio", () => {
  assert.ok(frameMatchesAspect(1024, 1536, "9:16")); assert.ok(frameMatchesAspect(720, 1280, "9:16"));
  assert.ok(!frameMatchesAspect(1024, 1024, "9:16")); assert.ok(!frameMatchesAspect(1536, 1024, "9:16"));
  assert.ok(frameMatchesAspect(1536, 1024, "16:9")); assert.ok(!frameMatchesAspect(1024, 1024, "16:9"));
  assert.ok(frameMatchesAspect(1024, 1024, "1:1")); assert.ok(!frameMatchesAspect(1024, 1536, "1:1"));
  assert.ok(!frameMatchesAspect(0, 10, "9:16")); assert.ok(!frameMatchesAspect(10, 10, "4:5"));
});

test("a 9:16 project compiles 1024×1536 Codex keyframes, a 9:16 Viggle video and a 720×1280 render", () => {
  const context = fixture(reels), result = compilePlan(source(context), context);
  const [image, video, , render] = result.nodes;
  assert.equal(image.args.width, 1024); assert.equal(image.args.height, 1536); assert.equal(image.args.aspect, "9:16");
  assert.equal(video.args.aspect, "9:16");
  assert.equal(render.args.width, 720); assert.equal(render.args.height, 1280);
  const landscape = fixture({ format: { aspect: "16:9" } }), wide = compilePlan(source(landscape), landscape);
  assert.deepEqual([wide.nodes[0].args.width, wide.nodes[0].args.height, wide.nodes[0].args.aspect], [1536, 1024, "16:9"]);
  assert.equal(wide.nodes[1].args.aspect, "16:9"); assert.deepEqual([wide.nodes[3].args.width, wide.nodes[3].args.height], [1280, 720]);
  // A keyframe saved before the format changed keeps its square v1 arguments and digest; the 9:16 video then refuses it
  // as a first frame at execution. An explicit matching canvas is v2; an explicit render size still wins.
  const legacyContext = fixture(), saved = compilePlan(source(legacyContext, { frame: ", width: 1024, height: 1024" }), legacyContext).nodes[0];
  const kept = compilePlan(source(context, { frame: ", width: 1024, height: 1024" }), context).nodes[0];
  assert.equal(Object.hasOwn(kept.args, "aspect"), false); assert.equal(kept.specDigest, saved.specDigest);
  assert.equal(compilePlan(source(context, { frame: ", width: 1024, height: 1536" }), context).nodes[0].args.aspect, "9:16");
  assert.equal(compilePlan(source(context, { render: ", width: 1080, height: 1920" }), context).nodes[3].args.height, 1920);
  // Other adapters keep their argument shape: the fake image and video profiles get no aspect.
  const fake = compilePlan(source(context, { image: "fake-image-v1", video: "fake-video-v1" }), context);
  assert.equal(Object.hasOwn(fake.nodes[0].args, "aspect"), false); assert.equal(Object.hasOwn(fake.nodes[1].args, "aspect"), false);
  assert.deepEqual([fake.nodes[0].args.width, fake.nodes[0].args.height], [1024, 1024]);
  assert.deepEqual([fake.nodes[3].args.width, fake.nodes[3].args.height], [720, 1280], "the render follows the film, whatever the providers");
});

test("Make keyframes composes the aspect canvas for Codex in a 9:16 film and the profile canvas otherwise", () => {
  const operation = [{ shotId: "shot-a", kind: "image", profileId: "codex-image-v1" }];
  const vertical = fixture(reels), image = composeScenePlan(null, operation, vertical).nodes.find(node => node.kind === "image");
  assert.deepEqual([image.args.width, image.args.height, image.args.aspect], [1024, 1536, "9:16"]);
  const legacy = fixture(), square = composeScenePlan(null, operation, legacy).nodes.find(node => node.kind === "image");
  assert.deepEqual([square.args.width, square.args.height, Object.hasOwn(square.args, "aspect")], [1024, 1024, false]);
});

test("a project without a format compiles exactly the legacy arguments and digests", () => {
  const legacy = fixture(), plain = compilePlan(source(legacy), legacy);
  const kind = fixture("narrative_short"), named = compilePlan(source(kind), kind);
  for (const result of [plain, named]) {
    const [image, video, , render] = result.nodes;
    assert.equal(Object.hasOwn(image.args, "aspect"), false); assert.equal(Object.hasOwn(video.args, "aspect"), false);
    assert.deepEqual([image.args.width, image.args.height, render.args.width, render.args.height], [1024, 1024, 1280, 720]);
  }
  assert.deepEqual(plain.nodes.map(node => node.specDigest), named.nodes.map(node => node.specDigest));
  const vertical = fixture(reels), changed = compilePlan(source(vertical), vertical);
  assert.notEqual(changed.nodes[0].specDigest, plain.nodes[0].specDigest);
  assert.notEqual(changed.nodes[1].specDigest, plain.nodes[1].specDigest);
});
