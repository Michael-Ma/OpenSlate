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
import { NarrationService, NarrationCanonicalService, sampleIntervalToFrames } from "../dist/narration/index.js";
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
  t.after(async () => { if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); });
  return f;
}

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


test("sample conversion rounds absolute boundaries once instead of accumulating per-segment error", () => {
  assert.deepEqual(sampleIntervalToFrames(64000, 24000), { placementFrames: 40, durationFrames: 15 });
  assert.deepEqual(sampleIntervalToFrames(799, 801), { placementFrames: 0, durationFrames: 1 });
  assert.deepEqual(sampleIntervalToFrames(800, 800), { placementFrames: 1, durationFrames: 0 });
  assert.throws(() => sampleIntervalToFrames(0.1, 1600), code("NARRATION_INVALID_INPUT"));
});

test('project-wide human scope cannot cue, accept, place or prepare canonical narration and creates no partial decisions', async t => {
  const f=await fixture(t);f.revise({add:[draft()]});
  const row=f.view.segments[0],version=f.view.state.version,canonical=new NarrationCanonicalService(f.narration);
  const before=f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all(),cursor=f.store.cursor(f.project.id),commands=f.store.db.prepare('SELECT * FROM commands ORDER BY rowid').all();
  const operations=[
    ()=>f.narration.recordHumanCue(f.project.id,f.human,version,randomUUID(),{segmentId:row.entry.segmentId,startSample:0,endSample:1600}),
    ()=>f.narration.accept(f.project.id,f.human,version,randomUUID(),'script',[row.script.id]),
    ()=>f.narration.accept(f.project.id,f.human,version,randomUUID(),'timing',[randomUUID()]),
    ()=>f.narration.acceptAudio(f.project.id,f.human,version,randomUUID(),[{segmentRevisionId:row.script.id,audioId:randomUUID()}]),
    ()=>f.narration.placeSegments(f.project.id,f.human,version,randomUUID(),[{segmentId:row.entry.segmentId,atSample:0}]),
    ()=>canonical.prepare(f.project.id,f.human,{expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:version,segmentIds:[row.entry.segmentId],shotRelativeSegmentIds:[row.entry.segmentId],shotDurationMode:'preserve',shotMappings:[{shotId:'shot-0',segmentId:row.entry.segmentId}],key:randomUUID()}),
  ];
  for(const operation of operations){
    assert.throws(operation,{code:'NARRATION_SHOT_SCOPE_REQUIRED'});
    assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all(),before);assert.equal(f.store.cursor(f.project.id),cursor);assert.deepEqual(f.store.db.prepare('SELECT * FROM commands ORDER BY rowid').all(),commands);
    assert.equal(f.narration.workspaceSnapshot(f.project.id).state.version,version);
  }
});
