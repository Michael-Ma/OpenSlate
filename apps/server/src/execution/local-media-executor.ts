import { join, resolve } from "node:path";
import { canonical, digest, invariant, snapshotLocalExecution } from "@openslate/core";
import type { ArtifactRef, JsonObject, LocalExecutionIdentity } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { captureRender, captureTimeline } from "../media/timeline-capture.js";
import { createLocalTimelineDocument, LocalTimelineStore, parseLocalTimelineDocument } from "../media/local-timeline.js";
import type { LocalTimelineDocument, StoredLocalTimeline } from "../media/local-timeline.js";
import type { LocalMediaService } from "../media/local-media.js";
import { installManagedVideo } from "../media/managed-video.js";
import type { RenderCompletion } from "../media/types.js";
import type { ArtifactRecord, Attempt, NodeBinding } from "./engine.js";
import { assertLocalExecutionDispatch, assertLocalExecutionIntent, assertLocalExecutionResult, assertPreparedLocalExecution, localContentDigest } from "./local-execution.js";
import type { LocalExecutionCompletion, LocalExecutionDispatch, LocalExecutionIntent, LocalExecutionOptions, LocalExecutionPort, LocalExecutionResult, PreparedLocalExecution } from "./local-execution.js";

function check(signal?: AbortSignal): void { invariant(!signal?.aborted, "MEDIA_CANCELLED", "Local assembly cancelled"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const timelineDocument = (capture: PreparedLocalExecution["capture"]): LocalTimelineDocument => createLocalTimelineDocument({
  projectId: capture.input.projectId, clips: capture.input.clips, audio: capture.input.audio ?? [],
});

/** Owned local assembly. Engine alone admits work, records dispatch and publishes SQL state. */
export class LocalMediaExecutor implements LocalExecutionPort {
  readonly recovery: InstallationRecoveryGuard;
  readonly identity: LocalExecutionIdentity = Object.freeze({ adapter: "local-media", version: "1" });
  readonly maxOutputBytes: number;
  readonly artifactDir: string;
  readonly timelines: LocalTimelineStore;
  constructor(readonly store: Store, readonly media: LocalMediaService, options: { artifactDir: string }) {
    this.recovery = new InstallationRecoveryGuard(store);
    this.artifactDir = resolve(options.artifactDir);
    this.maxOutputBytes = media.limits.maxOutputBytes;
    this.timelines = new LocalTimelineStore({ rootDir: join(this.artifactDir, "local-timelines"), media });
  }

  async prepare(projectId: string, nodeId: string, options: { signal?: AbortSignal } = {}): Promise<PreparedLocalExecution> {
    this.recovery.assertWritable(projectId);
    const { signal } = options; check(signal);
    const binding = this.binding(projectId, nodeId);
    let prepared: PreparedLocalExecution;
    if (binding.node.kind === "timeline") {
      const capture = captureTimeline(this.store, projectId, nodeId);
      const recipe = timelineDocument(capture) as unknown as JsonObject;
      prepared = { projectId, nodeId, specDigest: binding.node.specDigest, kind: "timeline", capture, recipe, contentDigest: digest(recipe) };
    } else {
      invariant(binding.node.kind === "render", "LOCAL_EXECUTION_UNSUPPORTED", "Local assembly supports timelines and renders");
      const capture = captureRender(this.store, projectId, nodeId), timelineArtifact = this.timelineArtifact(projectId, capture.target.timelineNodeId);
      const document = timelineDocument(capture), artifact = this.store.get<ArtifactRecord>("artifact", timelineArtifact.artifactId)!;
      const stored = await this.timelines.read({ recipeDigest: document.recipeDigest, sha256: timelineArtifact.sha256, byteLength: artifact.byteLength! }, { ...(signal ? { signal } : {}) });
      invariant(canonical(stored.document) === canonical(document) && stored.path === artifact.path, "LOCAL_EXECUTION_CONFLICT", "Selected timeline does not match its exact owned recipe");
      const recipe = await this.media.freezeManifest(capture.input, { ...(signal ? { signal } : {}) });
      prepared = { projectId, nodeId, specDigest: binding.node.specDigest, kind: "render", capture, recipe, timelineArtifact, contentDigest: "" };
      prepared.contentDigest = localContentDigest(prepared);
    }
    check(signal); assertPreparedLocalExecution(prepared);
    invariant(this.matches(prepared), "REVISION_CONFLICT", "Assembly target changed during preparation");
    return freeze(prepared);
  }

  matches(prepared: PreparedLocalExecution): boolean {
    try {
      assertPreparedLocalExecution(prepared);
      const binding = this.binding(prepared.projectId, prepared.nodeId);
      if (binding.node.specDigest !== prepared.specDigest || binding.node.kind !== prepared.kind) return false;
      const capture = prepared.kind === "timeline" ? captureTimeline(this.store, prepared.projectId, prepared.nodeId)
        : captureRender(this.store, prepared.projectId, prepared.nodeId);
      if (canonical(capture) !== canonical(prepared.capture)) return false;
      if (prepared.kind === "timeline") return canonical(timelineDocument(capture)) === canonical(prepared.recipe);
      return canonical(this.timelineArtifact(prepared.projectId, capture.target.timelineNodeId)) === canonical(prepared.timelineArtifact);
    } catch { return false; }
  }

  async recover(value: LocalExecutionIntent, options: LocalExecutionOptions): Promise<LocalExecutionResult | null> {
    this.recovery.assertWritable(value.projectId);
    const intent = structuredClone(value), signal = options.signal, expectedLease = { ...options.expectedLease };
    this.owned(intent, expectedLease, signal, true);
    let result: LocalExecutionResult;
    if (intent.prepared.kind === "timeline") {
      const document = parseLocalTimelineDocument(intent.prepared.recipe), bytes = Buffer.byteLength(canonical(document));
      let stored: StoredLocalTimeline;
      try { stored = await this.timelines.read({ recipeDigest: document.recipeDigest, sha256: intent.prepared.contentDigest, byteLength: bytes }, { signal }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { this.owned(intent, expectedLease, signal, true); return null; } throw error; }
      invariant(canonical(stored.document) === canonical(document), "LOCAL_EXECUTION_CONFLICT", "Recovered timeline belongs to another recipe");
      result = this.timelineResult(intent, stored);
    } else {
      const saved = this.store.get<LocalExecutionCompletion>("local_execution_completion", intent.id);
      let completion: RenderCompletion | undefined;
      if (saved) {
        assertLocalExecutionResult(saved.result, intent);
        invariant(saved.result.completion.kind === "render", "LOCAL_EXECUTION_CONFLICT", "Saved completion has another media kind");
        completion = await this.media.readCompletion(intent.prepared.recipe.digest, saved.result.completion.sha256, { signal });
      } else completion = (await this.media.findCompletions(intent.prepared.recipe.digest, { signal }))[0];
      this.owned(intent, expectedLease, signal, true);
      if (!completion) return null;
      result = await this.renderResult(intent, completion, signal);
    }
    this.owned(intent, expectedLease, signal, true); assertLocalExecutionResult(result, intent);
    return freeze(result);
  }

  async execute(value: LocalExecutionIntent, options: LocalExecutionOptions): Promise<LocalExecutionResult> {
    const intent = structuredClone(value), signal = options.signal, expectedLease = { ...options.expectedLease };
    this.owned(intent, expectedLease, signal, false);
    const dispatch = this.store.get<LocalExecutionDispatch>("local_execution_dispatch", intent.id);
    invariant(dispatch, "LOCAL_EXECUTION_NOT_DISPATCHED", "Local work requires its durable dispatch marker");
    assertLocalExecutionDispatch(dispatch, intent);
    invariant(dispatch.owner === expectedLease.owner && dispatch.epoch === expectedLease.epoch, "LOCAL_EXECUTION_LEASE_LOST", "Another lease owns the local dispatch");
    // Defensive replay is read-only. A completed filesystem receipt is never rerendered.
    const recovered = await this.recover(intent, { signal, expectedLease });
    if (recovered) return recovered;
    this.recovery.assertFreshAuthority(intent.projectId, "attempt", intent.id);
    this.owned(intent, expectedLease, signal, false);
    let result: LocalExecutionResult;
    if (intent.prepared.kind === "timeline") {
      const document = parseLocalTimelineDocument(intent.prepared.recipe);
      result = this.timelineResult(intent, await this.timelines.put(document, { signal }));
    } else {
      const completion = await this.media.render(intent.prepared.recipe, { signal });
      this.owned(intent, expectedLease, signal, false);
      result = await this.renderResult(intent, completion, signal);
    }
    this.owned(intent, expectedLease, signal, false); assertLocalExecutionResult(result, intent);
    return freeze(result);
  }

  private binding(projectId: string, nodeId: string): NodeBinding {
    const project = this.store.getProject(projectId), lock = this.store.get<{ projectId: string; localExecution?: LocalExecutionIdentity }>("capability_lock", project.capabilityLockId);
    invariant(lock?.projectId === projectId && Object.hasOwn(lock, "localExecution"), "LOCAL_EXECUTION_UNSUPPORTED", "Project has no pinned local assembly runtime");
    snapshotLocalExecution(lock.localExecution);
    const binding = this.store.get<NodeBinding>("node_binding", nodeId);
    invariant(binding?.projectId === projectId && binding.state === "active" && binding.planId === project.activePlanId
      && binding.candidateId === null && ["timeline", "render"].includes(binding.node.kind), "LOCAL_EXECUTION_CONFLICT", "Local node is not a current assembly binding");
    snapshotLocalExecution(binding.node.args.localExecution);
    return binding;
  }
  private timelineArtifact(projectId: string, nodeId: string): ArtifactRef {
    const binding = this.binding(projectId, nodeId), ref = binding.outputs.timeline;
    const artifact = ref ? this.store.get<ArtifactRecord>("artifact", ref.artifactId) : undefined;
    invariant(binding.node.kind === "timeline" && ref?.kind === "data" && artifact?.projectId === projectId
      && artifact.fixture === false && artifact.mimeType === "application/json" && canonical(artifact.artifact) === canonical(ref)
      && typeof artifact.path === "string" && Number.isSafeInteger(artifact.byteLength) && artifact.byteLength! > 0 && artifact.byteLength! <= 1024 * 1024,
    "LOCAL_EXECUTION_INPUT_PENDING", "Render requires its exact completed local timeline");
    return structuredClone(ref);
  }
  private owned(intent: LocalExecutionIntent, expected: LocalExecutionOptions["expectedLease"], signal: AbortSignal, allowSucceeded: boolean): void {
    check(signal);
    const attempt = this.store.get<Attempt>("attempt", intent.id), saved = this.store.get<LocalExecutionIntent>("local_execution_intent", intent.id);
    invariant(attempt && saved && canonical(saved) === canonical(intent), "LOCAL_EXECUTION_CONFLICT", "Local work lacks its exact immutable intent");
    assertLocalExecutionIntent(intent, attempt);
    const lock = this.store.get<{ projectId: string; localExecution?: LocalExecutionIdentity }>("capability_lock", intent.capabilityLockId);
    invariant(lock?.projectId === intent.projectId, "LOCAL_EXECUTION_CONFLICT", "Local work has no owned capability lock");
    snapshotLocalExecution(lock.localExecution);
    if (allowSucceeded && attempt.phase === "succeeded") return;
    invariant(attempt.phase !== "succeeded" && attempt.phase !== "failed" && attempt.leaseOwner === expected.owner
      && attempt.leaseEpoch === expected.epoch && attempt.leaseExpiresAt > Date.now(), "LOCAL_EXECUTION_LEASE_LOST", "Local work is no longer owned by this lease");
  }
  private timelineResult(intent: LocalExecutionIntent, stored: StoredLocalTimeline): LocalExecutionResult {
    return { version: 1, intentDigest: digest(intent), requestDigest: intent.requestDigest, port: "timeline",
      artifact: { id: intent.outputArtifactId, projectId: intent.projectId, attemptId: intent.id,
        artifact: { artifactId: intent.outputArtifactId, sha256: stored.receipt.sha256, kind: "data" }, path: stored.path,
        mimeType: "application/json", fixture: false, byteLength: stored.receipt.byteLength, physicalDurationSeconds: null },
      completion: { kind: "timeline", documentDigest: intent.prepared.contentDigest } };
  }
  private async renderResult(intent: LocalExecutionIntent, completion: RenderCompletion, signal: AbortSignal): Promise<LocalExecutionResult> {
    invariant(intent.prepared.kind === "render" && canonical(completion.manifest) === canonical(intent.prepared.recipe), "LOCAL_EXECUTION_CONFLICT", "Rendered bytes belong to another manifest");
    const recipe = intent.prepared.recipe, probe = completion.artifact.probe;
    invariant(probe.video?.frames === recipe.totalFrames && probe.video.width === recipe.width && probe.video.height === recipe.height
      && probe.video.frameRate === "30/1" && probe.video.codec === "h264", "LOCAL_EXECUTION_CONFLICT", "Recovered video measurement differs from the frozen recipe");
    invariant(recipe.audio.length ? probe.audio?.codec === "aac" && probe.audio.sampleRate === 48000 && probe.audio.channels === 2
      && probe.audio.samples !== null && Math.abs(probe.audio.samples - recipe.totalFrames * 1600) <= 2048 : !probe.audio,
    "LOCAL_EXECUTION_CONFLICT", "Recovered audio measurement differs from the frozen recipe");
    const path = await installManagedVideo(this.artifactDir, intent.projectId, completion.artifact, this.maxOutputBytes, { signal });
    check(signal);
    return { version: 1, intentDigest: digest(intent), requestDigest: intent.requestDigest, port: "video",
      artifact: { id: intent.outputArtifactId, projectId: intent.projectId, attemptId: intent.id,
        artifact: { artifactId: intent.outputArtifactId, sha256: completion.artifact.sha256, kind: "video" }, path,
        mimeType: "video/mp4", fixture: false, origin: "local_render", byteLength: completion.artifact.byteLength,
        physicalDurationSeconds: recipe.totalFrames / 30, width: recipe.width, height: recipe.height },
      completion: { kind: "render", manifestDigest: recipe.digest, sha256: completion.artifact.sha256 } };
  }
}
