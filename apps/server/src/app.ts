import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";
import { APP_NAME, DomainError, digest, invariant, newId } from "@openslate/core";
import type { ActorContext, HealthResponse } from "@openslate/core";
import { ToolInvocationService } from "./application/tool-invocations.js";
import type { ProductionService } from "./application/service.js";

interface AppOptions { service?: ProductionService; localToken?: string; logger?: boolean }
const string = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const actors = new WeakMap<object, ActorContext>();
  const service = () => { invariant(options.service, "SERVICE_UNAVAILABLE", "Application storage is not configured"); return options.service; };
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
    if (request.routeOptions.url === "/api/health") return;
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,256})$/)?.[1];
    invariant(bearer, "AUTH_REQUIRED", "A local session or director bridge token is required");
    if (request.routeOptions.url?.startsWith("/internal/")) {
      const projectId = (request.params as { projectId: string }).projectId;
      actors.set(request, service().actorForBridge(projectId, bearer));
    } else invariant(options.localToken && timingSafeEqual(Buffer.from(digest(bearer)), Buffer.from(digest(options.localToken))), "AUTH_REQUIRED", "Invalid local session token");
  });
  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({ name: APP_NAME, status: "ok", stage: "foundation" }));
  app.post<{ Body: { name: string } }>("/api/projects", { schema: { body: object({ name: string }, ["name"]) } }, async request => service().createProject(request.body.name));
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async request => service().snapshot(request.params.projectId));
  app.post<{ Params: { projectId: string }; Body: { text: string; scopeIds?: string[]; editing?: boolean; continuationRequestId?: string; replyToReviewId?: string } }>("/api/projects/:projectId/messages", {
    schema: { body: object({ text: { type: "string", minLength: 1, maxLength: 16000 }, scopeIds: { type: "array", minItems: 1, maxItems: 400, items: string }, editing: { type: "boolean" }, continuationRequestId: string, replyToReviewId: string }, ["text"]) },
  }, async request => {
    const actor = service().beginRequest(request.params.projectId, "local-user", request.body.text,
      { ...request.body, contextDigest: digest({ replyToReviewId: request.body.replyToReviewId ?? null }), editing: request.body.replyToReviewId ? false : request.body.editing ?? true, key: request.headers["idempotency-key"] as string | undefined ?? newId() });
    if (request.body.replyToReviewId) return service().replyToReview(request.params.projectId, actor, request.body.replyToReviewId, request.body.text);
    return { requestId: actor.requestId, status: "recorded", director: "not_connected" };
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/review", async request => service().engine.reviewSnapshot(request.params.projectId));
  app.post<{ Params: { projectId: string }; Body: { snapshotId: string; videoNodeIds: string[] } }>("/api/projects/:projectId/approvals", {
    schema: { body: object({ snapshotId: string, videoNodeIds: { type: "array", minItems: 1, maxItems: 400, uniqueItems: true, items: string } }, ["snapshotId", "videoNodeIds"]) },
  }, async request => {
    const actor = service().beginRequest(request.params.projectId, "local-user", "Review the displayed keyframes", { editing: false, contextDigest: digest({ snapshotId: request.body.snapshotId, videoNodeIds: [...request.body.videoNodeIds].sort() }), key: `review:${request.headers["idempotency-key"] ?? digest(request.body)}` });
    return service().approve(request.params.projectId, actor, request.body.snapshotId, request.body.videoNodeIds);
  });
  app.post<{ Params: { projectId: string }; Body: { action: "pause" | "resume" } }>("/api/projects/:projectId/controls", {
    schema: { body: object({ action: { enum: ["pause", "resume"] } }, ["action"]) },
  }, async request => {
    const actor = service().beginRequest(request.params.projectId, "local-user", request.body.action, { editing: false });
    return service().control(request.params.projectId, actor, request.body.action);
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
    reply.raw.on("close", () => { closed = true; clearInterval(timer); });
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
