import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DomainError, invariant, newId, shotIntentDigest } from "@openslate/core";
import type { ArtifactRef, ProjectRecord, ShotRecord } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { ProductionService } from "./application/service.js";
import { Engine } from "./execution/engine.js";
import type { ArtifactRecord, NodeBinding, PlanRecord } from "./execution/engine.js";
import { Store } from "./persistence/store.js";

export interface DemoSummary {
  mode: "fake";
  label: string;
  directory: string;
  projectId: string;
  plannedDurationSeconds: number;
  videoFixtureDurationSeconds: number;
  networkCalls: 0;
  fakeAcceptances: { initial: number; afterEditAndRestart: number; duplicateAttempts: number };
  fakeCommittedMicros: string;
  changedShotId: string;
  preserved: { shotId: string; candidateId: string; artifactId: string; sha256: string };
  recoveredAttemptId: string;
  artifacts: { alias: string; kind: string; artifactId: string; path: string; fixture: true }[];
  previousKeyframePath: string;
  previewPath: string;
  summaryPath: string;
}

function expect(value: unknown, message: string): asserts value { invariant(value, "DEMO_ASSERTION", message); }

// Only this trusted fixture builder writes seed records directly. All production
// changes, grants and review decisions below go through ProductionService.
export function seedFixture(service: ProductionService, directory: string, existingProjectId?: string): ProjectRecord {
  const project = existingProjectId ? service.store.getProject(existingProjectId) : service.createProject("OpenSlate FAKE two-shot boots demonstration");
  invariant(!project.shots.length && !project.activePlanId && !project.brief && !project.story && !project.narration.script && !project.scenes.length, "DEMO_REQUIRES_EMPTY_PROJECT", "Create a new empty project for the fixture demonstration");
  const importDirectory = join(directory, "fixture-imports"); mkdirSync(importDirectory, { recursive: true });
  const product = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e9dfd2"/><path d="M125 25h65v65l65 35v20H80v-25l45-25z" fill="#754e31"/><text x="12" y="165" font-size="13">FAKE PRODUCT REFERENCE</text></svg>');
  const samples = 12 * 48000; const audio = Buffer.alloc(44 + samples * 2);
  audio.write("RIFF", 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(48000, 24); audio.writeUInt32LE(96000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write("data", 36); audio.writeUInt32LE(samples * 2, 40);
  const imported = (name: string, bytes: Buffer, kind: ArtifactRef["kind"], mimeType: string, seconds: number | null): ArtifactRef => {
    const id = newId(); const path = join(importDirectory, name); writeFileSync(path, bytes, { flag: "wx" });
    const artifact: ArtifactRef = { artifactId: id, sha256: createHash("sha256").update(bytes).digest("hex"), kind };
    service.store.insert("artifact", id, project.id, { artifact, path, mimeType, fixture: true, attemptId: "trusted-fixture-import", physicalDurationSeconds: seconds });
    return artifact;
  };
  return service.store.transaction(() => {
    const productArtifact = imported("product-reference.svg", product, "image", "image/svg+xml", null);
    const narrationArtifact = imported("silent-narration-fixture.wav", audio, "audio", "audio/wav", 12);
    const sceneId = newId();
    const cues = [0, 1].map(index => ({ id: newId(), meaning: index === 0 ? "Show leather texture" : "Show the sole", durationFrames: 180, placementFrames: index * 180, audio: narrationArtifact, accepted: true, measured: true }));
    const shots = cues.map((cue, index): ShotRecord => {
      const shot: ShotRecord = {
        id: newId(), revisionId: newId(), sceneId, purpose: cue.meaning,
        action: index === 0 ? "A boot rests on a workshop bench" : "A boot stands upright showing its sole",
        framing: index === 0 ? "Side close-up" : "Low close-up", motion: index === 0 ? "Slow push toward the leather" : "Slow move along the sole",
        desiredFrames: 180, imagePrompt: index === 0 ? "Brown leather boot on a workshop bench, side close-up" : "Brown leather boot sole, low close-up",
        videoPrompt: index === 0 ? "Slow push toward the leather of the boot" : "Slow camera move along the boot sole",
        referenceArtifactIds: [productArtifact.artifactId], cueId: cue.id, promptIntent: { image: "", video: "" },
      };
      shot.promptIntent = { image: shotIntentDigest(shot, "image", cue), video: shotIntentDigest(shot, "video", cue) };
      return shot;
    });
    const saved = service.store.saveProject({ ...project, revisionId: newId(), brief: "A deliberately fake leather-boots commercial integration fixture", story: "Introduce the leather, then the sole", scenes: [{ id: sceneId, revisionId: newId(), purpose: "Demonstrate two reviewed shots" }], narration: { script: "Fake narration: leather texture, then the sole.", source: "uploaded" }, shots, cues, artifacts: [productArtifact, narrationArtifact] }, project.headVersion);
    service.store.insert("project_revision", saved.revisionId, saved.id, { project: saved, fixture: true });
    service.store.appendEvent(saved.id, "fixture.seeded", { fixture: true });
    return saved;
  });
}

function sourceFor(project: ProjectRecord): string {
  const quote = JSON.stringify; const [first, second] = project.shots;
  expect(first && second && project.cues[0], "Fixture must contain two shots and accepted cue data");
  return `definePlan({baseRevision:${quote(project.revisionId)}},p=>{
  const product=p.asset(${quote(first.referenceArtifactIds[0])});
  const narration=p.asset(${quote(project.cues[0].audio.artifactId)});
  const shot1=p.shot(${quote(first.id)});
  const shot2=p.shot(${quote(second.id)});
  const frame1=p.image("shot-1/keyframe",{intent:shot1,profile:"fake-image-v1",references:[product],prompt:${quote(first.imagePrompt)}});
  const frame2=p.image("shot-2/keyframe",{intent:shot2,profile:"fake-image-v1",references:[product],prompt:${quote(second.imagePrompt)}});
  const review=p.humanReview("scene/storyboard",{shots:[
    {intent:shot1,keyframe:frame1,videoProfile:"fake-video-v1",motionPrompt:${quote(first.videoPrompt)},seconds:6},
    {intent:shot2,keyframe:frame2,videoProfile:"fake-video-v1",motionPrompt:${quote(second.videoPrompt)},seconds:6}
  ]});
  const take1=p.video("shot-1/take",{intent:shot1,profile:"fake-video-v1",firstFrame:p.approvedImage(frame1,review),prompt:${quote(first.videoPrompt)},seconds:6});
  const take2=p.video("shot-2/take",{intent:shot2,profile:"fake-video-v1",firstFrame:p.approvedImage(frame2,review),prompt:${quote(second.videoPrompt)},seconds:6});
  const timeline=p.timeline("film/timeline",{takes:[take1,take2],narration,cueRange:${quote(first.sceneId)},transition:"cut"});
  return p.render("film/fake-preview",{timeline});
});`;
}

function binding(store: Store, projectId: string, alias: string): NodeBinding {
  const current = store.getProject(projectId);
  const value = store.list<NodeBinding>("node_binding", projectId).find(row => row.planId === current.activePlanId && row.node.alias === alias);
  expect(value, `Missing current binding for ${alias}`); return value;
}

async function finishReadyWork(engine: Engine, projectId: string): Promise<void> {
  let lastBlocked: { nodeId: string; code: string }[] = [];
  for (let round = 0; round < 12; round++) {
    await engine.reconcile(); lastBlocked = (await engine.runReady()).blocked;
    const project = engine.store.getProject(projectId);
    const plan = engine.store.get<PlanRecord>("plan", project.activePlanId!)!;
    if (engine.outputs(projectId).length === plan.compiled.nodes.length) return;
  }
  throw new DomainError("DEMO_STALLED", "Fake demo did not complete within its bounded execution rounds", { blocked: lastBlocked, attempts: engine.attempts(projectId).map(attempt => ({ id: attempt.id, nodeId: attempt.nodeId, phase: attempt.phase })) });
}

/** Local fake integration proof. It makes no network requests or actual model calls. */
export async function runDemo(directory = mkdtempSync(join(tmpdir(), "openslate-fake-demo-"))): Promise<DemoSummary> {
  const destination = resolve(directory); mkdirSync(destination, { recursive: true });
  const statePath = join(destination, "openslate.sqlite"); const providerPath = join(destination, "fake-provider.sqlite");
  invariant(!existsSync(statePath) && !existsSync(providerPath), "DEMO_ALREADY_EXISTS", "Choose a new directory so this fixture cannot overwrite earlier work");
  let store = new Store(statePath); let provider = new FakeProvider(providerPath);
  let engine = new Engine(store, provider, { artifactDir: join(destination, "artifacts") });
  let service = new ProductionService(store, engine);
  try {
    const project = seedFixture(service, destination); const projectId = project.id;
    const human = service.beginRequest(projectId, "simulated-demo-human", "Approve this fake two-shot plan and its initial image/video allowance.");
    service.authorize(projectId, human, project.shots.flatMap(shot => [{ scopeId: shot.id, kind: "image" as const }, { scopeId: shot.id, kind: "video" as const }]), "initial-fake-slots", "initial_slot");
    const director = service.openEpoch(projectId, human).actor;
    const prepared = await service.prepare(projectId, director, { variant: "plan", expectedHeadVersion: project.headVersion, source: sourceFor(project) });
    service.apply(projectId, director, prepared.id);

    await engine.runReady(); await engine.reconcile();
    const beforeApproval = await engine.runReady();
    expect(provider.acceptedCount() === 2, "Only two keyframes may be accepted before human review");
    expect(engine.attempts(projectId).every(attempt => attempt.request.kind !== "video"), "Video ran before keyframe approval");
    expect(beforeApproval.blocked.some(item => item.code === "HUMAN_REVIEW_REQUIRED"), "Missing review was not reported");
    const initialReview = engine.reviewSnapshot(projectId);
    expect(initialReview.members.length === 2 && initialReview.members.every(member => member.ready), "Both exact keyframes must be displayed for review");
    const initialReviewer = service.beginRequest(projectId, "simulated-demo-human", "Approve both displayed fake keyframes and their six-second motion plans.", { editing: false });
    service.approve(projectId, initialReviewer, initialReview.id, initialReview.members.map(member => member.videoNodeId));
    await finishReadyWork(engine, projectId);
    expect(provider.acceptedCount() === 4, "Initial fake production should contain exactly four provider accepts");

    const previousFrame = binding(store, projectId, "shot-1/keyframe");
    const previousTake = binding(store, projectId, "shot-1/take");
    const preservedFrame = binding(store, projectId, "shot-2/keyframe");
    const preservedTake = binding(store, projectId, "shot-2/take");
    expect(previousFrame.outputs.image && preservedTake.outputs.video && preservedTake.candidateId, "Initial artifacts and candidates must exist");
    const previousKeyframePath = store.get<ArtifactRecord>("artifact", previousFrame.outputs.image.artifactId)!.path;
    const current = store.getProject(projectId); const changedShotId = current.shots[0]!.id;
    const editHuman = service.beginRequest(projectId, "simulated-demo-human", "Change only shot 1 to an extreme close-up of the stitching; create a new frame and video after review.", { scopeIds: [changedShotId], editing: true });
    service.authorize(projectId, editHuman, [{ scopeId: changedShotId, kind: "image" }, { scopeId: changedShotId, kind: "video" }], "single-shot-edit-slots");
    const update = { id: changedShotId, framing: "Extreme close-up of stitching", imagePrompt: "Brown leather boot stitching, extreme close-up", videoPrompt: "Slow push toward the stitching on the boot", reauthorPrompts: true };
    const proposed = structuredClone(current);
    Object.assign(proposed.shots[0]!, { framing: update.framing, imagePrompt: update.imagePrompt, videoPrompt: update.videoPrompt });
    const editDirector = service.openEpoch(projectId, editHuman).actor;
    const change = await service.prepare(projectId, editDirector, { variant: "workflow", expectedHeadVersion: current.headVersion, creative: { updateShots: [update] }, source: sourceFor(proposed) });
    service.apply(projectId, editDirector, change.id);
    expect(binding(store, projectId, "shot-1/take").candidateId !== previousTake.candidateId, "Edited shot must have a new authorized candidate");
    expect(binding(store, projectId, "shot-2/keyframe").candidateId === preservedFrame.candidateId, "Unchanged keyframe candidate was replaced");
    expect(binding(store, projectId, "shot-2/take").candidateId === preservedTake.candidateId, "Unchanged video candidate was replaced");
    expect(binding(store, projectId, "shot-2/take").outputs.video?.artifactId === preservedTake.outputs.video.artifactId, "Unchanged output was not reused");

    await engine.runReady(); await engine.reconcile();
    const editBlocked = await engine.runReady();
    expect(provider.acceptedCount() === 5, "Edited video ran before its new keyframe review");
    const editedVideo = binding(store, projectId, "shot-1/take");
    expect(editBlocked.blocked.some(item => item.nodeId === editedVideo.id && item.code === "HUMAN_REVIEW_REQUIRED"), "Old approval incorrectly admitted an edited shot");
    const revisedReview = engine.reviewSnapshot(projectId);
    const editedMember = revisedReview.members.find(member => member.videoNodeId === editedVideo.id)!;
    expect(editedMember.ready && editedMember.keyframe?.sha256 !== previousFrame.outputs.image.sha256, "Revised review did not display changed frame bytes");
    const editReviewer = service.beginRequest(projectId, "simulated-demo-human", "Approve the displayed revised shot 1 keyframe and motion.", { scopeIds: [changedShotId], editing: false });
    service.approve(projectId, editReviewer, revisedReview.id, [editedVideo.id]);

    // The fake backend durably accepts this job and deliberately loses its response.
    provider.setMode(editedVideo.id, "unknown_after_accept");
    await engine.runReady();
    const unresolved = engine.attempts(projectId).find(attempt => attempt.nodeId === editedVideo.id && attempt.phase === "submission_unknown");
    expect(unresolved && provider.acceptedCount() === 6, "Fault injection must leave exactly one uncertain accepted attempt");
    const recoveredAttemptId = unresolved.id;
    store.close(); provider.close();

    store = new Store(statePath); provider = new FakeProvider(providerPath);
    engine = new Engine(store, provider, { artifactDir: join(destination, "artifacts") });
    service = new ProductionService(store, engine);
    await finishReadyWork(engine, projectId);
    expect(service.snapshot(projectId).outputs.length === 6, "Restarted application did not reconstruct all six current outputs");
    const recovered = engine.attempts(projectId).find(attempt => attempt.id === recoveredAttemptId);
    expect(recovered?.phase === "succeeded", "Restart did not reconcile the original uncertain attempt");
    expect(provider.acceptedCount() === 6 && provider.acceptedCount(recoveredAttemptId) === 1, "Restart duplicated a fake paid acceptance");
    const kept = binding(store, projectId, "shot-2/take");
    expect(kept.candidateId === preservedTake.candidateId && kept.outputs.video?.artifactId === preservedTake.outputs.video.artifactId, "Restart lost the untouched shot's selected execution output");
    expect(existsSync(previousKeyframePath), "The old keyframe should remain available in history");

    const accepts = new Map<string, number>();
    for (const job of provider.jobs()) accepts.set(job.attemptId, (accepts.get(job.attemptId) ?? 0) + 1);
    const duplicateAttempts = [...accepts.values()].filter(count => count > 1).length;
    const artifacts = engine.outputs(projectId).map(output => {
      const record = store.get<ArtifactRecord>("artifact", output.artifact.artifactId)!;
      expect(createHash("sha256").update(readFileSync(record.path)).digest("hex") === output.artifact.sha256, "Demo output failed final hash verification");
      return { alias: store.get<NodeBinding>("node_binding", output.nodeId)!.node.alias, kind: output.artifact.kind, artifactId: output.artifact.artifactId, path: record.path, fixture: true as const };
    });
    const preview = artifacts.find(artifact => artifact.alias === "film/fake-preview")!;
    const summary: DemoSummary = {
      mode: "fake", label: "FAKE integration demo: placeholder media, simulated human decisions, no model or network calls. The preview is a one-second fixture, not the planned commercial.",
      directory: destination, projectId, plannedDurationSeconds: 12, videoFixtureDurationSeconds: 1, networkCalls: 0,
      fakeAcceptances: { initial: 4, afterEditAndRestart: provider.acceptedCount(), duplicateAttempts },
      fakeCommittedMicros: engine.budget(projectId).committedMicros, changedShotId,
      preserved: { shotId: current.shots[1]!.id, candidateId: kept.candidateId!, artifactId: kept.outputs.video!.artifactId, sha256: kept.outputs.video!.sha256 },
      recoveredAttemptId, artifacts, previousKeyframePath, previewPath: preview.path, summaryPath: join(destination, "demo-summary.json"),
    };
    writeFileSync(summary.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
    return summary;
  } finally {
    if (store.db.open) store.close();
    if (provider.db.open) provider.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runDemo(process.argv[2]);
  process.stdout.write(`${result.label}\nFake accepts: ${result.fakeAcceptances.initial} initial + 2 edited, ${result.fakeAcceptances.duplicateAttempts} duplicates after restart.\nUnchanged shot preserved: ${result.preserved.shotId}\nFixture preview: ${result.previewPath}\nSummary: ${result.summaryPath}\n`);
}
