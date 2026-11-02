import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { invariant } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationService } from './service.js';
import type { NarrationSpeechService } from './narration-speech-service.js';
import type { PrepareNarrationSpeech } from './narration-speech-types.js';
import { summarizeNarrationSpeechProposal } from './narration-speech-projection.js';
import { registerPersonalVoiceRoutes } from './personal-voice-routes.js';
import { audioRequestActor } from './audio-request-session.js';
const id = { type: 'string', minLength: 1, maxLength: 160 };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const key = (request: FastifyRequest): string => { const value = request.headers['idempotency-key']; invariant(typeof value === 'string' && value.length > 0 && value.length <= 160, 'VALIDATION_ERROR', 'One bounded Idempotency-Key is required'); return value; };
async function connected<T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController(), disconnected = () => { if (!reply.raw.writableFinished) abort.abort(); };
  request.raw.on('aborted', disconnected); reply.raw.on('close', disconnected);
  try { return await work(abort.signal); } finally { request.raw.off('aborted', disconnected); reply.raw.off('close', disconnected); }
}
/** Standalone saved-section speech request, also usable outside scene confirmation. */
export function registerNarrationSpeechRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; narrationSpeech?: NarrationSpeechService;
  actorFor(projectId: string, sessionId: string): ActorContext }): void {
  const { production, narration, narrationSpeech, actorFor } = options;
  invariant(narration.production === production && (!narrationSpeech || narrationSpeech.narration === narration),
    'NARRATION_SPEECH_CONFIGURATION_INVALID', 'Speech routes must share this application narration service');
  registerPersonalVoiceRoutes(app, production);
  const service = () => { invariant(narrationSpeech, 'NARRATION_SPEECH_UNAVAILABLE', 'Speech planning is unavailable in this installation'); return narrationSpeech; };
  const base = '/api/projects/:projectId/narration', params = object({ projectId: id }, ['projectId']);
  app.post<{ Params: { projectId: string }; Body: Omit<PrepareNarrationSpeech, 'key'> & { sessionId?: string } }>(`${base}/speech`, {
    schema: { params, querystring: object({}), body: object({ sessionId: id, expectedHeadVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      segmentId: id, segmentRevisionId: id, profileId: id, voice: id, instructions: { type: 'string', maxLength: 256 } },
    ['expectedHeadVersion', 'segmentId', 'segmentRevisionId', 'profileId', 'voice', 'instructions']) },
  }, async (request, reply) => {
    const { sessionId, ...input } = request.body, projectId = request.params.projectId, commandKey = key(request);
    const actor = audioRequestActor(production, projectId, commandKey, sessionId, actorFor, 'Generate narration from the selected saved script.');
    const result = await connected(request, reply, signal => service().request(projectId, actor, { ...input, key: commandKey }, { signal }));
    return reply.header('Cache-Control', 'private, no-store').send({ proposal: summarizeNarrationSpeechProposal(production.store, projectId, result.proposal.id), receipt: result.receipt });
  });
}
