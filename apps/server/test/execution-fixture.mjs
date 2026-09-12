import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { compilePlan, shotIntentDigest, DEFAULT_PROFILES } from "../../../packages/core/dist/index.js";

export function projectFixture(id = randomUUID(), count = 2) {
  const shots = Array.from({ length: count }, (_, index) => ({
    id: `shot-${index}`, revisionId: randomUUID(), sceneId: `scene-${index}`, purpose: "Show the product",
    action: "A boot on a bench", framing: "Wide", motion: "Slow push", desiredFrames: 180,
    imagePrompt: `Boot angle ${index}`, videoPrompt: `Slow push angle ${index}`, referenceArtifactIds: [], cueId: null,
    promptIntent: { image: "", video: "" },
  }));
  for (const shot of shots) refreshIntent(shot);
  return { id, revisionId: randomUUID(), headVersion: 0, name: "Fake execution", brief: "A labeled fake test", story: "Product study", scenes: shots.map(shot => ({ id: shot.sceneId, revisionId: randomUUID(), purpose: "Product" })), narration: { script: "", source: "undecided" }, maxFrames: 10800, capabilityLockId: randomUUID(), shots, cues: [], artifacts: [], activePlanId: null };
}
export function refreshIntent(shot, cue) { shot.promptIntent = { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) }; }
export function sourceFor(project, imagesOnly = false) {
  let source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
  for (const [index, shot] of project.shots.entries()) {
    source += `const shot${index}=p.shot(${JSON.stringify(shot.id)});const image${index}=p.image("image${index}",{intent:shot${index},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`;
    if (!imagesOnly) source += `const review${index}=p.humanReview("review${index}",{shots:[{intent:shot${index},keyframe:image${index},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});const video${index}=p.video("video${index}",{intent:shot${index},profile:"fake-video-v1",firstFrame:p.approvedImage(image${index},review${index}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});`;
  }
  return source + `return [${project.shots.map((_, index) => `${imagesOnly ? "image" : "video"}${index}`).join(",")}];});`;
}
export function setup(t, { count = 2, budgetMicros = "100000", profiles = DEFAULT_PROFILES, imagesOnly = false, leaseMs = 30000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-execution-"));
  const dbPath = join(directory, "store.sqlite"); const providerPath = join(directory, "provider.sqlite"); const artifactDir = join(directory, "artifacts");
  const store = new Store(dbPath); const provider = new FakeProvider(providerPath);
  const engine = new Engine(store, provider, { artifactDir, budgetMicros, profiles, leaseMs });
  const project = projectFixture(randomUUID(), count); store.createProject(project);
  const logicalIds = {};
  const compile = current => compilePlan(sourceFor(current, imagesOnly), { project: current, profiles, logicalIds, allocateId: randomUUID });
  const plan = compile(project); const grants = {};
  for (const node of plan.nodes) if (["image", "video", "speech", "transcription"].includes(node.kind)) grants[node.id] = engine.createGrant(project.id, node.shotId ?? project.id, node.kind, "human-initial", "initial_slot").id;
  const planId = randomUUID();
  store.transaction(() => { engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, dbPath, providerPath, artifactDir, store, provider, engine, projectId: project.id, plan, compile, logicalIds };
}
