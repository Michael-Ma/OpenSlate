import { canonical, digest, DomainError, invariant, newId } from "@openslate/core";
import { setTimeout as delay } from "node:timers/promises";
import type { ActorContext, ArtifactRef } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import { LocalMediaService } from "./local-media.js";
import { installManagedVideo } from "./managed-video.js";
import type { RenderCompletion } from "./types.js";
import type { ImportedVideo, ImportVideoInput, MediaPreview, MediaRenderJob, OwnedMediaSource, PrepareMediaRender, RealVideoArtifact } from "./application-types.js";
import type { ExportRecord, ExportView, StartExportInput } from "@openslate/core/public";
import type { StoryboardCapture } from "./storyboard-capture.js";
import { captureStoryboard, changedFilm } from "./storyboard-capture.js";
import { fixtureSource } from "./demo-source.js";
import { captureRender } from "./timeline-capture.js";
import type { CapturedRender } from "./timeline-capture.js";
import { validateUploadName } from "./upload-name.js";

interface Request { projectId: string; principalId: string; scopeIds: string[]; state: string }
const errorCode = (error: unknown): string => error instanceof DomainError ? error.code : "MEDIA_RENDER_FAILED";
const terminal = (job: MediaRenderJob): boolean => job.state === "published" || job.state === "historical";
const importReceipt = (value: ImportedVideo): ImportedVideo => ({ artifact: value.artifact, sourceId: value.sourceId, revisionId: value.revisionId, headVersion: value.headVersion });

/** Local supplied-media bridge. It never starts generation or changes executor bindings. */
export class MediaApplicationService {
  private readonly preparingExports = new Map<string, Promise<MediaRenderJob>>();
  private readonly running = new Map<string, AbortController>();
  private readonly leaseMs: number;
  constructor(readonly production: ProductionService, readonly media: LocalMediaService, options: { leaseMs?: number } = {}) {
    this.leaseMs = options.leaseMs ?? 15000;
    invariant(Number.isSafeInteger(this.leaseMs) && this.leaseMs >= 1000 && this.leaseMs <= 120000, "MEDIA_INVALID_INPUT", "Invalid render lease duration");
  }
  private get store() { return this.production.store; }

  private authorize(projectId: string, actor: ActorContext, write = true): void {
    if (write) this.production.recovery.assertWritable(projectId, actor.requestId);
    this.production.assertActor(projectId, actor, write && actor.kind === "director");
    const request = this.store.get<Request>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.principalId === actor.principalId && (!write || request.state === "active"), "ACTOR_DENIED", "Render request is inactive");
    invariant(request.scopeIds.includes(projectId), "SCOPE_DENIED", "Full timeline rendering requires project scope");
  }

  /** Host-selected path, authenticated human only; never add this path field to a model tool. */
  async importVideo(projectId: string, actor: ActorContext, input: ImportVideoInput, options: { signal?: AbortSignal } = {}): Promise<ImportedVideo> {
    const request = structuredClone(input), authority = structuredClone(actor);
    this.validateRequest(request, ["expectedHeadVersion", "path", "key", "name"]);
    validateUploadName(request.name);
    if (request.name === undefined) delete request.name;
    invariant(typeof request.path === "string" && request.path.length > 0 && request.path.length <= 4096, "MEDIA_INVALID_INPUT", "A bounded host-selected file path is required");
    const intent = this.store.transaction(() => {
      this.authorize(projectId, authority); this.production.assertActor(projectId, authority, true);
      invariant(authority.kind === "human", "ACTOR_DENIED", "Only a human can choose a supplied file");
      return this.store.command(`${authority.principalId}:${projectId}:media_import`, request.key, digest({ request, authority }), () => {
        invariant(this.store.getProject(projectId).headVersion === request.expectedHeadVersion, "REVISION_CONFLICT", "Project changed before media import");
        const row = { id: newId(), projectId, artifactId: newId(), requestId: authority.requestId, ...(request.name === undefined ? {} : { name: request.name }) };
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
        origin: "supplied_video", byteLength: source.byteLength, physicalDurationSeconds: source.probe.video!.frames / 30, sourceDescriptorId: source.id,
        ...(request.name === undefined ? {} : { name: request.name }) };
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

  async prepareExport(projectId: string, actor: ActorContext, input: StartExportInput & { key: string }): Promise<MediaRenderJob> {
    const request = structuredClone(input), authority = structuredClone(actor);
    this.validateRequest(request, ["expectedHeadVersion", "key"]);
    const reserved = this.store.transaction(() => {
      this.authorize(projectId, authority);
      invariant(authority.kind === "human", "ACTOR_DENIED", "Export requires a human request");
      return this.store.command(`${authority.principalId}:${projectId}:storyboard_export`, request.key, digest({ request, authority }), () => {
        invariant(this.store.getProject(projectId).headVersion === request.expectedHeadVersion, "REVISION_CONFLICT", "Film changed before export");
        const capture = captureStoryboard(this.store, projectId);
        if (!capture.readiness.ready) throw new DomainError("EXPORT_BLOCKED", "Film is not ready to export", capture.readiness);
        const job = { projectId, target: capture.target };
        this.assertUnpaused(job);
        return { id: newId(), outputArtifactId: newId(), capture };
      });
    });
    const prior = this.store.get<MediaRenderJob>("media_render", reserved.id); if (prior) return prior;
    const pending = this.preparingExports.get(reserved.id); if (pending) return pending;
    const promise = this.freezeExport(projectId, authority, reserved);
    this.preparingExports.set(reserved.id, promise);
    try { return await promise; } finally { this.preparingExports.delete(reserved.id); }
  }

  private async freezeExport(projectId: string, authority: ActorContext, reserved: { id: string; outputArtifactId: string; capture: StoryboardCapture }): Promise<MediaRenderJob> {
    const { capture } = reserved, renderInput = structuredClone(capture.input);
    const assertCurrent = () => this.store.transaction(() => {
      this.authorize(projectId, authority);
      invariant(canonical(captureStoryboard(this.store, projectId).target) === canonical(capture.target), "REVISION_CONFLICT", "Film changed while freezing export");
      this.assertUnpaused({ projectId, target: capture.target });
    });
    for (const clip of capture.fixtureClips) {
      const source = await this.whenMediaAvailable(() => fixtureSource(this.store, this.media, projectId, clip.artifact, clip.durationFrames), assertCurrent);
      renderInput.clips.push({ source, startFrame: 0, durationFrames: clip.durationFrames, fit: "contain" });
    }
    const fixtureAudioSources = new Map<string, Awaited<ReturnType<typeof fixtureSource>>>();
    for (const placement of capture.fixtureAudio) {
      let source = fixtureAudioSources.get(placement.artifact.artifactId);
      if (!source) {
        source = await this.whenMediaAvailable(() => fixtureSource(this.store, this.media, projectId, placement.artifact, Math.round(capture.readiness.seconds * 30)), assertCurrent);
        fixtureAudioSources.set(placement.artifact.artifactId, source);
      }
      renderInput.audio!.push({ source, startSample: placement.startSample, durationSamples: placement.durationSamples, atSample: placement.atSample });
    }
    const manifest = await this.media.freezeManifest(renderInput);
    return this.store.transaction(() => {
      this.authorize(projectId, authority);
      const previous = this.store.get<MediaRenderJob>("media_render", reserved.id); if (previous) return previous;
      invariant(canonical(captureStoryboard(this.store, projectId).target) === canonical(capture.target), "REVISION_CONFLICT", "Film changed while freezing export");
      const job: MediaRenderJob = { id: reserved.id, projectId, actor: authority, target: capture.target, manifest, outputArtifactId: reserved.outputArtifactId,
        state: "prepared", ownerToken: null, leaseUntil: null, cancelRequested: false, artifact: null, createdAt: new Date().toISOString(), finishedAt: null, errorCode: null };
      this.store.insert("media_render", job.id, projectId, job);
      this.store.appendEvent(projectId, "media.render_prepared", { renderJobId: job.id, manifestDigest: manifest.digest });
      return job;
    });
  }

  exportRecord(projectId: string, jobId: string): ExportRecord {
    const job = this.job(projectId, jobId), target = job.target;
    invariant("kind" in target && target.kind === "storyboard", "NOT_FOUND", "Export does not belong to the storyboard");
    return { exportId: job.id, state: terminal(job) ? "done" : job.cancelRequested || job.state === "cancelled" ? "cancelled" :
      job.state === "failed" || job.errorCode ? "failed" : "rendering",
      headVersion: target.headVersion, demo: target.demo, startedAt: job.createdAt,
      ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}), ...(job.artifact ? { artifact: { ...job.artifact, kind: "video" as const } } : {}),
      ...(job.errorCode ? { failure: { code: job.errorCode } } : {}),
      outdatedBy: changedFilm(target.film, captureStoryboard(this.store, projectId).target.film) };
  }

  exportView(projectId: string): ExportView {
    return this.store.transaction(() => {
      const capture = captureStoryboard(this.store, projectId);
      const records = this.store.list<MediaRenderJob>("media_render", projectId).filter(job => "kind" in job.target && job.target.kind === "storyboard").reverse()
        .map(job => this.exportRecord(projectId, job.id));
      const current = records.find(record => record.state === "rendering") ?? records[0] ?? null;
      return { readiness: capture.readiness, current, history: records.filter(record => record !== current) };
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
      const completion = await this.whenMediaAvailable(() => this.media.render(job.manifest, { signal: abort.signal }), () => this.store.transaction(() => {
        const current = this.job(projectId, jobId);
        invariant(current.ownerToken === job.ownerToken && current.state === "running", "MEDIA_LEASE_LOST", "Render ownership changed while waiting for FFmpeg");
        invariant(!current.cancelRequested, "MEDIA_CANCELLED", "Render was cancelled while waiting for FFmpeg");
        this.authorize(projectId, actor); this.authorize(projectId, current.actor);
        invariant(this.matches(current), "MEDIA_STALE_TARGET", "Render target changed while waiting for FFmpeg");
        this.assertUnpaused(current);
      }), abort.signal);
      const path = await installManagedVideo(this.production.engine.artifactDir, projectId, completion.artifact, this.media.limits.maxOutputBytes);
      return this.finish(job, completion, path);
    } catch (error) {
      this.store.transaction(() => {
        const current = this.job(projectId, jobId);
        if (current.ownerToken === job.ownerToken && current.state === "running") {
          // A receipt may already exist (for example after SQL failure). Recovery scans
          // it before any retry; there is never an automatic second FFmpeg dispatch.
          // Only the explicit human cancel command sets cancelRequested. A host
          // shutdown leaves receipt recovery available, including the narrow
          // window where FFmpeg finished before its publication was interrupted.
          const interrupted = abort.signal.aborted && !current.cancelRequested;
          this.store.put("media_render", jobId, projectId, { ...current, state: current.cancelRequested ? "cancelled" : interrupted ? "interrupted" : "failed", ownerToken: null,
            leaseUntil: null, errorCode: interrupted ? null : errorCode(error), finishedAt: new Date().toISOString() });
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
  workspaceSnapshot(projectId: string): { jobs: MediaRenderJob[]; preview: MediaPreview | null; lastExport: { artifact: ArtifactRef; outdated: boolean; outdatedBy: ExportRecord["outdatedBy"] } | null } {
    this.store.getProject(projectId);
    const jobs = this.store.list<MediaRenderJob>("media_render", projectId), preview = this.store.get<MediaPreview>("media_preview", projectId);
    const selected = preview ? jobs.find(job => job.id === preview.renderJobId) : undefined;
    const last = [...jobs].reverse().find(job => job.artifact);
    const outdatedBy = last && "kind" in last.target ? this.exportRecord(projectId, last.id).outdatedBy : [];
    const lastExport = last?.artifact ? { artifact: last.artifact, outdated: "kind" in last.target ? outdatedBy.length > 0 : !this.matches(last), outdatedBy } : null;
    return { jobs, preview: preview && selected && this.matches(selected) ? preview : null, lastExport };
  }

  private job(projectId: string, id: string): MediaRenderJob {
    const job = this.store.get<MediaRenderJob>("media_render", id); invariant(job?.projectId === projectId, "NOT_FOUND", "Render does not belong to this project"); return job;
  }

  private async whenMediaAvailable<T>(operation: () => Promise<T>, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    for (;;) {
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Local render interrupted");
      assertCurrent();
      try { return await operation(); }
      catch (error) {
        // MEDIA_BUSY is emitted only before LocalMediaService takes its worker
        // or dispatches FFmpeg. Every other outcome needs explicit recovery.
        if (!(error instanceof DomainError) || error.code !== "MEDIA_BUSY") throw error;
      }
      try { await delay(50, undefined, signal ? { signal } : {}); }
      catch { throw new DomainError("MEDIA_CANCELLED", "Local render interrupted while waiting for FFmpeg"); }
    }
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
      const record: RealVideoArtifact = { id: artifact.artifactId, projectId: job.projectId, artifact, path, mimeType: "video/mp4", fixture: "kind" in job.target && job.target.demo, attemptId: null,
        origin: "local_render", byteLength: completion.artifact.byteLength, physicalDurationSeconds: completion.artifact.probe.video!.frames / 30, manifestDigest: job.manifest.digest, renderJobId: job.id };
      this.store.insert("artifact", record.id, job.projectId, record);
      let publish = !current.cancelRequested && this.matches(job);
      try { this.authorize(job.projectId, job.actor); this.assertUnpaused(job); } catch { publish = false; }
      const next: MediaRenderJob = { ...current, state: publish ? "published" : "historical", artifact, ownerToken: null, leaseUntil: null,
        finishedAt: new Date().toISOString(), errorCode: null };
      this.store.put("media_render", job.id, job.projectId, next);
      if (publish) this.store.put<MediaPreview>("media_preview", job.projectId, job.projectId, { id: job.projectId, projectId: job.projectId, renderJobId: job.id, artifact,
        revisionId: job.target.revisionId, headVersion: job.target.headVersion, planId: "planId" in job.target ? job.target.planId : null, manifestDigest: job.manifest.digest, fixture: "kind" in job.target && job.target.demo });
      this.store.appendEvent(job.projectId, publish ? "media.render_published" : "media.render_historical", { renderJobId: job.id, artifactId: artifact.artifactId, manifestDigest: job.manifest.digest });
      return next;
    });
  }

  private matches(job: MediaRenderJob): boolean {
    try {
      const capture = "kind" in job.target ? captureStoryboard(this.store, job.projectId) : this.capture(job.projectId, job.target.renderNodeId);
      return (!("readiness" in capture) || capture.readiness.ready) && canonical(capture.target) === canonical(job.target);
    } catch { return false; }
  }

  private assertUnpaused(job: Pick<MediaRenderJob, "projectId" | "target">): void {
    // Storyboard exports spend nothing and have no provider dispatch. Stop still fences generation.
    const storyboard = "kind" in job.target && job.target.kind === "storyboard";
    invariant(storyboard || !this.store.get<{ paused: boolean }>("execution_control", job.projectId)?.paused, "MEDIA_PAUSED", "Project execution is paused");
    const held = this.store.list<{ scopeId: string; active: boolean }>("hold", job.projectId)
      .some(hold => hold.active && (job.target.scopeIds.includes(hold.scopeId) || job.target.dependencyNodeIds.includes(hold.scopeId)));
    invariant(!held, "MEDIA_HELD", "A timeline dependency is held for editing");
  }

  private capture(projectId: string, renderNodeId: string): CapturedRender {
    return captureRender(this.store, projectId, renderNodeId);
  }
}
