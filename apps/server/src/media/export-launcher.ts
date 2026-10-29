import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { StartExportInput } from "@openslate/core/public";
import type { ProductionService } from "../application/service.js";
import type { MediaApplicationService } from "./application.js";
import type { MediaRenderJob } from "./application-types.js";

/**
 * Owns local render tasks for one server. The person's Export route and the Director's start_export call the same
 * start(), so both prepare the export under an identical app request and launch the same renderer.
 */
export class ExportLauncher {
  readonly tasks = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  #closing = false;
  #warn: (details: { renderJobId: string; code: string }, message: string) => void = () => {};
  constructor(readonly production: ProductionService, readonly media: MediaApplicationService) {}

  attachLog(warn: (details: { renderJobId: string; code: string }, message: string) => void): void { this.#warn = warn; }

  commandActor(projectId: string, action: string, key: string, context: unknown): ActorContext {
    return this.production.beginRequest(projectId, "local-user", action, { source: "app", editing: false, key: `media:${key}`, contextDigest: digest(context) });
  }

  launch(job: MediaRenderJob, actor: ActorContext, action: "run" | "recover"): void {
    invariant(!this.#closing, "SERVICE_UNAVAILABLE", "Renderer is shutting down");
    if (this.tasks.has(job.id)) return;
    const abort = new AbortController();
    // Defer entry until the registry owns the task, including synchronous port failures.
    const promise = Promise.resolve().then(async () => {
      try { if (action === "run") await this.media.run(job.projectId, actor, job.id, { signal: abort.signal }); else await this.media.recover(job.projectId, actor, job.id); }
      catch (error) {
        // Admission can fail before the running transition. Keep it prepared,
        // expose a bounded reason, and require an explicit later run request.
        const code = error instanceof DomainError ? error.code : "MEDIA_RENDER_FAILED";
        try {
          this.production.store.transaction(() => {
            const current = this.production.store.get<MediaRenderJob>("media_render", job.id);
            if (current?.state === "prepared") this.production.store.put("media_render", job.id, job.projectId, { ...current, errorCode: code });
          });
        } catch { /* SQL unavailable: preserve existing durable intent for explicit recovery. */ }
        this.#warn({ renderJobId: job.id, code }, "Local render did not complete");
      } finally { this.tasks.delete(job.id); }
    });
    this.tasks.set(job.id, { abort, promise });
  }

  /**
   * The person's Export: prepare under a new app request and run the renderer when the job is ready. The Director's
   * start_export passes its own conversation as `directorRequestId`, so that conversation's edit holds do not block it.
   */
  async start(projectId: string, input: StartExportInput, key: string, options: { directorRequestId?: string } = {}) {
    const actor = this.commandActor(projectId, "Export the storyboard film", `export:${key}`, input);
    const job = await this.media.prepareExport(projectId, actor, { ...input, key }, options.directorRequestId ? { directorRequestId: options.directorRequestId } : {});
    if (job.state === "prepared" && !job.errorCode && !job.cancelRequested) this.launch(job, actor, "run");
    return this.media.exportRecord(projectId, job.id);
  }

  async close(): Promise<void> {
    this.#closing = true; const owned = [...this.tasks.values()];
    owned.forEach(task => task.abort.abort(new DomainError("MEDIA_INTERRUPTED", "Renderer is shutting down")));
    await Promise.allSettled(owned.map(task => task.promise));
  }
}
