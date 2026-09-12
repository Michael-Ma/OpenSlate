import type { FastifyInstance, FastifyRequest } from "fastify";
import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { ManagedUploadStore } from "../narration/managed-upload.js";
import type { MediaApplicationService } from "./application.js";
import type { MediaRenderJob, OwnedMediaSource } from "./application-types.js";

interface RouteOptions { production: ProductionService; media: MediaApplicationService; uploads: ManagedUploadStore }
type ProjectParams = { projectId: string };
type JobParams = ProjectParams & { jobId: string };
const text = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const idempotencyKey = (request: FastifyRequest): string => {
  const key = request.headers["idempotency-key"];
  invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "A bounded idempotency-key header is required"); return key;
};
const summary = (job: MediaRenderJob) => ({ id: job.id, state: job.state, artifact: job.artifact, errorCode: job.errorCode,
  cancelRequested: job.cancelRequested, totalFrames: job.manifest.totalFrames, manifestDigest: job.manifest.digest,
  revisionId: job.target.revisionId, headVersion: job.target.headVersion, planId: job.target.planId, renderNodeId: job.target.renderNodeId,
  createdAt: job.createdAt, finishedAt: job.finishedAt, fixture: false as const,
  canRun: job.state === "prepared" && !job.cancelRequested,
  canRecover: !["prepared", "published", "historical"].includes(job.state) && (!job.ownerToken || (job.leaseUntil ?? 0) <= Date.now()) });

/** Register only below the parent application's authenticated local-session hook. */
export function registerMediaRoutes(app: FastifyInstance, options: RouteOptions): void {
  app.register(async scope => {
    const { production, media, uploads } = options;
    const tasks = new Map<string, { abort: AbortController; promise: Promise<void> }>();
    let closing = false;
    const currentJob = (projectId: string, jobId: string) => {
      const found = media.workspaceSnapshot(projectId).jobs.find(job => job.id === jobId);
      invariant(found, "NOT_FOUND", "Render does not belong to this project"); return found;
    };
    const commandActor = (projectId: string, action: string, key: string, context: unknown): ActorContext =>
      production.beginRequest(projectId, "local-user", action, { editing: false, key: `media:${key}`, contextDigest: digest(context) });
    const launch = (job: MediaRenderJob, actor: ActorContext, action: "run" | "recover") => {
      invariant(!closing, "SERVICE_UNAVAILABLE", "Renderer is shutting down");
      if (tasks.has(job.id)) return;
      const abort = new AbortController();
      // Defer entry until the registry owns the task, including synchronous port failures.
      const promise = Promise.resolve().then(async () => {
        try { if (action === "run") await media.run(job.projectId, actor, job.id, { signal: abort.signal }); else await media.recover(job.projectId, actor, job.id); }
        catch (error) {
          // Admission can fail before the running transition. Keep it prepared,
          // expose a bounded reason, and require an explicit later run request.
          const code = error instanceof DomainError ? error.code : "MEDIA_RENDER_FAILED";
          try {
            production.store.transaction(() => {
              const current = production.store.get<MediaRenderJob>("media_render", job.id);
              if (current?.state === "prepared") production.store.put("media_render", job.id, job.projectId, { ...current, errorCode: code });
            });
          } catch { /* SQL unavailable: preserve existing durable intent for explicit recovery. */ }
          scope.log.warn({ renderJobId: job.id, code }, "Local render did not complete");
        } finally { tasks.delete(job.id); }
      });
      tasks.set(job.id, { abort, promise });
    };
    scope.addHook("onClose", async () => {
      closing = true; const owned = [...tasks.values()]; owned.forEach(task => task.abort.abort());
      await Promise.allSettled(owned.map(task => task.promise));
    });
    // Stream bodies without buffering or touching files before inherited auth.
    scope.addContentTypeParser("application/octet-stream", (_request, payload, done) => { done(null, payload); });
    scope.get<{ Params: ProjectParams }>("/api/projects/:projectId/media", async request => {
      const { projectId } = request.params, state = media.workspaceSnapshot(projectId);
      return { jobs: state.jobs.slice(-40).reverse().map(summary), preview: state.preview,
        sources: production.store.list<OwnedMediaSource>("media_source", projectId).map(record => ({ artifactId: record.source.artifactId, sha256: record.source.sha256,
          kind: record.source.kind, frames: record.source.probe.video?.frames ?? null, byteLength: record.source.byteLength, fixture: false })) };
    });
    scope.post<{ Params: ProjectParams; Querystring: { expectedHeadVersion: string; requestId?: string; continuationRequestId?: string }; Body: AsyncIterable<Uint8Array> }>("/api/projects/:projectId/media/uploads", {
      bodyLimit: uploads.maxBytes,
      schema: { querystring: object({ expectedHeadVersion: { type: "string", pattern: "^(0|[1-9][0-9]{0,14})$" }, requestId: text, continuationRequestId: text }, ["expectedHeadVersion"]) },
    }, async (request, reply) => {
      invariant(request.headers["content-type"]?.split(";")[0] === "application/octet-stream", "VALIDATION_ERROR", "Upload video bytes as application/octet-stream");
      const { projectId } = request.params, expectedHeadVersion = Number(request.query.expectedHeadVersion), key = idempotencyKey(request);
      invariant(!(request.query.requestId && request.query.continuationRequestId), "VALIDATION_ERROR", "Choose one existing import request or an explicit continuation");
      const actor: ActorContext = request.query.requestId ? { kind: "human", principalId: "local-user", requestId: request.query.requestId }
        : production.beginRequest(projectId, "local-user", "Import supplied video", { key: `video-upload:${key}`, editing: true,
          ...(request.query.continuationRequestId ? { continuationRequestId: request.query.continuationRequestId } : {}), contextDigest: digest({ expectedHeadVersion }) });
      const assertCurrent = () => {
        production.assertActor(projectId, actor, true);
        const message = production.store.get<{ scopeIds: string[] }>("message", actor.requestId);
        invariant(message?.scopeIds.includes(projectId), "SCOPE_DENIED", "Video import requires project scope");
      };
      assertCurrent();
      try {
        const uploaded = await uploads.receive(request.body, digest({ projectId, principalId: "local-user", key }), assertCurrent);
        try { return { ...await media.importVideo(projectId, actor, { expectedHeadVersion, path: uploaded.path, key }), requestId: actor.requestId }; }
        finally { await uploaded.release(); }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const status = ["ACTOR_DENIED", "SCOPE_DENIED", "EPOCH_REVOKED"].includes(error.code) ? 403 : error.code === "VALIDATION_ERROR" ? 400 : 409;
        return reply.code(status).send({ error: { code: error.code, message: error.message }, requestId: actor.requestId });
      }
    });
    scope.post<{ Params: ProjectParams; Body: { expectedHeadVersion: number; renderNodeId: string } }>("/api/projects/:projectId/media/renders", {
      schema: { body: object({ expectedHeadVersion: { type: "integer", minimum: 0 }, renderNodeId: text }, ["expectedHeadVersion", "renderNodeId"]) },
    }, async (request, reply) => {
      const { projectId } = request.params, key = idempotencyKey(request), actor = commandActor(projectId, "Render the current supplied-media plan", key, request.body);
      const job = await media.prepareRender(projectId, actor, { ...request.body, key });
      launch(job, actor, "run"); return reply.code(202).send({ job: summary(job), requestId: actor.requestId });
    });
    scope.get<{ Params: JobParams }>("/api/projects/:projectId/media/renders/:jobId", async request => ({ job: summary(currentJob(request.params.projectId, request.params.jobId)) }));
    scope.post<{ Params: JobParams; Body: Record<string, never> }>("/api/projects/:projectId/media/renders/:jobId/run", { schema: { body: object({}) } }, async (request, reply) => {
      const { projectId, jobId } = request.params, key = idempotencyKey(request), job = currentJob(projectId, jobId);
      const actor = commandActor(projectId, "Run the prepared local render", `run:${key}`, { jobId });
      invariant(job.state === "prepared" && !job.cancelRequested, "MEDIA_RENDER_NOT_READY", "Only a prepared render can start; reconcile uncertain work");
      launch(job, actor, "run"); return reply.code(202).send({ job: summary(job) });
    });
    scope.post<{ Params: JobParams; Body: Record<string, never> }>("/api/projects/:projectId/media/renders/:jobId/cancel", { schema: { body: object({}) } }, async request => {
      const { projectId, jobId } = request.params, key = idempotencyKey(request), actor = commandActor(projectId, "Cancel local rendering", `cancel:${key}`, { jobId });
      return { job: summary(media.cancel(projectId, actor, jobId)) };
    });
    scope.post<{ Params: JobParams; Body: Record<string, never> }>("/api/projects/:projectId/media/renders/:jobId/recover", { schema: { body: object({}) } }, async (request, reply) => {
      const { projectId, jobId } = request.params, key = idempotencyKey(request), job = currentJob(projectId, jobId);
      const actor = commandActor(projectId, "Recover local render output", `recover:${key}`, { jobId });
      invariant(!tasks.has(job.id), "MEDIA_RENDER_BUSY", "This server is still processing the render");
      launch(job, actor, "recover"); return reply.code(202).send({ job: summary(job) });
    });
  });
}
