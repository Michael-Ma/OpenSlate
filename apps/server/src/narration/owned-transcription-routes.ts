import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "./service.js";
import type { OwnedTranscriptionService } from "./owned-transcription-service.js";
import type { PrepareOwnedTranscription } from "./owned-transcription-types.js";
import { summarizeOwnedTranscriptionProposal } from "./owned-transcription-projection.js";
import { audioRequestActor } from './audio-request-session.js';

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

/** Standalone owned-recording transcription has no equivalent in the scene confirmation runner. */
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
  app.post<{ Params: { projectId: string }; Body: Omit<PrepareOwnedTranscription, 'key'> & { sessionId?: string } }>(`${base}/transcriptions`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id,
      expectedHeadVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, audioId: id,
      sourceRecordDigest: hash, profileId: id, language: { type: 'string', minLength: 1, maxLength: 64 }, target },
    ['expectedHeadVersion', 'audioId', 'sourceRecordDigest', 'profileId', 'language', 'target']) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, projectId = request.params.projectId, commandKey = key(request);
    const actor = audioRequestActor(production, projectId, commandKey, sessionId, actorFor, 'Transcribe the selected owned recording.');
    const result = await connected(request, reply, signal => service().request(projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header('Cache-Control', 'private, no-store').send({ proposal: summarizeOwnedTranscriptionProposal(production.store, projectId, result.proposal.id), receipt: result.receipt });
  });
}
