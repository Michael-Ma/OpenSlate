import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService, MediaApplicationService } from "../dist/media/index.js";
import { FakeProvider } from "@openslate/providers";
import { compilePlan, DEFAULT_PROFILES, newId, shotIntentDigest } from "@openslate/core";

const execute = promisify(execFile), code = expected => error => error?.code === expected;
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputDir, red, blue, voice;
before(async () => {
  inputDir = await mkdtemp(join(tmpdir(), "openslate-render-input-"));
  red = join(inputDir, "red.mp4"); blue = join(inputDir, "blue.mp4"); voice = join(inputDir, "voice.wav");
  for (const [color, path] of [["red", red], ["blue", blue]]) await execute(ffmpeg,
    ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=160x90:r=30:d=1`, "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", path], { timeout: 10000 });
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=1", "-c:a", "pcm_s16le", voice], { timeout: 10000 });
});
after(async () => { await rm(inputDir, { recursive: true, force: true }); });

async function fixture(t, { imported = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-media-app-"));
  const store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "artifacts") });
  const production = new ProductionService(store, engine), project = production.createProject("Supplied media preview");
  const human = production.beginRequest(project.id, "human", "Import my clips");
  const options = { rootDir: join(dir, "media"), allowedInputRoots: [inputDir], ffmpegPath: ffmpeg, ffprobePath: ffprobe };
  const media = new LocalMediaService(options), app = new MediaApplicationService(production, media);
  const f = { dir, store, provider, engine, production, project, human, media, app, options, clips: [] };
  f.import = async path => {
    const result = await app.importVideo(project.id, human, { path, expectedHeadVersion: store.getProject(project.id).headVersion, key: newId() });
    f.clips.push(result.artifact); return result;
  };
  f.head = () => store.getProject(project.id);
  f.plan = (extra = "", cueRange = "") => {
    const project = f.head(), id = newId();
    const source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{
      ${extra} const timeline=p.timeline("timeline",{takes:[${f.clips.map(a => `p.asset(${JSON.stringify(a.artifactId)})`).join(",")}],${cueRange ? `cueRange:${JSON.stringify(cueRange)},` : ""}transition:"cut"});
      return p.render("preview",{timeline,width:160,height:90});
    });`;
    const compiled = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId });
    store.transaction(() => {
      engine.installPlan(project.id, id, compiled);
      store.saveProject({ ...project, revisionId: newId(), activePlanId: id }, project.headVersion);
      for (const hold of store.list("hold", project.id)) if (hold.ownerId === human.requestId && hold.active) engine.releaseHold(project.id, hold.id, human.requestId);
    });
    f.renderNodeId = compiled.nodes.find(n => n.kind === "render").id;
    f.renderActor = production.beginRequest(project.id, "human", "Render this installed plan", { editing: false });
    return compiled;
  };
  f.prepare = key => app.prepareRender(project.id, f.renderActor, { expectedHeadVersion: f.head().headVersion, renderNodeId: f.renderNodeId, key: key ?? newId() });
  t.after(async () => { if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  if (imported) { await f.import(red); await f.import(blue); f.plan(); }
  return f;
}

test("human import is scoped, idempotent and revision checked; directors cannot supply host paths", async t => {
  const f = await fixture(t, { imported: false });
  const input = { path: red, expectedHeadVersion: 0, key: "red-once" };
  const one = await f.app.importVideo(f.project.id, f.human, input);
  assert.deepEqual(await f.app.importVideo(f.project.id, f.human, input), one);
  assert.equal(f.store.list("artifact", f.project.id).length, 1);
  assert.equal(f.head().artifacts.length, 1);
  await assert.rejects(f.app.importVideo(f.project.id, f.human, { ...input, path: blue }), code("IDEMPOTENCY_CONFLICT"));
  const actor = f.production.openEpoch(f.project.id, f.human).actor;
  await assert.rejects(f.app.importVideo(f.project.id, actor, { ...input, key: "model" }), code("ACTOR_DENIED"));
  await assert.rejects(f.app.importVideo(f.project.id, f.human, { ...input, path: "https://example.invalid/movie.mp4", expectedHeadVersion: 1, key: "url" }), code("MEDIA_PATH_REJECTED"));
  assert.equal(f.provider.acceptedCount(), 0);
});

test("current imported plan renders real ordered frames and registers one guarded nonfixture preview", async t => {
  const f = await fixture(t), job = await f.prepare("same");
  assert.equal((await f.prepare("same")).id, job.id);
  assert.equal(job.manifest.totalFrames, 60);
  assert.deepEqual(job.manifest.clips.map(c => c.source.artifactId), f.clips.map(c => c.artifactId));
  const result = await f.app.run(f.project.id, f.renderActor, job.id);
  assert.equal(result.state, "published");
  assert.equal((await f.app.run(f.project.id, f.renderActor, job.id)).artifact.artifactId, result.artifact.artifactId);
  const artifact = f.store.get("artifact", result.artifact.artifactId);
  assert.equal(artifact.fixture, false); assert.equal(artifact.origin, "local_render"); assert.equal(artifact.attemptId, null);
  assert.equal(artifact.physicalDurationSeconds, 2); assert.ok((await stat(artifact.path)).size > 0);
  const pixels = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", artifact.path, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", timeout: 10000 });
  assert.equal(pixels.stdout.length, 180);
  for (let frame = 0; frame < 60; frame++) assert.ok(frame < 30 ? pixels.stdout[frame * 3] > pixels.stdout[frame * 3 + 2] + 100 : pixels.stdout[frame * 3 + 2] > pixels.stdout[frame * 3] + 100);
  assert.equal(f.app.snapshot(f.project.id, f.renderActor).preview.artifact.artifactId, result.artifact.artifactId);
  assert.equal(f.store.list("attempt", f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});

test("global pause and relevant holds block dispatch without clearing either control", async t => {
  const f = await fixture(t), job = await f.prepare();
  f.production.control(f.project.id, f.renderActor, "pause");
  await assert.rejects(f.app.run(f.project.id, f.renderActor, job.id), code("MEDIA_PAUSED"));
  assert.equal(f.store.get("execution_control", f.project.id).paused, true);
  f.production.control(f.project.id, f.renderActor, "resume");
  const hold = f.engine.setHold(f.project.id, { scopeId: f.project.id, ownerId: "another-edit" });
  await assert.rejects(f.app.run(f.project.id, f.renderActor, job.id), code("MEDIA_HELD"));
  assert.equal(f.store.get("hold", hold.id).active, true);
  assert.equal(f.store.get("media_render", job.id).state, "prepared");
});

test("foreign artifacts and fixture outputs cannot masquerade as supplied media", async t => {
  const f = await fixture(t), project = f.head(), fixtureRef = { ...f.clips[0], artifactId: newId() };
  f.store.insert("artifact", fixtureRef.artifactId, project.id, { artifact: fixtureRef, fixture: true });
  f.store.saveProject({ ...project, revisionId: newId(), artifacts: [...project.artifacts, fixtureRef] }, project.headVersion);
  f.clips = [fixtureRef]; f.plan();
  await assert.rejects(f.prepare(), code("MEDIA_FIXTURE_UNSUPPORTED"));
  const other = f.production.createProject("Another owner");
  const otherHuman = f.production.beginRequest(other.id, "other-human", "Render", { editing: false });
  await assert.rejects(f.app.prepareRender(project.id, otherHuman, { expectedHeadVersion: f.head().headVersion, renderNodeId: f.renderNodeId, key: "foreign" }), code("ACTOR_DENIED"));
  const foreign = { artifactId: newId(), sha256: f.clips[0].sha256, kind: "video" };
  f.store.insert("artifact", foreign.artifactId, other.id, { artifact: foreign, fixture: false });
  const current = f.head(); f.store.saveProject({ ...current, revisionId: newId(), artifacts: [...current.artifacts, foreign] }, current.headVersion);
  f.clips = [foreign]; f.plan();
  await assert.rejects(f.prepare(), code("MEDIA_ARTIFACT_UNAVAILABLE"));
});

test("changed project or selected binding retains late completion as history without replacing prior preview", async t => {
  const f = await fixture(t), first = await f.prepare(); await f.app.run(f.project.id, f.renderActor, first.id);
  const second = await f.prepare();
  const render = f.media.render.bind(f.media);
  f.media.render = async (...args) => {
    const result = await render(...args);
    const project = f.head(); f.store.saveProject({ ...project, revisionId: newId(), name: "Changed while rendering" }, project.headVersion); return result;
  };
  const completed = await f.app.run(f.project.id, f.renderActor, second.id);
  assert.equal(completed.state, "historical");
  assert.equal(f.store.get("media_preview", f.project.id).renderJobId, first.id);
  assert.equal(f.app.snapshot(f.project.id, f.renderActor).preview, null, "an old preview must not be presented as current");
  assert.equal(f.store.get("artifact", completed.artifact.artifactId).origin, "local_render");
  assert.equal(f.provider.acceptedCount(), 0);
});

test("pause or cancellation after FFmpeg finishes retains evidence but suppresses publication", async t => {
  const f = await fixture(t), job = await f.prepare(), render = f.media.render.bind(f.media);
  f.media.render = async (...args) => { const result = await render(...args); f.app.cancel(f.project.id, f.renderActor, job.id); return result; };
  const completed = await f.app.run(f.project.id, f.renderActor, job.id);
  assert.equal(completed.state, "historical"); assert.equal(completed.cancelRequested, true);
  assert.equal(f.app.snapshot(f.project.id, f.renderActor).preview, null);
  const another = await f.prepare();
  f.media.render = async (...args) => { const result = await render(...args); f.production.control(f.project.id, f.renderActor, "pause"); return result; };
  assert.equal((await f.app.run(f.project.id, f.renderActor, another.id)).state, "historical");
});

test("cancelled process does not publish or silently retry", async t => {
  const f = await fixture(t), job = await f.prepare(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.app.run(f.project.id, f.renderActor, job.id, { signal: abort.signal }), code("MEDIA_CANCELLED"));
  assert.equal(f.store.get("media_render", job.id).state, "cancelled");
  await assert.rejects(f.app.run(f.project.id, f.renderActor, job.id), code("MEDIA_RENDER_NOT_READY"));
  assert.equal(f.app.snapshot(f.project.id, f.renderActor).preview, null);
});

test("installed receipt survives SQL failure and backend restart; recovery never calls FFmpeg again", async t => {
  const f = await fixture(t), job = await f.prepare(), insert = f.store.insert.bind(f.store); let fail = true;
  f.store.insert = (...args) => { if (args[0] === "artifact" && args[3].origin === "local_render" && fail) { fail = false; throw new Error("synthetic completion transaction failure"); } return insert(...args); };
  await assert.rejects(f.app.run(f.project.id, f.renderActor, job.id), /synthetic completion transaction failure/);
  assert.equal(f.store.get("media_render", job.id).state, "failed");
  f.store.close();
  const reopened = new Store(join(f.dir, "db.sqlite")), engine = new Engine(reopened, f.provider, { artifactDir: f.engine.artifactDir });
  const media = new LocalMediaService(f.options), bridge = new MediaApplicationService(new ProductionService(reopened, engine), media);
  media.render = () => { throw new Error("recovery must not rerender"); };
  try {
    const recovered = await bridge.recover(f.project.id, f.renderActor, job.id);
    assert.equal(recovered.state, "published");
    assert.equal((await bridge.recover(f.project.id, f.renderActor, job.id)).artifact.artifactId, recovered.artifact.artifactId);
    assert.equal(reopened.list("artifact", f.project.id).filter(a => a.origin === "local_render").length, 1);
  } finally { reopened.close(); }
});

test("two SQLite connections cannot dispatch the same job and recovery respects live ownership", async t => {
  const f = await fixture(t), job = await f.prepare();
  const other = new Store(f.store.path), otherEngine = new Engine(other, f.provider, { artifactDir: f.engine.artifactDir });
  const bridge = new MediaApplicationService(new ProductionService(other, otherEngine), new LocalMediaService(f.options));
  try {
    const running = f.app.run(f.project.id, f.renderActor, job.id);
    await assert.rejects(bridge.run(f.project.id, f.renderActor, job.id), code("MEDIA_RENDER_NOT_READY"));
    await assert.rejects(bridge.recover(f.project.id, f.renderActor, job.id), code("MEDIA_RENDER_BUSY"));
    assert.equal((await running).state, "published");
    const missing = await f.prepare();
    f.store.put("media_render", missing.id, f.project.id, { ...missing, state: "running", ownerToken: "dead-process", leaseUntil: 0 });
    bridge.media.render = () => { throw new Error("must not retry lost local work"); };
    assert.equal((await bridge.recover(f.project.id, f.renderActor, missing.id)).state, "published", "same exact frozen manifest may reuse a verified prior receipt");
    const changed = f.head(); f.store.saveProject({ ...changed, revisionId: newId() }, changed.headVersion);
    const noReceipt = await f.prepare();
    f.store.put("media_render", noReceipt.id, f.project.id, { ...noReceipt, state: "running", ownerToken: "dead-process", leaseUntil: 0 });
    assert.equal((await bridge.recover(f.project.id, f.renderActor, noReceipt.id)).state, "interrupted");
  } finally { other.close(); }
});

test("six-second selected video cannot be satisfied by a one-second supplied clip", async t => {
  const f = await fixture(t), project = f.head(), sceneId = newId(), shotId = newId();
  const shot = { id: shotId, sceneId, revisionId: newId(), purpose: "Detail", action: "Boot still", framing: "Close", motion: "Slow push", desiredFrames: 180,
    imagePrompt: "Boot", videoPrompt: "Slow push", promptIntent: { image: "", video: "" }, referenceArtifactIds: [], cueId: null };
  shot.promptIntent.image = shotIntentDigest(shot, "image"); shot.promptIntent.video = shotIntentDigest(shot, "video");
  const image = { artifactId: newId(), sha256: "1".repeat(64), kind: "image" };
  const next = f.store.saveProject({ ...project, revisionId: newId(), scenes: [{ id: sceneId, revisionId: newId(), purpose: "Scene" }], shots: [shot], artifacts: [...project.artifacts, image] }, project.headVersion);
  const source = `definePlan({baseRevision:${JSON.stringify(next.revisionId)}},p=>{
    const shot=p.shot(${JSON.stringify(shotId)}); const frame=p.asset(${JSON.stringify(image.artifactId)});
    const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:"fake-video-v1",motionPrompt:"Slow push",seconds:6}]});
    const take=p.video("take",{intent:shot,profile:"fake-video-v1",firstFrame:p.approvedImage(frame,review),prompt:"Slow push",seconds:6});
    const timeline=p.timeline("timeline",{takes:[take]}); return p.render("preview",{timeline,width:160,height:90}); });`;
  const compiled = compilePlan(source, { project: next, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: newId }), planId = newId(), video = compiled.nodes.find(n => n.kind === "video");
  const grant = f.engine.createGrant(project.id, shotId, "video", f.human.requestId);
  f.engine.installPlan(project.id, planId, compiled, { [video.id]: grant.id });
  f.store.saveProject({ ...next, revisionId: newId(), activePlanId: planId }, next.headVersion);
  const binding = f.store.get("node_binding", video.id);
  f.store.put("node_binding", video.id, project.id, { ...binding, outputs: { video: f.clips[0] } });
  f.renderNodeId = compiled.nodes.find(n => n.kind === "render").id;
  await assert.rejects(f.prepare(), code("MEDIA_SOURCE_TOO_SHORT"));
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.store.list("attempt", project.id).length, 0);
});

test("mixed canonical narration uses exact sample ranges rather than the single optional DSL audio", async t => {
  const f = await fixture(t), source = await f.media.importMedia({ artifactId: newId(), path: voice, kind: "audio" });
  const audio = { artifactId: source.artifactId, sha256: source.sha256, kind: "audio" };
  const owned = await f.media.verifiedSource(source);
  f.store.insert("artifact", audio.artifactId, f.project.id, { projectId: f.project.id, artifact: audio, fixture: false, path: owned.path, mimeType: "audio/wav", attemptId: null, physicalDurationSeconds: 1 });
  const cues = [0, 1].map(i => ({ id: newId(), meaning: `Line ${i}`, durationFrames: 15, placementFrames: i * 30, audio, accepted: true, measured: true }));
  const scene = { id: newId(), revisionId: newId(), purpose: "Whole scene" };
  const shots = cues.map(cue => ({ id: newId(), sceneId: scene.id, revisionId: newId(), purpose: cue.meaning, action: "Still", framing: "Close", motion: "None", desiredFrames: 15,
    imagePrompt: "Image", videoPrompt: "Video", promptIntent: { image: "unused", video: "unused" }, referenceArtifactIds: [], cueId: cue.id }));
  const project = f.head(); f.store.saveProject({ ...project, revisionId: newId(), scenes: [scene], shots, cues, narration: { script: "Line 0 Line 1", source: "uploaded" }, artifacts: [...project.artifacts, audio] }, project.headVersion);
  const narration = { id: newId(), projectId: project.id, script: "Line 0 Line 1", segments: cues.map((cue, i) => ({ cue, audioPlacement: { source, startSample: i * 1600, durationSamples: 24000, atSample: i * 48000, gainMilliDb: 0 } })) };
  f.store.insert("narration_canonical", narration.id, project.id, narration);
  f.store.put("narration_canonical_head", project.id, project.id, { canonicalId: narration.id });
  f.plan("", scene.id); const job = await f.prepare();
  assert.equal(job.target.canonicalNarrationId, narration.id); assert.equal(job.manifest.audio.length, 2);
  assert.deepEqual(job.manifest.audio.map(a => [a.startSample, a.durationSamples, a.atSample]), [[0, 24000, 0], [1600, 24000, 48000]]);
  const result = await f.app.run(project.id, f.renderActor, job.id);
  const artifact = f.store.get("artifact", result.artifact.artifactId);
  const probe = await execute(ffprobe, ["-v", "error", "-show_streams", "-of", "json", artifact.path], { timeout: 10000 });
  assert.equal(JSON.parse(probe.stdout).streams.find(s => s.codec_type === "audio").sample_rate, "48000");
  const current = f.head(); f.store.saveProject({ ...current, revisionId: newId(), cues: current.cues.map((cue, i) => i ? cue : { ...cue, accepted: false }) }, current.headVersion);
  await assert.rejects(f.prepare(), code("MEDIA_NARRATION_REQUIRED"));
});

test("actor revocation during preparation or import cannot publish durable results", async t => {
  const f = await fixture(t), human = f.production.beginRequest(f.project.id, "human", "Prepare render"), actor = f.production.openEpoch(f.project.id, human).actor;
  const freeze = f.media.freezeManifest.bind(f.media);
  f.media.freezeManifest = async (...args) => { const result = await freeze(...args); f.production.beginRequest(f.project.id, "human", "New direction"); return result; };
  await assert.rejects(f.app.prepareRender(f.project.id, actor, { expectedHeadVersion: f.head().headVersion, renderNodeId: f.renderNodeId, key: "fenced" }), code("EPOCH_REVOKED"));
  assert.equal(f.store.list("media_render", f.project.id).length, 0);
  const current = f.production.beginRequest(f.project.id, "human", "Import video"), oldImport = f.media.importMedia.bind(f.media);
  f.media.importMedia = async (...args) => { const source = await oldImport(...args); f.production.beginRequest(f.project.id, "human", "Supersede import"); return source; };
  await assert.rejects(f.app.importVideo(f.project.id, current, { expectedHeadVersion: f.head().headVersion, path: red, key: "fenced-import" }), code("ACTOR_DENIED"));
  assert.equal(f.store.list("artifact", f.project.id).length, 2);
});

test('owned soundtrack is frozen into the rendered mix with bounded gain and duration', async t => {
  const f = await fixture(t);
  const { NarrationService } = await import('../dist/narration/service.js');
  const narrator = new NarrationService(f.production, f.media);
  const actor = f.production.beginRequest(f.project.id, 'human', 'Add music', { editing: true });
  const recording = await narrator.importAudio(f.project.id, actor, { path: voice, declaredOrigin: 'uploaded', key: 'music-import' });
  f.store.saveProject({ ...f.head(), soundtrack: { audioId: recording.id, gainMilliDb: -18000 } }, f.head().headVersion);
  for (const hold of f.store.list('hold', f.project.id)) if (hold.active && hold.ownerId === actor.requestId) f.engine.releaseHold(f.project.id, hold.id, actor.requestId);
  f.plan(); const job = await f.prepare('music-render');
  assert.equal(job.manifest.audio.length, 1);
  assert.equal(job.manifest.audio[0].gainMilliDb, -18000);
  const result = await f.app.run(f.project.id, f.renderActor, job.id);
  assert.equal(result.state, 'published');
  assert.equal(f.provider.acceptedCount(), 0);
});
