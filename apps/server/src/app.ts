import { registerGenerationPermission } from "./generation-permission.js";
import { registerProjectEventStream } from "./application/project-event-stream.js";
import { registerStudioSessions, type StudioSessions } from "./studio-sessions.js";
import Fastify from "fastify";
import { ProjectModelSettings } from "./application/project-model-settings.js";
import type { ProjectModelPreviewInput } from "./application/project-model-settings.js";
import { createHash, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { APP_NAME, DomainError, digest, invariant, newId } from "@openslate/core";
import type { ActorContext, HealthResponse } from "@openslate/core";
import { ToolInvocationService } from "./application/tool-invocations.js";
import { imageMessageContext, selectedDirectorImages } from "./application/director-images.js";
import type { SelectedDirectorImage } from "./application/director-images.js";
import type { ProductionService } from "./application/service.js";
import type { DirectorSupervisor } from "./application/director-supervisor.js";
import type { LocalDirectorController, LocalDirectorSelection } from "./application/local-director.js";
import type { ArtifactRecord, PlanRecord, ReviewSnapshot } from "./execution/engine.js";
import { seedFixture } from "./demo.js";
import type { DemoCommand } from "./application/fake-director.js";
import { registerNarrationRoutes } from "./narration/routes.js";
import { registerMediaRoutes } from "./media/routes.js";
import { registerImageRoutes } from "./media/image-routes.js";
import { isPublicWebRequest, type WebAssets } from "./web-assets.js";
import { assertDemoProviderProfiles, InstalledProviderCatalog } from "./application/provider-catalog.js";
import { registerAllowanceRoutes } from "./application/allowance-routes.js";
import { InstallationRecoveryGuard } from "./application/installation-recovery.js";
import { RECOVERY_RELEASE_PATH, recoveryInspectionAllowed, registerRecoveryRoutes } from "./application/recovery-routes.js";

interface AppOptions { service?: ProductionService; localToken?: string; logger?: boolean;
  studioSessions?: StudioSessions;
  allowanceRoutes?: Parameters<typeof registerAllowanceRoutes>[1];
  providerCatalog?: InstalledProviderCatalog;
  webAssets?: WebAssets;
  director?: Pick<DirectorSupervisor, "status" | "enqueue" | "answerQuestion" | "tick">;
  runtimeSettings?: LocalDirectorController;
  narrationRoutes?: Parameters<typeof registerNarrationRoutes>[1];
  imageRoutes?: Parameters<typeof registerImageRoutes>[1];
  mediaRoutes?: Parameters<typeof registerMediaRoutes>[1] }
const string = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const actors = new WeakMap<object, ActorContext>();
  const recovery = options.service ? new InstallationRecoveryGuard(options.service.store) : undefined;
  const reviewCache = new Map<string, { cursor: number; snapshot: ReviewSnapshot }>();
  const service = () => { invariant(options.service, "SERVICE_UNAVAILABLE", "Application storage is not configured"); return options.service; };
  let defaultProviderCatalog: InstalledProviderCatalog | undefined;
  const providerCatalog = () => options.providerCatalog ?? (defaultProviderCatalog ??= new InstalledProviderCatalog({ registry: service().engine.registry }));
  const directorMode = (projectId: string) => options.director?.status(projectId).mode ?? "not_connected";
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      const status = ["EPOCH_REVOKED", "ACTOR_DENIED", "SCOPE_DENIED", "AUTH_REQUIRED", "ORIGIN_DENIED", "CSRF_DENIED", "STUDIO_LINK_EXPIRED"].includes(error.code) ? 403
        : error.code === "NOT_FOUND" ? 404 : error.code === "SERVICE_UNAVAILABLE" ? 503 : error.code === "VALIDATION_ERROR" ? 400 : 409;
      void reply.status(status).send({ error: { code: error.code, message: error.message } });
    } else if ((error as { validation?: unknown }).validation) void reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Request does not match its schema" } });
    else { app.log.error(error); void reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "The operation could not be completed" } }); }
  });
  app.addHook("preHandler", async (request, reply) => {
    const host = request.headers.host?.split(":")[0];
    invariant(host === "127.0.0.1" || host === "localhost", "ORIGIN_DENIED", "Use a loopback address");
    const origin = request.headers.origin;
    invariant(!origin || ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3001", "http://localhost:3001"].includes(origin), "ORIGIN_DENIED", "Origin is not permitted");
    const commandKey = request.headers["idempotency-key"];
    invariant(commandKey === undefined || (typeof commandKey === "string" && commandKey.length > 0 && commandKey.length <= 160), "VALIDATION_ERROR", "Use one bounded command identity");
    if (request.routeOptions.url === "/api/health" || isPublicWebRequest(request)) return;
    if (options.studioSessions && request.routeOptions.url === "/api/session" && request.method === "POST") {
      invariant(origin && request.headers["x-openslate-client"] === "studio", "ORIGIN_DENIED", "Pair from the local studio page");
      return;
    }
    const bearer = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,256})$/)?.[1];
    if (request.routeOptions.url?.startsWith("/internal/")) {
      invariant(bearer, "AUTH_REQUIRED", "A director bridge token is required");
      const projectId = (request.params as { projectId: string }).projectId;
      actors.set(request, service().actorForBridge(projectId, bearer));
    } else if (request.headers.authorization || request.routeOptions.url === "/api/studio/launch") {
      invariant(bearer && options.localToken && timingSafeEqual(Buffer.from(digest(bearer)), Buffer.from(digest(options.localToken))), "AUTH_REQUIRED", "Invalid local launcher credential");
    } else {
      invariant(options.studioSessions, "AUTH_REQUIRED", "Open studio from the local launcher");
      options.studioSessions.authorize(request);
      reply.header("Cache-Control", "no-store");
    }
    // Pairing/logout are independent of installation recovery and grant no execution authority.
    if (options.studioSessions && ["/api/session", "/api/session/logout", "/api/studio/launch"].includes(request.routeOptions.url ?? "")) return;
    // Authenticate first. The narrow release endpoint is independent of project/model authority;
    // all other writes (including raw upload handlers) stay closed during recovery review.
    if (recovery?.isQuarantined()) invariant(recoveryInspectionAllowed(request.method, request.routeOptions.url)
      || request.method === "POST" && request.routeOptions.url === RECOVERY_RELEASE_PATH,
    "INSTALLATION_QUARANTINED", "Review this restored installation before making changes");
  });
  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({ name: APP_NAME, status: "ok", stage: "foundation" }));
  options.webAssets?.register(app);
  if (options.studioSessions) registerStudioSessions(app, options.studioSessions);
  if (options.service) registerRecoveryRoutes(app, options.service);
  if (options.narrationRoutes) registerNarrationRoutes(app, options.narrationRoutes);
  if (options.mediaRoutes) registerMediaRoutes(app, options.mediaRoutes);
  if (options.imageRoutes) registerImageRoutes(app, options.imageRoutes);
  if (options.allowanceRoutes) {
    invariant(options.allowanceRoutes.service === options.service, "ALLOWANCE_CONFIGURATION_INVALID", "Spending routes must use this application's service");
    registerAllowanceRoutes(app, options.allowanceRoutes);
  }
  app.get("/api/projects", async () => ({ projects: service().store.listProjects().map(project => ({ id: project.id, name: project.name, headVersion: project.headVersion, activePlanId: project.activePlanId, shotCount: project.shots.length })) }));
  app.get("/api/providers", async () => providerCatalog().view());
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/providers", async request => {
    const project = service().store.getProject(request.params.projectId);
    const lock = service().store.get<{ projectId: string; profiles: unknown; providerSelection?: unknown; localExecution?: unknown }>("capability_lock", project.capabilityLockId);
    invariant(lock?.projectId === project.id, "PROVIDER_CATALOG_INVALID", "The project provider lock is unavailable");
    return providerCatalog().projectView(lock.profiles, lock.providerSelection, lock.localExecution);
  });
  const modelSettings = () => new ProjectModelSettings(service(), providerCatalog());
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/settings/models", async request => modelSettings().status(request.params.projectId));
  app.post<{ Params: { projectId: string }; Body: ProjectModelPreviewInput }>("/api/projects/:projectId/settings/models/preview", {
    schema: { body: object({ expectedHeadVersion: { type: "integer", minimum: 0 }, expectedSelectionDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      expectedCatalogDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, profileIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: string },
      scope: { oneOf: [object({ kind: { const: "unfinished" } }, ["kind"]), object({ kind: { const: "shots" }, shotIds: { type: "array", minItems: 1, maxItems: 400, uniqueItems: true, items: string } }, ["kind", "shotIds"])] } },
      ["expectedHeadVersion", "expectedSelectionDigest", "expectedCatalogDigest", "profileIds", "scope"]) },
  }, async (request, reply) => {
    const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
    request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
    try { return await modelSettings().preview(request.params.projectId, request.body, { signal: abort.signal }); }
    finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
  });
  app.post<{ Params: { projectId: string }; Body: { previewId: string; previewDigest: string } }>("/api/projects/:projectId/settings/models/apply", {
    schema: { body: object({ previewId: string, previewDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["previewId", "previewDigest"]) },
  }, async (request, reply) => {
    const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
    request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
    try { return await modelSettings().apply(request.params.projectId, { ...request.body, key: request.headers["idempotency-key"] as string | undefined ?? newId() }, { signal: abort.signal }); }
    finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
  });
  app.post<{ Body: { name: string; expectedCatalogDigest?: string; profileIds?: string[] } }>("/api/projects", {
    schema: { body: { ...object({ name: string, expectedCatalogDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      profileIds: { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: string } }, ["name"]),
      dependencies: { expectedCatalogDigest: ["profileIds"], profileIds: ["expectedCatalogDigest"] } } },
  }, async request => service().store.command("local-user:create-project", request.headers["idempotency-key"] as string | undefined ?? newId(), digest(request.body), () => {
    // Resolve only for a new command: a replay must not adopt or reject a later installation catalog.
    const selection = request.body.profileIds ? providerCatalog().select(request.body.expectedCatalogDigest!, request.body.profileIds) : undefined;
    return service().createProject(request.body.name, selection);
  }));
  registerGenerationPermission(app, service, options.director);
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async request => service().snapshot(request.params.projectId));
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director", async request => {
    service().store.getProject(request.params.projectId);
    return options.director?.status(request.params.projectId) ?? { mode: "offline", status: "not_connected", activeRequestId: null };
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director/setup", async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.settings(request.params.projectId);
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director/tools", async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director settings are not available in this server");
    return options.runtimeSettings.tools(request.params.projectId);
  });
  app.post<{ Params: { projectId: string }; Body: { expectedLockId: string; expectedLockDigest: string; targetVersion: "2.0.0" | "3.0.0" } }>("/api/projects/:projectId/director/tools/upgrade", {
    schema: { body: object({ expectedLockId: string, expectedLockDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, targetVersion: { enum: ["2.0.0", "3.0.0"] } }, ["expectedLockId", "expectedLockDigest", "targetVersion"]) },
  }, async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director settings are not available in this server");
    return options.runtimeSettings.upgradeTools(request.params.projectId, request.body, request.headers["idempotency-key"] as string | undefined ?? newId());
  });
  app.post<{ Params: { projectId: string }; Body: LocalDirectorSelection }>("/api/projects/:projectId/director/setup", {
    schema: { body: object({ mode: { enum: ["fake", "native"] }, binaryPath: { type: "string", maxLength: 4096 }, model: { type: "string", maxLength: 120 }, codexHome: { type: "string", maxLength: 4096 } }, ["mode"]) },
  }, async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.configure(request.params.projectId, request.body, request.headers["idempotency-key"] as string | undefined ?? newId());
  });
  app.post<{ Params: { projectId: string }; Body: { expectedSelectionDigest: string; selection: LocalDirectorSelection } }>("/api/projects/:projectId/director/change", {
    schema: { body: object({ expectedSelectionDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, selection: object({ mode: { enum: ["fake", "native"] }, binaryPath: { type: "string", maxLength: 4096 }, model: { type: "string", maxLength: 120 }, codexHome: { type: "string", maxLength: 4096 } }, ["mode"]) }, ["expectedSelectionDigest", "selection"]) },
  }, async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.changeSelection(request.params.projectId, request.body, request.headers["idempotency-key"] as string | undefined ?? newId());
  });
  app.post<{ Params: { projectId: string }; Body: { text: string; scopeIds?: string[]; editing?: boolean; continuationRequestId?: string; resumeFromStopId?: string; replyToReviewId?: string; replyToQuestionId?: string; images?: SelectedDirectorImage[] } }>("/api/projects/:projectId/messages", {
    schema: { body: object({ text: { type: "string", minLength: 1, maxLength: 16000 }, scopeIds: { type: "array", minItems: 1, maxItems: 400, items: string }, editing: { type: "boolean" }, continuationRequestId: string, resumeFromStopId: string, replyToReviewId: string, replyToQuestionId: string,
      images: { type: "array", minItems: 1, maxItems: 4, items: object({ artifactId: { type: "string", minLength: 1, maxLength: 160 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["artifactId", "sha256"]) } }, ["text"]) },
  }, async request => {
    invariant(!request.body.resumeFromStopId || (!request.body.replyToQuestionId && !request.body.replyToReviewId), "VALIDATION_ERROR", "Continue stopped work with a fresh conversation message");
    const images = request.body.images ? selectedDirectorImages(request.body.images) : undefined;
    invariant(!images || (options.director && options.runtimeSettings && directorMode(request.params.projectId) === "native" && !request.body.replyToQuestionId && !request.body.replyToReviewId), "DIRECTOR_IMAGES_UNAVAILABLE", "Attach references to a new native conversation request");
    if (request.body.replyToQuestionId) {
      invariant(options.director && !request.body.replyToReviewId && !request.body.scopeIds && !request.body.continuationRequestId && request.body.editing === undefined, "VALIDATION_ERROR", "Reply to one pending question using its original scope");
      const actor = options.director.answerQuestion(request.params.projectId, "local-user", request.body.replyToQuestionId, request.body.text, request.headers["idempotency-key"] as string | undefined ?? newId());
      options.director.tick(); return { requestId: actor.requestId, status: "queued", director: directorMode(request.params.projectId) };
    }
    const actor = service().store.transaction(() => {
      const actor = service().beginRequest(request.params.projectId, "local-user", request.body.text,
        { ...request.body, contextDigest: imageMessageContext(images, request.body.replyToReviewId), editing: request.body.replyToReviewId ? false : request.body.editing ?? true, key: request.headers["idempotency-key"] as string | undefined ?? newId() });
      if (images) options.runtimeSettings!.recordImages(request.params.projectId, actor, images);
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
      const before = service().store.getProject(projectId);
      const lock = service().store.get<{ projectId: string; profiles: unknown }>("capability_lock", before.capabilityLockId);
      invariant(lock?.projectId === projectId, "DEMO_PROVIDER_MISMATCH", "The project provider lock is unavailable");
      assertDemoProviderProfiles(lock.profiles);
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
    const activePlan = service().store.get<PlanRecord>("plan", project.activePlanId);
    invariant(activePlan?.projectId === projectId, "PLAN_REQUIRED", "The current plan is unavailable");
    // Planning may stop at images before a video/review recipe exists. Keep the
    // workspace readable without fabricating an approval snapshot or authority.
    if (!activePlan.compiled.gates.length) return { id: null, projectId, planId: activePlan.id, members: [], headVersion: project.headVersion, revisionId: project.revisionId };
    let snapshot: ReviewSnapshot | (Omit<ReviewSnapshot, "id"> & { id: null });
    if (recovery?.isQuarantined()) snapshot = { ...service().engine.inspectReview(projectId), id: null };
    else {
      const cursor = service().store.cursor(projectId);
      let cached = reviewCache.get(projectId);
      if (!cached || cached.cursor !== cursor) {
        cached = { cursor, snapshot: service().engine.reviewSnapshot(projectId) }; reviewCache.set(projectId, cached);
      }
      snapshot = cached.snapshot;
    }
    const plan = service().store.get<PlanRecord>("plan", snapshot.planId)!;
    const approvals = service().store.list<{ videoNodeId: string; approvalDigest: string }>("approval", projectId);
    return { ...snapshot, headVersion: project.headVersion, revisionId: project.revisionId, members: snapshot.members.map(member => {
      const node = plan.compiled.nodes.find(node => node.id === member.videoNodeId)!;
      return { ...member, keyframeFixture: member.keyframe ? service().artifactFixture(projectId, member.keyframe) : null,
        approved: approvals.some(approval => approval.videoNodeId === member.videoNodeId && approval.approvalDigest === member.approvalDigest), motionPrompt: node.args.prompt, durationFrames: node.args.durationFrames, profileLabel: node.profileId };
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
  app.post<{ Params: { projectId: string }; Body: { action: "pause" | "resume" | "stop" } }>("/api/projects/:projectId/controls", {
    schema: { body: object({ action: { enum: ["pause", "resume", "stop"] } }, ["action"]) },
  }, async request => {
    const key = request.headers["idempotency-key"] as string | undefined ?? newId();
    const result = service().store.command(`local-user:${request.params.projectId}:control`, key, digest(request.body), () => {
      const actor = service().beginRequest(request.params.projectId, "local-user", request.body.action === "stop" ? "Stop the current conversation and new generation." : request.body.action, { editing: false, key: `control:${key}` });
      return service().control(request.params.projectId, actor, request.body.action);
    });
    options.director?.tick(); return result;
  });
  if (options.service) registerProjectEventStream(app, { store: options.service.store,
    authorize: request => { if (!request.headers.authorization) options.studioSessions?.authorize(request); } });
  app.post<{ Params: { projectId: string; tool: string }; Body: Record<string, unknown> }>("/internal/projects/:projectId/tools/:tool", async (request, reply) => {
    const actor = actors.get(request)!;
    const { projectId, tool } = request.params;
    const callId = request.headers["x-openslate-tool-call-id"];
    invariant(typeof callId === "string", "VALIDATION_ERROR", "One tool call identity is required");
    const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
    request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
    const ports = options.narrationRoutes;
    try { return await new ToolInvocationService(service(), {
      ...(ports?.ownedTranscription ? { ownedTranscription: ports.ownedTranscription } : {}),
      ...(ports?.narrationSpeech ? { narrationSpeech: ports.narrationSpeech } : {}),
    }).invoke(projectId, actor, callId, tool, request.body, { signal: abort.signal }); }
    finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
  });
  return app;
}
