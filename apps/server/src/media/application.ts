import { canonical, digest, DomainError, invariant, newId, shotIntentDigest } from "@openslate/core";
import type { ActorContext, ArtifactRef, CompiledPlan, CueRecord, InputSource, PlanNode } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NodeBinding } from "../execution/engine.js";
import { LocalMediaService } from "./local-media.js";
import { installManagedVideo } from "./managed-video.js";
import type { RenderCompletion, RenderManifestInput, SuppliedMedia } from "./types.js";
import type { ImportedVideo, ImportVideoInput, MediaPreview, MediaRenderJob, OwnedMediaSource, PrepareMediaRender, RealVideoArtifact, RenderTarget } from "./application-types.js";

interface Request { projectId: string; principalId: string; scopeIds: string[]; state: string }
interface Plan { id: string; projectId: string; compiled: CompiledPlan }
interface Artifact { projectId: string; artifact: ArtifactRef; fixture: boolean }
interface Narration {
  id: string; projectId: string; script: string;
  segments: Array<{ cue: CueRecord; audioPlacement: { source: SuppliedMedia; startSample: number; durationSamples: number; atSample: number; gainMilliDb: number } }>;
}
interface Capture { target: RenderTarget; input: RenderManifestInput }
const errorCode = (error: unknown): string => error instanceof DomainError ? error.code : "MEDIA_RENDER_FAILED";
const terminal = (job: MediaRenderJob): boolean => job.state === "published" || job.state === "historical";
const importReceipt = (value: ImportedVideo): ImportedVideo => ({ artifact: value.artifact, sourceId: value.sourceId, revisionId: value.revisionId, headVersion: value.headVersion });

/** Local supplied-media bridge. It never starts generation or changes executor bindings. */
export class MediaApplicationService {
  private readonly running = new Map<string, AbortController>();
  private readonly leaseMs: number;
  constructor(readonly production: ProductionService, readonly media: LocalMediaService, options: { leaseMs?: number } = {}) {
    this.leaseMs = options.leaseMs ?? 15000;
    invariant(Number.isSafeInteger(this.leaseMs) && this.leaseMs >= 1000 && this.leaseMs <= 120000, "MEDIA_INVALID_INPUT", "Invalid render lease duration");
  }
  private get store() { return this.production.store; }

  private authorize(projectId: string, actor: ActorContext, write = true): void {
    this.production.assertActor(projectId, actor, write && actor.kind === "director");
    const request = this.store.get<Request>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.principalId === actor.principalId && (!write || request.state === "active"), "ACTOR_DENIED", "Render request is inactive");
    invariant(request.scopeIds.includes(projectId), "SCOPE_DENIED", "Full timeline rendering requires project scope");
  }

  /** Host-selected path, authenticated human only; never add this path field to a model tool. */
  async importVideo(projectId: string, actor: ActorContext, input: ImportVideoInput, options: { signal?: AbortSignal } = {}): Promise<ImportedVideo> {
    const request = structuredClone(input), authority = structuredClone(actor);
    this.validateRequest(request, ["expectedHeadVersion", "path", "key"]);
    invariant(typeof request.path === "string" && request.path.length > 0 && request.path.length <= 4096, "MEDIA_INVALID_INPUT", "A bounded host-selected file path is required");
    const intent = this.store.transaction(() => {
      this.authorize(projectId, authority); this.production.assertActor(projectId, authority, true);
      invariant(authority.kind === "human", "ACTOR_DENIED", "Only a human can choose a supplied file");
      return this.store.command(`${authority.principalId}:${projectId}:media_import`, request.key, digest({ request, authority }), () => {
        invariant(this.store.getProject(projectId).headVersion === request.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before media import");
        const row = { id: newId(), projectId, artifactId: newId(), requestId: authority.requestId };
        this.store.insert("media_import", row.id, projectId, row); return row;
      });
    });
    const complete = this.store.get<ImportedVideo>("media_import_receipt", intent.id);
    if (complete) return importReceipt(complete);
    const source = await this.media.importMedia({ artifactId: intent.artifactId, path: request.path, kind: "video" }, options);
    const verified = await this.media.verifiedSource(source);
    const path = await installManagedVideo(this.production.engine.artifactDir, projectId, { ...source, path: verified.path }, this.media.limits.maxOutputBytes);
    return this.store.transaction(() => {
      this.authorize(projectId, authority); this.production.assertActor(projectId, authority, true);
      const prior = this.store.get<ImportedVideo>("media_import_receipt", intent.id); if (prior) return importReceipt(prior);
      const project = this.store.getProject(projectId);
      invariant(project.headVersion === request.expectedHeadVersion, "REVISION_CONFLICT", "Project changed while importing media");
      const artifact: ArtifactRef = { artifactId: source.artifactId, sha256: source.sha256, kind: "video" };
      const record: RealVideoArtifact = { id: source.artifactId, projectId, artifact, path, mimeType: "video/mp4", fixture: false, attemptId: null,
        origin: "supplied_video", byteLength: source.byteLength, physicalDurationSeconds: source.probe.video!.frames / 30, sourceDescriptorId: source.id };
      this.store.insert("artifact", record.id, projectId, record);
      this.store.insert<OwnedMediaSource>("media_source", source.artifactId, projectId, { id: source.artifactId, projectId, source, requestId: authority.requestId });
      const saved = this.store.saveProject({ ...project, revisionId: newId(), artifacts: [...project.artifacts, artifact] }, project.headVersion);
      this.store.insert("project_revision", saved.revisionId, projectId, { project: saved });
      const result = { artifact, sourceId: source.id, revisionId: saved.revisionId, headVersion: saved.headVersion };
      this.store.insert("media_import_receipt", intent.id, projectId, result);
      this.store.appendEvent(projectId, "media.imported", { artifactId: artifact.artifactId, revisionId: saved.revisionId });
      return result;
    });
  }

  async prepareRender(projectId: string, actor: ActorContext, input: PrepareMediaRender): Promise<MediaRenderJob> {
    const request = structuredClone(input), authority = structuredClone(actor);
    this.validateRequest(request, ["expectedHeadVersion", "renderNodeId", "key"]);
    invariant(typeof request.renderNodeId === "string" && request.renderNodeId.length > 0 && request.renderNodeId.length <= 160, "MEDIA_INVALID_INPUT", "A current render node is required");
    const reserved = this.store.transaction(() => {
      this.authorize(projectId, authority);
      return this.store.command(`${authority.principalId}:${projectId}:media_prepare`, request.key, digest({ request, authority }), () => {
        invariant(this.store.getProject(projectId).headVersion === request.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before render preparation");
        return { id: newId(), outputArtifactId: newId(), capture: this.capture(projectId, request.renderNodeId) };
      });
    });
    const previous = this.store.get<MediaRenderJob>("media_render", reserved.id); if (previous) return previous;
    const manifest = await this.media.freezeManifest(reserved.capture.input);
    return this.store.transaction(() => {
      this.authorize(projectId, authority);
      const prior = this.store.get<MediaRenderJob>("media_render", reserved.id); if (prior) return prior;
      invariant(canonical(this.capture(projectId, request.renderNodeId).target) === canonical(reserved.capture.target), "REVISION_CONFLICT", "Render inputs changed while freezing");
      const job: MediaRenderJob = { id: reserved.id, projectId, actor: authority, target: reserved.capture.target, manifest, outputArtifactId: reserved.outputArtifactId,
        state: "prepared", ownerToken: null, leaseUntil: null, cancelRequested: false, artifact: null, createdAt: new Date().toISOString(), finishedAt: null, errorCode: null };
      this.store.insert("media_render", job.id, projectId, job);
      this.store.appendEvent(projectId, "media.render_prepared", { renderJobId: job.id, manifestDigest: manifest.digest });
      return job;
    });
  }

  async run(projectId: string, actor: ActorContext, jobId: string, options: { signal?: AbortSignal } = {}): Promise<MediaRenderJob> {
    const job = this.store.transaction(() => {
      this.authorize(projectId, actor); const current = this.job(projectId, jobId);
      if (terminal(current)) return current;
      invariant(current.state === "prepared" && !current.cancelRequested, "MEDIA_RENDER_NOT_READY", "Render has already started or was cancelled; reconcile its receipt");
      this.authorize(projectId, current.actor);
      invariant(this.matches(current), "MEDIA_STALE_TARGET", "Render target changed"); this.assertUnpaused(current);
      const next = { ...current, state: "running" as const, ownerToken: newId(), leaseUntil: Date.now() + this.leaseMs, errorCode: null };
      this.store.put("media_render", jobId, projectId, next); this.store.appendEvent(projectId, "media.render_started", { renderJobId: jobId }); return next;
    });
    if (terminal(job)) return job;
    const abort = new AbortController(); this.running.set(job.id, abort);
    const forwardAbort = () => abort.abort();
    options.signal?.addEventListener("abort", forwardAbort, { once: true }); if (options.signal?.aborted) abort.abort();
    const heartbeat = setInterval(() => {
      try {
        this.store.transaction(() => {
          const current = this.job(projectId, jobId);
          if (current.ownerToken !== job.ownerToken || current.cancelRequested || current.state !== "running") { abort.abort(); return; }
          this.store.put("media_render", jobId, projectId, { ...current, leaseUntil: Date.now() + this.leaseMs });
        });
      } catch { abort.abort(); }
    }, Math.max(250, Math.floor(this.leaseMs / 3)));
    heartbeat.unref();
    try {
      const completion = await this.media.render(job.manifest, { signal: abort.signal });
      const path = await installManagedVideo(this.production.engine.artifactDir, projectId, completion.artifact, this.media.limits.maxOutputBytes);
      return this.finish(job, completion, path);
    } catch (error) {
      this.store.transaction(() => {
        const current = this.job(projectId, jobId);
        if (current.ownerToken === job.ownerToken && current.state === "running") {
          // A receipt may already exist (for example after SQL failure). Recovery scans
          // it before any retry; there is never an automatic second FFmpeg dispatch.
          this.store.put("media_render", jobId, projectId, { ...current, state: abort.signal.aborted ? "cancelled" : "failed", ownerToken: null,
            leaseUntil: null, cancelRequested: current.cancelRequested || abort.signal.aborted, errorCode: errorCode(error), finishedAt: new Date().toISOString() });
        }
      });
      throw error;
    } finally { clearInterval(heartbeat); options.signal?.removeEventListener("abort", forwardAbort); this.running.delete(job.id); }
  }

  /** Recovery consumes verified filesystem receipts; it never reruns a renderer. */
  async recover(projectId: string, actor: ActorContext, jobId: string): Promise<MediaRenderJob> {
    const job = this.store.transaction(() => {
      this.authorize(projectId, actor); const current = this.job(projectId, jobId);
      if (terminal(current)) return current;
      invariant(current.state !== "prepared", "MEDIA_RENDER_NOT_STARTED", "Prepared renders have no lost completion to recover");
      invariant(!current.ownerToken || (current.leaseUntil ?? 0) <= Date.now(), "MEDIA_RENDER_BUSY", "A render or recovery worker still owns its lease");
      const claimed = { ...current, ownerToken: newId(), leaseUntil: Date.now() + this.leaseMs };
      this.store.put("media_render", jobId, projectId, claimed); return claimed;
    });
    if (terminal(job)) return job;
    const receipts = await this.media.findCompletions(job.manifest.digest);
    const completion = receipts[0];
    if (!completion) return this.store.transaction(() => {
      const current = this.job(projectId, jobId); invariant(current.ownerToken === job.ownerToken, "MEDIA_LEASE_LOST", "Recovery ownership changed");
      const next = { ...current, state: current.cancelRequested ? "cancelled" as const : "interrupted" as const, ownerToken: null, leaseUntil: null, finishedAt: new Date().toISOString(), errorCode: "MEDIA_NO_COMPLETION" };
      this.store.put("media_render", jobId, projectId, next); return next;
    });
    const path = await installManagedVideo(this.production.engine.artifactDir, projectId, completion.artifact, this.media.limits.maxOutputBytes);
    return this.finish(job, completion, path);
  }

  cancel(projectId: string, actor: ActorContext, jobId: string): MediaRenderJob {
    const result = this.store.transaction(() => {
      this.authorize(projectId, actor); invariant(actor.kind === "human", "ACTOR_DENIED", "Cancellation requires an explicit human command");
      const job = this.job(projectId, jobId); if (terminal(job) || job.cancelRequested) return job;
      const next = { ...job, cancelRequested: true, state: job.state === "running" ? "running" as const : "cancelled" as const };
      this.store.put("media_render", jobId, projectId, next); this.store.appendEvent(projectId, "media.render_cancelled", { renderJobId: jobId }); return next;
    });
    this.running.get(jobId)?.abort(); return result;
  }

  snapshot(projectId: string, actor: ActorContext): { jobs: MediaRenderJob[]; preview: MediaPreview | null } {
    this.authorize(projectId, actor, false);
    return this.workspaceSnapshot(projectId);
  }

  /** Trusted authenticated host view. Model-facing reads must call snapshot with an actor. */
  workspaceSnapshot(projectId: string): { jobs: MediaRenderJob[]; preview: MediaPreview | null } {
    this.store.getProject(projectId);
    const jobs = this.store.list<MediaRenderJob>("media_render", projectId), preview = this.store.get<MediaPreview>("media_preview", projectId);
    const selected = preview ? jobs.find(job => job.id === preview.renderJobId) : undefined;
    return { jobs, preview: preview && selected && this.matches(selected) ? preview : null };
  }

  private job(projectId: string, id: string): MediaRenderJob {
    const job = this.store.get<MediaRenderJob>("media_render", id); invariant(job?.projectId === projectId, "NOT_FOUND", "Render does not belong to this project"); return job;
  }

  private validateRequest(input: { expectedHeadVersion: number; key: string }, fields: string[]): void {
    invariant(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).every(key => fields.includes(key)), "MEDIA_INVALID_INPUT", "Unknown media request field");
    invariant(Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0 && typeof input.key === "string" && input.key.length > 0 && input.key.length <= 160, "MEDIA_INVALID_INPUT", "A current project version and bounded idempotency key are required");
  }

  private finish(job: MediaRenderJob, completion: RenderCompletion, path: string): MediaRenderJob {
    invariant(canonical(completion.manifest) === canonical(job.manifest), "MEDIA_INTEGRITY_ERROR", "Completion is for another frozen render");
    return this.store.transaction(() => {
      const current = this.job(job.projectId, job.id); if (terminal(current)) return current;
      invariant(current.ownerToken === job.ownerToken, "MEDIA_LEASE_LOST", "Another worker owns completion registration");
      const artifact: ArtifactRef = { artifactId: job.outputArtifactId, sha256: completion.artifact.sha256, kind: "video" };
      const record: RealVideoArtifact = { id: artifact.artifactId, projectId: job.projectId, artifact, path, mimeType: "video/mp4", fixture: false, attemptId: null,
        origin: "local_render", byteLength: completion.artifact.byteLength, physicalDurationSeconds: completion.artifact.probe.video!.frames / 30, manifestDigest: job.manifest.digest, renderJobId: job.id };
      this.store.insert("artifact", record.id, job.projectId, record);
      let publish = !current.cancelRequested && this.matches(job);
      try { this.authorize(job.projectId, job.actor); this.assertUnpaused(job); } catch { publish = false; }
      const next: MediaRenderJob = { ...current, state: publish ? "published" : "historical", artifact, ownerToken: null, leaseUntil: null,
        finishedAt: new Date().toISOString(), errorCode: null };
      this.store.put("media_render", job.id, job.projectId, next);
      if (publish) this.store.put<MediaPreview>("media_preview", job.projectId, job.projectId, { id: job.projectId, projectId: job.projectId, renderJobId: job.id, artifact,
        revisionId: job.target.revisionId, headVersion: job.target.headVersion, planId: job.target.planId, manifestDigest: job.manifest.digest, fixture: false });
      this.store.appendEvent(job.projectId, publish ? "media.render_published" : "media.render_historical", { renderJobId: job.id, artifactId: artifact.artifactId, manifestDigest: job.manifest.digest });
      return next;
    });
  }

  private matches(job: MediaRenderJob): boolean {
    try { return canonical(this.capture(job.projectId, job.target.renderNodeId).target) === canonical(job.target); } catch { return false; }
  }

  private assertUnpaused(job: MediaRenderJob): void {
    invariant(!this.store.get<{ paused: boolean }>("execution_control", job.projectId)?.paused, "MEDIA_PAUSED", "Project execution is paused");
    const held = this.store.list<{ scopeId: string; active: boolean }>("hold", job.projectId)
      .some(hold => hold.active && (job.target.scopeIds.includes(hold.scopeId) || job.target.dependencyNodeIds.includes(hold.scopeId)));
    invariant(!held, "MEDIA_HELD", "A timeline dependency is held for editing");
  }

  /** SQL-only snapshot; file descriptor and actual byte checks happen after this returns. */
  private capture(projectId: string, renderNodeId: string): Capture {
    const project = this.store.getProject(projectId);
    const plan = project.activePlanId ? this.store.get<Plan>("plan", project.activePlanId) : undefined;
    invariant(plan?.projectId === projectId, "MEDIA_PLAN_REQUIRED", "Install a plan before rendering");
    const node = (id: string, kind?: string): PlanNode => {
      const found = plan.compiled.nodes.find(n => n.id === id), binding = this.store.get<NodeBinding>("node_binding", id);
      invariant(found && binding?.projectId === projectId && binding.state === "active" && binding.planId === plan.id && canonical(binding.node) === canonical(found), "MEDIA_STALE_BINDING", "Plan binding is not current");
      invariant(!kind || found.kind === kind, "MEDIA_PLAN_UNSUPPORTED", "Unexpected operation in render plan"); return found;
    };
    const render = node(renderNodeId, "render");
    invariant(render.inputs.length === 1 && render.inputs[0]?.source.kind === "output", "MEDIA_PLAN_UNSUPPORTED", "Render requires one timeline operation");
    const timeline = node(render.inputs[0].source.nodeId, "timeline");
    invariant(timeline.args.transition === "cut" && render.args.format === "mp4", "MEDIA_PLAN_UNSUPPORTED", "Only cut-based MP4 output is supported");
    const takes = timeline.inputs.filter(i => i.destinationPort === "takes" && i.role === "video").sort((a, b) => a.order - b.order);
    const narrationInputs = timeline.inputs.filter(i => i.destinationPort === "narration" && i.role === "audio");
    invariant(takes.length > 0 && takes.every((take, index) => take.order === index) && narrationInputs.length <= 1 && takes.length + narrationInputs.length === timeline.inputs.length, "MEDIA_PLAN_UNSUPPORTED", "Timeline ports or ordering are unsupported");
    const inputs: RenderTarget["inputs"] = [], dependencyNodeIds = new Set([render.id, timeline.id]), scopeIds = new Set([projectId]);
    const addDependencies = (id: string): void => {
      if (dependencyNodeIds.has(id)) return; dependencyNodeIds.add(id);
      const value = node(id); if (value.shotId) { scopeIds.add(value.shotId); const shot = project.shots.find(s => s.id === value.shotId); if (shot) scopeIds.add(shot.sceneId); }
      for (const input of value.inputs) if (input.source.kind === "output") addDependencies(input.source.nodeId);
    };
    const resolve = (source: InputSource, kind: "video" | "audio"): ArtifactRef => {
      if (source.kind === "output") addDependencies(source.nodeId);
      const ref = source.kind === "artifact" ? source.artifact : this.store.get<NodeBinding>("node_binding", source.nodeId)?.outputs[source.port];
      invariant(ref?.kind === kind, "MEDIA_INPUT_PENDING", "A selected timeline input is not available");
      const artifact = this.store.get<Artifact>("artifact", ref.artifactId);
      invariant(artifact?.projectId === projectId && canonical(artifact.artifact) === canonical(ref), "MEDIA_ARTIFACT_UNAVAILABLE", "Selected artifact is not owned by the project");
      invariant(artifact.fixture === false, "MEDIA_FIXTURE_UNSUPPORTED", "Fixture outputs cannot stand in for real planned media");
      if (source.kind === "artifact") invariant(project.artifacts.some(a => canonical(a) === canonical(ref)), "MEDIA_ARTIFACT_UNAVAILABLE", "Imported artifact is not in the current project");
      inputs.push({ nodeId: source.kind === "output" ? source.nodeId : null, port: source.kind === "output" ? source.port : kind, artifact: ref }); return ref;
    };
    const selectedCueIds = new Set<string>();
    const clips = takes.map(take => {
      const ref = resolve(take.source, "video"), owned = this.store.get<OwnedMediaSource>("media_source", ref.artifactId);
      invariant(owned?.projectId === projectId && owned.source.kind === "video" && owned.source.artifactId === ref.artifactId && owned.source.sha256 === ref.sha256, "MEDIA_SOURCE_UNAVAILABLE", "Video has no measured supplied-media descriptor");
      let frames = owned.source.probe.video?.frames;
      if (take.source.kind === "output") {
        const video = node(take.source.nodeId, "video"), shot = project.shots.find(s => s.id === video.shotId);
        invariant(shot && video.args.durationFrames === shot.desiredFrames && video.shotRevisionId === shot.revisionId, "MEDIA_STALE_BINDING", "Video timing no longer matches its shot");
        const cue = shot.cueId ? project.cues.find(c => c.id === shot.cueId) : undefined;
        invariant(!shot.cueId || (cue?.accepted && cue.measured && cue.durationFrames === shot.desiredFrames), "MEDIA_NARRATION_REQUIRED", "Current shot timing is not accepted");
        invariant(video.intentDigest === shotIntentDigest(shot, "video", cue) && shot.promptIntent.video === video.intentDigest && video.args.prompt === shot.videoPrompt, "MEDIA_STALE_BINDING", "Selected take intent is stale");
        if (cue) selectedCueIds.add(cue.id); frames = shot.desiredFrames;
      }
      invariant(Number.isSafeInteger(frames) && frames! > 0, "MEDIA_SOURCE_UNAVAILABLE", "Video duration has not been measured");
      return { source: owned.source, startFrame: 0, durationFrames: frames!, fit: "contain" as const };
    });
    const totalFrames = clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
    invariant(totalFrames <= project.maxFrames && (timeline.args.durationFrames === null || timeline.args.durationFrames === totalFrames), "MEDIA_DURATION_MISMATCH", "Timeline duration does not match its measured/planned takes");
    const canonicalHead = this.store.get<{ projectId: string; canonicalId: string }>("narration_canonical_head", projectId);
    const narration = canonicalHead?.projectId === projectId ? this.store.get<Narration>("narration_canonical", canonicalHead.canonicalId) : undefined;
    const fingerprints = timeline.args.cues;
    invariant(Array.isArray(fingerprints), "MEDIA_PLAN_UNSUPPORTED", "Timeline cue identities are absent");
    const cueFingerprint = (cue: CueRecord) => ({ meaning: cue.meaning, placementFrames: cue.placementFrames, durationFrames: cue.durationFrames, audioHash: cue.audio.sha256 });
    const selected = fingerprints.map(fingerprint => {
      const matches = narration?.segments.filter(segment => canonical(cueFingerprint(segment.cue)) === canonical(fingerprint)) ?? [];
      invariant(matches.length === 1, "MEDIA_NARRATION_REQUIRED", "Timeline cue has no unique committed narration placement");
      const segment = matches[0]!;
      const current = project.cues.find(cue => cue.id === segment.cue.id);
      invariant(current?.accepted && current.measured && canonical(current) === canonical(segment.cue), "MEDIA_NARRATION_REQUIRED", "Narration acceptance or timing changed");
      const source = segment.audioPlacement.source;
      invariant(source.artifactId === current.audio.artifactId && source.sha256 === current.audio.sha256 && source.kind === "audio", "MEDIA_NARRATION_REQUIRED", "Narration bytes do not match the committed cue");
      resolve({ kind: "artifact", artifact: current.audio }, "audio"); return segment;
    });
    invariant(new Set(selected.map(s => s.cue.id)).size === selected.length && [...selectedCueIds].every(id => selected.some(s => s.cue.id === id)), "MEDIA_NARRATION_REQUIRED", "Timeline does not cover its shot cues exactly");
    if (selected.length) invariant(narration?.projectId === projectId && narration.script === project.narration.script, "MEDIA_NARRATION_REQUIRED", "Narration script changed after acceptance");
    else invariant(!project.narration.script.trim() && project.cues.length === 0 && narrationInputs.length === 0, "MEDIA_NARRATION_REQUIRED", "A narrated project requires committed timeline cue placements");
    for (const input of narrationInputs) {
      const audio = resolve(input.source, "audio");
      invariant(selected.some(segment => canonical(segment.cue.audio) === canonical(audio)), "MEDIA_NARRATION_REQUIRED", "Narration input is not part of the frozen cue placements");
    }
    return { target: { revisionId: project.revisionId, headVersion: project.headVersion, planId: plan.id, graphDigest: plan.compiled.graphDigest,
      renderNodeId: render.id, timelineNodeId: timeline.id, canonicalNarrationId: selected.length ? narration!.id : null, inputs,
      dependencyNodeIds: [...dependencyNodeIds].sort(), scopeIds: [...scopeIds].sort() },
      input: { projectId, targetRevisionId: project.revisionId, width: Number(render.args.width), height: Number(render.args.height), clips, audio: selected.map(segment => segment.audioPlacement) } };
  }
}
