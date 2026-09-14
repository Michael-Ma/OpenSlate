import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonical, DEFAULT_PROFILES, digest, providerProfileArguments } from "@openslate/core";
import { FakeProvider, OPENAI_SPEECH_MODEL } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { LocalMediaService } from "../dist/media/local-media.js";
import { NarrationService } from "../dist/narration/service.js";
import { NarrationSpeechService } from "../dist/narration/narration-speech-service.js";
import { OpenAISpeechExecution } from "../dist/execution/openai-speech-execution.js";
import { ExecutionOutputStore } from "../dist/execution/output-store.js";
import { DurableExternalAdmission } from "../dist/execution/durable-external-admission.js";
import { EnvironmentMediaCredentials } from "../dist/application/provider-credentials.js";
import { ExternalAllowanceService, allowanceIssueContextDigest } from "../dist/application/external-allowances.js";
import { projectFixture } from "./execution-fixture.mjs";
import { response } from "./speech-execution-fixture.mjs";

export const key = () => randomUUID();
export const draft = (text = "The exact saved narration words.", source = {}) => ({ text, meaning: text, textKind: "draft", language: "en",
  source: { kind: "generated", voice: null, profileRevisionId: null, ...source } });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const bodies = (f, kinds) => canonical(Object.fromEntries(kinds.map(kind => [kind, rows(f, kind)])));
export const speechProfile = Object.freeze({ id: "section-speech", revision: "offline-estimate-1", kind: "speech", adapter: "openai-speech", executionVersion: "1",
  configuration: { model: OPENAI_SPEECH_MODEL, settings: {} }, maxConcurrency: 2, unitCostMicros: "100", maxRetries: 0 });

function fullSource(project) {
  let source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
  for (const [i, shot] of project.shots.entries()) source += `const s${i}=p.shot(${JSON.stringify(shot.id)});`
    + `const i${i}=p.image("frame-${i}",{intent:s${i},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`
    + `const r${i}=p.humanReview("review-${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:6}]});`
    + `const v${i}=p.video("take-${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:6});`;
  return source + `const edit=p.timeline("edit",{takes:[v0,v1],transition:"cut"});return p.render("preview",{timeline:edit,format:"mp4"});});`;
}

/** Production-created locked project and saved draft; all optional provider replies are injected. */
export async function narrationSpeechFixture(t, options = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "openslate-narration-speech-"))), root = join(parent, "installation"); mkdirSync(root);
  const path = join(root, "openslate.sqlite"), artifactDir = join(root, "artifacts"), store = new Store(path), stores = [store];
  const provider = new FakeProvider(join(root, "fake-provider.sqlite")), profile = structuredClone(speechProfile), profiles = [...DEFAULT_PROFILES, profile];
  const outputs = new ExecutionOutputStore(store, { rootDir: join(root, "execution-output") }), calls = { http: 0, credentials: 0 };
  const credentials = new EnvironmentMediaCredentials(() => { calls.credentials++; return options.credential ? options.credential() : "offline-only-speech-key"; });
  const fetch = async (...args) => { calls.http++; return options.fetch ? options.fetch(...args) : response(); };
  const bridge = new OpenAISpeechExecution({ store, outputStore: outputs, credentials, fetch });
  const engine = new Engine(store, options.realSpeech ? bridge : provider, { artifactDir, profiles, outputStore: outputs,
    externalAdmission: new DurableExternalAdmission(store, () => {}) });
  const production = new ProductionService(store, engine, profiles); let project = production.createProject("Narration speech proposal");
  if (options.plan) project = store.saveProject({ ...projectFixture(project.id, 2), capabilityLockId: project.capabilityLockId }, project.headVersion);
  const human = production.beginRequest(project.id, "human", "Prepare my saved narration section."), actor = production.openEpoch(project.id, human).actor;
  const media = new LocalMediaService({ rootDir: join(root, "media"), allowedInputRoots: [parent], ffmpegPath: "/missing/offline-ffmpeg", ffprobePath: "/missing/offline-ffprobe" });
  const narration = new NarrationService(production, media), service = new NarrationSpeechService(narration), allowances = new ExternalAllowanceService(store);
  const f = { root, parent, directory: root, path, store, stores, provider, profile, profiles, outputs, calls, bridge, credentials, fetch,
    engine, production, human, actor, media, narration, service, project, artifactDir, allowances };
  t.after(() => { for (const item of stores) if (item.db.open) item.close(); if (provider.db.open) provider.close(); rmSync(parent, { recursive: true, force: true }); });
  if (options.plan) {
    const before = store.getProject(project.id);
    production.authorize(project.id, human, before.shots.flatMap(shot => ["image", "video"].map(kind => ({ scopeId: shot.id, kind }))), key(), "initial_slot");
    const prepared = await production.prepare(project.id, actor, { variant: "plan", expectedHeadVersion: before.headVersion, source: fullSource(before) });
    production.apply(project.id, actor, prepared.id);
  }
  f.view = () => narration.snapshot(project.id, human);
  f.revise = patch => narration.reviseSegments(project.id, human, f.view().state.version, key(), patch);
  f.revise({ add: [draft(options.text), draft("Keep this unrelated section unchanged.")] });
  f.input = (patch = {}) => ({ key: key(), expectedHeadVersion: store.getProject(project.id).headVersion,
    segmentId: f.view().segments[0].entry.segmentId, segmentRevisionId: f.view().segments[0].script.id,
    profileId: profile.id, voice: "coral", instructions: "Warm, measured delivery.", ...patch });
  f.prepare = (input = f.input(), prepareOptions = {}) => service.prepare(project.id, actor, input, prepareOptions);
  f.review = (proposal, input = {}, reviewOptions = {}) => service.review(project.id, human,
    { key: key(), proposalId: proposal.id, proposalDigest: digest(proposal), ...input }, reviewOptions);
  f.issue = application => {
    const candidate = store.get("candidate", application.candidateId), node = store.get("node_binding", candidate.nodeId).node;
    const input = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
      selections: [{ candidateId: candidate.id, nodeId: node.id, specDigest: node.specDigest }], maxAttempts: 1,
      maxEstimatedMicros: "100", expiresAt: new Date(Date.now() + 3600000).toISOString() };
    const spendingActor = production.beginRequest(project.id, "human", "Approve one exact offline fixture start", { editing: false,
      scopeIds: [project.id], contextDigest: allowanceIssueContextDigest(project.id, input) });
    return allowances.issue(project.id, spendingActor, input);
  };
  f.admit = application => { const candidate = store.get("candidate", application.candidateId), node = store.get("node_binding", candidate.nodeId).node;
    return engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint); };
  f.project = store.getProject(project.id); return f;
}
