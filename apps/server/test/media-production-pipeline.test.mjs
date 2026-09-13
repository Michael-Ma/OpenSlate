import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PROFILES, digest, newId, providerProfileArguments } from "@openslate/core";
import { FakeProvider, OPENAI_IMAGE_MODEL } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { ProductionService } from "../dist/application/service.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { createMediaExecutionRuntime } from "../dist/application/media-execution-runtime.js";
import { allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { NarrationService, NarrationCanonicalService } from "../dist/narration/index.js";

const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const imageProfile = { id: "pipeline-image", revision: "1", kind: "image", adapter: "openai-image", executionVersion: "1",
  configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium" } }, maxConcurrency: 1, unitCostMicros: "100000", maxRetries: 0 };
const videoProfile = { id: "pipeline-video", revision: "1", kind: "video", adapter: "minimax-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3", settings: { resolution: "768P" } }, maxConcurrency: 1, unitCostMicros: "200000", maxRetries: 0, minFrames: 120, maxFrames: 450 };

test("production composition gates exact frames and spending, then automatically renders injected H3 media with accepted narration across restart", { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "openslate-production-pipeline-"));
  const calls = { image: 0, submit: 0, poll: 0, download: 0, lookup: 0, render: 0 };
  let store, provider, runtime, production;
  t.after(async () => { if (store?.db.open) store.close(); if (provider?.db.open) provider.close(); await rm(directory, { recursive: true, force: true }); });
  const pngPath = join(directory, "synthetic-frame.png"), mp4Path = join(directory, "synthetic-provider.mp4");
  await execute(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=1024x1024", "-frames:v", "1", "-threads", "1", pngPath], { timeout: 15000 });
  await execute(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=160x90:r=24:d=6", "-an", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", mp4Path], { timeout: 15000 });
  const png = await readFile(pngPath), video = await readFile(mp4Path), taskId = "offline-pipeline-h3-task";
  const open = () => {
    store = new Store(join(directory, "state.sqlite")); provider = new FakeProvider(join(directory, "fake.sqlite"));
    runtime = createMediaExecutionRuntime({ store, fakeProvider: provider, dataDirectory: directory, ffmpegPath, ffprobePath,
      configuration: { image: true, h3: true, h3DownloadHosts: ["media.example.test"] },
      credentials: new EnvironmentMediaCredentials(() => "offline-synthetic-key-never-live"),
      providerConfiguration: { version: 1, profiles: [{ label: "Test image", profile: imageProfile }, { label: "Test video", profile: videoProfile }] },
      transport: {
        imageFetch: async (_url, init) => { calls.image++; assert.equal(init.method, "POST"); return Response.json({ created: 1789200000, data: [{ b64_json: png.toString("base64") }] }); },
        h3Fetch: async (_url, init) => {
          if (init.method === "POST") {
            calls.submit++; const body = JSON.parse(init.body);
            assert.ok(body.content.some(item => item.type === "image_url" && item.image_url.url === `data:image/png;base64,${png.toString("base64")}`));
            return Response.json({ task_id: taskId });
          }
          calls.poll++; return Response.json({ task: { id: taskId, model: "MiniMax-H3", status: "succeeded", duration: 6,
            resolution: "768P", usage: { total_seconds: 6 }, content: { url: "https://media.example.test/output.mp4?signature=offline" } } });
        },
        download: {
          lookup: async () => { calls.lookup++; return [{ address: "8.8.8.8", family: 4 }]; },
          request: (args, callback) => {
            calls.download++; const client = new EventEmitter(); let body, destroyed = false;
            client.destroy = () => { if (!destroyed) { destroyed = true; args.signal.removeEventListener("abort", abort); body?.destroy(); queueMicrotask(() => client.emit("close")); } return client; };
            const abort = () => { body?.destroy(Error("cancelled")); client.emit("error", Error("cancelled")); client.destroy(); };
            args.signal.addEventListener("abort", abort, { once: true });
            client.end = () => queueMicrotask(() => { body = Readable.from([video]); body.on("error", () => {}); body.statusCode = 200;
              body.headers = { "content-type": "video/mp4", "content-length": String(video.length) }; callback(body); });
            return client;
          },
        },
      },
    });
    const render = runtime.localMedia.render.bind(runtime.localMedia);
    runtime.localMedia.render = (...args) => { calls.render++; return render(...args); };
    production = new ProductionService(store, runtime.engine, DEFAULT_PROFILES, runtime.productionOptions);
  };
  open();
  const project = production.createProject("Offline production pipeline", runtime.providerCatalog.select(runtime.providerCatalog.digest, [imageProfile.id, videoProfile.id]));
  const projectId = project.id, head = () => store.getProject(projectId);
  const human = production.beginRequest(projectId, "human", "Make one blue product shot using my supplied narration");
  const creative = await production.prepare(projectId, human, { variant: "project", expectedHeadVersion: head().headVersion, creative: {
    brief: "A blue product study", story: "Show the product with a short spoken line", createScenes: [{ key: "scene", purpose: "Product" }],
    createShots: [{ key: "shot", sceneId: "scene", purpose: "Show the product", action: "Product on a bench", framing: "Wide", motion: "Slow push",
      desiredFrames: 180, imagePrompt: "Blue product on a bench", videoPrompt: "Slow push toward the blue product", referenceArtifactIds: [], cueId: null }],
  } });
  production.apply(projectId, human, creative.id);
  const narration = new NarrationService(production, runtime.localMedia), canonical = new NarrationCanonicalService(narration);
  const view = () => narration.snapshot(projectId, human), wavPath = join(runtime.uploadDirectory, "supplied.wav");
  await execute(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=700:sample_rate=48000:duration=6", "-c:a", "pcm_s16le", wavPath], { timeout: 15000 });
  narration.reviseSegments(projectId, human, view().state.version, newId(), { add: [{ text: "Crafted to last.", meaning: "Crafted to last.", textKind: "draft", language: "en", source: { kind: "uploaded" } }] });
  const recording = await narration.importAudio(projectId, human, { path: wavPath, declaredOrigin: "uploaded", key: newId() });
  const segmentId = view().segments[0].entry.segmentId;
  narration.bindAudio(projectId, human, view().state.version, newId(), segmentId, recording.id);
  narration.recordHumanCue(projectId, human, view().state.version, newId(), { segmentId, startSample: 0, endSample: 288000 });
  let segment = view().segments[0];
  narration.accept(projectId, human, view().state.version, newId(), "script", [segment.script.id]);
  narration.acceptAudio(projectId, human, view().state.version, newId(), [{ segmentRevisionId: segment.script.id, audioId: segment.audio.id }]);
  segment = view().segments[0]; narration.accept(projectId, human, view().state.version, newId(), "timing", [segment.cue.id]);
  narration.placeSegments(projectId, human, view().state.version, newId(), [{ segmentId, atSample: 0 }]);
  const narrationChange = canonical.prepare(projectId, human, { expectedHeadVersion: head().headVersion, expectedNarrationVersion: view().state.version,
    shotMappings: [{ shotId: head().shots[0].id, segmentId }], key: newId() });
  await canonical.apply(projectId, human, narrationChange.id);
  const shot = head().shots[0], cueId = canonical.current(projectId, human).segments[0].cue.id, q = JSON.stringify;
  production.authorize(projectId, human, ["image", "video"].map(kind => ({ scopeId: shot.id, kind })), newId(), "initial_slot");
  const source = `definePlan({baseRevision:${q(head().revisionId)}},p=>{
    const shot=p.shot(${q(shot.id)});const frame=p.image("frame",{intent:shot,profile:${q(imageProfile.id)},prompt:${q(shot.imagePrompt)}});
    const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:${q(videoProfile.id)},motionPrompt:${q(shot.videoPrompt)},seconds:6}]});
    const take=p.video("take",{intent:shot,profile:${q(videoProfile.id)},firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:6});
    const timeline=p.timeline("timeline",{takes:[take],cueRange:${q(cueId)},transition:"cut"});return p.render("preview",{timeline,width:160,height:90});});`;
  const prepared = await production.prepare(projectId, human, { variant: "plan", expectedHeadVersion: head().headVersion, source,
    creative: { updateShots: [{ id: shot.id, reauthorPrompts: true }] } });
  production.apply(projectId, human, prepared.id);
  const binding = kind => store.list("node_binding", projectId).find(value => value.node.kind === kind);
  const issue = profile => {
    const selected = binding(profile.kind), input = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
      selections: [{ candidateId: selected.candidateId, nodeId: selected.id, specDigest: selected.node.specDigest }], maxAttempts: 1,
      maxEstimatedMicros: profile.unitCostMicros, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const reviewer = production.beginRequest(projectId, "human", "Allow one exact synthetic test operation", { editing: false, contextDigest: allowanceIssueContextDigest(projectId, input) });
    return runtime.allowances.issue(projectId, reviewer, input);
  };
  let result = await runtime.engine.runReady();
  assert.ok(result.blocked.some(item => item.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE")); assert.equal(runtime.engine.attempts(projectId).length, 0);
  issue(imageProfile); issue(videoProfile);
  result = await runtime.engine.runReady();
  const frameOutput = runtime.engine.outputs(projectId).find(output => output.nodeId === binding("image").id);
  assert.ok(frameOutput, JSON.stringify({ result, attempts: runtime.engine.attempts(projectId) }));
  const frameRef = frameOutput.artifact;
  assert.equal(frameRef.sha256, hash(png)); assert.deepEqual(await readFile(store.get("artifact", frameRef.artifactId).path), png);
  for (let pass = 0; pass < 2; pass++) await runtime.engine.runReady();
  assert.equal(calls.submit, 0, "A spending allowance cannot stand in for exact keyframe review");
  assert.equal(store.list("external_allowance_consumption", projectId).length, 1);
  const reviewer = production.beginRequest(projectId, "human", "Approve this exact blue keyframe", { editing: false });
  const review = runtime.engine.reviewSnapshot(projectId);
  production.approve(projectId, reviewer, review.id, [binding("video").id]);
  await runtime.engine.runReady();
  assert.equal(calls.submit, 1); assert.equal(runtime.engine.attempts(projectId).find(a => a.request.kind === "video").phase, "remote_pending");
  // Observe the real durable poll cooldown rather than modifying persisted scheduling records.
  await new Promise(resolve => setTimeout(resolve, 2100));
  await runtime.engine.reconcile();
  for (let pass = 0; pass < 4 && !binding("render").outputs.video; pass++) await runtime.engine.runReady();
  const output = binding("render").outputs.video; assert.ok(output, JSON.stringify(runtime.engine.attempts(projectId)));
  const artifact = store.get("artifact", output.artifactId);
  assert.equal(artifact.fixture, false); assert.equal(artifact.origin, "local_render"); assert.equal(artifact.physicalDurationSeconds, 6);
  assert.equal(output.sha256, hash(await readFile(artifact.path)));
  const { stdout: pixels } = await execute(ffmpegPath, ["-nostdin", "-v", "error", "-i", artifact.path, "-map", "0:v:0", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 15000 });
  assert.equal(pixels.length, 180 * 3);
  for (let i = 0; i < 180; i++) assert.ok(pixels[i * 3] < 40 && pixels[i * 3 + 1] < 40 && pixels[i * 3 + 2] > 200, `Unexpected picture at frame ${i}`);
  const { stdout: samples } = await execute(ffmpegPath, ["-nostdin", "-v", "error", "-i", artifact.path, "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024, timeout: 15000 });
  assert.ok(Math.abs(samples.length / 2 - 288000) <= 2048);
  let energy = 0; for (let i = 1000; i < 287000; i++) energy += samples.readInt16LE(i * 2) ** 2;
  assert.ok(Math.sqrt(energy / 286000) > 500, "Accepted narration is audible");
  const attempts = runtime.engine.attempts(projectId);
  assert.equal(attempts.length, 4); assert.ok(attempts.every(attempt => attempt.phase === "succeeded"));
  const local = attempts.filter(attempt => attempt.request.execution.adapter === "local-media");
  assert.equal(local.length, 2); assert.ok(local.every(attempt => attempt.taskId === null && attempt.candidateId === null && attempt.reservationId === null));
  assert.equal(store.list("external_allowance_consumption", projectId).length, 2); assert.equal(store.list("local_execution_completion", projectId).length, 2);
  assert.equal(provider.acceptedCount(), 0); assert.deepEqual(calls, { image: 1, submit: 1, poll: 1, download: 1, lookup: 1, render: 1 });
  const before = structuredClone(calls), savedIds = attempts.map(attempt => attempt.id);
  store.close(); provider.close(); open();
  runtime.localMedia.render = () => { throw Error("Completed production must not render again after restart"); };
  await runtime.engine.reconcile(); await runtime.engine.runReady();
  assert.deepEqual(runtime.engine.attempts(projectId).map(attempt => attempt.id), savedIds); assert.deepEqual(calls, before);
  assert.equal(binding("render").outputs.video.artifactId, output.artifactId);
});
