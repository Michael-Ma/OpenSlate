import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DomainError, compilePlan, digest, providerProfileArguments, DEFAULT_PROFILES } from "../../../packages/core/dist/index.js";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { OpenAITranscriptionExecution } from "../dist/execution/openai-transcription-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { TranscriptionAudioService } from "../dist/execution/transcription-audio-service.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { transcriptionFixture } from "./transcription-execution-fixture.mjs";

export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export async function eventually(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < deadline, "controlled condition did not become true"); await new Promise(resolve => setTimeout(resolve, 10)); }
}
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const current = f => rows(f, "attempt")[0];
export function due(f) {
  const attempt = current(f);
  f.store.put("attempt", attempt.id, f.project.id, { ...attempt, leaseExpiresAt: 0,
    preparation: { ...attempt.preparation, nextEligibleAt: 0 } });
}
export const liability = f => ({ attempts: rows(f, "attempt").map(({ id, candidateId, ordinal, reservationId, request }) => ({ id, candidateId, ordinal, reservationId, request })),
  candidates: rows(f, "candidate"), grants: rows(f, "grant"), consumptions: rows(f, "external_allowance_consumption"), reservations: rows(f, "reservation") });

/** Real imported/accepted audio and durable human allowance, with only preparation scheduling and HTTP controlled by this fixture. */
export async function preparationEngineFixture(t, options = {}) {
  const f = await transcriptionFixture(t, { ...options, deferAdmission: true });
  f.control = { busy: true, beforePrepare: undefined, beforeStart: undefined, afterOutcome: undefined };
  f.calls.starts = 0; f.calls.resumes = 0; f.calls.lookups = 0; f.calls.submits = 0;
  f.makeWorker = (store = f.store, workerOptions = {}) => {
    const outputs = new ExecutionOutputStore(store, { rootDir: join(f.directory, "execution-output") });
    const preparation = new TranscriptionAudioService(store, f.media, f.files), prepare = preparation.prepare.bind(preparation);
    preparation.prepare = async (...args) => {
      f.calls.prepare++;
      assert.equal(store.get("attempt", args[0].id).phase, "preparing", "protocol evidence must precede local work");
      if (f.control.beforePrepare) await f.control.beforePrepare({ store, attempt: args[0], options: args[1] });
      if (f.control.busy) throw new DomainError("MEDIA_BUSY", "synthetic shared worker contention");
      return prepare(...args);
    };
    const bridge = new OpenAITranscriptionExecution({ store, outputStore: outputs, preparation, credentials: f.credentials, fetch: f.fetch, timeoutMs: 5000 });
    const lookup = bridge.lookup.bind(bridge), submit = bridge.submit.bind(bridge);
    bridge.lookup = async (...args) => { f.calls.lookups++; return lookup(...args); };
    bridge.submit = async (...args) => { f.calls.submits++; return submit(...args); };
    const port = { identity: { adapter: "openai-transcription", version: "1" },
      async start(...args) { f.calls.starts++; if (f.control.beforeStart) await f.control.beforeStart(...args); const result = await bridge.start(...args); return f.control.afterOutcome ? f.control.afterOutcome(result) : result; },
      async resume(...args) { f.calls.resumes++; const result = await bridge.resume(...args); return f.control.afterOutcome ? f.control.afterOutcome(result) : result; } };
    const engine = new Engine(store, bridge, { artifactDir: f.artifactRoot, profiles: [f.profile], outputStore: outputs,
      externalAdmission: new DurableExternalAdmission(store, () => {}), submissionPreparation: port,
      leaseMs: options.leaseMs ?? 30000, providerTimeoutMs: 5000, ...workerOptions });
    return { store, engine, bridge, port, outputs, preparation };
  };
  f.worker = f.makeWorker(); f.engine = f.worker.engine;
  f.reopen = () => {
    if (f.store.db.open) f.store.close();
    f.store = new Store(f.path); f.stores.push(f.store); f.worker = f.makeWorker(); f.engine = f.worker.engine; return f.worker;
  };
  f.peer = () => { const store = new Store(f.path); f.stores.push(store); return f.makeWorker(store); };
  return f;
}

export function install(f, plan, grants = {}) {
  const project = f.store.getProject(f.project.id), planId = randomUUID();
  f.store.transaction(() => { f.engine.installPlan(project.id, planId, plan, grants); f.store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  return planId;
}
function approveNode(f, node) {
  const target = f.store.get("node_binding", node.id), input = { profileDigest: String(providerProfileArguments(f.profile).profileDigest), profileDefinitionDigest: digest(f.profile),
    selections: [{ candidateId: target.candidateId, nodeId: target.id, specDigest: target.node.specDigest }], maxAttempts: 1, maxEstimatedMicros: "100",
    expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const human = f.production.beginRequest(f.project.id, "offline-human", "Approve this exact controlled transcription", { editing: false, scopeIds: [f.project.id], contextDigest: allowanceIssueContextDigest(f.project.id, input) });
  return f.allowances.issue(f.project.id, human, input);
}
export function addSecondTranscription(f) {
  const project = f.store.getProject(f.project.id), q = JSON.stringify;
  const spec = `{profile:${q(f.profile.id)},audio:p.asset(${q(f.audio.id)}),language:"auto",timing:"word",settings:{}}`;
  const plan = compilePlan(`definePlan({baseRevision:${q(project.revisionId)}},p=>{const first=p.transcription("transcript",${spec});const second=p.transcription("second",${spec});return [first,second];});`,
    { project, profiles: [f.profile], logicalIds: { transcript: f.node.id }, allocateId: randomUUID });
  const second = plan.nodes[1]; install(f, plan, { [second.id]: f.engine.createGrant(project.id, project.id, "transcription", "human-second-transcription").id });
  approveNode(f, second); return second.id;
}
export function replan(f, { language = "auto", freshCandidate = false, brief = "An unrelated editorial update", alias = "transcript" } = {}) {
  const before = f.store.getProject(f.project.id);
  f.store.saveProject({ ...before, revisionId: randomUUID(), brief }, before.headVersion);
  const project = f.store.getProject(f.project.id), q = JSON.stringify;
  const plan = compilePlan(`definePlan({baseRevision:${q(project.revisionId)}},p=>{return p.transcription(${q(alias)},{profile:${q(f.profile.id)},audio:p.asset(${q(f.audio.id)}),language:${q(language)},timing:"word",settings:{}});});`,
    { project, profiles: [f.profile], logicalIds: { transcript: f.node.id }, allocateId: randomUUID });
  const old = f.store.get("node_binding", f.node.id), changed = plan.nodes[0].specDigest !== old.node.specDigest || plan.nodes[0].id !== old.id;
  const grants = changed || freshCandidate ? { [plan.nodes[0].id]: f.engine.createGrant(project.id, project.id, "transcription", "human-replacement").id } : {};
  install(f, plan, grants); return plan;
}

/** Controlled completed upstream binding: its real owned audio remains the ordinary canonical import. No upstream generation is claimed. */
export function useOutputSource(f) {
  const project = f.store.getProject(f.project.id), q = JSON.stringify, speech = DEFAULT_PROFILES.find(profile => profile.kind === "speech");
  const plan = compilePlan(`definePlan({baseRevision:${q(project.revisionId)}},p=>{const recording=p.speech("owned-source",{profile:${q(speech.id)},text:"Leather boots.",voice:"alloy"});return p.transcription("transcript",{profile:${q(f.profile.id)},audio:recording,language:"auto",timing:"word"});});`,
    { project, profiles: [speech, f.profile], logicalIds: { transcript: f.node.id }, allocateId: randomUUID });
  const grants = Object.fromEntries(plan.nodes.map(node => [node.id, f.engine.createGrant(project.id, project.id, node.kind, "controlled-upstream-fixture").id]));
  install(f, plan, grants);
  const upstream = plan.nodes.find(node => node.kind === "speech"), binding = f.store.get("node_binding", upstream.id);
  f.store.put("node_binding", upstream.id, project.id, { ...binding, outputs: { audio: f.store.get("artifact", f.audio.id).artifact } });
  f.node = plan.nodes.find(node => node.kind === "transcription");
  f.allowance = approveNode(f, f.node);
  return upstream.id;
}
