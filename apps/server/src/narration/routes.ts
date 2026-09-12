import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ActorContext } from "@openslate/core";
import { digest, invariant, newId } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "./service.js";
import type { NarrationCanonicalService } from "./canonical.js";
import type { NarrationShotMapping } from "./canonical-types.js";
import type { NarrationAudio, ReviseSegments } from "./types.js";
import { ManagedUploadStore } from "./managed-upload.js";

interface Session { id: string; projectId: string; requestId: string; principalId: "local-user" }
interface Params { projectId: string }
const id = { type: "string", minLength: 1, maxLength: 160 };
const version = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const samples = { type: "integer", minimum: 0, maximum: 48000 * 360 };
const object = (properties: object, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const array = (items: object, minItems = 1) => ({ type: "array", items, minItems, maxItems: 400 });
const source = { oneOf: [object({ kind: { const: "undecided" } }, ["kind"]), object({ kind: { const: "uploaded" } }, ["kind"]),
  object({ kind: { const: "generated" }, voice: { anyOf: [id, { type: "null" }] }, profileRevisionId: { anyOf: [id, { type: "null" }] } }, ["kind", "voice", "profileRevisionId"])] };
const draft = object({ text: { type: "string", maxLength: 16000 }, textKind: { enum: ["notes", "outline", "draft"] }, language: { type: "string", minLength: 1, maxLength: 64 }, meaning: { type: "string", maxLength: 4000 }, source }, ["text", "textKind", "language", "meaning", "source"]);
const edit = (properties: object, required: string[]) => object({ sessionId: id, expectedVersion: version, ...properties }, ["sessionId", "expectedVersion", ...required]);
const key = (request: FastifyRequest): string => { const value = request.headers["idempotency-key"]; invariant(typeof value === "string" && value.length > 0 && value.length <= 160, "VALIDATION_ERROR", "A bounded Idempotency-Key is required"); return value; };

/** Register only under the application's inherited authenticated local HTTP boundary. */
export function registerNarrationRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; canonical: NarrationCanonicalService; uploadDirectory: string }): void {
  const { production, narration, canonical } = options, store = production.store;
  const uploads = new ManagedUploadStore({ rootDir: options.uploadDirectory });
  const actorFor = (projectId: string, sessionId: string): ActorContext => {
    const session = store.get<Session>("narration_session", sessionId);
    invariant(session?.projectId === projectId && session.principalId === "local-user", "NARRATION_SESSION_STALE", "Open or explicitly continue this project's narration session");
    const actor: ActorContext = { kind: "human", principalId: "local-user", requestId: session.requestId };
    try { production.assertActor(projectId, actor, true); } catch { invariant(false, "NARRATION_SESSION_STALE", "Narration session was superseded; explicitly continue it before editing"); }
    const request = store.get<{ scopeIds: string[] }>("message", actor.requestId);
    invariant(request?.scopeIds.includes(projectId), "NARRATION_SESSION_STALE", "Narration session no longer has project scope"); return actor;
  };
  const selectedSession = (projectId: string) => {
    const head = store.get<{ sessionId: string }>("narration_session_head", projectId), session = head ? store.get<Session>("narration_session", head.sessionId) : undefined;
    if (!session) return null;
    let state: "active" | "stale" = "active"; try { actorFor(projectId, session.id); } catch { state = "stale"; }
    return { ...session, state };
  };
  const view = (projectId: string, audioOffset = 0) => store.transaction(() => {
    const project = store.getProject(projectId);
    const recordings = store.list<NarrationAudio>("narration_audio", projectId).reverse();
    invariant(audioOffset <= recordings.length, "VALIDATION_ERROR", "Recording library offset is beyond its current size");
    const audioLibrary = recordings.slice(audioOffset, audioOffset + 400).map(({ id, declaredOrigin, media }) => ({ id, declaredOrigin, media }));
    return { audioLibrary, coverage: { audioLibrary: { offset: audioOffset, returned: audioLibrary.length, total: recordings.length, nextOffset: audioOffset + audioLibrary.length < recordings.length ? audioOffset + audioLibrary.length : null } }, headVersion: project.headVersion, revisionId: project.revisionId, snapshot: narration.workspaceSnapshot(projectId), canonical: canonical.workspaceCurrent(projectId), session: selectedSession(projectId) };
  });

  app.register(async scoped => {
    const base = "/api/projects/:projectId/narration";
    // Authentication inherited from createApp runs before a handler consumes this stream.
    scoped.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
    scoped.get<{ Params: Params; Querystring: { audioOffset?: string } }>(base, { schema: { querystring: object({ audioOffset: { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" } }, []) } }, async request => view(request.params.projectId, Number(request.query.audioOffset ?? 0)));
    scoped.get<{ Params: Params & { audioId: string } }>(`${base}/audio/:audioId/content`, async (request, reply) => {
      const recording = store.get<NarrationAudio>("narration_audio", request.params.audioId);
      invariant(recording?.projectId === request.params.projectId, "NOT_FOUND", "Recording does not belong to this project");
      const verified = await narration.media.verifiedSource(recording.media);
      invariant(verified.source.kind === "audio", "MEDIA_INTEGRITY_ERROR", "Recording is not normalized audio");
      const file = await open(verified.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat(); invariant(stat.isFile() && stat.size <= 80 * 1024 * 1024, "ARTIFACT_TOO_LARGE", "Recording preview exceeds its limit");
        const bytes = await file.readFile(); invariant(bytes.length === stat.size && createHash("sha256").update(bytes).digest("hex") === recording.media.sha256, "ARTIFACT_CORRUPT", "Recording bytes changed");
        return reply.header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, no-store").header("X-Content-SHA256", recording.media.sha256).type("audio/wav").send(bytes);
      } finally { await file.close(); }
    });
    scoped.post<{ Params: Params; Body: { text?: string; continuationSessionId?: string } }>(`${base}/sessions`, {
      schema: { body: object({ text: { type: "string", minLength: 1, maxLength: 4000 }, continuationSessionId: id }, []) },
    }, async request => {
      const { projectId } = request.params;
      const session = store.command(`local-user:${projectId}:narration-session`, key(request), digest(request.body), () => {
        const old = selectedSession(projectId);
        invariant(!old || request.body.continuationSessionId === old.id, "NARRATION_SESSION_EXISTS", "Continue the displayed narration session explicitly");
        const previous = request.body.continuationSessionId ? store.get<Session>("narration_session", request.body.continuationSessionId) : undefined;
        invariant(!request.body.continuationSessionId || previous?.projectId === projectId && previous.principalId === "local-user", "NARRATION_SESSION_STALE", "Previous narration session is unavailable");
        const actor = production.beginRequest(projectId, "local-user", request.body.text ?? "Edit narration and review its recording and timing", {
          scopeIds: [projectId], editing: true, key: `narration:${digest(key(request))}`,
          ...(previous ? { continuationRequestId: previous.requestId } : {}),
        });
        const session: Session = { id: newId(), projectId, requestId: actor.requestId, principalId: "local-user" };
        store.insert("narration_session", session.id, projectId, session); store.put("narration_session_head", projectId, projectId, { sessionId: session.id }); return session;
      });
      return { ...view(projectId), session: { ...session, state: (() => { try { actorFor(projectId, session.id); return "active"; } catch { return "stale"; } })() } };
    });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; patch: ReviseSegments } }>(`${base}/segments`, {
      schema: { body: edit({ patch: object({ add: array(draft), update: array(object({ segmentId: id, draft }, ["segmentId", "draft"])), remove: array(id), order: array(id, 0) }, []) }, ["patch"]) },
    }, async request => { const b = request.body; return narration.reviseSegments(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), b.patch); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; segmentId: string; audioId: string } }>(`${base}/bindings`, {
      schema: { body: edit({ segmentId: id, audioId: id }, ["segmentId", "audioId"]) },
    }, async request => { const b = request.body; return narration.bindAudio(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), b.segmentId, b.audioId); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; segmentId: string; startSample: number; endSample: number } }>(`${base}/cues`, {
      schema: { body: edit({ segmentId: id, startSample: samples, endSample: samples }, ["segmentId", "startSample", "endSample"]) },
    }, async request => { const b = request.body; return narration.recordHumanCue(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), { segmentId: b.segmentId, startSample: b.startSample, endSample: b.endSample }); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; placements: Array<{ segmentId: string; atSample: number }> } }>(`${base}/placements`, {
      schema: { body: edit({ placements: array(object({ segmentId: id, atSample: samples }, ["segmentId", "atSample"])) }, ["placements"]) },
    }, async request => { const b = request.body; return narration.placeSegments(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), b.placements); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; kind: "script" | "timing"; targets: string[] } }>(`${base}/acceptances`, {
      schema: { body: edit({ kind: { enum: ["script", "timing"] }, targets: { ...array(id), uniqueItems: true } }, ["kind", "targets"]) },
    }, async request => { const b = request.body; return narration.accept(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), b.kind, b.targets); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedVersion: number; targets: Array<{ segmentRevisionId: string; audioId: string }> } }>(`${base}/audio-acceptances`, {
      schema: { body: edit({ targets: array(object({ segmentRevisionId: id, audioId: id }, ["segmentRevisionId", "audioId"])) }, ["targets"]) },
    }, async request => { const b = request.body; return narration.acceptAudio(request.params.projectId, actorFor(request.params.projectId, b.sessionId), b.expectedVersion, key(request), b.targets); });
    scoped.post<{ Params: Params; Body: { sessionId: string; expectedHeadVersion: number; expectedNarrationVersion: number; shotMappings: NarrationShotMapping[] } }>(`${base}/prepare`, {
      schema: { body: object({ sessionId: id, expectedHeadVersion: version, expectedNarrationVersion: version, shotMappings: array(object({ shotId: id, segmentId: { anyOf: [id, { type: "null" }] } }, ["shotId", "segmentId"]), 0) }, ["sessionId", "expectedHeadVersion", "expectedNarrationVersion", "shotMappings"]) },
    }, async request => { const { sessionId, ...input } = request.body; return canonical.prepare(request.params.projectId, actorFor(request.params.projectId, sessionId), { ...input, key: key(request) }); });
    scoped.post<{ Params: Params; Body: { sessionId: string; preparedId: string } }>(`${base}/apply`, {
      schema: { body: object({ sessionId: id, preparedId: id }, ["sessionId", "preparedId"]) },
    }, async request => { const { projectId } = request.params, actor = actorFor(projectId, request.body.sessionId);
      store.command(`local-user:${projectId}:${request.body.sessionId}:narration-http-apply`, key(request), digest(request.body), () => ({ preparedId: request.body.preparedId }));
      return canonical.apply(projectId, actor, request.body.preparedId); });
    scoped.post<{ Params: Params; Querystring: { sessionId: string; declaredOrigin: "uploaded" | "generated" }; Body: AsyncIterable<Uint8Array> }>(`${base}/audio`, {
      bodyLimit: uploads.maxBytes,
      schema: { querystring: object({ sessionId: id, declaredOrigin: { enum: ["uploaded", "generated"] } }, ["sessionId", "declaredOrigin"]) },
    }, async request => {
      invariant(request.headers["content-type"]?.split(";")[0] === "application/octet-stream", "VALIDATION_ERROR", "Upload recording bytes as application/octet-stream");
      const { projectId } = request.params, { sessionId, declaredOrigin } = request.query, commandKey = key(request), actor = actorFor(projectId, sessionId);
      const identity = digest({ projectId, sessionId, commandKey });
      const upload = await uploads.receive(request.body, identity, () => { actorFor(projectId, sessionId); });
      try {
        const result = await narration.importAudio(projectId, actor, { path: upload.path, declaredOrigin, key: `http:${identity}` });
        actorFor(projectId, sessionId); invariant(result.media.originalSha256 === upload.sha256, "UPLOAD_CORRUPT", "Imported recording differs from uploaded bytes"); return result;
      } finally { await upload.release(); }
    });
  });
}
