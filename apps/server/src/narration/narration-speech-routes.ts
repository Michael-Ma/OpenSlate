import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { invariant } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationService } from './service.js';
import type { NarrationSpeechService } from './narration-speech-service.js';
import type { PrepareNarrationSpeech, ReviewNarrationSpeech } from './narration-speech-types.js';
import { projectNarrationSpeechOptions, projectNarrationSpeechProposals, projectNarrationSpeechProposal, summarizeNarrationSpeechProposal } from './narration-speech-projection.js';
const id = { type: 'string', minLength: 1, maxLength: 160 }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const key = (request: FastifyRequest): string => { const value = request.headers['idempotency-key']; invariant(typeof value === 'string' && value.length > 0 && value.length <= 160, 'VALIDATION_ERROR', 'One bounded Idempotency-Key is required'); return value; };
async function connected<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
  request.raw.on('aborted', disconnected); reply.raw.on('close', disconnected);
  try { return await work(abort.signal); } finally { request.raw.off('aborted', disconnected); reply.raw.off('close', disconnected); }
}
export function registerNarrationSpeechRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; narrationSpeech?: NarrationSpeechService;
  actorFor(projectId: string, sessionId: string): ActorContext }): void {
  const { production, narration, narrationSpeech, actorFor } = options;
  invariant(narration.production === production && (!narrationSpeech || narrationSpeech.narration === narration),
    'NARRATION_SPEECH_CONFIGURATION_INVALID', 'Speech routes must share this application narration service');
  const service = () => { invariant(narrationSpeech, 'NARRATION_SPEECH_UNAVAILABLE', 'Speech planning is unavailable in this installation'); return narrationSpeech; };
  const base = '/api/projects/:projectId/narration', params = object({ projectId: id }, ['projectId']);
  app.get<{ Params: { projectId: string } }>(`${base}/speech-options`, { schema: { params, querystring: object({}) } }, async (request, reply) =>
    reply.header('Cache-Control', 'private, no-store').send({ ...projectNarrationSpeechOptions(production, request.params.projectId),
      capabilities: { configured: !!narrationSpeech, providerReadiness: 'check_project_provider_settings' } }));
  app.get<{ Params: { projectId: string }; Querystring: { offset?: string; expectedDigest?: string } }>(`${base}/speech-proposals`, {
    schema: { params, querystring: object({ offset: { type: 'string', pattern: '^(0|[1-9][0-9]{0,6})$' }, expectedDigest: hash }) },
  }, async (request, reply) => reply.header('Cache-Control', 'private, no-store').send(projectNarrationSpeechProposals(production.store, request.params.projectId, Number(request.query.offset ?? 0), request.query.expectedDigest)));
  app.get<{ Params: { projectId: string; proposalId: string } }>(`${base}/speech-proposals/:proposalId`, {
    schema: { params: object({ projectId: id, proposalId: id }, ['projectId', 'proposalId']), querystring: object({}) },
  }, async (request, reply) => reply.header('Cache-Control', 'private, no-store').send(projectNarrationSpeechProposal(production.store, request.params.projectId, request.params.proposalId)));
  app.post<{ Params: { projectId: string }; Body: Omit<PrepareNarrationSpeech, 'key'> & { sessionId: string } }>(`${base}/speech-proposals`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id, expectedHeadVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      segmentId: id, segmentRevisionId: id, profileId: id, voice: id, instructions: { type: 'string', maxLength: 256 } },
    ['sessionId', 'expectedHeadVersion', 'segmentId', 'segmentRevisionId', 'profileId', 'voice', 'instructions']) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, actor = actorFor(request.params.projectId, sessionId), selected = service(), commandKey = key(request);
    const proposal = await connected(request, reply, signal => selected.prepare(request.params.projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header('Cache-Control', 'private, no-store').send({ proposal: summarizeNarrationSpeechProposal(production.store, request.params.projectId, proposal.id) });
  });
  app.post<{ Params: { projectId: string }; Body: Omit<ReviewNarrationSpeech, 'key'> & { sessionId: string } }>(`${base}/speech-reviews`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id, proposalId: id, proposalDigest: hash }, ['sessionId', 'proposalId', 'proposalDigest']) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, actor = actorFor(request.params.projectId, sessionId), selected = service(), commandKey = key(request);
    const receipt = await connected(request, reply, signal => selected.review(request.params.projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header('Cache-Control', 'private, no-store').send({ receipt });
  });
}
