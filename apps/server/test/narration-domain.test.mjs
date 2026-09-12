import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService } from "../dist/media/index.js";
import { NarrationService, compareNarrationProjections, sampleIntervalToFrames } from "../dist/narration/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";

const execute = promisify(execFile);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let inputDir, wav;
before(async () => {
  inputDir = await mkdtemp(join(tmpdir(), "openslate-narration-input-")); wav = join(inputDir, "voice.wav");
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=600:sample_rate=44100:duration=2", "-c:a", "pcm_s16le", wav], { timeout: 15000 });
});
after(async () => { await rm(inputDir, { recursive: true, force: true }); });
const code = expected => error => error?.code === expected;
const draft = (text = "Handmade boots", source = { kind: "uploaded" }) => ({ text, textKind: "draft", language: "en", meaning: text, source });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "openslate-narration-"));
  const store = new Store(join(dir, "db.sqlite")), provider = new FakeProvider(join(dir, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(dir, "fixtures") });
  const production = new ProductionService(store, engine), project = production.createProject("Narration fixture");
  const human = production.beginRequest(project.id, "human", "Develop narration drafts");
  const actor = production.openEpoch(project.id, human).actor;
  const media = new LocalMediaService({ rootDir: join(dir, "media"), allowedInputRoots: [inputDir], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media);
  const f = { dir, store, provider, engine, production, project, human, actor, media, narration, view: narration.snapshot(project.id, human) };
  f.revise = patch => f.view = narration.reviseSegments(project.id, actor, f.view.state.version, randomUUID(), patch);
  f.bind = (segmentId, audioId) => f.view = narration.bindAudio(project.id, actor, f.view.state.version, randomUUID(), segmentId, audioId);
  f.cue = (segmentId, startSample = 4800, endSample = 28800) => f.view = narration.recordHumanCue(project.id, human, f.view.state.version, randomUUID(), { segmentId, startSample, endSample });
  f.place = placements => f.view = narration.placeSegments(project.id, actor, f.view.state.version, randomUUID(), placements);
  f.approve = segmentId => {
    let segment = f.view.segments.find(s => s.entry.segmentId === segmentId);
    f.view = narration.accept(project.id, human, f.view.state.version, randomUUID(), "script", [segment.script.id]);
    f.view = narration.acceptAudio(project.id, human, f.view.state.version, randomUUID(), [{ segmentRevisionId: segment.script.id, audioId: segment.audio.id }]);
    segment = f.view.segments.find(s => s.entry.segmentId === segmentId);
    f.view = narration.accept(project.id, human, f.view.state.version, randomUUID(), "timing", [segment.cue.id]);
  };
  t.after(async () => { if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return f;
}

async function ready(f) {
  f.revise({ add: [draft("Crafted by hand"), draft("Made for your journey")] });
  const audio = await f.narration.importAudio(f.project.id, f.human, { path: wav, declaredOrigin: "uploaded", key: "recording" });
  const ids = f.view.segments.map(s => s.entry.segmentId);
  for (const [index, id] of ids.entries()) { f.bind(id, audio.id); f.cue(id, 4800 + index * 4800, 28800 + index * 4800); f.approve(id); }
  f.place([{ segmentId: ids[0], atSample: 0 }, { segmentId: ids[1], atSample: 48000 }]);
  return { audio, ids, projection: f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true }) };
}

test("text, audio and timing readiness stay independent for partial mixed-source narration", async t => {
  const f = await fixture(t);
  assert.equal(f.view.readiness.text, "none");
  f.revise({ add: [draft("Keep this recording"), draft("Write the missing ending", { kind: "generated", voice: null, profileRevisionId: null })] });
  const audio = await f.narration.importAudio(f.project.id, f.human, { path: wav, declaredOrigin: "uploaded", key: "recording" });
  assert.equal(audio.media.probe.audio.samples, 96000);
  const first = f.view.segments[0].entry.segmentId;
  f.bind(first, audio.id); f.cue(first); f.approve(first);
  assert.equal(f.view.readiness.text, "draft");
  assert.equal(f.view.readiness.audio, "partial");
  assert.equal(f.view.readiness.timing, "partial");
  assert.ok(f.view.readiness.gaps.some(g => g.category === "missing_voice_or_profile"));
  assert.throws(() => f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true }), code("NARRATION_NOT_READY"));
  const second = f.view.segments[1].entry.segmentId;
  const suppliedGenerated = await f.narration.importAudio(f.project.id, f.human, { path: wav, declaredOrigin: "generated", key: "externally-supplied-recording" });
  f.bind(second, suppliedGenerated.id); f.cue(second); f.approve(second);
  f.place([{ segmentId: second, atSample: 48000 }]);
  assert.equal(f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true }).readyForCanonicalCommit, true);
  assert.equal(f.view.segments[1].audio.declaredOrigin, "generated");
  assert.equal(f.provider.acceptedCount(), 0);
});

test("an accepted projection is not a canonical engine mutation and survives application restart", async t => {
  const f = await fixture(t);
  const beforeProject = f.store.getProject(f.project.id), beforeHolds = f.store.list("hold", f.project.id);
  const { projection } = await ready(f);
  assert.equal(projection.readyForCanonicalCommit, true);
  assert.equal(projection.canonicalApplied, false);
  assert.ok(projection.segments.every(s => s.cue.accepted && s.cue.measured));
  assert.deepEqual(f.store.getProject(f.project.id), beforeProject);
  assert.deepEqual(f.store.list("hold", f.project.id), beforeHolds);
  assert.equal(f.store.list("artifact", f.project.id).length, 0, "no fake artifact metadata was fabricated");
  const secondStore = new Store(f.store.path);
  try {
    const secondProduction = new ProductionService(secondStore, f.engine);
    const restarted = new NarrationService(secondProduction, f.media);
    assert.deepEqual(restarted.exportProjection(f.project.id, f.human, { requireAccepted: true }), projection);
  } finally { secondStore.close(); }
});

test("one segment edit keeps recording history and unrelated acceptance but cannot reuse stale human approval", async t => {
  const f = await fixture(t), { audio, ids } = await ready(f);
  const old = f.view, untouched = structuredClone(old.segments[1]);
  f.revise({ update: [{ segmentId: ids[0], draft: draft("A different opening") }] });
  assert.equal(f.view.segments[0].audio.id, audio.id);
  assert.equal(f.view.segments[0].cue, null);
  assert.deepEqual(f.view.segments[0].accepted, { script: false, audio: false, timing: false });
  assert.deepEqual(f.view.segments[1], untouched);
  assert.ok(f.store.get("narration_cue", old.segments[0].cue.id));
  assert.deepEqual(f.store.get("narration_audio", audio.id), audio);
  assert.throws(() => f.narration.accept(f.project.id, f.human, f.view.state.version, "stale-script", "script", [old.segments[0].script.id]), code("NARRATION_STALE_ACCEPTANCE"));
  assert.throws(() => f.narration.accept(f.project.id, f.human, f.view.state.version, "stale-timing", "timing", [old.segments[0].cue.id]), code("NARRATION_STALE_ACCEPTANCE"));
  assert.equal(f.narration.exportProjection(f.project.id, f.human).readyForCanonicalCommit, false);
});

test("later placement preserves artifact-local cues and visual fingerprints while requiring a new render", async t => {
  const f = await fixture(t), { ids, projection } = await ready(f);
  const originalCue = structuredClone(f.view.segments[1].cue);
  f.place([{ segmentId: ids[1], atSample: 64000 }]);
  const next = f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true });
  assert.deepEqual(f.view.segments[1].cue, originalCue);
  assert.equal(next.segments[1].audioPlacement.startSample, 9600);
  assert.equal(next.segments[1].audioPlacement.atSample, 64000);
  assert.equal(next.segments[1].cue.placementFrames, 40);
  assert.deepEqual(compareNarrationProjections(projection, next).map(i => [i.visual, i.render]), [["reuse", "reuse"], ["reuse", "replace"]]);
  f.cue(ids[1], 9600, 35200); f.approve(ids[1]);
  const longer = f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true });
  assert.equal(compareNarrationProjections(next, longer)[1].reason, "meaning_or_duration");
});

test("exact normalized bytes reuse rendering regardless of a replacement descriptor identity", async t => {
  const f = await fixture(t), { projection } = await ready(f);
  const sameBytes = structuredClone(projection);
  sameBytes.segments[0].audioPlacement.source.id = randomUUID();
  sameBytes.segments[0].audioPlacement.source.artifactId = randomUUID();
  sameBytes.segments[0].cue.audio.artifactId = randomUUID();
  assert.equal(compareNarrationProjections(projection, sameBytes)[0].render, "reuse");
});

test("sub-frame placement changes coverage without changing relative visual duration", async t => {
  const f = await fixture(t), { ids } = await ready(f);
  f.cue(ids[0], 0, 24001); f.approve(ids[0]);
  const before = f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true });
  f.place([{ segmentId: ids[0], atSample: 799 }]);
  const after = f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true });
  assert.equal(before.segments[0].cue.durationFrames, 15);
  assert.equal(after.segments[0].cue.durationFrames, 15);
  assert.equal(before.segments[0].frameCoverage.endFrame, 15);
  assert.equal(after.segments[0].frameCoverage.endFrame, 16);
  assert.equal(compareNarrationProjections(before, after)[0].visual, "reuse");
  assert.equal(compareNarrationProjections(before, after)[0].render, "replace");
});

test("revisions and command identity prevent stale writes and duplicate edits", async t => {
  const f = await fixture(t), patch = { add: [draft()] };
  const one = f.narration.reviseSegments(f.project.id, f.actor, 0, "one", patch);
  assert.deepEqual(f.narration.reviseSegments(f.project.id, f.actor, 0, "one", patch), one);
  assert.equal(f.store.list("narration_segment", f.project.id).length, 1);
  assert.throws(() => f.narration.reviseSegments(f.project.id, f.actor, 0, "one", { add: [draft("changed")] }), code("IDEMPOTENCY_CONFLICT"));
  assert.throws(() => f.narration.reviseSegments(f.project.id, f.actor, 0, "new-key", patch), code("REVISION_CONFLICT"));
  assert.equal(f.narration.snapshot(f.project.id, f.human).state.version, 1);
});

test("directors cannot claim human audio/timing approval and revoked requests cannot mutate drafts", async t => {
  const f = await fixture(t); f.revise({ add: [draft()] });
  assert.throws(() => f.narration.accept(f.project.id, f.actor, f.view.state.version, "fake-approval", "script", [f.view.segments[0].script.id]), code("ACTOR_DENIED"));
  assert.throws(() => f.narration.recordHumanCue(f.project.id, f.actor, f.view.state.version, "fake-cue", { segmentId: f.view.segments[0].entry.segmentId, startSample: 0, endSample: 1600 }), code("ACTOR_DENIED"));
  f.production.beginRequest(f.project.id, "human", "New direction");
  assert.throws(() => f.revise({ add: [draft()] }), code("EPOCH_REVOKED"));
  assert.equal(f.store.list("narration_segment", f.project.id).length, 1);
});

test("late local import rechecks its original request and idempotent imports preserve exact identity", async t => {
  const f = await fixture(t);
  const input = { path: wav, declaredOrigin: "uploaded", key: "one" };
  const audio = await f.narration.importAudio(f.project.id, f.human, input);
  assert.deepEqual(await f.narration.importAudio(f.project.id, f.human, input), audio);
  await assert.rejects(f.narration.importAudio(f.project.id, f.human, { ...input, declaredOrigin: "generated" }), code("IDEMPOTENCY_CONFLICT"));
  const pending = f.narration.importAudio(f.project.id, f.human, { ...input, key: "late" });
  f.production.beginRequest(f.project.id, "human", "Supersede the import request");
  await assert.rejects(pending, code("ACTOR_DENIED"));
  assert.equal(f.store.list("narration_audio", f.project.id).length, 1);
});

test("bounds, overlap, and cross-project source references cannot become accepted export timing", async t => {
  const f = await fixture(t), { ids } = await ready(f);
  assert.throws(() => f.cue(ids[0], 0, 96001), code("NARRATION_CUE_OUT_OF_RANGE"));
  assert.throws(() => f.cue(ids[0], 0.5, 24000), code("NARRATION_INVALID_INPUT"));
  f.place([{ segmentId: ids[1], atSample: 1000 }]);
  assert.throws(() => f.narration.exportProjection(f.project.id, f.human, { requireAccepted: true }), code("NARRATION_NOT_READY"));
  f.place([{ segmentId: ids[1], atSample: 48000 * 360 }]);
  assert.ok(f.narration.exportProjection(f.project.id, f.human).gaps.some(g => g.category === "export_duration"));
  const second = f.production.createProject("Other");
  const foreignId = randomUUID();
  f.store.insert("narration_audio", foreignId, second.id, { media: {}, declaredOrigin: "uploaded", requestId: "fixture" });
  assert.throws(() => f.bind(ids[0], foreignId), code("SCOPE_DENIED"));
});

test("sample conversion rounds absolute boundaries once instead of accumulating per-segment error", () => {
  assert.deepEqual(sampleIntervalToFrames(64000, 24000), { placementFrames: 40, durationFrames: 15 });
  assert.deepEqual(sampleIntervalToFrames(799, 801), { placementFrames: 0, durationFrames: 1 });
  assert.deepEqual(sampleIntervalToFrames(800, 800), { placementFrames: 1, durationFrames: 0 });
  assert.throws(() => sampleIntervalToFrames(0.1, 1600), code("NARRATION_INVALID_INPUT"));
});
