import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DEFAULT_PROFILES, newId } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { LocalMediaExecutor } from "../dist/execution/local-media-executor.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService, MediaApplicationService } from "../dist/media/index.js";
import { NarrationService, NarrationCanonicalService } from "../dist/narration/index.js";

const execute = promisify(execFile);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputs, red, blue, voice;
before(async () => {
  inputs = await mkdtemp(join(tmpdir(), "openslate-local-worker-input-"));
  red = join(inputs, "red.mp4"); blue = join(inputs, "blue.mp4"); voice = join(inputs, "voice.wav");
  for (const [color, path] of [["red", red], ["blue", blue]]) await execute(ffmpeg,
    ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=160x90:r=30:d=1`, "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", path], { timeout: 15000 });
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=3", "-c:a", "pcm_s16le", voice], { timeout: 15000 });
});
after(async () => { if (inputs) await rm(inputs, { recursive: true, force: true }); });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-local-worker-"));
  const f = { dir, artifactDir: join(dir, "artifacts"), dbPath: join(dir, "state.sqlite"), providerPath: join(dir, "fake.sqlite"), renderCalls: 0, clips: [] };
  f.options = { rootDir: join(dir, "media"), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe };
  f.open = () => {
    f.store = new Store(f.dbPath); f.provider = new FakeProvider(f.providerPath);
    f.provider.submit = () => { throw Error("A supplied-media plan must never submit provider work"); };
    f.media = new LocalMediaService(f.options);
    const render = f.media.render.bind(f.media);
    f.media.render = (...args) => { f.renderCalls++; return render(...args); };
    f.worker = new LocalMediaExecutor(f.store, f.media, { artifactDir: f.artifactDir });
    f.engine = new Engine(f.store, f.provider, { artifactDir: f.artifactDir, localExecution: f.worker });
    f.production = new ProductionService(f.store, f.engine, DEFAULT_PROFILES, { newProjectLocalExecution: { adapter: "local-media", version: "1" } });
    f.app = new MediaApplicationService(f.production, f.media);
    f.narration = new NarrationService(f.production, f.media); f.canonical = new NarrationCanonicalService(f.narration);
  };
  f.close = () => { if (f.store?.db.open) f.store.close(); if (f.provider?.db.open) f.provider.close(); };
  t.after(async () => { f.close(); await rm(dir, { recursive: true, force: true }); });
  f.open(); f.project = f.production.createProject("Two supplied takes with accepted narration");
  f.human = f.production.beginRequest(f.project.id, "human", "Use my two clips and recording");
  f.head = () => f.store.getProject(f.project.id);
  f.view = () => f.narration.snapshot(f.project.id, f.human);
  for (const path of [red, blue]) {
    const imported = await f.app.importVideo(f.project.id, f.human, { path, expectedHeadVersion: f.head().headVersion, key: newId() });
    f.clips.push(imported.artifact);
  }
  f.narration.reviseSegments(f.project.id, f.human, f.view().state.version, newId(), { add: [
    { text: "Crafted to last.", meaning: "Crafted to last.", textKind: "draft", language: "en", source: { kind: "uploaded" } },
  ] });
  const audio = await f.narration.importAudio(f.project.id, f.human, { path: voice, declaredOrigin: "uploaded", key: newId() });
  f.segmentId = f.view().segments[0].entry.segmentId;
  f.narration.bindAudio(f.project.id, f.human, f.view().state.version, newId(), f.segmentId, audio.id);
  f.narration.recordHumanCue(f.project.id, f.human, f.view().state.version, newId(), { segmentId: f.segmentId, startSample: 12000, endSample: 84000 });
  let segment = f.view().segments[0];
  f.narration.accept(f.project.id, f.human, f.view().state.version, newId(), "script", [segment.script.id]);
  f.narration.acceptAudio(f.project.id, f.human, f.view().state.version, newId(), [{ segmentRevisionId: segment.script.id, audioId: segment.audio.id }]);
  segment = f.view().segments[0];
  f.narration.accept(f.project.id, f.human, f.view().state.version, newId(), "timing", [segment.cue.id]);
  f.commitNarration = async atSample => {
    f.narration.placeSegments(f.project.id, f.human, f.view().state.version, newId(), [{ segmentId: f.segmentId, atSample }]);
    const prepared = f.canonical.prepare(f.project.id, f.human, { expectedHeadVersion: f.head().headVersion, expectedNarrationVersion: f.view().state.version, shotMappings: [], key: newId() });
    return f.canonical.apply(f.project.id, f.human, prepared.id);
  };
  await f.commitNarration(12000);
  f.plan = async ({ clips = f.clips, creative } = {}) => {
    const head = f.head(), cueId = f.canonical.current(head.id, f.human).segments[0].cue.id;
    const source = `definePlan({baseRevision:${JSON.stringify(head.revisionId)}},p=>{
      const timeline=p.timeline("timeline",{takes:[${clips.map(a => `p.asset(${JSON.stringify(a.artifactId)})`).join(",")}],cueRange:${JSON.stringify(cueId)},transition:"cut"});
      return p.render("preview",{timeline,width:160,height:90}); });`;
    const prepared = await f.production.prepare(head.id, f.human, { variant: "plan", expectedHeadVersion: head.headVersion, source, ...(creative ? { creative } : {}) });
    f.production.apply(head.id, f.human, prepared.id);
    f.timelineNodeId = prepared.compiled.nodes.find(n => n.kind === "timeline").id;
    f.renderNodeId = prepared.compiled.nodes.find(n => n.kind === "render").id;
    return prepared;
  };
  await f.plan();
  f.output = port => f.engine.outputs(f.project.id).find(output => output.port === port);
  f.assertNoPaidWork = () => {
    assert.equal(f.provider.acceptedCount(), 0);
    for (const kind of ["grant", "candidate", "reservation", "external_allowance_consumption"])
      assert.equal(f.store.list(kind, f.project.id).length, 0, `Unexpected ${kind}`);
    for (const attempt of f.engine.attempts(f.project.id)) {
      assert.deepEqual(attempt.request.execution, { adapter: "local-media", version: "1" });
      assert.equal(attempt.candidateId, null); assert.equal(attempt.reservationId, null); assert.equal(attempt.taskId, null);
    }
  };
  f.finish = async () => {
    for (let turn = 0; turn < 4 && !f.output("video"); turn++) await f.engine.runReady();
    assert.ok(f.output("video"), JSON.stringify(f.engine.attempts(f.project.id)));
    return f.store.get("artifact", f.output("video").artifact.artifactId);
  };
  return f;
}

async function pictureColors(path) {
  const { stdout } = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", path, "-map", "0:v:0", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 15000 });
  assert.equal(stdout.length, 60 * 3);
  return Array.from({ length: 60 }, (_, i) => Array.from(stdout.subarray(i * 3, i * 3 + 3)));
}
function assertColors(colors, first = "red") {
  for (const [i, rgb] of colors.entries()) {
    const redFirst = first === "red", isRed = i < 30 ? redFirst : !redFirst;
    assert.ok(isRed ? rgb[0] > 200 && rgb[1] < 40 && rgb[2] < 40 : rgb[2] > 200 && rgb[0] < 40 && rgb[1] < 40, `Unexpected frame ${i}: ${rgb}`);
  }
}
function rms(bytes, from, to) {
  let energy = 0;
  for (let i = from; i < to; i++) energy += bytes.readInt16LE(i * 2) ** 2;
  return Math.sqrt(energy / (to - from));
}
function barrier() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test("automatic Engine assembly decodes two real takes and exact human-accepted canonical narration", async t => {
  const f = await fixture(t), artifact = await f.finish();
  assert.equal(f.renderCalls, 1); assert.equal(artifact.fixture, false); assert.equal(artifact.origin, "local_render");
  assert.equal(artifact.physicalDurationSeconds, 2); assert.equal(artifact.width, 160); assert.equal(artifact.height, 90);
  assert.equal(createHash("sha256").update(await readFile(artifact.path)).digest("hex"), artifact.artifact.sha256);
  assertColors(await pictureColors(artifact.path));
  const { stdout } = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", artifact.path, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 15000 });
  assert.ok(Math.abs(stdout.length / 2 - 96000) <= 2048);
  assert.ok(rms(stdout, 1000, 8000) < 10, "Leading silence survives the selected placement");
  assert.ok(rms(stdout, 20000, 70000) > 500, "Selected accepted narration is audible");
  assert.ok(rms(stdout, 89000, 95000) < 10, "Trailing silence survives the selected trim");
  const intents = f.store.list("local_execution_intent", f.project.id), canonical = f.canonical.current(f.project.id, f.human);
  assert.deepEqual(intents.map(i => i.prepared.kind).sort(), ["render", "timeline"]);
  for (const intent of intents) {
    assert.equal(intent.prepared.capture.target.canonicalNarrationId, canonical.id);
    assert.deepEqual(intent.prepared.capture.input.audio, canonical.segments.map(segment => segment.audioPlacement));
  }
  assert.equal(f.store.list("local_execution_completion", f.project.id).length, 2);
  assert.ok(f.engine.attempts(f.project.id).every(a => a.phase === "succeeded")); f.assertNoPaidWork();
});

test("render filesystem receipt survives SQL publication rollback and restart without another render", async t => {
  const f = await fixture(t); await f.engine.runReady();
  assert.ok(f.output("timeline")); assert.equal(f.output("video"), undefined);
  const insert = f.store.insert.bind(f.store); let failed = false;
  f.store.insert = (...args) => {
    if (args[0] === "artifact" && args[3].origin === "local_render" && !failed) { failed = true; throw Error("synthetic local artifact publication failure"); }
    return insert(...args);
  };
  await assert.rejects(f.engine.runReady(), /synthetic local artifact publication failure/); assert.equal(failed, true);
  assert.equal(f.output("video"), undefined); assert.equal(f.renderCalls, 1);
  const pending = f.engine.attempts(f.project.id).find(a => a.request.kind === "render");
  assert.notEqual(pending.phase, "succeeded"); assert.equal(f.store.list("artifact", f.project.id).filter(a => a.origin === "local_render").length, 0);
  f.close(); f.open(); f.media.render = () => { throw Error("Recovery must not invoke FFmpeg render"); };
  const result = await f.engine.reconcile(); assert.equal(result.reconciled, 1);
  const artifact = f.store.get("artifact", f.output("video").artifact.artifactId);
  assertColors(await pictureColors(artifact.path)); assert.equal(f.renderCalls, 1);
  assert.equal(f.engine.attempts(f.project.id).find(a => a.id === pending.id).phase, "succeeded");
  assert.equal(f.store.list("artifact", f.project.id).filter(a => a.origin === "local_render").length, 1);
  await f.engine.reconcile(); await f.engine.runReady(); assert.equal(f.engine.attempts(f.project.id).length, 2); f.assertNoPaidWork();
});

for (const reason of ["pause", "human edit"]) test(`a real render completed during ${reason} stays historical until current work is released`, async t => {
  const f = await fixture(t); await f.engine.runReady();
  const rendered = barrier(), release = barrier(), render = f.media.render.bind(f.media);
  f.media.render = async (...args) => { const completion = await render(...args); rendered.resolve(); await release.promise; return completion; };
  const running = f.engine.runReady();
  try {
    await Promise.race([rendered.promise, running.then(() => { throw Error("Render did not reach the completion barrier"); })]);
    if (reason === "pause") f.engine.setPaused(f.project.id, true, f.human.requestId);
    else f.human = f.production.beginRequest(f.project.id, "human", "Hold the completed output while we review an edit");
  } finally { release.resolve(); }
  await running;
  assert.equal(f.output("video"), undefined); assert.equal(f.renderCalls, 1);
  assert.equal(f.store.list("artifact", f.project.id).filter(a => a.origin === "local_render").length, 1);
  assert.equal(f.engine.attempts(f.project.id).find(a => a.request.kind === "render").phase, "succeeded");
  if (reason === "pause") f.engine.setPaused(f.project.id, false, f.human.requestId);
  else await f.plan();
  await f.finish(); assert.equal(f.renderCalls, 1); assert.equal(f.engine.attempts(f.project.id).length, 2); f.assertNoPaidWork();
});

test("brief-only replanning reuses verified local content while reversing supplied takes creates new output", async t => {
  const f = await fixture(t), first = await f.finish(), initialAttempts = f.engine.attempts(f.project.id).map(a => a.id);
  f.human = f.production.beginRequest(f.project.id, "human", "Clarify the brief without changing media");
  await f.plan({ creative: { brief: "Show a red boot, then a blue boot." } });
  const reused = await f.finish();
  assert.equal(reused.artifact.artifactId, first.artifact.artifactId); assert.equal(f.renderCalls, 1);
  assert.deepEqual(f.engine.attempts(f.project.id).map(a => a.id), initialAttempts);
  f.human = f.production.beginRequest(f.project.id, "human", "Put the blue shot before the red shot");
  await f.plan({ clips: [...f.clips].reverse() }); const changed = await f.finish();
  assert.notEqual(changed.artifact.artifactId, first.artifact.artifactId); assert.notEqual(changed.artifact.sha256, first.artifact.sha256);
  assert.equal(f.renderCalls, 2); assert.equal(f.engine.attempts(f.project.id).length, 4);
  assertColors(await pictureColors(changed.path), "blue"); assert.ok(f.store.get("artifact", first.artifact.artifactId)); f.assertNoPaidWork();
});

test("sample-only canonical placement change invalidates assembly content despite unchanged supplied takes", async t => {
  const f = await fixture(t), first = await f.finish();
  const previous = f.store.list("local_execution_intent", f.project.id).map(i => i.prepared.contentDigest);
  f.human = f.production.beginRequest(f.project.id, "human", "Move the narration slightly later");
  await f.commitNarration(12001); await f.plan(); const next = await f.finish();
  assert.notEqual(next.artifact.artifactId, first.artifact.artifactId); assert.equal(f.renderCalls, 2);
  const intents = f.store.list("local_execution_intent", f.project.id);
  assert.equal(intents.length, 4); assert.equal(new Set(intents.map(i => i.prepared.contentDigest)).size, 4);
  const newer = intents.filter(i => !previous.includes(i.prepared.contentDigest));
  assert.ok(newer.every(i => i.prepared.capture.input.audio[0].atSample === 12001)); f.assertNoPaidWork();
});
