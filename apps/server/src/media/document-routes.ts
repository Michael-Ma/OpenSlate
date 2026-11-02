import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { ManagedUpload, ManagedUploadStore } from "../narration/managed-upload.js";
import { DOCUMENT_IMPORT_MAX_BYTES, DocumentApplicationService } from "./document-application.js";

interface DocumentRouteOptions { production: ProductionService; documents: DocumentApplicationService; uploads: ManagedUploadStore }
const text = { type: "string", minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
function commandKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Use one bounded document upload command identity"); return key;
}
async function readUpload(upload: ManagedUpload): Promise<Buffer> {
  invariant(upload.byteLength > 0 && upload.byteLength <= DOCUMENT_IMPORT_MAX_BYTES, "UPLOAD_TOO_LARGE", "Documents must be at most 32 MiB");
  const handle = await open(upload.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat(); invariant(info.isFile() && info.size === upload.byteLength, "UPLOAD_CORRUPT", "Staged document changed before validation");
    const bytes = Buffer.alloc(upload.byteLength + 1); let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    invariant(length === upload.byteLength, "UPLOAD_CORRUPT", "Staged document changed during validation"); return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

/** Mounted beneath the same authenticated local-session boundary as image uploads. */
export function registerDocumentRoutes(app: FastifyInstance, options: DocumentRouteOptions): void {
  invariant(options.uploads.maxBytes <= DOCUMENT_IMPORT_MAX_BYTES, "DOCUMENT_CONFIGURATION_INVALID", "Document uploads require a limit of at most 32 MiB");
  app.register(async scope => {
    const { production, documents, uploads } = options;
    scope.addContentTypeParser("application/octet-stream", (_request, payload, done) => { done(null, payload); });
    scope.post<{ Params: { projectId: string }; Querystring: { expectedHeadVersion: string; name: string; requestId?: string; continuationRequestId?: string }; Body: AsyncIterable<Uint8Array> }>("/api/projects/:projectId/documents/uploads", {
      bodyLimit: uploads.maxBytes,
      schema: { querystring: object({ expectedHeadVersion: { type: "string", pattern: "^(0|[1-9][0-9]{0,14})$" }, name: { type: "string", minLength: 1, maxLength: 200 }, requestId: text, continuationRequestId: text }, ["expectedHeadVersion", "name"]) },
    }, async (request, reply) => {
      invariant(request.headers["content-type"]?.split(";")[0] === "application/octet-stream", "VALIDATION_ERROR", "Upload document bytes as application/octet-stream");
      const { projectId } = request.params, key = commandKey(request), expectedHeadVersion = Number(request.query.expectedHeadVersion), name = request.query.name;
      invariant(!(request.query.requestId && request.query.continuationRequestId), "VALIDATION_ERROR", "Choose an existing request or an explicit continuation");
      const actor: ActorContext = request.query.requestId ? { kind: "human", principalId: "local-user", requestId: request.query.requestId }
        : production.beginRequest(projectId, "local-user", "Import a supplied document", { source: "app", key: `document-upload:${key}`, editing: true,
          ...(request.query.continuationRequestId ? { continuationRequestId: request.query.continuationRequestId } : {}), contextDigest: digest({ expectedHeadVersion, name }) });
      const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
      const assertCurrent = () => {
        invariant(!abort.signal.aborted, "MEDIA_CANCELLED", "Document upload cancelled"); production.assertActor(projectId, actor, true);
        invariant(production.store.get<{ scopeIds: string[] }>("message", actor.requestId)?.scopeIds.includes(projectId), "SCOPE_DENIED", "Document import requires project scope");
      };
      request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
      try {
        assertCurrent();
        const uploaded = await uploads.receive(request.body, digest({ kind: "document", projectId, principalId: "local-user", key }), assertCurrent);
        try {
          const bytes = await readUpload(uploaded); assertCurrent();
          return { ...await documents.importDocument(projectId, actor, { bytes, sha256: uploaded.sha256, expectedHeadVersion, key, name }, { signal: abort.signal }), requestId: actor.requestId };
        } finally { await uploaded.release(); }
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        const status = ["ACTOR_DENIED", "SCOPE_DENIED", "EPOCH_REVOKED"].includes(error.code) ? 403 : error.code === "VALIDATION_ERROR" ? 400 : error.code === "DOCUMENT_EXTRACTOR_UNAVAILABLE" ? 503 : 409;
        const message = error.code === "UPLOAD_TOO_LARGE" ? `Document exceeds the ${uploads.maxBytes} byte upload limit` : error.message;
        return reply.code(status).send({ error: { code: error.code, message }, requestId: actor.requestId });
      } finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
    });
  });
}
