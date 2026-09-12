import type { FastifyInstance, FastifyRequest } from "fastify";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { ManagedUpload, ManagedUploadStore } from "../narration/managed-upload.js";
import { ImageApplicationService, PNG_IMPORT_MAX_BYTES } from "./image-application.js";
import type { SuppliedImageArtifact } from "./image-application.js";

interface ImageRouteOptions { production: ProductionService; images: ImageApplicationService | null; uploads: ManagedUploadStore }
const text = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
function commandKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Use one bounded image upload command identity"); return key;
}
async function readUpload(upload: ManagedUpload): Promise<Buffer> {
  invariant(upload.byteLength > 0 && upload.byteLength <= PNG_IMPORT_MAX_BYTES, "UPLOAD_TOO_LARGE", "PNG references must be at most 32 MiB");
  const handle = await open(upload.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(); invariant(info.isFile() && info.size === upload.byteLength, "UPLOAD_CORRUPT", "Staged image changed before validation");
    const bytes = Buffer.alloc(upload.byteLength + 1); let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    invariant(length === upload.byteLength, "UPLOAD_CORRUPT", "Staged image size changed during validation"); return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

/** Public API paths remain below createApp's authenticated local-session hook. */
export function registerImageRoutes(app: FastifyInstance, options: ImageRouteOptions): void {
  invariant(options.uploads.maxBytes <= PNG_IMPORT_MAX_BYTES, "IMAGE_CONFIGURATION_INVALID", "Image uploads require a limit of at most 32 MiB");
  app.register(async scope => {
    const { production, images, uploads } = options;
    scope.addContentTypeParser("application/octet-stream", (_request, payload, done) => { done(null, payload); });
    scope.get<{ Params: { projectId: string }; Querystring: { offset?: string } }>("/api/projects/:projectId/images", {
      schema: { querystring: object({ offset: { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" } }) },
    }, async request => {
      const project = production.store.getProject(request.params.projectId), offset = Number(request.query.offset ?? 0);
      const ids = new Set(project.artifacts.filter(artifact => artifact.kind === "image").map(artifact => artifact.artifactId));
      const owned = production.store.list<SuppliedImageArtifact>("artifact", project.id).filter(record => record.origin === "supplied_image" && !record.fixture && ids.has(record.id)).reverse();
      const selected = owned.slice(offset, offset + 40);
      return { headVersion: project.headVersion, revisionId: project.revisionId,
        capabilities: { import: images !== null, format: "image/png", maxBytes: uploads.maxBytes, unavailableReason: images ? null : "Local FFmpeg and ffprobe are required to validate PNG references." },
        images: selected.map(record => ({ artifact: record.artifact, mimeType: record.mimeType, width: record.width, height: record.height, byteLength: record.byteLength, fixture: false, origin: record.origin })),
        coverage: { offset, returned: selected.length, total: owned.length, nextOffset: offset + selected.length < owned.length ? offset + selected.length : null } };
    });
    scope.post<{ Params: { projectId: string }; Querystring: { expectedHeadVersion: string; requestId?: string; continuationRequestId?: string }; Body: AsyncIterable<Uint8Array> }>("/api/projects/:projectId/images/uploads", {
      bodyLimit: uploads.maxBytes,
      schema: { querystring: object({ expectedHeadVersion: { type: "string", pattern: "^(0|[1-9][0-9]{0,14})$" }, requestId: text, continuationRequestId: text }, ["expectedHeadVersion"]) },
    }, async (request, reply) => {
      invariant(images, "SERVICE_UNAVAILABLE", "PNG reference import requires local FFmpeg and ffprobe");
      invariant(request.headers["content-type"]?.split(";")[0] === "application/octet-stream", "VALIDATION_ERROR", "Upload PNG bytes as application/octet-stream");
      const projectId = request.params.projectId, key = commandKey(request), expectedHeadVersion = Number(request.query.expectedHeadVersion);
      invariant(!(request.query.requestId && request.query.continuationRequestId), "VALIDATION_ERROR", "Choose an existing request or an explicit continuation");
      const actor: ActorContext = request.query.requestId ? { kind: "human", principalId: "local-user", requestId: request.query.requestId }
        : production.beginRequest(projectId, "local-user", "Import a supplied PNG reference", { key: `image-upload:${key}`, editing: true,
          ...(request.query.continuationRequestId ? { continuationRequestId: request.query.continuationRequestId } : {}), contextDigest: digest({ expectedHeadVersion }) });
      const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
      const assertCurrent = () => {
        invariant(!abort.signal.aborted, "MEDIA_CANCELLED", "PNG reference upload cancelled");
        production.assertActor(projectId, actor, true);
        invariant(production.store.get<{ scopeIds: string[] }>("message", actor.requestId)?.scopeIds.includes(projectId), "SCOPE_DENIED", "Reference import requires project scope");
      };
      request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
      try {
        assertCurrent();
        const uploaded = await uploads.receive(request.body, digest({ kind: "png-reference", projectId, principalId: "local-user", key }), assertCurrent);
        try {
          const bytes = await readUpload(uploaded); assertCurrent();
          return { ...await images.importImage(projectId, actor, { bytes, sha256: uploaded.sha256, expectedHeadVersion, key }, { signal: abort.signal }), requestId: actor.requestId };
        } finally { await uploaded.release(); }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const status = ["ACTOR_DENIED", "SCOPE_DENIED", "EPOCH_REVOKED"].includes(error.code) ? 403 : error.code === "VALIDATION_ERROR" ? 400 : 409;
        const message = error.code === "UPLOAD_TOO_LARGE" ? `PNG reference exceeds the ${uploads.maxBytes} byte upload limit`
          : error.code === "VALIDATION_ERROR" ? "Choose a nonempty PNG reference and a valid upload request" : error.message;
        return reply.code(status).send({ error: { code: error.code, message }, requestId: actor.requestId });
      } finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
    });
  });
}
