import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { Store } from "../dist/persistence/index.js";
import { Engine } from "../dist/execution/index.js";
import { FakeProvider } from "../../../packages/providers/dist/index.js";
import { compilePlan, DEFAULT_PROFILES } from "../../../packages/core/dist/index.js";
import { setup, refreshIntent, sourceFor } from "./execution-fixture.mjs";

async function images(f) { assert.equal((await f.engine.runReady()).dispatched, 2); await f.engine.reconcile(); }
test("independent branches generate in parallel, while every video waits for its exact human review", async t => {
  const f = setup(t); await images(f);
  assert.equal(f.provider.acceptedCount(), 2); assert.equal(f.engine.outputs(f.projectId).length, 2);
  const blocked = await f.engine.runReady(); assert.equal(blocked.dispatched, 0); assert.ok(blocked.blocked.every(item => item.code === "HUMAN_REVIEW_REQUIRED"));
  const snapshot = f.engine.reviewSnapshot(f.projectId); assert.ok(snapshot.members.every(member => member.ready));
  f.engine.approve(f.projectId, snapshot.id, [snapshot.members[0].videoNodeId], "human-review");
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  assert.equal(f.engine.outputs(f.projectId).filter(item => item.artifact.kind === "video").length, 1);
  const artifact = f.store.get("artifact", f.engine.outputs(f.projectId).find(item => item.artifact.kind === "video").artifact.artifactId);
  assert.equal(artifact.fixture, true); assert.equal(artifact.physicalDurationSeconds, 1); assert.equal(readFileSync(artifact.path).subarray(4, 8).toString(), "ftyp");
});
test("owned scoped holds and user pauses compose without stopping accepted-job monitoring", async t => {
  const f = setup(t); const hold = f.engine.setHold(f.projectId, { scopeId: "shot-0", ownerId: "edit-1" });
  assert.throws(() => f.engine.releaseHold(f.projectId, hold.id, "edit-2"), { code: "SCOPE_DENIED" });
  assert.equal((await f.engine.runReady()).dispatched, 1);
  f.engine.setPaused(f.projectId, true, "human-pause"); f.engine.releaseHold(f.projectId, hold.id, "edit-1");
  await f.engine.reconcile(); assert.equal(f.engine.outputs(f.projectId).length, 1);
  assert.equal((await f.engine.runReady()).dispatched, 0);
  f.engine.setPaused(f.projectId, false, "human-resume"); assert.equal((await f.engine.runReady()).dispatched, 1);
});
test("lost submission acknowledgment remains reserved and reconciles after restart without another acceptance", async t => {
  const f = setup(t, { count: 1 }); const image = f.plan.nodes.find(node => node.kind === "image");
  f.provider.setMode(image.id, "unknown_after_accept"); await f.engine.runReady();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), 1);
  f.store.close(); f.provider.close();
  const store = new Store(f.dbPath); const provider = new FakeProvider(f.providerPath); const engine = new Engine(store, provider, { artifactDir: f.artifactDir });
  try { await engine.reconcile(); assert.equal(engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(provider.acceptedCount(), 1); assert.equal(engine.outputs(f.projectId).length, 1); }
  finally { store.close(); provider.close(); }
});
test("trusted technical failure retries the same candidate under a new attempt ordinal and reservation", async t => {
  const f = setup(t, { count: 1 }); const image = f.plan.nodes.find(node => node.kind === "image");
  f.provider.setMode(image.id, ["technical_failure", "complete"]);
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady(); await f.engine.reconcile();
  const attempts = f.engine.attempts(f.projectId); assert.equal(attempts.length, 2); assert.equal(attempts[0].candidateId, attempts[1].candidateId);
  assert.deepEqual(attempts.map(attempt => attempt.ordinal), [1, 2]); assert.equal(attempts[1].phase, "succeeded"); assert.equal(f.engine.budget(f.projectId).committedMicros, "200");
  await f.engine.runReady(); assert.equal(f.provider.acceptedCount(), 2);
});
test("a scoped replacement preserves the other branch and rejects old review while retaining old artifacts", async t => {
  const f = setup(t); await images(f); const snapshot = f.engine.reviewSnapshot(f.projectId); const oldOutputs = f.engine.outputs(f.projectId);
  const project = f.store.getProject(f.projectId); project.shots[0].framing = "Close-up"; project.shots[0].imagePrompt = "Close-up boot"; project.shots[0].revisionId = randomUUID(); refreshIntent(project.shots[0]); project.revisionId = randomUUID();
  const next = f.compile(project); const bindings = {};
  for (const node of next.nodes.filter(node => node.shotId === "shot-0")) bindings[node.id] = f.engine.createGrant(f.projectId, "shot-0", node.kind, "human-edit").id;
  const planId = randomUUID(); f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, next, bindings); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  assert.equal(f.engine.outputs(f.projectId).length, 1); assert.equal(f.engine.outputs(f.projectId)[0].artifact.artifactId, oldOutputs.find(item => item.nodeId === next.nodes.find(node => node.alias === "image1").id).artifact.artifactId);
  assert.throws(() => f.engine.approve(f.projectId, snapshot.id, [snapshot.members[0].videoNodeId], "human"));
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  assert.equal(f.store.list("artifact", f.projectId).length, 3);
});
test("an explicit identical new take gets a distinct candidate while valid frame approval remains reusable", async t => {
  const f = setup(t, { count: 1 }); await f.engine.runReady(); await f.engine.reconcile();
  const snapshot = f.engine.reviewSnapshot(f.projectId); const videoId = snapshot.members[0].videoNodeId;
  f.engine.approve(f.projectId, snapshot.id, [videoId], "human"); await f.engine.runReady(); await f.engine.reconcile();
  const old = f.engine.attempts(f.projectId).find(attempt => attempt.nodeId === videoId); const project = f.store.getProject(f.projectId); const planId = randomUUID(); const grant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-new-take");
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, f.plan, { [videoId]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  assert.equal((await f.engine.runReady()).dispatched, 1); await f.engine.reconcile();
  const videos = f.engine.attempts(f.projectId).filter(attempt => attempt.nodeId === videoId); assert.equal(videos.length, 2); assert.notEqual(videos[1].candidateId, old.candidateId); assert.equal(videos[1].fingerprint, old.fingerprint);
});
test("a recreated logical node cannot consume a previously used grant", t => {
  const f = setup(t, { imagesOnly: true, count: 1 }); const old = f.store.list("candidate", f.projectId)[0]; const changed = structuredClone(f.plan); changed.nodes[0].id = randomUUID(); changed.graphDigest = randomUUID();
  assert.throws(() => f.engine.installPlan(f.projectId, randomUUID(), changed, { [changed.nodes[0].id]: old.grantId }), { code: "UNIQUENESS_CONFLICT" });
  assert.equal(f.store.list("candidate", f.projectId).length, 1);
});
test("live measured cue readiness is rechecked even after keyframe approval", async t => {
  const f = setup(t, { count: 1 }); const project = f.store.getProject(f.projectId); const cue = { id: "cue", meaning: "Boot", durationFrames: 180, placementFrames: 0, audio: { artifactId: "audio", sha256: "a".repeat(64), kind: "audio" }, accepted: true, measured: true };
  project.cues = [cue]; project.shots[0].cueId = cue.id; refreshIntent(project.shots[0], cue); project.revisionId = randomUUID();
  const plan = f.compile(project); const video = plan.nodes.find(node => node.kind === "video"); const grant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-cue"); const planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, plan, { [video.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  await f.engine.runReady(); await f.engine.reconcile(); const snapshot = f.engine.reviewSnapshot(f.projectId); f.engine.approve(f.projectId, snapshot.id, [video.id], "human");
  const current = f.store.getProject(f.projectId); current.cues[0].accepted = false; f.store.saveProject(current, current.headVersion);
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, "TIMING_REQUIRED");
});
test("late stale-lease evidence is retained and cannot overwrite the active fence", async t => {
  const f = setup(t, { count: 1, leaseMs: 150 }); let release, started; const entered = new Promise(resolve => { started = resolve; });
  const original = f.provider.submit.bind(f.provider);
  f.provider.submit = async request => { const outcome = await original(request); await new Promise(resolve => { release = resolve; started(); }); return outcome; };
  const running = f.engine.runReady(); await entered;
  // Submission now renews its lease. Explicitly lose it rather than relying on a slow call.
  const attempt = f.engine.attempts(f.projectId)[0]; f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseExpiresAt: 0 });
  const second = new Store(f.dbPath); const provider = new FakeProvider(f.providerPath); const engine = new Engine(second, provider, { artifactDir: f.artifactDir });
  try {
    await engine.reconcile(); release(); await running;
    assert.equal(engine.attempts(f.projectId)[0].phase, "succeeded"); assert.ok(engine.attempts(f.projectId)[0].leaseEpoch > 1);
    assert.equal(provider.acceptedCount(), 1); assert.equal(second.list("execution_evidence", f.projectId).length, 2); assert.equal(engine.outputs(f.projectId).length, 1);
  } finally { second.close(); provider.close(); }
});
test("two real worker connections racing near the cap admit exactly one covered submission", async t => {
  const f = setup(t, { imagesOnly: true, budgetMicros: "100" }); const shared = new SharedArrayBuffer(4);
  const modulePaths = { store: new URL("../dist/persistence/index.js", import.meta.url).href, engine: new URL("../dist/execution/index.js", import.meta.url).href, provider: new URL("../../../packages/providers/dist/index.js", import.meta.url).href };
  const workers = [0, 1].map(() => new Worker(`const {parentPort,workerData}=require('node:worker_threads'); (async()=>{const {Store}=await import(workerData.modules.store);const {Engine}=await import(workerData.modules.engine);const {FakeProvider}=await import(workerData.modules.provider);const store=new Store(workerData.dbPath);const provider=new FakeProvider(workerData.providerPath);const engine=new Engine(store,provider,{artifactDir:workerData.artifactDir,budgetMicros:'100'});parentPort.postMessage('ready');Atomics.wait(new Int32Array(workerData.shared),0,0);try {parentPort.postMessage(await engine.runReady());}finally{store.close();provider.close();}})().catch(error=>{throw error;});`, { eval: true, workerData: { modules: modulePaths, shared, dbPath: f.dbPath, providerPath: f.providerPath, artifactDir: f.artifactDir } }));
  const ready = workers.map(worker => new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
  await Promise.all(ready); const results = workers.map(worker => new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
  Atomics.store(new Int32Array(shared), 0, 1); Atomics.notify(new Int32Array(shared), 0, 2);
  const completed = await Promise.all(results); await Promise.all(workers.map(worker => worker.terminate()));
  assert.equal(completed.reduce((sum, result) => sum + result.dispatched, 0), 1); assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
});

test("uncertain pre-send failure never guesses rejection or frees its liability", async t => {
  const f = setup(t, { count: 1, imagesOnly: true, budgetMicros: "100" });
  f.provider.submit = async () => { throw Error("connection lost before any trustworthy acceptance evidence"); };
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady();
  assert.equal(f.provider.acceptedCount(), 0); assert.equal(f.engine.attempts(f.projectId).length, 1);
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "submission_unknown"); assert.equal(f.engine.budget(f.projectId).committedMicros, "100");
  const other = new Store(f.dbPath); const restarted = new Engine(other, f.provider, { artifactDir: f.artifactDir });
  try { assert.equal(restarted.budget(f.projectId).capMicros, "100"); } finally { other.close(); }
});

test("late completion from a replaced candidate is historical and cannot select itself", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); const node = f.plan.nodes[0];
  f.provider.setMode(node.id, "pending"); await f.engine.runReady(); const old = f.engine.attempts(f.projectId)[0];
  const project = f.store.getProject(f.projectId); const grant = f.engine.createGrant(f.projectId, "shot-0", "image", "human-new-image"); const planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, f.plan, { [node.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  f.provider.complete(old.taskId); await f.engine.reconcile();
  assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.store.list("artifact", f.projectId).length, 1); assert.equal(f.engine.outputs(f.projectId).length, 0);
  await f.engine.runReady(); await f.engine.reconcile(); assert.equal(f.engine.outputs(f.projectId).length, 1); assert.notEqual(f.engine.outputs(f.projectId)[0].candidateId, old.candidateId);
});

test("crash after durable output evidence recovers ingestion without another provider call", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); await f.engine.runReady();
  const original = f.store.insert.bind(f.store); let injected = false;
  f.store.insert = (...args) => { if (args[0] === "artifact" && !injected) { injected = true; throw Error("injected publication crash"); } return original(...args); };
  await assert.rejects(f.engine.reconcile(), /publication crash/); f.store.insert = original;
  const attempt = f.engine.attempts(f.projectId)[0]; assert.equal(attempt.phase, "ingesting"); assert.equal(f.store.list("artifact", f.projectId).length, 0);
  f.store.put("attempt", attempt.id, f.projectId, { ...attempt, leaseExpiresAt: 0 });
  f.provider.poll = async () => { throw Error("provider unavailable after download"); }; f.provider.lookup = f.provider.poll;
  await f.engine.reconcile(); assert.equal(f.engine.attempts(f.projectId)[0].phase, "succeeded"); assert.equal(f.engine.outputs(f.projectId).length, 1); assert.equal(f.provider.acceptedCount(), 1);
});

test("a technical retry cannot exceed the bounded paid attempt allowance", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); f.provider.setMode(f.plan.nodes[0].id, ["technical_failure", "technical_failure", "complete"]);
  await f.engine.runReady(); await f.engine.reconcile(); await f.engine.runReady(); await f.engine.reconcile();
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, "RETRY_NOT_AUTHORIZED"); assert.equal(f.provider.acceptedCount(), 2);
});

test("restart uses immutable lock prices and profiles instead of changed constructor defaults", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); const project = f.store.getProject(f.projectId);
  f.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES });
  const changed = DEFAULT_PROFILES.map(profile => ({ ...profile, revision: "unsupported-new-default", unitCostMicros: "999999", maxConcurrency: 0 }));
  const store = new Store(f.dbPath); const provider = new FakeProvider(f.providerPath); const engine = new Engine(store, provider, { artifactDir: f.artifactDir, profiles: changed });
  try {
    assert.equal((await engine.runReady()).dispatched, 1); await engine.reconcile();
    assert.equal(engine.attempts(project.id)[0].request.args.profileRevision, "1"); assert.equal(engine.budget(project.id).committedMicros, "100");
    assert.equal(store.list("reservation", project.id)[0].micros, "100");
  } finally { store.close(); provider.close(); }
});

test("changed pinned profile revision blocks the old compiled node without falling back to defaults", async t => {
  const f = setup(t, { count: 1, imagesOnly: true }); const project = f.store.getProject(f.projectId);
  f.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES.map(profile => ({ ...profile, revision: "2" })) });
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, "PROFILE_INCOMPATIBLE"); assert.equal(f.provider.acceptedCount(), 0);
});

test("identical finalized local inputs rebind cached derivatives after an explicit new video candidate", async t => {
  const f = setup(t, { count: 1 }); const project = f.store.getProject(f.projectId);
  const source = sourceFor(project).replace("return [video0];", 'const timeline=p.timeline("timeline",{takes:[video0]});return p.render("render",{timeline});');
  const plan = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: f.logicalIds, allocateId: randomUUID }); const planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, plan); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  await f.engine.runReady(); await f.engine.reconcile(); const snapshot = f.engine.reviewSnapshot(f.projectId); const videoId = snapshot.members[0].videoNodeId;
  f.engine.approve(f.projectId, snapshot.id, [videoId], "human");
  for (let i = 0; i < 4; i++) { await f.engine.runReady(); await f.engine.reconcile(); }
  assert.equal(f.engine.outputs(f.projectId).length, 4); const localAttempts = f.engine.attempts(f.projectId).filter(attempt => attempt.candidateId === null); assert.equal(localAttempts.length, 2);
  const current = f.store.getProject(f.projectId); const newPlanId = randomUUID(); const grant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-new-take");
  f.store.transaction(() => { f.engine.installPlan(f.projectId, newPlanId, plan, { [videoId]: grant.id }); f.store.saveProject({ ...current, activePlanId: newPlanId }, current.headVersion); });
  let reused = 0;
  for (let i = 0; i < 4; i++) { reused += (await f.engine.runReady()).reused; await f.engine.reconcile(); }
  assert.equal(f.engine.outputs(f.projectId).length, 4); assert.equal(reused, 2); assert.equal(f.engine.attempts(f.projectId).filter(attempt => attempt.candidateId === null).length, 2);
  assert.equal(f.provider.acceptedCount(), 3); assert.equal(f.store.readEvents(f.projectId).filter(event => event.kind === "execution.output_reused").length, 2);
});

test("an application narrated lock blocks video without a cue despite exact keyframe approval", async t => {
  const f = setup(t, { count: 1 }); const project = f.store.getProject(f.projectId);
  f.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES, recipeDigest: "narrated-video-fixture" });
  await f.engine.runReady(); await f.engine.reconcile();
  const snapshot = f.engine.reviewSnapshot(f.projectId); assert.equal(snapshot.members[0].ready, true);
  f.engine.approve(f.projectId, snapshot.id, [snapshot.members[0].videoNodeId], "human-review");
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, "TIMING_REQUIRED");
  assert.equal(f.provider.acceptedCount(), 1); assert.equal(f.engine.attempts(f.projectId).filter(attempt => attempt.request.kind === "video").length, 0);
});

test("narrated dispatch requires measured cue, shot and requested video durations to agree", async t => {
  const f = setup(t, { count: 1 }); const project = f.store.getProject(f.projectId);
  f.store.insert("capability_lock", project.capabilityLockId, project.id, { profiles: DEFAULT_PROFILES, recipeDigest: "narrated-video-fixture" });
  const cue = { id: "cue-duration", meaning: "Boot", durationFrames: 180, placementFrames: 0, audio: { artifactId: "audio", sha256: "a".repeat(64), kind: "audio" }, accepted: true, measured: true };
  project.cues = [cue]; project.shots[0].cueId = cue.id; project.shots[0].desiredFrames = 150; refreshIntent(project.shots[0], cue); project.revisionId = randomUUID();
  const plan = f.compile(project); const video = plan.nodes.find(node => node.kind === "video");
  const grant = f.engine.createGrant(f.projectId, "shot-0", "video", "human-timing"); const planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(f.projectId, planId, plan, { [video.id]: grant.id }); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  await f.engine.runReady(); await f.engine.reconcile(); const snapshot = f.engine.reviewSnapshot(f.projectId);
  assert.equal(snapshot.members[0].ready, true); f.engine.approve(f.projectId, snapshot.id, [video.id], "human-review");
  const result = await f.engine.runReady(); assert.equal(result.dispatched, 0); assert.equal(result.blocked[0].code, "TIMING_REQUIRED"); assert.equal(f.provider.acceptedCount(), 1);
});
