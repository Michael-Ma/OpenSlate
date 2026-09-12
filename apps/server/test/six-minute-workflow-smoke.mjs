import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compilePlan, DEFAULT_PROFILES, shotIntentDigest } from "../../../packages/core/dist/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { projectFixture } from "./execution-fixture.mjs";

// Explicit offline acceptance probe. Seeded creative state and human decisions
// are synthetic; the rendered fixture is one second, not a six-minute film.
const root = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "openslate-workflow-360-"));
mkdirSync(root, { recursive: true });
const dbPath = join(root, "openslate.sqlite"), providerPath = join(root, "fake-provider.sqlite");
assert.ok(!existsSync(dbPath) && !existsSync(providerPath), "Use a new probe directory");
let store, provider, engine, service;
const open = () => { store = new Store(dbPath); provider = new FakeProvider(providerPath); engine = new Engine(store, provider, { artifactDir: join(root, "artifacts") }); service = new ProductionService(store, engine); };
const close = () => { if (store?.db.open) store.close(); if (provider?.db.open) provider.close(); };
const metrics = {}, timed = async (label, work) => { const start = performance.now(); const result = await work(); metrics[label] = Math.round((performance.now() - start) * 10) / 10; return result; };
function sourceFor(project, extraTake = false) {
  let source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{\n`;
  source += `const narration=p.asset(${JSON.stringify(project.cues[0].audio.artifactId)});\n`;
  for (const [index, shot] of project.shots.entries()) {
    source += `const shot${index}=p.shot(${JSON.stringify(shot.id)});\n`;
    source += `const frame${index}=p.image("shot-${index}/frame",{intent:shot${index},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});\n`;
    source += `const review${index}=p.humanReview("shot-${index}/review",{shots:[{intent:shot${index},keyframe:frame${index},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});\n`;
    source += `const take${index}=p.video("shot-${index}/take",{intent:shot${index},profile:"fake-video-v1",firstFrame:p.approvedImage(frame${index},review${index}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});\n`;
  }
  const takes = project.shots.map((_, index) => `take${index}`); if (extraTake) takes.push("take0");
  return source + `const timeline=p.timeline("film/timeline",{takes:[${takes.join(",")}],narration,transition:"cut"});return p.render("film/fixture-preview",{timeline});});`;
}
const bindings = projectId => store.list("node_binding", projectId).filter(row => row.planId === store.getProject(projectId).activePlanId);
const binding = (projectId, alias) => { const found = bindings(projectId).find(row => row.node.alias === alias); assert.ok(found, alias); return found; };
async function driveUntil(projectId, done, label) {
  const start = performance.now();
  for (let round = 0; round < 160; round++) {
    await engine.reconcile(); const status = await engine.runReady();
    if (done()) return round + 1;
    assert.ok(performance.now() - start < 120000, `${label} exceeded its probe deadline`);
    assert.ok(status.dispatched || status.reused || engine.attempts(projectId).some(row => !["succeeded", "failed"].includes(row.phase)), `${label} stalled: ${JSON.stringify(status.blocked.slice(0, 5))}`);
  }
  throw Error(`${label} exceeded bounded execution rounds`);
}
try {
  open(); const empty = service.createProject("FAKE six-minute workflow acceptance");
  const seeded = { ...projectFixture(empty.id, 60), name: empty.name, capabilityLockId: empty.capabilityLockId };
  // One physically six-second silent fixture is reused by sixty explicitly
  // synthetic accepted cues. No ASR, human review or real narration is claimed.
  const audio = Buffer.alloc(44 + 6 * 48000 * 2); audio.write("RIFF"); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(48000, 24);
  audio.writeUInt32LE(96000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(audio.length - 44, 40);
  const audioRef = { artifactId: randomUUID(), kind: "audio", sha256: createHash("sha256").update(audio).digest("hex") };
  const audioPath = join(root, "artifacts", "synthetic-six-second-cue.wav"); writeFileSync(audioPath, audio, { flag: "wx" });
  store.insert("artifact", audioRef.artifactId, empty.id, { artifact: audioRef, path: audioPath, mimeType: "audio/wav", fixture: true, attemptId: "trusted-fixture-import", physicalDurationSeconds: 6 });
  seeded.artifacts = [audioRef]; seeded.narration = { script: "Synthetic silent cue repeated for workflow testing.", source: "uploaded" };
  seeded.cues = seeded.shots.map((shot, index) => {
    const cue = { id: randomUUID(), meaning: shot.purpose, durationFrames: 180, placementFrames: index * 180, audio: audioRef, accepted: true, measured: true };
    shot.cueId = cue.id; shot.promptIntent = { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) }; return cue;
  });
  const project = store.saveProject(seeded, empty.headVersion);
  store.insert("project_revision", project.revisionId, project.id, { project, fixture: true });
  const projectId = project.id, human = service.beginRequest(projectId, "simulated-human", "Create the explicitly fake 60-shot plan and initial test allowance.");
  service.authorize(projectId, human, project.shots.flatMap(shot => [{ scopeId: shot.id, kind: "image" }, { scopeId: shot.id, kind: "video" }]), "initial-test-grants", "initial_slot");
  const director = service.openEpoch(projectId, human).actor;
  const prepared = await timed("initialPrepareMs", () => service.prepare(projectId, director, { variant: "plan", expectedHeadVersion: project.headVersion, source: sourceFor(project) }));
  assert.equal(prepared.compiled.nodes.length, 122); assert.equal(prepared.compiled.gates.length, 60);
  assert.equal(prepared.compiled.nodes.find(node => node.kind === "timeline").args.durationFrames, 10800);
  const aliases = store.get("logical_ids", projectId)?.aliases ?? prepared.logicalIds;
  const roundtrip = compilePlan(prepared.compiled.canonicalSource, { project: prepared.next, profiles: DEFAULT_PROFILES, logicalIds: { ...aliases }, allocateId: randomUUID });
  assert.equal(roundtrip.graphDigest, prepared.compiled.graphDigest);
  assert.throws(() => compilePlan(sourceFor(prepared.next, true), { project: prepared.next, profiles: DEFAULT_PROFILES, logicalIds: { ...aliases }, allocateId: randomUUID }), { code: "DURATION_LIMIT" });
  await timed("initialApplyMs", () => service.apply(projectId, director, prepared.id));
  const imageRounds = await timed("allKeyframesMs", () => driveUntil(projectId, () => bindings(projectId).filter(row => row.node.kind === "image" && row.outputs.image).length === 60, "Keyframes"));
  assert.equal(provider.acceptedCount(), 60); assert.equal(engine.attempts(projectId).filter(row => row.request.kind === "video").length, 0);
  const firstReview = engine.reviewSnapshot(projectId); assert.equal(firstReview.members.length, 60); assert.ok(firstReview.members.every(member => member.ready));
  const initialVideoRounds = await timed("reviewAndVideoMs", async () => {
    let rounds = 0;
    for (let offset = 0; offset < 60; offset += 15) {
      const review = engine.reviewSnapshot(projectId), selected = review.members.slice(offset, offset + 15);
      const reviewer = service.beginRequest(projectId, "simulated-human", `Approve displayed fake members ${offset + 1}–${offset + 15}.`, { editing: false });
      service.approve(projectId, reviewer, review.id, selected.map(member => member.videoNodeId));
      rounds += await driveUntil(projectId, () => selected.every(member => store.get("node_binding", member.videoNodeId)?.outputs.video), "Approved videos");
      assert.equal(engine.attempts(projectId).filter(row => row.request.kind === "video").length, offset + 15, "Undisplayed/unapproved members must not dispatch");
    }
    return rounds;
  });
  await driveUntil(projectId, () => engine.outputs(projectId).length === 122, "Initial assembly");
  assert.equal(provider.acceptedCount(), 120);
  const initialBindings = new Map(bindings(projectId).map(row => [row.node.alias, structuredClone(row)]));
  const initialAccepts = provider.acceptedCount(), before = store.getProject(projectId), changed = before.shots[29];
  const edit = service.beginRequest(projectId, "simulated-human", "Change only shot 30 to stitching detail; create one replacement after review.", { scopeIds: [changed.id] });
  service.authorize(projectId, edit, [{ scopeId: changed.id, kind: "image" }, { scopeId: changed.id, kind: "video" }], "one-shot-test-grants");
  const patch = { id: changed.id, framing: "Extreme close-up", imagePrompt: "Boot stitching in an extreme close-up", videoPrompt: "Move slowly along the boot stitching", reauthorPrompts: true };
  const next = structuredClone(before); Object.assign(next.shots[29], patch);
  const editDirector = service.openEpoch(projectId, edit).actor;
  const replacement = await timed("scopedPrepareMs", () => service.prepare(projectId, editDirector, { variant: "workflow", expectedHeadVersion: before.headVersion, creative: { updateShots: [patch] }, source: sourceFor(next) }));
  assert.equal(replacement.impact.filter(item => item.kind === "replace").length, 4);
  assert.equal(replacement.impact.filter(item => item.kind === "reuse").length, 118);
  await timed("scopedApplyMs", () => service.apply(projectId, editDirector, replacement.id));
  const afterEdit = store.getProject(projectId);
  assert.deepEqual(afterEdit.narration, before.narration); assert.deepEqual(afterEdit.cues, before.cues); assert.deepEqual(afterEdit.scenes, before.scenes);
  assert.deepEqual(afterEdit.shots.filter(shot => shot.id !== changed.id), before.shots.filter(shot => shot.id !== changed.id));
  for (const row of bindings(projectId).filter(row => row.node.shotId && row.node.shotId !== changed.id)) {
    const old = initialBindings.get(row.node.alias); assert.equal(row.candidateId, old.candidateId); assert.deepEqual(row.outputs, old.outputs);
  }
  await driveUntil(projectId, () => !!binding(projectId, "shot-29/frame").outputs.image, "Replacement keyframe");
  assert.equal(provider.acceptedCount(), initialAccepts + 1);
  const video = binding(projectId, "shot-29/take"), review = engine.reviewSnapshot(projectId);
  const blocked = await engine.runReady(); assert.ok(blocked.blocked.some(row => row.nodeId === video.id && row.code === "HUMAN_REVIEW_REQUIRED"));
  const reviewer = service.beginRequest(projectId, "simulated-human", "Approve the exact replacement for shot 30.", { scopeIds: [changed.id], editing: false });
  service.approve(projectId, reviewer, review.id, [video.id]);
  provider.setMode(video.id, "unknown_after_accept"); await engine.runReady();
  const uncertain = engine.attempts(projectId).find(row => row.nodeId === video.id && row.phase === "submission_unknown"); assert.ok(uncertain);
  assert.equal(provider.acceptedCount(), 122); close(); open();
  await timed("restartRecoveryMs", () => driveUntil(projectId, () => engine.outputs(projectId).length === 122, "Restart recovery"));
  assert.equal(engine.attempts(projectId).find(row => row.id === uncertain.id).phase, "succeeded");
  assert.equal(provider.acceptedCount(), 122); assert.equal(provider.acceptedCount(uncertain.id), 1);
  const acceptsByAttempt = new Map();
  for (const job of provider.jobs()) acceptsByAttempt.set(job.attemptId, (acceptsByAttempt.get(job.attemptId) ?? 0) + 1);
  const duplicateFakeAccepts = [...acceptsByAttempt.values()].filter(count => count > 1).length; assert.equal(duplicateFakeAccepts, 0);
  for (const row of bindings(projectId).filter(row => row.node.shotId && row.node.shotId !== changed.id)) assert.deepEqual(row.outputs, initialBindings.get(row.node.alias).outputs);
  for (const output of engine.outputs(projectId)) {
    const artifact = store.get("artifact", output.artifact.artifactId); assert.equal(artifact.fixture, true);
    assert.equal(createHash("sha256").update(readFileSync(artifact.path)).digest("hex"), output.artifact.sha256);
  }
  const oldFrame = initialBindings.get("shot-29/frame").outputs.image; assert.ok(existsSync(store.get("artifact", oldFrame.artifactId).path));
  const summary = { schemaVersion: 1, recordedAt: new Date().toISOString(), nodeVersion: process.version, platform: process.platform, arch: process.arch,
    mode: "fake", label: "Synthetic state-machine acceptance; no native model or media API calls. Fake video/preview bytes are one second, not a physical six-minute film.",
    projectId, plannedSeconds: 360, shots: 60, syntheticAcceptedCues: 60, operations: 122, exactReviewMembers: 60, reviewBatchSize: 15, initialFakeAccepts: 120, finalFakeAccepts: 122,
    changedShot: 30, preservedShots: 59, preservedMediaNodes: 118, replacedNodes: 4, duplicateFakeAccepts, uncertainAttemptRecovered: true,
    narrationCuesAndScenesUnchanged: true, sourceBytes: Buffer.byteLength(prepared.compiled.source),
    durationOverflowRejected: true, canonicalSourceRoundTrip: true, currentOutputHashesVerified: 122, oldKeyframeRetained: true,
    modelStarts: 0, mediaApiCalls: 0, imageRounds, initialVideoRounds, metrics };
  writeFileSync(join(root, "workflow-summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify(summary, null, 2));
} finally { close(); }
