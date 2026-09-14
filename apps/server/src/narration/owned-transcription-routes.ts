import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "./service.js";
import type { OwnedTranscriptionService } from "./owned-transcription-service.js";
import type { PrepareOwnedTranscription, ReviewOwnedTranscription } from "./owned-transcription-types.js";
import { projectOwnedTranscriptionOptions, projectOwnedTranscriptionProposal, projectOwnedTranscriptionProposals,
  summarizeOwnedTranscriptionProposal } from "./owned-transcription-projection.js";

const id = { type: "string", minLength: 1, maxLength: 160 };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const object = (properties: object, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const target = { oneOf: [object({ kind: { const: "recording" } }, ["kind"]),
  object({ kind: { const: "section" }, segmentId: id, segmentRevisionId: id, audioId: id }, ["kind", "segmentId", "segmentRevisionId", "audioId"])] };
const key = (request: FastifyRequest): string => {
  const value = request.headers["idempotency-key"];
  invariant(typeof value === "string" && value.length > 0 && value.length <= 160, "VALIDATION_ERROR", "A bounded Idempotency-Key is required"); return value;
};
async function connected<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
  request.raw.on("aborted", disconnected); reply.raw.on("close", disconnected);
  try { return await work(abort.signal); }
  finally { request.raw.off("aborted", disconnected); reply.raw.off("close", disconnected); }
}

/** Human HTTP only; this registration never changes a director's locked tool catalog. */
export function registerOwnedTranscriptionRoutes(app: FastifyInstance, options: {
  production: ProductionService; narration: NarrationService; ownedTranscription: OwnedTranscriptionService | undefined;
  actorFor(projectId: string, sessionId: string): ActorContext;
}): void {
  const { production, narration, ownedTranscription, actorFor } = options;
  invariant(!ownedTranscription || ownedTranscription.narration === narration && narration.production === production,
    "OWNED_TRANSCRIPTION_CONFIGURATION_INVALID", "Recording routes must share this application's narration service");
  const service = (): OwnedTranscriptionService => {
    invariant(ownedTranscription && narration.mediaAvailable, "NARRATION_MEDIA_UNAVAILABLE", "Recording transcription requires configured local audio tools");
    return ownedTranscription;
  };
  const base = "/api/projects/:projectId/narration", params = object({ projectId: id }, ["projectId"]);
  app.get<{ Params: { projectId: string } }>(`${base}/transcription-options`, {
    schema: { params, querystring: object({}) },
  }, async (request, reply) => reply.header("Cache-Control", "private, no-store").send({
    ...projectOwnedTranscriptionOptions(production, request.params.projectId),
    capabilities: { implemented: true, configured: !!ownedTranscription, audioTools: narration.mediaAvailable,
      providerReadiness: "check_project_provider_settings", directorToolAvailable: false },
  }));
  app.get<{ Params: { projectId: string }; Querystring: { offset?: string; expectedDigest?: string } }>(`${base}/transcription-proposals`, {
    schema: { params, querystring: object({ offset: { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" }, expectedDigest: hash }) },
  }, async (request, reply) => reply.header("Cache-Control", "private, no-store").send(projectOwnedTranscriptionProposals(production.store,
    request.params.projectId, Number(request.query.offset ?? 0), request.query.expectedDigest)));
  app.get<{ Params: { projectId: string; proposalId: string } }>(`${base}/transcription-proposals/:proposalId`, {
    schema: { params: object({ projectId: id, proposalId: id }, ["projectId", "proposalId"]), querystring: object({}) },
  }, async (request, reply) => reply.header("Cache-Control", "private, no-store").send(projectOwnedTranscriptionProposal(production.store,
    request.params.projectId, request.params.proposalId)));
  app.post<{ Params: { projectId: string }; Body: Omit<PrepareOwnedTranscription, "key"> & { sessionId: string } }>(`${base}/transcription-proposals`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id,
      expectedHeadVersion: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, audioId: id,
      sourceRecordDigest: hash, profileId: id, language: { type: "string", minLength: 1, maxLength: 64 }, target },
    ["sessionId", "expectedHeadVersion", "audioId", "sourceRecordDigest", "profileId", "language", "target"]) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, actor = actorFor(request.params.projectId, sessionId), commandKey = key(request), owned = service();
    const proposal = await connected(request, reply, signal => owned.prepare(request.params.projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header("Cache-Control", "private, no-store").send({ proposal: summarizeOwnedTranscriptionProposal(production.store, request.params.projectId, proposal.id) });
  });
  app.post<{ Params: { projectId: string }; Body: Omit<ReviewOwnedTranscription, "key"> & { sessionId: string } }>(`${base}/transcription-reviews`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id, proposalId: id, proposalDigest: hash }, ["sessionId", "proposalId", "proposalDigest"]) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, actor = actorFor(request.params.projectId, sessionId), commandKey = key(request), owned = service();
    const receipt = await connected(request, reply, signal => owned.review(request.params.projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header("Cache-Control", "private, no-store").send({ receipt });
  });
}
