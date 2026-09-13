import { canonical, digest, invariant, snapshotLocalExecution } from "@openslate/core";
import type { ArtifactRef, JsonObject, LocalExecutionIdentity } from "@openslate/core";
import type { ArtifactRecord, Attempt } from "./engine.js";
import type { CapturedRender, CapturedTimeline } from "../media/timeline-capture.js";
import type { FrozenRenderManifest } from "../media/types.js";
import { createLocalTimelineDocument, parseLocalTimelineDocument } from "../media/local-timeline.js";

interface PreparedIdentity { projectId: string; nodeId: string; specDigest: string; contentDigest: string }
export type PreparedLocalExecution = PreparedIdentity & (
  { kind: "timeline"; capture: CapturedTimeline; recipe: JsonObject }
  | { kind: "render"; capture: CapturedRender; recipe: FrozenRenderManifest; timelineArtifact: ArtifactRef }
);
export interface LocalExecutionIntent {
  id: string; projectId: string; version: 1; attemptId: string; requestDigest: string;
  capabilityLockId: string; execution: LocalExecutionIdentity; prepared: PreparedLocalExecution; effectiveFingerprint: string;
  outputArtifactId: string; createdAt: string;
}
export interface LocalExecutionOptions {
  signal: AbortSignal; expectedLease: Readonly<{ owner: string; epoch: number }>;
}
export interface LocalExecutionResult {
  version: 1; intentDigest: string; requestDigest: string; port: "timeline" | "video"; artifact: ArtifactRecord;
  completion: { kind: "timeline"; documentDigest: string } | { kind: "render"; manifestDigest: string; sha256: string };
}
export interface LocalExecutionPort {
  readonly identity: LocalExecutionIdentity;
  readonly maxOutputBytes: number;
  prepare(projectId: string, nodeId: string, options?: { signal?: AbortSignal }): Promise<PreparedLocalExecution>;
  /** SQL-only exact comparison of the complete captured target and input. */
  matches(prepared: PreparedLocalExecution): boolean;
  recover(intent: LocalExecutionIntent, options: LocalExecutionOptions): Promise<LocalExecutionResult | null>;
  execute(intent: LocalExecutionIntent, options: LocalExecutionOptions): Promise<LocalExecutionResult>;
}
export interface LocalExecutionDispatch {
  id: string; projectId: string; version: 1; attemptId: string; requestDigest: string; intentDigest: string;
  owner: string; epoch: number; createdAt: string;
}
export interface LocalExecutionCompletion {
  id: string; projectId: string; version: 1; attemptId: string; result: LocalExecutionResult;
}
export interface LocalExecutionBinding {
  id: string; projectId: string; attemptId: string; prepared: PreparedLocalExecution;
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const fields = (value: object, keys: string[]) => invariant(value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), "LOCAL_EXECUTION_CONFLICT", "Invalid local execution record fields");
export function localContentDigest(prepared: PreparedLocalExecution): string {
  if (prepared.kind === "timeline") return digest(prepared.recipe);
  const { digest: _digest, targetRevisionId: _revision, ...content } = prepared.recipe;
  return digest({ execution: { adapter: "local-media", version: "1" }, kind: "render", manifest: content });
}
export function assertPreparedLocalExecution(value: PreparedLocalExecution): void {
  fields(value, ["projectId", "nodeId", "specDigest", "contentDigest", "kind", "capture", "recipe", ...(value?.kind === "render" ? ["timelineArtifact"] : [])]);
  invariant(id(value.projectId) && id(value.nodeId) && hash(value.specDigest) && hash(value.contentDigest)
    && (value.kind === "timeline" || value.kind === "render") && value.recipe && typeof value.recipe === "object" && !Array.isArray(value.recipe)
    && value.capture?.input?.projectId === value.projectId && value.capture.target?.revisionId === value.capture.input.targetRevisionId
    && value.contentDigest === localContentDigest(value) && Buffer.byteLength(canonical(value)) <= 2 * 1024 * 1024,
  "LOCAL_EXECUTION_CONFLICT", "Prepared local work differs from its exact capture or content identity");
  fields(value.capture, ["target", "input"]);
  fields(value.capture.target, ["revisionId", "headVersion", "planId", "graphDigest", "timelineNodeId", "canonicalNarrationId", "inputs", "dependencyNodeIds", "scopeIds", ...(value.kind === "render" ? ["renderNodeId"] : [])]);
  fields(value.capture.input, ["projectId", "targetRevisionId", "clips", "audio", ...(value.kind === "render" ? ["width", "height"] : [])]);
  invariant(value.kind === "timeline" ? value.capture.target.timelineNodeId === value.nodeId
    : value.capture.target.renderNodeId === value.nodeId && id(value.timelineArtifact?.artifactId) && value.timelineArtifact?.kind === "data" && hash(value.timelineArtifact.sha256),
  "LOCAL_EXECUTION_CONFLICT", "Prepared work names a different local operation");
  const target = value.capture.target;
  invariant(id(target.revisionId) && id(target.planId) && hash(target.graphDigest) && id(target.timelineNodeId)
    && Number.isSafeInteger(target.headVersion) && target.headVersion >= 0
    && (target.canonicalNarrationId === null || id(target.canonicalNarrationId))
    && Array.isArray(target.inputs) && target.inputs.length > 0 && target.inputs.length <= 129
    && [target.dependencyNodeIds, target.scopeIds].every(values => Array.isArray(values) && values.length > 0
      && values.length <= 4096 && values.every(id) && new Set(values).size === values.length)
    && target.dependencyNodeIds.includes(value.nodeId) && target.dependencyNodeIds.includes(target.timelineNodeId)
    && target.scopeIds.includes(value.projectId), "LOCAL_EXECUTION_CONFLICT", "Local capture target is incomplete");
  const document = createLocalTimelineDocument({ projectId: value.projectId, clips: value.capture.input.clips, audio: value.capture.input.audio ?? [] });
  const sources = [...document.clips, ...document.audio].map(placement => placement.source);
  for (const input of target.inputs) {
    fields(input, ["nodeId", "port", "artifact"]); fields(input.artifact, ["artifactId", "sha256", "kind"]);
    invariant((input.nodeId === null || id(input.nodeId) && target.dependencyNodeIds.includes(input.nodeId)) && id(input.port)
      && id(input.artifact.artifactId) && hash(input.artifact.sha256)
      && sources.some(source => source.artifactId === input.artifact.artifactId && source.sha256 === input.artifact.sha256 && source.kind === input.artifact.kind),
    "LOCAL_EXECUTION_CONFLICT", "Local capture input does not match its measured media");
  }
  invariant(sources.every(source => target.inputs.some(input => input.artifact.artifactId === source.artifactId
    && input.artifact.sha256 === source.sha256 && input.artifact.kind === source.kind)), "LOCAL_EXECUTION_CONFLICT", "Local capture omits a selected media input");
  if (value.kind === "timeline") invariant(canonical(parseLocalTimelineDocument(value.recipe)) === canonical(document),
    "LOCAL_EXECUTION_CONFLICT", "Timeline recipe differs from its captured sources or placements");
  if (value.kind === "render") {
    fields(value.recipe, ["digest", "version", "projectId", "targetRevisionId", "width", "height", "frameRate", "sampleRate", "totalFrames", "clips", "audio", "toolchainDigest"]);
    const { digest: manifestDigest, ...body } = value.recipe;
    invariant(manifestDigest === digest(body) && value.recipe.projectId === value.projectId
      && value.recipe.targetRevisionId === value.capture.target.revisionId
      && value.recipe.width === value.capture.input.width && value.recipe.height === value.capture.input.height
      && [value.recipe.width, value.recipe.height].every(size => Number.isSafeInteger(size) && size >= 2 && size <= 4096 && size % 2 === 0)
      && value.recipe.version === 1 && canonical(value.recipe.frameRate) === canonical({ numerator: 30, denominator: 1 })
      && value.recipe.sampleRate === 48000 && hash(value.recipe.toolchainDigest)
      && value.recipe.totalFrames === document.totalFrames
      && canonical(value.recipe.clips) === canonical(value.capture.input.clips)
      && canonical(value.recipe.audio) === canonical((value.capture.input.audio ?? []).map(placement => ({ ...placement, gainMilliDb: placement.gainMilliDb ?? 0 }))),
    "LOCAL_EXECUTION_CONFLICT", "Frozen render manifest differs from its target");
  }
}
export function isLocalExecutionAttempt(attempt: Attempt): boolean {
  return attempt.request.execution?.adapter === "local-media" || Object.hasOwn(attempt.request.args, "localExecution");
}
export function assertLocalExecutionIntent(value: LocalExecutionIntent, attempt: Attempt): void {
  fields(value, ["id", "projectId", "version", "attemptId", "requestDigest", "capabilityLockId", "execution", "prepared", "effectiveFingerprint", "outputArtifactId", "createdAt"]);
  snapshotLocalExecution(value.execution); snapshotLocalExecution(attempt.request.execution); snapshotLocalExecution(attempt.request.args.localExecution);
  assertPreparedLocalExecution(value.prepared);
  invariant(value.version === 1 && value.id === attempt.id && value.attemptId === attempt.id && value.projectId === attempt.projectId
    && value.prepared.projectId === attempt.projectId && value.prepared.nodeId === attempt.nodeId && value.prepared.specDigest === attempt.specDigest
    && value.prepared.kind === attempt.request.kind && value.requestDigest === digest(attempt.request)
    && hash(value.effectiveFingerprint) && attempt.fingerprint === localFingerprint(value.effectiveFingerprint, value.prepared.contentDigest)
    && attempt.request.fingerprint === attempt.fingerprint && attempt.workKey === localWorkKey(attempt.projectId, attempt.nodeId, attempt.fingerprint, attempt.ordinal)
    && attempt.candidateId === null && attempt.reservationId === null && attempt.taskId === null && !attempt.request.profile && !attempt.request.externalAllowanceId
    && id(value.capabilityLockId) && id(value.outputArtifactId) && Number.isFinite(Date.parse(value.createdAt)),
  "LOCAL_EXECUTION_CONFLICT", "Local intent is not bound to its exact application attempt");
}
export function assertLocalExecutionDispatch(value: LocalExecutionDispatch, intent: LocalExecutionIntent): void {
  fields(value, ["id", "projectId", "version", "attemptId", "requestDigest", "intentDigest", "owner", "epoch", "createdAt"]);
  invariant(value.version === 1 && value.id === intent.id && value.attemptId === intent.id && value.projectId === intent.projectId
    && value.requestDigest === intent.requestDigest && value.intentDigest === digest(intent) && id(value.owner)
    && Number.isSafeInteger(value.epoch) && value.epoch > 0 && Number.isFinite(Date.parse(value.createdAt)),
  "LOCAL_EXECUTION_CONFLICT", "Local dispatch differs from its durable intent");
}
export function assertLocalExecutionResult(value: LocalExecutionResult, intent: LocalExecutionIntent): void {
  fields(value, ["version", "intentDigest", "requestDigest", "port", "artifact", "completion"]);
  const artifact = value.artifact, timeline = intent.prepared.kind === "timeline";
  invariant(value.version === 1 && value.intentDigest === digest(intent) && value.requestDigest === intent.requestDigest
    && value.port === (timeline ? "timeline" : "video") && artifact?.id === intent.outputArtifactId && artifact.projectId === intent.projectId
    && artifact.attemptId === intent.attemptId && artifact.artifact?.artifactId === artifact.id && hash(artifact.artifact.sha256)
    && artifact.artifact.kind === (timeline ? "data" : "video") && artifact.fixture === false
    && artifact.mimeType === (timeline ? "application/json" : "video/mp4") && typeof artifact.path === "string"
    && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength! > 0 && artifact.byteLength! <= (timeline ? 1024 * 1024 : 1024 * 1024 * 1024)
    && (timeline ? artifact.artifact.sha256 === intent.prepared.contentDigest && artifact.physicalDurationSeconds === null
      : intent.prepared.kind === "render" && artifact.origin === "local_render" && artifact.physicalDurationSeconds === intent.prepared.recipe.totalFrames / 30),
  "LOCAL_EXECUTION_CONFLICT", "Local completion differs from its exact owned output");
  fields(value.completion, timeline ? ["kind", "documentDigest"] : ["kind", "manifestDigest", "sha256"]);
  invariant(timeline ? value.completion.kind === "timeline" && value.completion.documentDigest === intent.prepared.contentDigest
    : value.completion.kind === "render" && intent.prepared.kind === "render" && value.completion.manifestDigest === intent.prepared.recipe.digest
      && value.completion.sha256 === artifact.artifact.sha256,
  "LOCAL_EXECUTION_CONFLICT", "Local completion receipt does not match its recipe");
}
export function localFingerprint(effectiveFingerprint: string, contentDigest: string): string {
  return digest({ execution: { adapter: "local-media", version: "1" }, effectiveFingerprint, contentDigest });
}
/** Unique admission identity; the fingerprint remains the reusable content key. */
export function localWorkKey(projectId: string, nodeId: string, fingerprint: string, ordinal = 1): string {
  invariant(Number.isSafeInteger(ordinal) && ordinal > 0, "LOCAL_EXECUTION_CONFLICT", "Invalid local admission ordinal");
  return digest({ projectId, nodeId, execution: { adapter: "local-media", version: "1" }, fingerprint, ...(ordinal > 1 ? { admissionOrdinal: ordinal } : {}) });
}
