import Fastify from "fastify";
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { APP_NAME, DomainError, digest, invariant, newId } from "@openslate/core";
import type { ActorContext, HealthResponse } from "@openslate/core";
import { ToolInvocationService } from "./application/tool-invocations.js";
import type { ProductionService } from "./application/service.js";
import type { DirectorSupervisor } from "./application/director-supervisor.js";
import type { LocalDirectorController, LocalDirectorSelection } from "./application/local-director.js";
import type { ArtifactRecord, PlanRecord, ReviewSnapshot } from "./execution/engine.js";
import { seedFixture } from "./demo.js";
import type { DemoCommand } from "./application/fake-director.js";
import { registerNarrationRoutes } from "./narration/routes.js";
import { registerMediaRoutes } from "./media/routes.js";
import { isPublicWebRequest, type WebAssets } from "./web-assets.js";

interface AppOptions { service?: ProductionService; localToken?: string; logger?: boolean;
  webAssets?: WebAssets;
  director?: Pick<DirectorSupervisor, "status" | "enqueue" | "answerQuestion" | "tick">;
  runtimeSettings?: LocalDirectorController;
  narrationRoutes?: Parameters<typeof registerNarrationRoutes>[1];
  mediaRoutes?: Parameters<typeof registerMediaRoutes>[1] }
const string = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const actors = new WeakMap<object, ActorContext>();
  const reviewCache = new Map<string, { cursor: number; snapshot: ReviewSnapshot }>();
  const eventStreams = new Set<() => void>();
  app.addHook("preClose", async () => { for (const close of eventStreams) close(); });
  const service = () => { invariant(options.service, "SERVICE_UNAVAILABLE", "Application storage is not configured"); return options.service; };
  const directorMode = (projectId: string) => options.director?.status(projectId).mode ?? "not_connected";
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      const status = ["EPOCH_REVOKED", "ACTOR_DENIED", "SCOPE_DENIED", "AUTH_REQUIRED", "ORIGIN_DENIED"].includes(error.code) ? 403
        : error.code === "NOT_FOUND" ? 404 : error.code === "SERVICE_UNAVAILABLE" ? 503 : error.code === "VALIDATION_ERROR" ? 400 : 409;
      void reply.status(status).send({ error: { code: error.code, message: error.message } });
    } else if ((error as { validation?: unknown }).validation) void reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Request does not match its schema" } });
    else { app.log.error(error); void reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "The operation could not be completed" } }); }
  });
  app.addHook("preHandler", async request => {
    const host = request.headers.host?.split(":")[0];
    invariant(host === "127.0.0.1" || host === "localhost", "ORIGIN_DENIED", "Use a loopback address");
    const origin = request.headers.origin;
    invariant(!origin || ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3001", "http://localhost:3001"].includes(origin), "ORIGIN_DENIED", "Origin is not permitted");
    const commandKey = request.headers["idempotency-key"];
    invariant(commandKey === undefined || (typeof commandKey === "string" && commandKey.length > 0 && commandKey.length <= 160), "VALIDATION_ERROR", "Use one bounded command identity");
    if (request.routeOptions.url === "/api/health" || isPublicWebRequest(request)) return;
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,256})$/)?.[1];
    invariant(bearer, "AUTH_REQUIRED", "A local session or director bridge token is required");
    if (request.routeOptions.url?.startsWith("/internal/")) {
      const projectId = (request.params as { projectId: string }).projectId;
      actors.set(request, service().actorForBridge(projectId, bearer));
    } else invariant(options.localToken && timingSafeEqual(Buffer.from(digest(bearer)), Buffer.from(digest(options.localToken))), "AUTH_REQUIRED", "Invalid local session token");
  });
  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({ name: APP_NAME, status: "ok", stage: "foundation" }));
  options.webAssets?.register(app);
  if (options.narrationRoutes) registerNarrationRoutes(app, options.narrationRoutes);
  if (options.mediaRoutes) registerMediaRoutes(app, options.mediaRoutes);
  app.get("/api/projects", async () => ({ projects: service().store.listProjects().map(project => ({ id: project.id, name: project.name, headVersion: project.headVersion, activePlanId: project.activePlanId, shotCount: project.shots.length })) }));
  app.post<{ Body: { name: string } }>("/api/projects", { schema: { body: object({ name: string }, ["name"]) } }, async request =>
    service().store.command("local-user:create-project", request.headers["idempotency-key"] as string | undefined ?? newId(), digest(request.body), () => service().createProject(request.body.name)));
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async request => service().snapshot(request.params.projectId));
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director", async request => {
    service().store.getProject(request.params.projectId);
    return options.director?.status(request.params.projectId) ?? { mode: "offline", status: "not_connected", activeRequestId: null };
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director/setup", async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.settings(request.params.projectId);
  });
  app.post<{ Params: { projectId: string }; Body: LocalDirectorSelection }>("/api/projects/:projectId/director/setup", {
    schema: { body: object({ mode: { enum: ["fake", "native"] }, binaryPath: { type: "string", maxLength: 4096 }, model: { type: "string", maxLength: 120 }, codexHome: { type: "string", maxLength: 4096 } }, ["mode"]) },
  }, async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.configure(request.params.projectId, request.body, request.headers["idempotency-key"] as string | undefined ?? newId());
  });
  app.post<{ Params: { projectId: string }; Body: { text: string; scopeIds?: string[]; editing?: boolean; continuationRequestId?: string; replyToReviewId?: string; replyToQuestionId?: string } }>("/api/projects/:projectId/messages", {
    schema: { body: object({ text: { type: "string", minLength: 1, maxLength: 16000 }, scopeIds: { type: "array", minItems: 1, maxItems: 400, items: string }, editing: { type: "boolean" }, continuationRequestId: string, replyToReviewId: string, replyToQuestionId: string }, ["text"]) },
  }, async request => {
    if (request.body.replyToQuestionId) {
      invariant(options.director && !request.body.replyToReviewId && !request.body.scopeIds && !request.body.continuationRequestId && request.body.editing === undefined, "VALIDATION_ERROR", "Reply to one pending question using its original scope");
      const actor = options.director.answerQuestion(request.params.projectId, "local-user", request.body.replyToQuestionId, request.body.text, request.headers["idempotency-key"] as string | undefined ?? newId());
      options.director.tick(); return { requestId: actor.requestId, status: "queued", director: directorMode(request.params.projectId) };
    }
    const actor = service().store.transaction(() => {
      const actor = service().beginRequest(request.params.projectId, "local-user", request.body.text,
        { ...request.body, contextDigest: digest({ replyToReviewId: request.body.replyToReviewId ?? null }), editing: request.body.replyToReviewId ? false : request.body.editing ?? true, key: request.headers["idempotency-key"] as string | undefined ?? newId() });
      if (!request.body.replyToReviewId) options.director?.enqueue(request.params.projectId, actor);
      return actor;
    });
    if (request.body.replyToReviewId) return service().replyToReview(request.params.projectId, actor, request.body.replyToReviewId, request.body.text);
    options.director?.tick();
    return { requestId: actor.requestId, status: options.director ? "queued" : "recorded", director: directorMode(request.params.projectId) };
  });
  app.post<{ Params: { projectId: string }; Body: DemoCommand }>("/api/projects/:projectId/demo", {
    schema: { body: object({ action: { enum: ["create", "close_up", "wide"] }, shotId: string }, ["action"]) },
  }, async request => {
    invariant(options.director && directorMode(request.params.projectId) === "fake", "ACTOR_DENIED", "The demo is available only with the offline fake director");
    const { projectId } = request.params;
    const key = request.headers["idempotency-key"] as string | undefined ?? newId();
    // Dedicated human demo command authorizes bounded fake slots. Ordinary chat never grants generation.
    const result = service().store.command(`local-user:${projectId}:demo`, key, digest(request.body), () => {
      if (request.body.action === "create") seedFixture(service(), join(service().engine.artifactDir, projectId), projectId);
      const project = service().store.getProject(projectId);
      invariant(project.shots.length === 2 && project.brief === "A deliberately fake leather-boots commercial integration fixture", "DEMO_PROJECT_REQUIRED", "Use the dedicated two-shot fixture project");
      const shotIds = request.body.action === "create" ? project.shots.map(shot => shot.id) : [request.body.shotId];
      invariant(shotIds.every(id => id && project.shots.some(shot => shot.id === id)), "VALIDATION_ERROR", "Select a demo shot");
      const text = request.body.action === "create" ? "Create a 2-shot offline demo with sample media." : `Try ${request.body.action === "close_up" ? "a close-up" : "a wide view"} for the selected demo shot.`;
      const actor = service().beginRequest(projectId, "local-user", text, { scopeIds: request.body.action === "create" ? [projectId] : shotIds as string[], key: `demo:${key}`, contextDigest: digest(request.body) });
      service().authorize(projectId, actor, (shotIds as string[]).flatMap(scopeId => [{ scopeId, kind: "image" as const }, { scopeId, kind: "video" as const }]), `demo-slots:${actor.requestId}`, request.body.action === "create" ? "initial_slot" : "user_change");
      service().store.insert("demo_command", actor.requestId, projectId, request.body);
      const turn = options.director!.enqueue(projectId, actor);
      return { requestId: actor.requestId, turnId: turn.id, status: "queued", director: "fake" };
    });
    options.director.tick(); return result;
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/review", async request => {
    const { projectId } = request.params, project = service().store.getProject(projectId);
    if (!project.activePlanId) return { id: null, projectId, planId: null, members: [], headVersion: project.headVersion, revisionId: project.revisionId };
    const cursor = service().store.cursor(projectId);
    let cached = reviewCache.get(projectId);
    if (!cached || cached.cursor !== cursor) {
      cached = { cursor, snapshot: service().engine.reviewSnapshot(projectId) }; reviewCache.set(projectId, cached);
    }
    const plan = service().store.get<PlanRecord>("plan", cached.snapshot.planId)!;
    const approvals = service().store.list<{ videoNodeId: string; approvalDigest: string }>("approval", projectId);
    return { ...cached.snapshot, headVersion: project.headVersion, revisionId: project.revisionId, members: cached.snapshot.members.map(member => {
      const node = plan.compiled.nodes.find(node => node.id === member.videoNodeId)!;
      return { ...member, approved: approvals.some(approval => approval.videoNodeId === member.videoNodeId && approval.approvalDigest === member.approvalDigest), motionPrompt: node.args.prompt, durationFrames: node.args.durationFrames, profileLabel: node.profileId };
    }) };
  });
  app.get<{ Params: { projectId: string; artifactId: string } }>("/api/projects/:projectId/artifacts/:artifactId/content", async (request, reply) => {
    const artifact = service().store.get<ArtifactRecord>("artifact", request.params.artifactId);
    invariant(artifact?.projectId === request.params.projectId, "NOT_FOUND", "Artifact does not belong to this project");
    const root = realpathSync(service().engine.artifactDir), path = realpathSync(artifact.path), rel = relative(root, path);
    invariant(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep), "SCOPE_DENIED", "Artifact is outside managed media storage");
    const fd = openSync(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      invariant(stat.isFile() && stat.size <= 256 * 1024 * 1024, "ARTIFACT_TOO_LARGE", "Artifact preview exceeds its limit");
      const bytes = readFileSync(fd);
      invariant(createHash("sha256").update(bytes).digest("hex") === artifact.artifact.sha256, "ARTIFACT_CORRUPT", "Artifact bytes changed");
      const allowed = ["image/svg+xml", "image/png", "image/jpeg", "video/mp4", "audio/wav", "audio/mpeg"];
      invariant(allowed.includes(artifact.mimeType), "ARTIFACT_TYPE_UNSUPPORTED", "Artifact is not a supported preview");
      return reply.header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, no-store").header("Content-Security-Policy", "sandbox; default-src 'none'").type(artifact.mimeType).send(bytes);
    } finally { closeSync(fd); }
  });
  app.post<{ Params: { projectId: string }; Body: { snapshotId: string; videoNodeIds: string[] } }>("/api/projects/:projectId/approvals", {
    schema: { body: object({ snapshotId: string, videoNodeIds: { type: "array", minItems: 1, maxItems: 400, uniqueItems: true, items: string } }, ["snapshotId", "videoNodeIds"]) },
  }, async request => {
    const actor = service().beginRequest(request.params.projectId, "local-user", "Review the displayed keyframes", { editing: false, contextDigest: digest({ snapshotId: request.body.snapshotId, videoNodeIds: [...request.body.videoNodeIds].sort() }), key: `review:${request.headers["idempotency-key"] ?? digest(request.body)}` });
    return service().approve(request.params.projectId, actor, request.body.snapshotId, request.body.videoNodeIds);
  });
  app.post<{ Params: { projectId: string }; Body: { action: "pause" | "resume" } }>("/api/projects/:projectId/controls", {
    schema: { body: object({ action: { enum: ["pause", "resume"] } }, ["action"]) },
  }, async request => {
    const key = request.headers["idempotency-key"] as string | undefined ?? newId();
    const result = service().store.command(`local-user:${request.params.projectId}:control`, key, digest(request.body), () => {
      const actor = service().beginRequest(request.params.projectId, "local-user", request.body.action, { editing: false, key: `control:${key}` });
      return service().control(request.params.projectId, actor, request.body.action);
    });
    options.director?.tick(); return result;
  });
  app.get<{ Params: { projectId: string }; Querystring: { after?: string } }>("/api/projects/:projectId/events", async (request, reply) => {
    let cursor = Number(request.headers["last-event-id"] ?? request.query.after ?? 0);
    invariant(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= service().store.cursor(request.params.projectId), "VALIDATION_ERROR", "Invalid event cursor");
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    let closed = false;
    const pump = () => {
      if (closed) return;
      try {
        if (reply.raw.writableLength > 1024 * 1024) { reply.raw.end(); return; }
        const events = service().store.readEvents(request.params.projectId, cursor).slice(0, 100);
        for (const event of events) { reply.raw.write(`id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`); cursor = event.sequence; }
        if (!events.length) reply.raw.write(": heartbeat\n\n");
      } catch { reply.raw.end(); }
    };
    const timer = setInterval(pump, 1000);
    const close = () => { if (closed) return; closed = true; clearInterval(timer); eventStreams.delete(close); reply.raw.end(); };
    eventStreams.add(close);
    reply.raw.on("close", close);
    pump();
  });
  app.post<{ Params: { projectId: string; tool: string }; Body: Record<string, unknown> }>("/internal/projects/:projectId/tools/:tool", async request => {
    const actor = actors.get(request)!;
    const { projectId, tool } = request.params;
    const callId = request.headers["x-openslate-tool-call-id"];
    invariant(typeof callId === "string", "VALIDATION_ERROR", "One tool call identity is required");
    return new ToolInvocationService(service()).invoke(projectId, actor, callId, tool, request.body);
  });
  return app;
}
