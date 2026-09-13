import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlan, digest } from "../../../packages/core/dist/index.js";
import { OPENAI_IMAGE_MODEL } from "../../../packages/providers/dist/index.js";
import { OpenAIImageExecution } from "../dist/execution/openai-image-execution.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { Engine } from "../dist/execution/engine.js";
import { SpoolImageIngestor } from "../dist/execution/spool-image-ingester.js";
import { LocalImageStore } from "../dist/media/local-images.js";
import { Store } from "../dist/persistence/store.js";
import { projectFixture, refreshIntent } from "./execution-fixture.mjs";
import { InstallationRecoveryGuard, installRecoveryQuarantine, releaseRecovery } from "../dist/application/installation-recovery.js";

const key = "offline-image-credential", hash = bytes => createHash("sha256").update(bytes).digest("hex");
function png(value = 128) {
  function chunk(kind, data) {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const content = Buffer.concat([Buffer.from(kind), data]); let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([length, content, tail]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1024); ihdr.writeUInt32BE(1024, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc(3073 * 1024, value); for (let y = 0; y < 1024; y++) pixels[y * 3073] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
const bytes = png(), otherBytes = png(51);
const response = (extra = {}, status = 200) => new Response(JSON.stringify({ created: 1789200000,
  data: [{ b64_json: bytes.toString("base64") }], ...extra }), { status, headers: { "content-type": "application/json", "x-request-id": "req-offline-diagnostic" } });
function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "openslate-image-execution-"))), path = join(directory, "store.sqlite");
  const store = new Store(path), project = projectFixture(randomUUID(), 1), artifactRoot = join(directory, "artifacts"); mkdirSync(artifactRoot);
  const references = (options.images ?? []).map((content, index) => ({ artifactId: `reference-${index}-${randomUUID()}`, kind: "image", sha256: hash(content) }));
  project.artifacts = references; project.shots[0].referenceArtifactIds = references.map(value => value.artifactId); refreshIntent(project.shots[0]);
  store.createProject(project);
  references.forEach((artifact, index) => {
    const path = join(artifactRoot, `${artifact.artifactId}.png`); writeFileSync(path, options.images[index]);
    // These are already-ingested image records; this bridge verifies their exact bytes, not a second decode recipe.
    store.insert("artifact", artifact.artifactId, project.id, { artifact, path, mimeType: "image/png", fixture: false,
      origin: "supplied_image", attemptId: null, physicalDurationSeconds: null, byteLength: options.images[index].length,
      width: 1024, height: 1024, validationDigest: digest({ sha256: artifact.sha256, fixtureRecipe: "decoded-synthetic-png" }) });
  });
  const profile = { id: "offline-openai-image", revision: "1", kind: "image", adapter: "openai-image", executionVersion: "1",
    configuration: { model: OPENAI_IMAGE_MODEL, settings: { width: 1024, height: 1024, quality: "medium", ...options.settings } },
    maxConcurrency: 2, unitCostMicros: "100", maxRetries: 0 };
  if (options.omitQuality) delete profile.configuration.settings.quality;
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, "outputs") });
  const calls = { http: 0, credentials: 0 }, readCredential = options.credential ?? (() => key);
  const credentials = new EnvironmentMediaCredentials(name => { calls.credentials++; assert.equal(name, "OPENSLATE_OPENAI_API_KEY"); return readCredential(); });
  const fetch = async (...args) => { calls.http++; return (options.fetch ?? (async () => response()))(...args); };
  const bridge = new OpenAIImageExecution({ store, outputStore: outputs, artifactRoot, credentials, fetch, timeoutMs: options.timeoutMs ?? 1000 });
  const images = options.ingest ? new LocalImageStore({ rootDir: join(artifactRoot, "generated"),
    ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg"),
    ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe") }) : undefined;
  const engine = new Engine(store, bridge, { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs,
    ...(images ? { outputIngestor: new SpoolImageIngestor(outputs, images) } : {}),
    externalAdmission: { authorize: claim => {
      const id = randomUUID(); store.insert("offline_test_allowance", id, claim.projectId, { attemptId: claim.attemptId, claimed: true }); return { allowanceId: id };
    } } });
  const shot = project.shots[0], q = JSON.stringify;
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});return p.image("frame",{intent:shot,profile:${q(profile.id)},prompt:${q(shot.imagePrompt)},references:[${references.map(ref => `p.asset(${q(ref.artifactId)})`).join(",")}]});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID });
  const planId = randomUUID(), node = plan.nodes.find(node => node.kind === "image");
  const grant = engine.createGrant(project.id, shot.id, "image", "offline-human-grant", "initial_slot");
  engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); store.saveProject({ ...project, activePlanId: planId }, 0);
  // Exercise the real admission transaction, then independently control the provider-call failure boundaries.
  const admit = () => engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint);
  const attempt = options.deferAdmission ? undefined : admit();
  t.after(() => { if (store.db.open) store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, path, store, project, artifactRoot, outputs, credentials, fetch, bridge, calls, attempt, request: attempt?.request, engine, admit, references, profile };
}
const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });
function restoreImageFixture(f) {
  installRecoveryQuarantine(f.store, { restoreId: randomUUID(), backupId: randomUUID(), backupManifestSha256: "a".repeat(64), sourceDatabaseSha256: "b".repeat(64),
    originalDataRoot: f.directory, backupCreatedAt: "2026-09-11T00:00:00.000Z", restoredAt: "2026-09-12T00:00:00.000Z" });
  return () => { const snapshot = new InstallationRecoveryGuard(f.store).snapshot(); return releaseRecovery(f.store, { restoreId: snapshot.receipt.restoreId,
    expectedReceiptDigest: snapshot.receiptDigest, expectedSummaryDigest: snapshot.summaryDigest }, { principalId: "human", commandId: randomUUID() }); };
}

test("restoration blocks direct image calls and permanently denies an imported attempt's first POST before credentials", async t => {
  const f = fixture(t), release = restoreImageFixture(f);
  for (const operation of [() => f.bridge.submit(f.request, context(f)), () => f.bridge.lookup(f.attempt.id), () => f.bridge.poll("invented", f.request)])
    await assert.rejects(operation(), { code: "INSTALLATION_QUARANTINED" });
  release(); await assert.rejects(f.bridge.submit(f.request, context(f)), { code: "RESTORED_AUTHORITY_REQUIRES_NEW" });
  assert.equal((await f.bridge.lookup(f.attempt.id)).type, "unknown");
  assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(rows(f, "image_execution_dispatch").length, 0);
});

test("released image restoration reuses its exact synchronous spool without another HTTP call", async t => {
  const f = fixture(t), completed = await f.bridge.submit(f.request, context(f)), release = restoreImageFixture(f);
  const before = { ...f.calls }; await assert.rejects(f.bridge.lookup(f.attempt.id), { code: "INSTALLATION_QUARANTINED" });
  release(); const restarted = restart(t, f);
  assert.deepEqual(await restarted.bridge.lookup(f.attempt.id), completed);
  assert.deepEqual(f.calls, before); assert.equal(completed.vendorTaskId, null);
});
const rows = (f, kind) => f.store.list(kind, f.project.id);
function restart(t, f) {
  f.store.close(); const store = new Store(f.path), outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "outputs") });
  t.after(() => { if (store.db.open) store.close(); });
  return { store, outputs, bridge: new OpenAIImageExecution({ store, outputStore: outputs, artifactRoot: f.artifactRoot,
    credentials: new EnvironmentMediaCredentials(() => { throw Error("replay must not resolve credentials"); }), fetch: async () => { throw Error("replay must not POST"); } }) };
}

test("application intent precedes HTTP, exact transport digest differs, and completion retains usage before spooling", async t => {
  const f = fixture(t, { fetch: async (_url, init) => {
    const mapping = rows(f, "image_execution_mapping")[0], intent = rows(f, "image_execution_dispatch")[0];
    assert.equal(intent.mappingDigest, digest(mapping)); assert.equal(intent.transportDigest, mapping.transport.requestDigest);
    assert.notEqual(mapping.requestDigest, mapping.transport.requestDigest); assert.equal(mapping.requestDigest, digest(f.request));
    assert.equal(init.headers.Authorization, `Bearer ${key}`); return response({ usage: { input_tokens: 9, output_tokens: 10, total_tokens: 19 } });
  } });
  const spool = f.outputs.spool.bind(f.outputs);
  f.outputs.spool = async (...args) => { assert.equal(rows(f, "image_execution_result")[0].observation.usage.totalTokens, 19); return spool(...args); };
  const result = await f.bridge.submit(f.request, context(f));
  assert.equal(result.type, "completed"); assert.equal(result.version, 2); assert.equal(result.vendorTaskId, null);
  assert.equal(result.outputs[0].sha256, hash(bytes)); assert.equal(result.outputs[0].fixture, false);
  const owned = await f.outputs.resolveOwned(f.project.id, result.receiptId); assert.deepEqual(readFileSync(owned.path), bytes);
  assert.equal(JSON.stringify(result).includes("req-offline"), false); assert.equal(rows(f, "artifact").length, 0, "publication still belongs to ingestion");
  assert.deepEqual(await f.bridge.submit(f.request, context(f)), result); assert.deepEqual(await f.bridge.lookup(f.request.attemptId, f.request), result);
  assert.equal((await f.bridge.poll("req-offline-diagnostic", f.request)).type, "unknown"); assert.deepEqual(f.calls, { http: 1, credentials: 1 });
  const records = JSON.stringify([rows(f, "image_execution_mapping"), rows(f, "image_execution_dispatch"), rows(f, "image_execution_result")]);
  assert.equal(records.includes(key), false); assert.equal(records.includes("bytesBase64"), false); assert.equal(records.includes(f.directory), false);
});

test("PNG editing preserves ordered original bytes without resizing or accepting later request mutation", async t => {
  const f = fixture(t, { images: [bytes, otherBytes], fetch: async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/images/edits"); const payload = JSON.parse(init.body);
    assert.deepEqual(payload.images, [bytes, otherBytes].map(value => ({ image_url: `data:image/png;base64,${value.toString("base64")}` })));
    return response();
  } });
  const submitted = structuredClone(f.request), running = f.bridge.submit(submitted, context(f)); submitted.inputs.reverse(); submitted.args.prompt = "later mutation";
  const result = await running; assert.equal(result.type, "completed");
  assert.deepEqual(rows(f, "image_execution_mapping")[0].transport.inputs.map(input => input.sha256), [hash(bytes), hash(otherBytes)]);
  const changed = structuredClone(f.request); changed.inputs.reverse();
  await assert.rejects(f.bridge.submit(changed), { code: "IMAGE_EXECUTION_CONFLICT" }); assert.equal(f.calls.http, 1);
  const r = restart(t, f); assert.deepEqual(await r.bridge.lookup(f.request.attemptId), result);
});

test("concurrent instances claim one durable dispatch and perform exactly one HTTP request", { timeout: 5000 }, async t => {
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { images: [bytes], fetch: async () => { entered(); await barrier; return response(); } });
  const secondStore = new Store(f.path); t.after(() => secondStore.close());
  const second = new OpenAIImageExecution({ store: secondStore, outputStore: new ExecutionOutputStore(secondStore, { rootDir: join(f.directory, "outputs") }),
    artifactRoot: f.artifactRoot, credentials: f.credentials, fetch: f.fetch });
  const first = f.bridge.submit(f.request, context(f)); await started;
  try { assert.equal((await second.submit(f.request)).type, "unknown"); assert.equal(f.calls.http, 1); assert.equal(f.calls.credentials, 1); }
  finally { release(); }
  const result = await first; assert.equal(result.type, "completed"); assert.deepEqual(await second.submit(f.request), result);
  assert.equal(rows(f, "image_execution_dispatch").length, 1); assert.equal(f.calls.http, 1);
});

test("unknown remote result and restart never repeat synchronous generation or read another credential", async t => {
  const f = fixture(t, { fetch: async () => { throw Error(`${key}: lost after remote acceptance`); } });
  const result = await f.bridge.submit(f.request, context(f)); assert.equal(result.type, "unknown");
  assert.equal(rows(f, "image_execution_result")[0].observation.kind, "unknown");
  assert.equal(JSON.stringify(rows(f, "image_execution_result")).includes(key), false);
  const r = restart(t, f); assert.deepEqual(await r.bridge.submit(f.request), result); assert.deepEqual(await r.bridge.lookup(f.request.attemptId), result);
  assert.equal(f.calls.http, 1);
});

test("lost outcome receipt leaves an irreversible marker and remains unresolved after restart", async t => {
  const f = fixture(t), insert = f.store.insert.bind(f.store);
  f.store.insert = (...args) => { if (args[0] === "image_execution_result") throw Error("simulated receipt transaction failure"); return insert(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.insert = insert;
  assert.equal(rows(f, "image_execution_dispatch").length, 1); assert.equal(rows(f, "image_execution_result").length, 0); assert.equal(rows(f, "execution_output_receipt").length, 0);
  const r = restart(t, f); assert.equal((await r.bridge.submit(f.request)).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("durable PNG publication recovers locally after interrupted SQL spool installation", async t => {
  const f = fixture(t), put = f.store.put.bind(f.store);
  f.store.put = (...args) => { if (args[0] === "execution_output_spool") throw Error("simulated SQL installation loss"); return put(...args); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); f.store.put = put;
  assert.equal(rows(f, "image_execution_result")[0].observation.kind, "completed"); assert.equal(rows(f, "execution_output_spool").length, 0);
  const r = restart(t, f), result = await r.bridge.lookup(f.request.attemptId);
  assert.equal(result.type, "completed"); assert.equal(result.vendorTaskId, null); assert.equal(result.outputs[0].sha256, hash(bytes)); assert.equal(f.calls.http, 1);
});

test("known completion without durable bytes remains unresolved and never regenerates", async t => {
  const f = fixture(t); f.outputs.spool = async () => { throw Error("disk unavailable before blob publication"); };
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown");
  const r = restart(t, f); assert.equal((await r.bridge.submit(f.request)).type, "unknown"); assert.equal((await r.bridge.lookup(f.request.attemptId)).type, "unknown");
  assert.equal(f.calls.http, 1);
});

test("missing use-time credential is a durable definite non-dispatch, even if configured later", async t => {
  let current; const f = fixture(t, { credential: () => current });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); current = key;
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected");
  assert.equal(rows(f, "image_execution_mapping").length, 1); assert.equal(rows(f, "image_execution_dispatch").length, 0);
  assert.equal(rows(f, "image_execution_result")[0].observation.code, "LOCAL_CREDENTIAL_UNAVAILABLE"); assert.deepEqual(f.calls, { http: 0, credentials: 1 });
});

test("changed profile/configuration or absent/mismatched allowance cannot borrow an admitted attempt", async t => {
  const f = fixture(t);
  for (const mutate of [r => { r.profile.configuration.settings.quality = "high"; }, r => { r.args.width = 1536; },
    r => { r.externalAllowanceId = "different"; }, r => { delete r.externalAllowanceId; }]) {
    const request = structuredClone(f.request); mutate(request); await assert.rejects(f.bridge.submit(request));
  }
  assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(rows(f, "image_execution_dispatch").length, 0);
});

test("unsupported profile settings and missing explicit quality are rejected before credential access", async t => {
  for (const options of [{ settings: { responseFormat: "png" } }, { settings: { quality: "ultra" } }, { omitQuality: true }]) {
    const f = fixture(t, options); assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  }
});

test("owned PNG hash, path, format evidence, byte limits, and project isolation fail before dispatch", async t => {
  for (const variant of ["changed", "symlink", "outside", "cross-project", "oversize", "undecoded"]) {
    const f = fixture(t, { images: [bytes] }), ref = f.references[0], record = f.store.get("artifact", ref.artifactId);
    if (variant === "changed") writeFileSync(record.path, otherBytes);
    else if (variant === "symlink") { const old = record.path; record.path = join(f.artifactRoot, "symlink.png"); symlinkSync(old, record.path); }
    else if (variant === "outside") { record.path = join(f.directory, "outside.png"); writeFileSync(record.path, bytes); }
    else if (variant === "cross-project") { const foreign = projectFixture(); f.store.createProject(foreign); record.projectId = foreign.id; }
    else if (variant === "oversize") record.byteLength = 4 * 1024 * 1024 + 1;
    else delete record.validationDigest;
    if (variant !== "changed") f.store.db.prepare("UPDATE entities SET body=? WHERE kind='artifact' AND id=?").run(JSON.stringify(record), record.id);
    assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected", variant); assert.deepEqual(f.calls, { http: 0, credentials: 0 }, variant);
    assert.equal(rows(f, "image_execution_dispatch").length, 0);
  }
});

test("captured original cancellation during awaited input preparation does not dispatch", async t => {
  const f = fixture(t, { images: [bytes] }), original = new AbortController(), options = { ...context(f), signal: original.signal };
  const running = f.bridge.submit(f.request, options); options.signal = new AbortController().signal; original.abort();
  assert.equal((await running).type, "rejected"); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
  assert.equal(rows(f, "image_execution_result")[0].observation.code, "LOCAL_CANCELLED");
});

test("original signal survives options mutation through HTTP; cancellation after dispatch stays unknown", { timeout: 5000 }, async t => {
  let entered, observed; const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, { fetch: async (_url, init) => { observed = init.signal; entered(); return new Promise(() => {}); } });
  const original = new AbortController(), options = { ...context(f), signal: original.signal }, running = f.bridge.submit(f.request, options);
  await started; options.signal = new AbortController().signal; original.abort();
  assert.equal((await running).type, "unknown"); assert.equal(observed.aborted, true); assert.equal(f.calls.http, 1);
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "unknown"); assert.equal(f.calls.http, 1);
});

test("lease replacement during PNG preparation fails closed before the dispatch marker", async t => {
  const f = fixture(t, { images: [bytes] }), running = f.bridge.submit(f.request, context(f));
  f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  await assert.rejects(running, { code: "IMAGE_EXECUTION_NOT_DISPATCHABLE" }); assert.equal(f.calls.http, 0); assert.equal(rows(f, "image_execution_dispatch").length, 0);
});

test("stale local image preparation failures cannot close a replacement worker's admission", async t => {
  for (const failure of ["invalid-input", "cancelled", "expired"]) {
    const f = fixture(t, { images: [bytes] }), prepare = f.bridge.prepare.bind(f.bridge), controller = new AbortController();
    let entered, release; const started = new Promise(resolve => { entered = resolve; }), barrier = new Promise(resolve => { release = resolve; });
    f.bridge.prepare = async (...args) => { const result = await prepare(...args); entered(); await barrier;
      if (failure !== "cancelled") throw Error("controlled local preparation failure"); return result; };
    const running = f.bridge.submit(f.request, { ...context(f), signal: controller.signal }); await started;
    const current = f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt,
      ...(failure === "expired" ? { leaseExpiresAt: 0 } : { leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 }) });
    if (failure === "cancelled") controller.abort(); release();
    const outcome = await running;
    assert.equal(rows(f, "image_execution_result").length, 0, failure); assert.equal(rows(f, "image_execution_dispatch").length, 0, failure);
    assert.equal(outcome.type, "unknown", failure);
    assert.equal(f.store.get("reservation", current.reservationId).state, "reserved"); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
    const replacement = f.store.put("attempt", current.id, f.project.id, { ...current, leaseOwner: "replacement", leaseEpoch: current.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
    f.bridge.prepare = prepare;
    assert.equal((await f.bridge.submit(f.request, { expectedLease: { owner: replacement.leaseOwner, epoch: replacement.leaseEpoch } })).type, "completed");
    assert.equal(f.calls.http, 1); assert.equal(rows(f, "image_execution_result")[0].observation.kind, "completed");
  }
});

test("credential failure after image lease takeover cannot publish a terminal local result", async t => {
  let first = true;
  const f = fixture(t, { credential: () => { if (!first) return key; first = false;
    f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1 }); return undefined; } });
  const outcome = await f.bridge.submit(f.request, context(f));
  assert.equal(rows(f, "image_execution_result").length, 0); assert.equal(rows(f, "image_execution_dispatch").length, 0); assert.equal(f.calls.http, 0);
  assert.equal(outcome.type, "unknown");
  const current = f.store.get("attempt", f.attempt.id);
  assert.equal((await f.bridge.submit(f.request, { expectedLease: { owner: current.leaseOwner, epoch: current.leaseEpoch } })).type, "completed");
  assert.equal(f.calls.http, 1);
});

test("a stale image preparation failure replays a replacement's existing marker or completion", async t => {
  for (const complete of [false, true]) {
    let prepared, failPreparation, dispatched, finishHttp;
    const ready = new Promise(resolve => { prepared = resolve; }), preparationBarrier = new Promise(resolve => { failPreparation = resolve; });
    const posted = new Promise(resolve => { dispatched = resolve; }), httpBarrier = new Promise(resolve => { finishHttp = resolve; });
    const f = fixture(t, { fetch: async () => { dispatched(); await httpBarrier; return response(); } }), prepare = f.bridge.prepare.bind(f.bridge);
    f.bridge.prepare = async (...args) => { await prepare(...args); prepared(); await preparationBarrier; throw Error("old local failure"); };
    const old = f.bridge.submit(f.request, context(f)); await ready;
    const current = f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1 });
    const second = new OpenAIImageExecution({ store: f.store, outputStore: f.outputs, artifactRoot: f.artifactRoot, credentials: f.credentials, fetch: f.fetch });
    const replacement = second.submit(f.request, { expectedLease: { owner: current.leaseOwner, epoch: current.leaseEpoch } }); await posted;
    let result;
    try {
      if (complete) { finishHttp(); result = await replacement; }
      failPreparation(); const stale = await old; assert.equal(stale.type, complete ? "completed" : "unknown");
      if (complete) assert.deepEqual(stale, result); else assert.equal(rows(f, "image_execution_result").length, 0);
    } finally { failPreparation(); finishHttp(); await replacement; }
    assert.equal(rows(f, "image_execution_result")[0].observation.kind, "completed"); assert.equal(f.calls.http, 1);
  }
});

test("actual image observations remain durable after lease loss during the POST", async t => {
  const f = fixture(t, { fetch: async () => {
    f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1 }); return response();
  } });
  const completed = await f.bridge.submit(f.request, context(f)); assert.equal(completed.type, "completed");
  assert.equal(rows(f, "image_execution_result")[0].observation.kind, "completed");
  assert.equal(rows(f, "execution_output_receipt").length, 1); assert.equal(rows(f, "image_execution_dispatch").length, 1); assert.equal(f.calls.http, 1);
  assert.deepEqual(await f.bridge.submit(f.request), completed); assert.equal(f.calls.http, 1);
});

test("first dispatch requires the original caller lease and cannot adopt a replacement lease at entry", async t => {
  const f = fixture(t);
  await assert.rejects(f.bridge.submit(f.request), { code: "IMAGE_EXECUTION_NOT_DISPATCHABLE" });
  const original = context(f);
  f.store.put("attempt", f.attempt.id, f.project.id, { ...f.attempt, leaseOwner: "replacement", leaseEpoch: f.attempt.leaseEpoch + 1, leaseExpiresAt: Date.now() + 30000 });
  await assert.rejects(f.bridge.submit(f.request, original), { code: "IMAGE_EXECUTION_NOT_DISPATCHABLE" });
  assert.deepEqual(f.calls, { http: 0, credentials: 0 }); assert.equal(rows(f, "image_execution_mapping").length, 0);
});

test("call-context mutation cannot replace the captured lease during input preparation", async t => {
  const f = fixture(t, { images: [bytes] }), options = context(f), running = f.bridge.submit(f.request, options);
  options.expectedLease.owner = "changed-by-caller"; options.expectedLease.epoch++;
  assert.equal((await running).type, "completed"); assert.equal(f.calls.http, 1);
});

test("aggregate original PNG input limit is enforced without sending any media", async t => {
  const large = Buffer.alloc(4 * 1024 * 1024); bytes.copy(large);
  const f = fixture(t, { images: Array.from({ length: 7 }, () => large) });
  assert.equal((await f.bridge.submit(f.request, context(f))).type, "rejected"); assert.deepEqual(f.calls, { http: 0, credentials: 0 });
});

test("a late cancellation preserves the completed receipt but cannot report successful storage", async t => {
  const original = new AbortController(), f = fixture(t), spool = f.outputs.spool.bind(f.outputs);
  f.outputs.spool = async (...args) => { original.abort(); return spool(...args); };
  assert.equal((await f.bridge.submit(f.request, { ...context(f), signal: original.signal })).type, "unknown");
  assert.equal(rows(f, "image_execution_result")[0].observation.kind, "completed"); assert.equal(rows(f, "execution_output_receipt").length, 1);
  assert.equal(rows(f, "execution_output_spool").length, 0); assert.equal(f.calls.http, 1);
});

test("real Engine admission, injected transport, spool and exact PNG decode produce a usable image", async t => {
  const f = fixture(t, { deferAdmission: true, ingest: true });
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 1); assert.deepEqual(result.blocked, []);
  const attempt = f.engine.attempts(f.project.id)[0]; assert.equal(attempt.phase, "succeeded"); assert.equal(attempt.taskId, null);
  const artifact = rows(f, "artifact")[0]; assert.equal(artifact.fixture, false); assert.equal(artifact.width, 1024); assert.equal(artifact.height, 1024);
  assert.equal(artifact.artifact.sha256, hash(bytes)); assert.deepEqual(readFileSync(artifact.path), bytes); assert.equal(artifact.validationDigest.length, 64);
  assert.equal(f.store.get("reservation", attempt.reservationId).state, "charged");
  assert.equal(rows(f, "grant").length, 1); assert.equal(rows(f, "offline_test_allowance").length, 1); assert.equal(rows(f, "image_execution_dispatch").length, 1);
  await f.engine.reconcile(); await f.engine.runReady(); assert.deepEqual(f.calls, { http: 1, credentials: 1 });
});

test("immutable mapping/dispatch/outcome records reject changed payloads and cross-project receipt references", async t => {
  const f = fixture(t); await f.bridge.submit(f.request, context(f)); const other = projectFixture(); f.store.createProject(other);
  for (const family of ["image_execution_mapping", "image_execution_dispatch", "image_execution_result"]) {
    const record = rows(f, family)[0]; assert.throws(() => f.store.put(family, record.id, f.project.id, { ...record, requestDigest: "0".repeat(64) }));
    assert.throws(() => f.store.insert(family, record.id, other.id, { ...record, projectId: other.id }), { code: "SCOPE_DENIED" });
  }
  const result = rows(f, "image_execution_result")[0];
  assert.throws(() => f.store.put("image_execution_result", result.id, f.project.id, { ...result, observation: { kind: "not_dispatched", code: "LOCAL_CANCELLED" } }));
});
