import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePlan, DEFAULT_PROFILES, digest, newId, shotIntentDigest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { captureTimeline, captureRender } from "../dist/media/timeline-capture.js";

const hash = digit => digit.repeat(64);
function descriptor(artifactId, kind, sha256, frames = 30) {
  return { id: newId(), artifactId, kind, originalSha256: hash("f"), originalByteLength: 321, sha256, byteLength: 123,
    toolchainDigest: hash("e"), probe: kind === "video" ? { durationSeconds: frames / 30, video: { streamIndex: 0, width: 160, height: 90, frameRate: "30/1", frames, durationSeconds: frames / 30, codec: "h264" } }
      : { durationSeconds: 2, audio: { streamIndex: 0, sampleRate: 48000, channels: 2, samples: 96000, durationSeconds: 2, codec: "pcm_s16le" } } };
}
function fixture(t, { narrated = false, render = true, generated = false, alterRecord = () => {}, alterSource = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "openslate-timeline-capture-")), store = new Store(join(dir, "db.sqlite"));
  const provider = new FakeProvider(join(dir, "fake.sqlite")), engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") });
  const production = new ProductionService(store, engine), initial = production.createProject("SQL-only capture");
  t.after(() => { store.close(); provider.close(); rmSync(dir, { recursive: true, force: true }); });
  const videos = ["a", "b"].map(value => ({ artifactId: newId(), kind: "video", sha256: hash(value) }));
  const sources = videos.map(ref => descriptor(ref.artifactId, "video", ref.sha256, generated ? 180 : 30));
  const addArtifact = ref => {
    const row = { artifact: ref, fixture: false, attemptId: null, path: "/intentionally-absent-capture-only-media", mimeType: ref.kind === "video" ? "video/mp4" : "audio/wav", physicalDurationSeconds: 1 };
    alterRecord(row); store.insert("artifact", ref.artifactId, initial.id, row);
  };
  for (const [index, ref] of videos.entries()) {
    addArtifact(ref); const source = structuredClone(sources[index]); alterSource(source);
    store.insert("media_source", ref.artifactId, initial.id, { source, requestId: "synthetic-descriptor" });
  }
  const audio = { artifactId: newId(), kind: "audio", sha256: hash("c") }, audioSource = descriptor(audio.artifactId, "audio", audio.sha256);
  const scene = { id: newId(), revisionId: newId(), purpose: "Scene" };
  const cues = narrated ? [0, 1].map(index => ({ id: newId(), meaning: `Line ${index}`, durationFrames: 15, placementFrames: index * 30, audio, accepted: true, measured: true })) : [];
  const shots = generated ? videos.map((_, index) => {
    const shot = { id: newId(), revisionId: newId(), sceneId: scene.id, purpose: "Boot", action: "Standing", framing: "Wide", motion: "Push", desiredFrames: 180,
      imagePrompt: "Boot", videoPrompt: "Push", referenceArtifactIds: [], cueId: null, promptIntent: { image: "", video: "" } };
    shot.promptIntent = { image: shotIntentDigest(shot, "image"), video: shotIntentDigest(shot, "video") }; return shot;
  }) : cues.map(cue => ({ id: newId(), revisionId: newId(), sceneId: scene.id, purpose: cue.meaning, action: "Standing", framing: "Wide", motion: "Push", desiredFrames: 15,
    imagePrompt: "Boot", videoPrompt: "Push", referenceArtifactIds: [], cueId: cue.id, promptIntent: { image: "unused", video: "unused" } }));
  const frame = { artifactId: newId(), kind: "image", sha256: hash("d") };
  if (narrated) addArtifact(audio);
  const project = store.saveProject({ ...initial, revisionId: newId(), artifacts: [...videos, ...(narrated ? [audio] : []), ...(generated ? [frame] : [])],
    scenes: shots.length ? [scene] : [], shots, cues, narration: { script: narrated ? "Line 0 Line 1" : "", source: narrated ? "uploaded" : "undecided" } }, initial.headVersion);
  const narration = narrated ? { id: newId(), projectId: project.id, script: project.narration.script, segments: cues.map((cue, index) => ({ cue,
    audioPlacement: { source: audioSource, startSample: index * 1600, durationSamples: 24000, atSample: index * 48000, gainMilliDb: index ? 2000 : -1000 } })) } : null;
  if (narration) { store.insert("narration_canonical", narration.id, project.id, narration); store.put("narration_canonical_head", project.id, project.id, { canonicalId: narration.id }); }
  const generatedDeclarations = generated ? shots.map((shot, index) => `const shot${index}=p.shot(${JSON.stringify(shot.id)});const review${index}=p.humanReview("review${index}",{shots:[{intent:shot${index},keyframe:p.asset(${JSON.stringify(frame.artifactId)}),videoProfile:"fake-video-v1",motionPrompt:"Push",seconds:6}]});const video${index}=p.video("video${index}",{intent:shot${index},profile:"fake-video-v1",firstFrame:p.approvedImage(p.asset(${JSON.stringify(frame.artifactId)}),review${index}),prompt:"Push",seconds:6});`).join("") : "";
  const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{${generatedDeclarations}
    const timeline=p.timeline("timeline",{takes:[${videos.map((ref, index) => generated ? `video${index}` : `p.asset(${JSON.stringify(ref.artifactId)})`).join(",")}]
      ${narrated ? `,cueRange:${JSON.stringify(scene.id)},narration:p.asset(${JSON.stringify(audio.artifactId)})` : ""}});
    ${render ? 'return p.render("render",{timeline,width:160,height:90});' : 'return timeline;'} });`;
  const plan = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId }), planId = newId(), grants = {};
  for (const node of plan.nodes.filter(node => node.kind === "video")) grants[node.id] = engine.createGrant(project.id, node.shotId, "video", "synthetic-fixture-setup").id;
  store.transaction(() => { engine.installPlan(project.id, planId, plan, grants); store.saveProject({ ...project, revisionId: newId(), activePlanId: planId }, project.headVersion); });
  for (const [index, node] of plan.nodes.filter(node => node.kind === "video").entries()) {
    const binding = store.get("node_binding", node.id); store.put("node_binding", node.id, project.id, { ...binding, outputs: { video: videos[index] } });
  }
  return { store, engine, provider, projectId: project.id, plan, videos, sources, audio, audioSource, narration,
    timelineId: plan.nodes.find(node => node.kind === "timeline").id, renderId: plan.nodes.find(node => node.kind === "render")?.id };
}

test("timeline capture works without a render node, file access or new authority and returns detached exact sources", t => {
  const f = fixture(t, { render: false }), before = f.store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all(), project = f.store.getProject(f.projectId), cursor = f.store.cursor(f.projectId);
  const captured = captureTimeline(f.store, f.projectId, f.timelineId);
  assert.deepEqual(captured.input, { projectId: f.projectId, targetRevisionId: project.revisionId,
    clips: f.sources.map(source => ({ source, startFrame: 0, durationFrames: 30, fit: "contain" })), audio: [] });
  assert.equal(Object.hasOwn(captured.target, "renderNodeId"), false); assert.deepEqual(captured.target.dependencyNodeIds, [f.timelineId]);
  captured.input.clips[0].source.sha256 = hash("0"); captured.target.inputs[0].artifact.sha256 = hash("0");
  assert.equal(captureTimeline(f.store, f.projectId, f.timelineId).input.clips[0].source.sha256, f.sources[0].sha256);
  assert.deepEqual(f.store.db.prepare("SELECT * FROM entities ORDER BY kind,id").all(), before); assert.equal(f.store.cursor(f.projectId), cursor);
  assert.deepEqual(f.store.getProject(f.projectId), project); assert.equal(f.provider.acceptedCount(), 0);
});

test("render capture preserves the historical target/recipe field ordering, repeated inputs and digest", t => {
  const f = fixture(t, { narrated: true }), project = f.store.getProject(f.projectId), audioInput = { nodeId: null, port: "audio", artifact: f.audio };
  const expected = { target: { revisionId: project.revisionId, headVersion: project.headVersion, planId: project.activePlanId, graphDigest: f.plan.graphDigest,
    renderNodeId: f.renderId, timelineNodeId: f.timelineId, canonicalNarrationId: f.narration.id,
    inputs: [...f.videos.map(artifact => ({ nodeId: null, port: "video", artifact })), audioInput, audioInput, audioInput],
    dependencyNodeIds: [f.renderId, f.timelineId].sort(), scopeIds: [f.projectId] },
    input: { projectId: f.projectId, targetRevisionId: project.revisionId, width: 160, height: 90,
      clips: f.sources.map(source => ({ source: f.store.get("media_source", source.artifactId).source, startFrame: 0, durationFrames: 30, fit: "contain" })), audio: f.store.get("narration_canonical", f.narration.id).segments.map(segment => segment.audioPlacement) } };
  const captured = captureRender(f.store, f.projectId, f.renderId);
  assert.deepEqual(captured, expected); assert.equal(JSON.stringify(captured), JSON.stringify(expected)); assert.equal(digest(captured), digest(expected));
  const timeline = captureTimeline(f.store, f.projectId, f.timelineId);
  assert.deepEqual(timeline.input.audio, captured.input.audio); assert.deepEqual(timeline.target.inputs, captured.target.inputs);
  assert.deepEqual(timeline.target.dependencyNodeIds, [f.timelineId]);
});

test("full canonical audio source/sample/gain identity survives capture even when cue fingerprints stay unchanged", t => {
  const f = fixture(t, { narrated: true }), original = captureTimeline(f.store, f.projectId, f.timelineId), replacement = structuredClone(f.narration);
  replacement.id = newId(); replacement.segments[0].audioPlacement.startSample = 3200; replacement.segments[0].audioPlacement.durationSamples = 22000;
  replacement.segments[0].audioPlacement.gainMilliDb = -2500;
  f.store.insert("narration_canonical", replacement.id, f.projectId, replacement);
  f.store.put("narration_canonical_head", f.projectId, f.projectId, { canonicalId: replacement.id });
  const changed = captureTimeline(f.store, f.projectId, f.timelineId);
  assert.deepEqual(changed.input.audio, replacement.segments.map(segment => segment.audioPlacement));
  assert.notEqual(digest(changed.input), digest(original.input)); assert.equal(changed.target.canonicalNarrationId, replacement.id);
  assert.deepEqual(changed.target.inputs, original.target.inputs, "artifact hashes alone cannot identify sample edits");
  assert.equal(changed.input.audio[0].source.id, f.audioSource.id); assert.equal(original.input.audio[0].startSample, 0);
});

test("fixture records and mismatched normalized source metadata cannot enter a captured real timeline", async t => {
  for (const [options, code] of [[{ alterRecord: row => { row.fixture = true; } }, "MEDIA_FIXTURE_UNSUPPORTED"],
    [{ alterSource: source => { source.sha256 = hash("0"); } }, "MEDIA_SOURCE_UNAVAILABLE"],
    [{ alterSource: source => { source.probe.video.frames = 0; } }, "MEDIA_SOURCE_UNAVAILABLE"]]) {
    await t.test(code, t => { const f = fixture(t, options); assert.throws(() => captureTimeline(f.store, f.projectId, f.timelineId), { code }); });
  }
});

test("foreign, missing and changed artifact records reject without borrowing another project's metadata", async t => {
  for (const [label, mutate] of [["foreign", row => { row.projectId = newId(); }], ["changed bytes", row => { row.artifact.sha256 = hash("0"); }], ["missing", () => null]]) {
    await t.test(label, t => {
      const f = fixture(t), artifact = f.store.get("artifact", f.videos[0].artifactId), result = mutate(artifact);
      // Inject damaged historical SQL solely to verify this read boundary.
      if (result === null) f.store.db.prepare("DELETE FROM entities WHERE kind='artifact' AND id=?").run(artifact.id);
      else f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify(artifact), artifact.id);
      assert.throws(() => captureRender(f.store, f.projectId, f.renderId), { code: "MEDIA_ARTIFACT_UNAVAILABLE" });
    });
  }
});

test("retired or changed timeline bindings cannot be captured through an otherwise current render", async t => {
  for (const mutate of [binding => { binding.state = "retired"; }, binding => { binding.node.args.transition = "invented"; }, binding => { binding.planId = "another-plan"; }]) {
    await t.test("stale binding", t => {
      const f = fixture(t), binding = f.store.get("node_binding", f.timelineId); mutate(binding); f.store.put("node_binding", binding.id, f.projectId, binding);
      assert.throws(() => captureRender(f.store, f.projectId, f.renderId), { code: "MEDIA_STALE_BINDING" });
      assert.throws(() => captureTimeline(f.store, f.projectId, f.timelineId), { code: "MEDIA_STALE_BINDING" });
    });
  }
});

test("generated-take capture includes upstream scopes and refuses a later shot-intent change", t => {
  const f = fixture(t, { generated: true }), project = f.store.getProject(f.projectId), captured = captureTimeline(f.store, f.projectId, f.timelineId);
  assert.deepEqual(captured.target.dependencyNodeIds, [f.timelineId, ...f.plan.nodes.filter(node => node.kind === "video").map(node => node.id)].sort());
  assert.deepEqual(captured.target.scopeIds, [f.projectId, project.scenes[0].id, ...project.shots.map(shot => shot.id)].sort());
  const next = structuredClone(project); next.shots[0].motion = "Reverse direction"; f.store.saveProject(next, project.headVersion);
  assert.throws(() => captureTimeline(f.store, f.projectId, f.timelineId), { code: "MEDIA_STALE_BINDING" });
});

test("withdrawn narration acceptance or changed script cannot fulfill a timeline's committed placements", async t => {
  for (const mutate of [project => { project.cues[0].accepted = false; }, project => { project.narration.script = "Changed narration"; }]) {
    await t.test("stale narration", t => {
      const f = fixture(t, { narrated: true }), project = f.store.getProject(f.projectId); mutate(project); f.store.saveProject(project, project.headVersion);
      assert.throws(() => captureTimeline(f.store, f.projectId, f.timelineId), { code: "MEDIA_NARRATION_REQUIRED" });
    });
  }
});
