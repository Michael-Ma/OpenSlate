import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PROFILES, digest, newId, providerProfileArguments } from "@openslate/core";
import { FakeProvider, OPENAI_IMAGE_MODEL } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { ProductionService } from "../dist/application/service.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { createMediaExecutionRuntime } from "../dist/application/media-execution-runtime.js";
import { allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { InstalledProviderCatalog } from "../dist/application/provider-catalog.js";
import { assertViggleH3OperationOptions } from "../dist/execution/viggle-h3-receipts.js";
import { ImageApplicationService } from "../dist/media/image-application.js";
import { NarrationService, NarrationCanonicalService } from "../dist/narration/index.js";
import { projectFixture } from "./execution-fixture.mjs";

const ffmpegPath = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobePath = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
const imageProfile = { id: "configured-image", revision: "image-config-1", kind: "image", adapter: "openai-image", executionVersion: "1",
  configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium" } }, maxConcurrency: 1, unitCostMicros: "100000", maxRetries: 0 };
const videoProfile = { id: "configured-video", revision: "video-config-1", kind: "video", adapter: "minimax-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3", settings: { resolution: "768P" } }, maxConcurrency: 1, unitCostMicros: "200000", maxRetries: 0, minFrames: 120, maxFrames: 450 };
const viggleProfile = { id: "configured-viggle-video", revision: "viggle-config-1", kind: "video", adapter: "viggle-h3", executionVersion: "1",
  configuration: { model: "MiniMax-H3", settings: { quality: "low", resolution: "480p", aspectRatio: "16:9" } },
  maxConcurrency: 1, unitCostMicros: "900000", maxRetries: 0, minFrames: 90, maxFrames: 450 };
const viggleConfig = () => ({ ...config(), viggleH3: true, viggleH3DownloadHosts: ["viggle.example.test"] });
const providerConfiguration = { version: 1, profiles: [{ label: "Configured image", profile: imageProfile }, { label: "Configured video", profile: videoProfile }] };
const config = (image = false, h3 = false) => ({ image, h3, h3DownloadHosts: h3 ? ["media.example.test"] : [] });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
let inputDirectory, png, voice;
before(async () => {
  inputDirectory = mkdtempSync(join(tmpdir(), "openslate-runtime-input-"));
  const path = join(inputDirectory, "frame.png");
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=blue:s=1024x1024", "-frames:v", "1", "-threads", "1", path], { timeout: 30000 });
  png = readFileSync(path);
  voice = join(inputDirectory, "narration.wav");
  await promisify(execFile)(ffmpegPath, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=600:sample_rate=48000:duration=6", "-c:a", "pcm_s16le", voice], { timeout: 30000 });
});
after(() => { if (inputDirectory) rmSync(inputDirectory, { recursive: true, force: true }); });

function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-runtime-")));
  const store = new Store(join(directory, "state.sqlite")), provider = new FakeProvider(join(directory, "fake.sqlite"));
  const viggleCalls = { fetch: 0, lookup: 0, download: 0 };
  const calls = { image: 0, h3: 0, lookup: 0, download: 0 }, keys = { configured: options.keys ?? false, unavailable: false };
  const credentials = new EnvironmentMediaCredentials(() => {
    if (keys.unavailable) throw Error("synthetic credential backend failure");
    return keys.configured ? "offline-synthetic-credential-never-live" : undefined;
  });
  const arguments_ = { store, fakeProvider: provider, dataDirectory: directory, configuration: options.configuration ?? config(), credentials,
    providerConfiguration: options.videoProfile ? { version: 1, profiles: [...providerConfiguration.profiles, { label: "Configured Viggle video", profile: options.videoProfile }] } : providerConfiguration,
    ffmpegPath: options.tools === false ? null : ffmpegPath, ffprobePath: options.tools === false ? null : ffprobePath,
    transport: {
      imageFetch: async () => { calls.image++; return new Response(JSON.stringify({ created: 1789200000, data: [{ b64_json: png.toString("base64") }] }), { headers: { "content-type": "application/json" } }); },
      viggleFetch: async (_url, init) => { viggleCalls.fetch++; assert.equal(init.method, "POST");
        assert.match(Buffer.from(init.body).toString("utf8"), /name="quality"/);
        return new Response(JSON.stringify({ id: "vid_offline_runtime", status: "queued", video_url: null, alpha_url: null, error: null }), { headers: { "content-type": "application/json" } }); },
      viggleDownload: { lookup: async () => { viggleCalls.lookup++; throw Error("Unexpected Viggle DNS request"); }, request: () => { viggleCalls.download++; throw Error("Unexpected Viggle download request"); } },
      h3Fetch: async (_url, init) => { calls.h3++; assert.equal(init.method, "POST"); return new Response(JSON.stringify({ task_id: "offline-runtime-h3-task" }), { headers: { "content-type": "application/json" } }); },
      download: { lookup: async () => { calls.lookup++; throw Error("Unexpected DNS request"); }, request: () => { calls.download++; throw Error("Unexpected download request"); } },
    },
  };
  t.after(() => { if (store.db.open) store.close(); if (provider.db.open) provider.close(); rmSync(directory, { recursive: true, force: true }); });
  const f = { directory, store, provider, keys, calls, viggleCalls, arguments_ };
  f.build = () => { f.runtime = createMediaExecutionRuntime(arguments_); f.production = new ProductionService(store, f.runtime.engine, DEFAULT_PROFILES, f.runtime.productionOptions); return f.runtime; };
  f.seed = async (kind = "image", legacy = false) => {
    const videoSeconds = options.videoSeconds ?? 6;
    const runtime = f.runtime, production = legacy ? new ProductionService(store, runtime.engine) : f.production, profile = kind === "image" ? imageProfile : options.videoProfile ?? videoProfile;
    const selection = runtime.providerCatalog.select(runtime.providerCatalog.digest, [profile.id]);
    const created = production.createProject("Offline runtime composition", selection), seed = projectFixture(created.id, 1);
    let project = store.saveProject({ ...seed, capabilityLockId: created.capabilityLockId }, created.headVersion);
    const human = production.beginRequest(project.id, "offline-human", "Plan one exact media operation");
    let reference;
    if (kind === "video") {
      const imported = await new ImageApplicationService(production, runtime.imageStore).importImage(project.id, human,
        { bytes: png, sha256: hash(png), expectedHeadVersion: project.headVersion, key: newId() });
      reference = imported.artifact; project = store.getProject(project.id);
      const narration = new NarrationService(production, runtime.localMedia), canonical = new NarrationCanonicalService(narration);
      const view = () => narration.snapshot(project.id, human), key = () => newId();
      narration.reviseSegments(project.id, human, view().state.version, key(), { add: [
        { text: "Built to last.", meaning: "Built to last.", textKind: "draft", language: "en", source: { kind: "uploaded" } },
      ] });
      const path = join(runtime.uploadDirectory, "narration.wav"); copyFileSync(voice, path);
      const audio = await narration.importAudio(project.id, human, { path, declaredOrigin: "uploaded", key: key() });
      const segmentId = view().segments[0].entry.segmentId;
      narration.bindAudio(project.id, human, view().state.version, key(), segmentId, audio.id);
      narration.recordHumanCue(project.id, human, view().state.version, key(), { segmentId, startSample: 0, endSample: videoSeconds * 48000 });
      let segment = view().segments[0]; narration.accept(project.id, human, view().state.version, key(), "script", [segment.script.id]);
      narration.acceptAudio(project.id, human, view().state.version, key(), [{ segmentRevisionId: segment.script.id, audioId: audio.id }]);
      segment = view().segments[0]; narration.accept(project.id, human, view().state.version, key(), "timing", [segment.cue.id]);
      const canonicalPlan = canonical.prepare(project.id, human, { expectedHeadVersion: project.headVersion,
        expectedNarrationVersion: view().state.version, shotMappings: [{ shotId: project.shots[0].id, segmentId }], key: key() });
      await canonical.apply(project.id, human, canonicalPlan.id); project = store.getProject(project.id);
    }
    const shot = project.shots[0], q = JSON.stringify, settingsSource = options.videoSettings === undefined ? "" : `,settings:${q(options.videoSettings)}`;
    production.authorize(project.id, human, [{ scopeId: shot.id, kind }], newId(), "initial_slot");
    const body = kind === "image" ? `return p.image("frame",{intent:shot,profile:${q(profile.id)},prompt:${q(shot.imagePrompt)}});`
      : `const frame=p.asset(${q(reference.artifactId)});const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:${q(profile.id)},motionPrompt:${q(shot.videoPrompt)},seconds:${videoSeconds}${settingsSource}}]});return p.video("take",{intent:shot,profile:${q(profile.id)},firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:${videoSeconds}${settingsSource}});`;
    const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});${body}});`;
    const prepared = await production.prepare(project.id, human, { variant: "plan", expectedHeadVersion: project.headVersion, source,
      ...(kind === "video" ? { creative: { updateShots: [{ id: shot.id, reauthorPrompts: true }] } } : {}) });
    production.apply(project.id, human, prepared.id);
    const binding = store.list("node_binding", project.id).find(binding => binding.node.kind === kind);
    if (kind === "video") {
      const review = runtime.engine.reviewSnapshot(project.id); production.approve(project.id, human, review.id, [binding.id]);
    }
    return { projectId: project.id, binding, profile };
  };
  f.issue = selected => {
    const input = { profileDigest: String(providerProfileArguments(selected.profile).profileDigest), profileDefinitionDigest: digest(selected.profile),
      selections: [{ candidateId: selected.binding.candidateId, nodeId: selected.binding.id, specDigest: selected.binding.node.specDigest }],
      maxAttempts: 1, maxEstimatedMicros: selected.profile.unitCostMicros, expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const human = f.production.beginRequest(selected.projectId, "offline-human", "Approve this exact configured estimate", { editing: false,
      contextDigest: allowanceIssueContextDigest(selected.projectId, input) });
    return f.runtime.allowances.issue(selected.projectId, human, input);
  };
  f.noAdmission = projectId => {
    for (const kind of ["attempt", "reservation", "external_allowance_consumption", "image_execution_dispatch", "h3_execution_dispatch", "viggle_h3_execution_dispatch"])
      assert.equal(store.list(kind, projectId).length, 0, `Unexpected ${kind}`);
  };
  return f;
}

test("default composition keeps paid routes unavailable and existing local media directories reusable", t => {
  const f = fixture(t, { keys: true }), runtime = f.build();
  assert.equal(runtime.engine.registry.resolve({ adapter: "fake", version: "1" }), f.provider);
  for (const adapter of ["openai-image", "minimax-h3", "viggle-h3"]) assert.throws(() => runtime.engine.registry.resolve({ adapter, version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
  assert.ok(runtime.engine.localExecutor); assert.deepEqual(runtime.productionOptions, {});
  assert.equal(runtime.localMedia.rootDir, join(f.directory, "media")); assert.equal(runtime.imageStore.rootDir, join(f.directory, "artifacts", "images"));
  assert.equal(runtime.uploadDirectory, join(f.directory, "uploads")); assert.equal(runtime.providerCatalog.view().realExecutionEnabled, false);
  const project = f.production.createProject("Default demo"); assert.equal(Object.hasOwn(f.store.get("capability_lock", project.capabilityLockId), "localExecution"), false);
  f.noAdmission(project.id); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("explicit routes and credential presence do not call networks or create generation authority at construction", t => {
  const configuration = config(true, true), f = fixture(t, { configuration, keys: true }), runtime = f.build();
  configuration.image = false; configuration.h3 = false; configuration.h3DownloadHosts[0] = "changed.example.test";
  assert.ok(runtime.engine.registry.resolve({ adapter: "openai-image", version: "1" })); assert.ok(runtime.engine.registry.resolve({ adapter: "minimax-h3", version: "1" }));
  assert.equal(runtime.providerCatalog.view().realExecutionEnabled, true);
  assert.deepEqual(runtime.productionOptions, { newProjectLocalExecution: { adapter: "local-media", version: "1" }, newProjectLocalExecutionFor: "external-video" });
  const demo = f.production.createProject("Default still fake"), selected = runtime.providerCatalog.select(runtime.providerCatalog.digest, [videoProfile.id]);
  const production = f.production.createProject("Pinned production", selected);
  assert.equal(Object.hasOwn(f.store.get("capability_lock", demo.capabilityLockId), "localExecution"), false);
  assert.deepEqual(f.store.get("capability_lock", production.capabilityLockId).localExecution, { adapter: "local-media", version: "1" });
  for (const project of [demo, production]) for (const kind of ["message", "grant", "candidate", "attempt", "reservation", "external_allowance", "external_allowance_consumption"])
    assert.equal(f.store.list(kind, project.id).length, 0);
  assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("enabled routes require executable local tools, while disabled startup supports missing tools", t => {
  const f = fixture(t, { tools: false }); assert.equal(f.build().localMedia, null); assert.equal(f.runtime.imageStore, null);
  for (const configuration of [config(true), config(false, true)]) {
    f.arguments_.configuration = configuration;
    assert.throws(f.build, { code: "MEDIA_EXECUTION_TOOLS_REQUIRED" });
  }
  f.arguments_.ffmpegPath = f.directory; f.arguments_.ffprobePath = ffprobePath;
  assert.throws(f.build, { code: "MEDIA_EXECUTION_TOOLS_REQUIRED" });
  assert.equal(f.store.listProjects().length, 0); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("readiness separates enabled host routes, credential availability and unregistered providers", t => {
  const f = fixture(t, { configuration: config(true) }), runtime = f.build();
  const row = kind => runtime.providerCatalog.view().profiles.find(value => value.profile?.kind === kind && value.profile.adapter !== "fake");
  assert.equal(row("image").readiness.enabledByHost, true); assert.equal(row("image").readiness.realExecutionEnabled, false);
  assert.equal(row("video").readiness.enabledByHost, false); assert.equal(row("video").readiness.registered, false);
  const digest = runtime.providerCatalog.digest; f.keys.configured = true;
  assert.equal(row("image").readiness.realExecutionEnabled, true); assert.equal(runtime.providerCatalog.view().realExecutionEnabled, true);
  assert.equal(runtime.providerCatalog.digest, digest); f.keys.unavailable = true;
  assert.equal(row("image").readiness.realExecutionEnabled, false); assert.equal(row("image").readiness.credential.backendUnavailable, true);
  assert.equal(runtime.providerCatalog.view().realExecutionEnabled, false); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("actual human allowance and admitted image bridge publish the exact injected PNG without fake fallback", async t => {
  const f = fixture(t, { configuration: config(true), keys: true }), runtime = f.build(), selected = await f.seed();
  const denied = await runtime.engine.runReady(); assert.ok(denied.blocked.some(item => item.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE")); f.noAdmission(selected.projectId);
  const allowance = f.issue(selected); await runtime.engine.runReady();
  const output = runtime.engine.outputs(selected.projectId)[0], artifact = f.store.get("artifact", output.artifact.artifactId);
  assert.equal(artifact.fixture, false); assert.equal(artifact.artifact.sha256, hash(png)); assert.deepEqual(readFileSync(artifact.path), png);
  assert.equal(artifact.path.startsWith(runtime.imageStore.rootDir), true);
  const attempt = runtime.engine.attempts(selected.projectId)[0]; assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.request.externalAllowanceId, allowance.id);
  assert.equal(f.store.list("external_allowance_consumption", selected.projectId).length, 1);
  assert.equal(f.store.list("image_execution_dispatch", selected.projectId).length, 1); assert.equal(f.provider.acceptedCount(), 0);
  await runtime.engine.reconcile(); await runtime.engine.runReady(); assert.deepEqual(f.calls, { image: 1, h3: 0, lookup: 0, download: 0 });
});

for (const kind of ["image", "video"]) test(`missing ${kind} credential blocks before consuming an existing allowance`, async t => {
  const f = fixture(t, { configuration: config(true, true) }), runtime = f.build(), selected = await f.seed(kind); f.issue(selected);
  const result = await runtime.engine.runReady(); assert.ok(result.blocked.some(item => item.code === "MEDIA_CREDENTIAL_MISSING"), JSON.stringify(result));
  f.noAdmission(selected.projectId); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("legacy external-video projects require a new local-assembly pin before paid admission", async t => {
  const f = fixture(t, { configuration: config(false, true), keys: true }), runtime = f.build(), selected = await f.seed("video", true); f.issue(selected);
  const before = f.store.getProject(selected.projectId), lock = f.store.get("capability_lock", before.capabilityLockId);
  const result = await runtime.engine.runReady(); assert.ok(result.blocked.some(item => item.code === "LOCAL_EXECUTION_UPGRADE_REQUIRED"), JSON.stringify(result));
  assert.deepEqual(f.store.getProject(selected.projectId), before); assert.deepEqual(f.store.get("capability_lock", before.capabilityLockId), lock);
  f.noAdmission(selected.projectId); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
});

test("new pinned H3 project can admit exactly one reviewed attempt using its durable allowance", async t => {
  const f = fixture(t, { configuration: config(false, true), keys: true }), runtime = f.build(), selected = await f.seed("video"), allowance = f.issue(selected);
  const result = await runtime.engine.runReady(); const attempt = runtime.engine.attempts(selected.projectId)[0]; assert.ok(attempt, JSON.stringify(result));
  assert.equal(attempt.phase, "remote_pending"); assert.equal(attempt.taskId, "offline-runtime-h3-task");
  assert.deepEqual(attempt.request.execution, { adapter: "minimax-h3", version: "1" }); assert.equal(attempt.request.externalAllowanceId, allowance.id);
  assert.equal(f.store.list("external_allowance_consumption", selected.projectId).length, 1);
  assert.equal(f.store.list("h3_execution_dispatch", selected.projectId).length, 1); assert.equal(f.provider.acceptedCount(), 0);
  assert.deepEqual(f.calls, { image: 0, h3: 1, lookup: 0, download: 0 });
});

test("catalog host enablement is exact, detached and cannot be inferred from registration alone", t => {
  const f = fixture(t, { configuration: config(true), keys: true }), runtime = f.build();
  const enabled = [{ adapter: "openai-image", version: "1" }], credentials = f.arguments_.credentials;
  const catalog = new InstalledProviderCatalog({ configuration: providerConfiguration, registry: runtime.engine.registry, credentials,
    mediaTools: { image: true, video: true }, enabledExecutions: enabled });
  enabled[0].adapter = "minimax-h3"; assert.equal(catalog.view().profiles.find(p => p.id === imageProfile.id).readiness.realExecutionEnabled, true);
  for (const value of [[{ adapter: "fake", version: "1" }], [{ adapter: "openai-image", version: "2" }], [{ adapter: "openai-image", version: "1", secret: "no" }],
    [{ adapter: "openai-image", version: "1" }, { adapter: "openai-image", version: "1" }]])
    assert.throws(() => new InstalledProviderCatalog({ enabledExecutions: value }), { code: "PROVIDER_CATALOG_INVALID" });
});


test("Viggle construction registers only its explicit route and pins only new external-video projects without network or authority", t => {
  const configuration = viggleConfig(), f = fixture(t, { configuration, videoProfile: viggleProfile, keys: true }), runtime = f.build();
  assert.ok(runtime.engine.registry.resolve({ adapter: "viggle-h3", version: "1" }));
  assert.throws(() => runtime.engine.registry.resolve({ adapter: "minimax-h3", version: "1" }), { code: "PROVIDER_NOT_REGISTERED" });
  configuration.viggleH3 = false; configuration.viggleH3DownloadHosts[0] = "changed.example.test";
  const row = runtime.providerCatalog.view().profiles.find(value => value.id === viggleProfile.id);
  assert.equal(row.readiness.enabledByHost, true); assert.equal(row.readiness.realExecutionEnabled, true);
  const demo = f.production.createProject("Default still fake"), selected = runtime.providerCatalog.select(runtime.providerCatalog.digest, [viggleProfile.id]);
  const production = f.production.createProject("Viggle production", selected);
  assert.equal(Object.hasOwn(f.store.get("capability_lock", demo.capabilityLockId), "localExecution"), false);
  assert.deepEqual(f.store.get("capability_lock", production.capabilityLockId).localExecution, { adapter: "local-media", version: "1" });
  for (const project of [demo, production]) for (const kind of ["message", "grant", "candidate", "attempt", "reservation", "external_allowance", "external_allowance_consumption"])
    assert.equal(f.store.list(kind, project.id).length, 0);
  assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 }); assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 });
});

test("Viggle activation validates tools, boolean configuration and its own download host list", t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, tools: false });
  assert.throws(f.build, { code: "MEDIA_EXECUTION_TOOLS_REQUIRED" });
  f.arguments_.ffmpegPath = ffmpegPath; f.arguments_.ffprobePath = ffprobePath;
  for (const value of ["1", 1, null]) { f.arguments_.configuration = { ...viggleConfig(), viggleH3: value }; assert.throws(f.build, { code: "MEDIA_EXECUTION_CONFIGURATION" }); }
  f.arguments_.configuration = { ...config(false, true), viggleH3: true };
  assert.throws(f.build, { code: "OUTPUT_DOWNLOAD_CONFIGURATION" });
  assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 });
});

for (const blocker of ["missing_key", "legacy_pin"]) test(`Viggle ${blocker} blocks before consuming an exact allowance`, async t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, keys: true });
  if (blocker === "missing_key") f.arguments_.credentials = new EnvironmentMediaCredentials(name => name === "OPENSLATE_VIGGLE_API_KEY" ? undefined : "synthetic-other-provider-key");
  const runtime = f.build(), selected = await f.seed("video", blocker === "legacy_pin"); f.issue(selected);
  const result = await runtime.engine.runReady(), expected = blocker === "missing_key" ? "MEDIA_CREDENTIAL_MISSING" : "LOCAL_EXECUTION_UPGRADE_REQUIRED";
  assert.ok(result.blocked.some(value => value.code === expected), JSON.stringify(result));
  f.noAdmission(selected.projectId); assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 }); assert.equal(f.provider.acceptedCount(), 0);
});

test("Viggle runtime consumes one flat per-attempt allowance for an actually reviewed take through only its injected bridge", async t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, keys: true }), runtime = f.build(), selected = await f.seed("video");
  const denied = await runtime.engine.runReady(); assert.ok(denied.blocked.some(row => row.code === "EXTERNAL_ALLOWANCE_UNAVAILABLE")); f.noAdmission(selected.projectId);
  const allowance = f.issue(selected), result = await runtime.engine.runReady(), attempt = runtime.engine.attempts(selected.projectId)[0];
  assert.ok(attempt, JSON.stringify(result)); assert.equal(attempt.phase, "remote_pending"); assert.equal(attempt.taskId, "vid_offline_runtime");
  assert.deepEqual(attempt.request.execution, { adapter: "viggle-h3", version: "1" });
  assert.deepEqual(attempt.request.profile.configuration.settings, viggleProfile.configuration.settings); assert.equal(attempt.request.externalAllowanceId, allowance.id);
  const consumption = f.store.list("external_allowance_consumption", selected.projectId); assert.equal(consumption.length, 1); assert.equal(consumption[0].estimatedMicros, "900000");
  assert.equal(f.store.list("viggle_h3_execution_dispatch", selected.projectId).length, 1); assert.equal(f.store.list("h3_execution_dispatch", selected.projectId).length, 0);
  await runtime.engine.runReady(); assert.equal(f.provider.acceptedCount(), 0);
  assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 }); assert.deepEqual(f.viggleCalls, { fetch: 1, lookup: 0, download: 0 });
});


test("invalid explicit Viggle transport injections fail locally instead of falling through to live defaults", t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, keys: true });
  const original = f.arguments_.transport;
  for (const invalid of [null, false, 0, "not-callable", {}]) {
    for (const transport of [{ ...original, viggleFetch: invalid },
      { ...original, viggleDownload: { ...original.viggleDownload, lookup: invalid } },
      { ...original, viggleDownload: { ...original.viggleDownload, request: invalid } }]) {
      f.arguments_.transport = transport; assert.throws(f.build, { code: "MEDIA_EXECUTION_CONFIGURATION" });
    }
  }
  for (const viggleDownload of [null, false, []]) {
    f.arguments_.transport = { ...original, viggleDownload }; assert.throws(f.build, { code: "MEDIA_EXECUTION_CONFIGURATION" });
  }
  assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 }); assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 });
  assert.equal(f.store.listProjects().length, 0);
});

test("unsupported Viggle creative setting override preserves the exact unused allowance before admission", async t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, keys: true, videoSettings: { quality: "high" } });
  const runtime = f.build(), selected = await f.seed("video"), allowance = f.issue(selected);
  assert.equal(f.store.list("approval", selected.projectId).length, 1, "The exact frame and requested options were actually reviewed");
  for (let i = 0; i < 2; i++) {
    const result = await runtime.engine.runReady();
    assert.ok(result.blocked.some(row => row.code === "VIGGLE_H3_PREFLIGHT_INVALID"), JSON.stringify(result));
    f.noAdmission(selected.projectId);
    assert.deepEqual(f.store.get("external_allowance", allowance.id), allowance);
    assert.equal(f.store.get("node_binding", selected.binding.id).candidateId, selected.binding.candidateId);
  }
  assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 });
  assert.deepEqual(f.calls, { image: 0, h3: 0, lookup: 0, download: 0 }); assert.equal(f.provider.acceptedCount(), 0);
});

test("fractional Viggle video duration is rejected by the compiler before any spending allowance or attempt", async t => {
  const f = fixture(t, { configuration: viggleConfig(), videoProfile: viggleProfile, keys: true, videoSeconds: 3.5 });
  f.build(); await assert.rejects(f.seed("video"), { code: "PROFILE_INCOMPATIBLE" });
  const project = f.store.listProjects()[0]; f.noAdmission(project.id);
  assert.equal(f.store.list("external_allowance", project.id).length, 0);
  assert.deepEqual(f.viggleCalls, { fetch: 0, lookup: 0, download: 0 }); assert.equal(f.provider.acceptedCount(), 0);
});

test("shared Viggle preflight binds exact profile arguments and whole durations inside pinned limits", () => {
  const args = { ...providerProfileArguments(viggleProfile), prompt: "A leather boot turns slowly.", durationFrames: 180,
    frameRate: { numerator: 30, denominator: 1 }, settings: {} };
  for (const durationFrames of [90, 180, 450]) assert.doesNotThrow(() => assertViggleH3OperationOptions(viggleProfile, { ...args, durationFrames }));
  const cases = [
    ...[89, 105, 451, Infinity, "180"].map(durationFrames => [viggleProfile, { ...args, durationFrames }]),
    [viggleProfile, { ...args, frameRate: { numerator: 24, denominator: 1 } }],
    [viggleProfile, { ...args, profileDigest: "f".repeat(64) }],
    [viggleProfile, { ...args, profileRevision: "other-revision" }],
    [viggleProfile, { ...args, profileConfiguration: { ...viggleProfile.configuration, settings: { ...viggleProfile.configuration.settings, quality: "high" } } }],
    [{ ...viggleProfile, minFrames: 210 }, args], [{ ...viggleProfile, maxFrames: 150 }, args],
    [{ ...viggleProfile, id: "another-profile" }, args], [{ ...viggleProfile, revision: "another-revision" }, args],
  ];
  for (const [profile, input] of cases) assert.throws(() => assertViggleH3OperationOptions(profile, input), { code: "VIGGLE_H3_PREFLIGHT_INVALID" });
});
