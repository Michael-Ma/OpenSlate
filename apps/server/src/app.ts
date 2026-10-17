import { registerDirectorReviewSetting } from "./application/keyframe-review.js";
import { CODEX_PROTOCOL_VERSION } from "@openslate/director";
import { safeNativeDiagnostic } from "./application/native-diagnostics.js";
import { toolVersion } from "./installation-status.js";
import { registerDirectorProposals } from "./application/director-proposals.js";
import { registerShotTakes } from "./shot-takes.js";
import { registerDirectorNotes } from "./application/director-notes.js";
import { SceneConfirmationRunner, registerSceneConfirmations } from "./scene-confirmations.js";
import { registerNarrationFit } from "./narration-fit.js";
import { requiredCommandKey } from "./application/command-key.js";
import { registerGenerationOverview } from "./generation-overview.js";
import { registerSceneGeneration } from './scene-generation.js';
import { continueEditsSchema, type ContinueEdits } from './application/pending-edit-continuation.js';
import { registerStoryboard } from "./storyboard.js";
import { registerPlanImports } from "./plan-imports.js";
import { registerProjectLibrary } from "./project-library.js";
import { registerAssetLibrary } from "./asset-library.js";
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
import type { ControlInput, InstallationStatus, ReleaseAttemptInput } from "@openslate/core/public";
import { ToolInvocationService } from "./application/tool-invocations.js";
import { imageMessageContext, selectedDirectorImages } from "./application/director-images.js";
import type { SelectedDirectorImage } from "./application/director-images.js";
import type { ProductionService } from "./application/service.js";
import type { DirectorSupervisor } from "./application/director-supervisor.js";
import type { LocalDirectorController, LocalDirectorSelection } from "./application/local-director.js";
import type { ArtifactRecord, PlanRecord } from "./execution/engine.js";
import { seedFixture } from "./demo.js";
import type { DemoCommand } from "./application/fake-director.js";
import { registerNarrationRoutes } from "./narration/routes.js";
import { registerStockVoices } from "./narration/shot-recording-routes.js";
import { registerMediaRoutes } from "./media/routes.js";
import { registerImageRoutes } from "./media/image-routes.js";
import { isPublicWebRequest, type WebAssets } from "./web-assets.js";
import { assertDemoProviderProfiles, InstalledProviderCatalog } from "./application/provider-catalog.js";
import { InstallationRecoveryGuard } from "./application/installation-recovery.js";
import { RECOVERY_RELEASE_PATH, recoveryInspectionAllowed, registerRecoveryRoutes } from "./application/recovery-routes.js";

interface AppOptions { sceneCommands?: SceneConfirmationRunner; service?: ProductionService; localToken?: string; logger?: boolean;
  /** Host-selected tools, also available when the complete media service could not be installed. */
  mediaToolPaths?: { ffmpeg: string | null; ffprobe: string | null };
  /** Browser origins allowed to call the API. Defaults to the dev server and the installed studio. */
  allowedOrigins?: readonly string[];
  studioSessions?: StudioSessions;
  providerCatalog?: InstalledProviderCatalog;
  webAssets?: WebAssets;
  director?: Pick<DirectorSupervisor, "status" | "enqueue" | "answerQuestion" | "tick">;
  runtimeSettings?: LocalDirectorController;
  narrationRoutes?: Parameters<typeof registerNarrationRoutes>[1];
  imageRoutes?: Parameters<typeof registerImageRoutes>[1];
  mediaRoutes?: Parameters<typeof registerMediaRoutes>[1] }
const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:3001", "http://localhost:3001"];
const string = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });

export function createApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 3 * 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const actors = new WeakMap<object, ActorContext>();
  const recovery = options.service ? new InstallationRecoveryGuard(options.service.store) : undefined;
  const service = () => { invariant(options.service, "SERVICE_UNAVAILABLE", "Application storage is not configured"); return options.service; };
  let defaultProviderCatalog: InstalledProviderCatalog | undefined;
  const providerCatalog = () => options.providerCatalog ?? (defaultProviderCatalog ??= new InstalledProviderCatalog({ registry: service().engine.registry }));
  const directorMode = (projectId: string) => options.director?.status(projectId).mode ?? "not_connected";
  registerStockVoices(app, service);
  registerDirectorNotes(app, service);
  registerDirectorProposals(app, service);
  const sceneCommands = options.sceneCommands ?? (options.service ? new SceneConfirmationRunner(options.service, options.narrationRoutes) : undefined);
  registerSceneGeneration(app, service, options.narrationRoutes?.narration, sceneCommands?.enqueueKeyframes);
  if (sceneCommands) { registerSceneConfirmations(app, sceneCommands); registerNarrationFit(app, sceneCommands); }
  registerGenerationOverview(app, service, options.narrationRoutes?.narration);
  app.post<{ Params: { projectId: string; requestId: string } }>("/api/projects/:projectId/requests/:requestId/release-holds", async request => {
    const key = requiredCommandKey(request);
    invariant(request.body === undefined, "VALIDATION_ERROR", "Releasing edit holds takes no body");
    return service().releaseRequestHolds(request.params.projectId, request.params.requestId, key);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      const status = ["EPOCH_REVOKED", "ACTOR_DENIED", "SCOPE_DENIED", "AUTH_REQUIRED", "ORIGIN_DENIED", "CSRF_DENIED", "STUDIO_LINK_EXPIRED"].includes(error.code) ? 403
        : error.code === "NOT_FOUND" ? 404 : error.code === "SERVICE_UNAVAILABLE" ? 503 : ["VALIDATION_ERROR", "IDEMPOTENCY_KEY_REQUIRED"].includes(error.code) ? 400 : 409;
      const nativeDiagnostic = error.code === "DIRECTOR_SETUP_REQUIRED"
        ? safeNativeDiagnostic((error.details as { nativeDiagnostic?: unknown } | undefined)?.nativeDiagnostic) : undefined;
      void reply.status(status).send({ error: { code: error.code, message: error.message,
        ...(nativeDiagnostic ? { details: { nativeDiagnostic } } : ["SHOT_SHORTER_THAN_NARRATION", "DIRECTION_REQUIRED", "EXPORT_BLOCKED", "DIRECTOR_CODEX_VERSION_MISMATCH"].includes(error.code) && error.details !== undefined ? { details: error.details } : {}) } });
    } else if ((error as { validation?: unknown }).validation) void reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Request does not match its schema" } });
    else { app.log.error(error); void reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "The operation could not be completed" } }); }
  });
  app.addHook("preHandler", async (request, reply) => {
    const host = request.headers.host?.split(":")[0];
    invariant(host === "127.0.0.1" || host === "localhost", "ORIGIN_DENIED", "Use a loopback address");
    const origin = request.headers.origin;
    invariant(!origin || allowedOrigins.includes(origin), "ORIGIN_DENIED", "Origin is not permitted");
    const requiresCommandKey = request.method === "POST" && ["/api/projects/:projectId/controls", "/api/projects/:projectId/scenes/:sceneId/generate", "/api/projects/:projectId/scenes/:sceneId/confirm", "/api/projects/:projectId/shots/:shotId/narration-fit"].includes(request.routeOptions.url ?? "");
    const commandKey = request.headers["idempotency-key"];
    invariant(requiresCommandKey || commandKey === undefined || (typeof commandKey === "string" && commandKey.length > 0 && commandKey.length <= 160), "VALIDATION_ERROR", "Use one bounded command identity");
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
    if (requiresCommandKey) requiredCommandKey(request);
    // Pairing/logout are independent of installation recovery and grant no execution authority.
    if (options.studioSessions && ["/api/session", "/api/session/logout", "/api/studio/launch"].includes(request.routeOptions.url ?? "")) return;
    // Authenticate first. The narrow release endpoint is independent of project/model authority;
    // all other writes (including raw upload handlers) stay closed during recovery review.
    if (recovery?.isQuarantined()) invariant(recoveryInspectionAllowed(request.method, request.routeOptions.url)
      || request.method === "POST" && request.routeOptions.url === RECOVERY_RELEASE_PATH,
    "INSTALLATION_QUARANTINED", "Review this restored installation before making changes");
  });
  registerPlanImports(app, service, options.director);
  registerStoryboard(app, service);
  registerShotTakes(app, service);
  app.get<{ Reply: HealthResponse }>("/api/health", async () => ({ name: APP_NAME, status: "ok", stage: "foundation" }));
  options.webAssets?.register(app);
  if (options.studioSessions) registerStudioSessions(app, options.studioSessions, () => {
    const storageId = options.service?.engine.outputStore?.storageId;
    if (!storageId) return undefined;
    // This public cache partition follows the persistent installation output identity,
    // including a new generation after same-root recovery, without exposing a credential or path.
    return digest({ storageId, restoreId: options.service!.store.installationRecoveries().at(-1)?.receipt.restoreId ?? null });
  });
  if (options.service) registerRecoveryRoutes(app, options.service);
  if (options.narrationRoutes) registerNarrationRoutes(app, options.narrationRoutes);
  if (options.mediaRoutes) registerMediaRoutes(app, options.mediaRoutes);
  if (options.imageRoutes) registerImageRoutes(app, options.imageRoutes);
  registerProjectLibrary(app, service);
  app.get("/api/providers", async () => providerCatalog().view());
  app.get<{ Reply: InstallationStatus }>("/api/installation/status", async (_request, reply) => {
    const [codex, mediaTools] = await Promise.all([
      options.runtimeSettings?.codexStatus() ?? { found: false, version: null, pinnedVersion: CODEX_PROTOCOL_VERSION, signedIn: null },
      options.mediaRoutes ? options.mediaRoutes.media.media.toolStatus() : Promise.all([
        toolVersion(options.mediaToolPaths?.ffmpeg, "ffmpeg"), toolVersion(options.mediaToolPaths?.ffprobe, "ffprobe"),
      ]).then(([ffmpeg, ffprobe]) => ({ ffmpeg: { available: ffmpeg !== null, version: ffmpeg }, ffprobe: { available: ffprobe !== null, version: ffprobe } })),
    ]);
    const providersConfigured = providerCatalog().view().profiles.some(p => p.readiness.enabledByHost &&
      (p.readiness.credential.present === true || ("nativeAccess" in p.readiness && p.readiness.nativeAccess?.configured === true)));
    return reply.header("Cache-Control", "no-store").send({ codex, mediaTools, providersConfigured });
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
  registerAssetLibrary(app, service);
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId", async request => service().snapshot(request.params.projectId));
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director", async request => {
    service().store.getProject(request.params.projectId);
    return options.director?.status(request.params.projectId) ?? { mode: "offline", status: "not_connected", activeRequestId: null };
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director/setup", async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.inspectSettings(request.params.projectId);
  });
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/director/models", async request => {
    invariant(options.runtimeSettings, "SERVICE_UNAVAILABLE", "Local director setup is not available in this server");
    return options.runtimeSettings.models(request.params.projectId);
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
  registerDirectorReviewSetting(app, service);
  app.post<{ Params: { projectId: string }; Body: { text?: string; answers?: import("./application/director-supervisor.js").StructuredAnswer[]; scopeIds?: string[]; editing?: boolean; continueEdits?: ContinueEdits; continuationRequestId?: string; resumeFromStopId?: string; replyToReviewId?: string; replyToQuestionId?: string; images?: SelectedDirectorImage[] } }>("/api/projects/:projectId/messages", {
    schema: { body: object({ text: { type: "string", minLength: 1, maxLength: 16000 }, answers: { type: "array", minItems: 1, maxItems: 8, items: object({ questionId: string, optionIndex: { type: "integer", minimum: 0, maximum: 9 }, optionLabel: string, text: { type: "string", minLength: 1, maxLength: 16000 } }, ["questionId"]) }, scopeIds: { type: "array", minItems: 1, maxItems: 400, items: string }, editing: { type: "boolean" }, continueEdits: continueEditsSchema, continuationRequestId: string, resumeFromStopId: string, replyToReviewId: string, replyToQuestionId: string,
      images: { type: "array", minItems: 1, maxItems: 4, items: object({ artifactId: { type: "string", minLength: 1, maxLength: 160 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["artifactId", "sha256"]) } }, []) },
  }, async request => {
    const text = request.body.text ?? "";
    invariant(text.trim().length > 0 || request.body.answers?.length && request.body.replyToQuestionId, "VALIDATION_ERROR", "Write a message or answer a pending question");
    invariant(!request.body.resumeFromStopId || (!request.body.replyToQuestionId && !request.body.replyToReviewId), "VALIDATION_ERROR", "Continue stopped work with a fresh conversation message");
    invariant(!request.body.continueEdits || (!request.body.replyToQuestionId && !request.body.replyToReviewId && !request.body.resumeFromStopId && !request.body.continuationRequestId), "VALIDATION_ERROR", "Continue reviewed edits with one fresh covering message");
    invariant(!request.body.answers || request.body.replyToQuestionId, "VALIDATION_ERROR", "Structured answers require a pending question");
    const images = request.body.images ? selectedDirectorImages(request.body.images) : undefined;
    invariant(!images || (options.director && options.runtimeSettings && directorMode(request.params.projectId) === "native" && !request.body.replyToQuestionId && !request.body.replyToReviewId), "DIRECTOR_IMAGES_UNAVAILABLE", "Attach references to a new native conversation request");
    if (request.body.replyToQuestionId) {
      invariant(options.director && !request.body.replyToReviewId && !request.body.scopeIds && !request.body.continuationRequestId && request.body.editing === undefined, "VALIDATION_ERROR", "Reply to one pending question using its original scope");
      const actor = options.director.answerQuestion(request.params.projectId, "local-user", request.body.replyToQuestionId, request.body.answers ? { text, answers: request.body.answers } : text, request.headers["idempotency-key"] as string | undefined ?? newId());
      options.director.tick(); return { requestId: actor.requestId, status: "queued", director: directorMode(request.params.projectId) };
    }
    const actor = service().store.transaction(() => {
      const actor = service().beginRequest(request.params.projectId, "local-user", text,
        { ...request.body, contextDigest: imageMessageContext(images, request.body.replyToReviewId), editing: request.body.replyToReviewId ? false : request.body.editing ?? true, key: request.headers["idempotency-key"] as string | undefined ?? newId() });
      if (images) options.runtimeSettings!.recordImages(request.params.projectId, actor, images);
      if (!request.body.replyToReviewId) options.director?.enqueue(request.params.projectId, actor);
      return actor;
    });
    if (request.body.replyToReviewId) return service().replyToReview(request.params.projectId, actor, request.body.replyToReviewId, text);
    options.director?.tick();
    return { requestId: actor.requestId, status: options.director ? "queued" : "recorded", director: directorMode(request.params.projectId) };
  });
  app.post<{ Params: { projectId: string }; Body: DemoCommand }>("/api/projects/:projectId/demo", {
    schema: { body: object({ action: { enum: ["create", "close_up", "wide", "review"] }, shotId: string, sceneId: string }, ["action"]) },
  }, async request => {
    invariant(options.director && directorMode(request.params.projectId) === "fake", "ACTOR_DENIED", "The demo is available only with the offline fake director");
    const { projectId } = request.params;
    const key = request.headers["idempotency-key"] as string | undefined ?? newId();
    // Dedicated human demo command authorizes bounded fake slots. Ordinary chat never grants generation.
    const result = service().store.command(`local-user:${projectId}:demo`, key, digest(request.body), () => {
      const before = service().store.getProject(projectId);
      if (request.body.action === "review") {
        const scene = before.scenes.find(s => s.id === request.body.sceneId);
        invariant(scene, "SCOPE_DENIED", "Choose a scene in this demo project");
        const actor = service().beginRequest(projectId, "local-user", "Review this scene in the scripted demonstration.", { source: "app", editing: false, scopeIds: [scene.id], key: `demo:${key}` });
        service().store.insert("demo_command", actor.requestId, projectId, request.body);
        const turn = options.director!.enqueue(projectId, actor);
        return { requestId: actor.requestId, turnId: turn.id, status: "queued", director: "fake" };
      }
      const lock = service().store.get<{ projectId: string; profiles: unknown }>("capability_lock", before.capabilityLockId);
      invariant(lock?.projectId === projectId, "DEMO_PROVIDER_MISMATCH", "The project provider lock is unavailable");
      assertDemoProviderProfiles(lock.profiles);
      if (request.body.action === "create") seedFixture(service(), join(service().engine.artifactDir, projectId), projectId);
      const project = service().store.getProject(projectId);
      invariant(project.shots.length === 2 && project.brief === "A deliberately fake leather-boots commercial integration fixture", "DEMO_PROJECT_REQUIRED", "Use the dedicated two-shot fixture project");
      const shotIds = request.body.action === "create" ? project.shots.map(shot => shot.id) : [request.body.shotId];
      invariant(shotIds.every(id => id && project.shots.some(shot => shot.id === id)), "VALIDATION_ERROR", "Select a demo shot");
      const text = request.body.action === "create" ? "Create a 2-shot offline demo with sample media." : `Try ${request.body.action === "close_up" ? "a close-up" : "a wide view"} for the selected demo shot.`;
      const actor = service().beginRequest(projectId, "local-user", text, { source: "app", scopeIds: request.body.action === "create" ? [projectId] : shotIds as string[], key: `demo:${key}`, contextDigest: digest(request.body) });
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
    // Historical plan inspection grants no approval identity, in ordinary use or
    // during recovery. Durable approval snapshots belong to scene confirmation.
    const snapshot = { ...service().engine.inspectReview(projectId), id: null };
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
  app.post<{ Params: { projectId: string }; Body: ControlInput }>("/api/projects/:projectId/controls", {
    schema: { body: { oneOf: [object({ action: { const: "stop" } }, ["action"]),
      object({ action: { const: "resume" }, expectedAuthorityId: { anyOf: [string, { type: "null" }] } }, ["action", "expectedAuthorityId"])] } },
  }, async request => {
    const key = requiredCommandKey(request);
    // Continue changes control state only; it never drives a worker or Director tick.
    return service().store.command(`local-user:${request.params.projectId}:control`, key, digest(request.body), () => {
      const actor = service().beginRequest(request.params.projectId, "local-user", request.body.action === "stop" ? "Stop the current conversation and new generation." : request.body.action, { source: "app", editing: false, key: `control:${key}` });
      return service().control(request.params.projectId, actor, request.body.action, request.body.action === "resume" ? request.body.expectedAuthorityId : undefined);
    });
  });
  app.post<{ Params: { projectId: string; attemptId: string }; Body: ReleaseAttemptInput }>("/api/projects/:projectId/attempts/:attemptId/release", {
    schema: { body: object({ expectedPhase: { const: "submission_unknown" }, acknowledgeDoubleCharge: { type: "boolean" } }, ["expectedPhase"]) },
  }, async request => {
    const key = requiredCommandKey(request);
    return service().store.command(`local-user:${request.params.projectId}:release-attempt`, key, digest({ attemptId: request.params.attemptId, ...request.body }), () => {
      const actor = service().beginRequest(request.params.projectId, "local-user", "Release an unconfirmed submission; both jobs may be charged.", { source: "app", editing: false, key: `release-attempt:${key}` });
      return service().releaseAttempt(request.params.projectId, actor, request.params.attemptId, request.body);
    });
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
