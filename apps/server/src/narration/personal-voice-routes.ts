import type { FastifyInstance, FastifyRequest } from 'fastify';
import { digest, invariant } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import { PersonalVoiceService, projectPersonalVoices } from './personal-voices.js';

const id = { type: 'string', minLength: 1, maxLength: 160 }, hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const object = (properties: object, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const key = (request: FastifyRequest) => { const value = request.headers['idempotency-key']; invariant(typeof value === 'string' && value.length > 0 && value.length <= 160, 'VALIDATION_ERROR', 'A bounded Idempotency-Key is required'); return value; };
/** Identity setup inherits authentication and creates a bounded human request with no creative edit holds. */
export function registerPersonalVoiceRoutes(app: FastifyInstance, production: ProductionService) {
  const service = new PersonalVoiceService(production), base = '/api/projects/:projectId/narration/personal-voices';
  const params = object({ projectId: id }, ['projectId']);
  app.get<{ Params: { projectId: string } }>(base, { schema: { params, querystring: object({}) } }, async (request, reply) =>
    reply.header('Cache-Control', 'private, no-store').send({ headVersion: production.store.getProject(request.params.projectId).headVersion,
      voices: projectPersonalVoices(production.store, request.params.projectId),
      enrollment: { sampleUploadAvailable: false, existingVoiceRegistration: true, supportedSpeechProviders: ['openai'],
        notice: 'Register an existing voice created with your consent in an eligible provider account. Local registration does not verify account access or upload recordings.' } }));
  app.post<{ Params: { projectId: string }; Body: { expectedHeadVersion: number; label: string; provider: 'openai' | 'elevenlabs'; providerVoiceId: string; ownVoice: true; permitSynthesis: true } }>(base, {
    schema: { params, querystring: object({}), body: object({ expectedHeadVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      label: { type: 'string', minLength: 1, maxLength: 120 }, provider: { enum: ['openai', 'elevenlabs'] }, providerVoiceId: id,
      ownVoice: { const: true }, permitSynthesis: { const: true } }, ['expectedHeadVersion', 'label', 'provider', 'providerVoiceId', 'ownVoice', 'permitSynthesis']) },
  }, async (request, reply) => {
    const projectId = request.params.projectId, input = { ...request.body, key: key(request) };
    const voice = production.store.transaction(() => production.store.command(`local-user:${projectId}:personal-voice-register`, input.key, digest(input), () => {
      const actor = production.beginRequest(projectId, 'local-user', 'Register my own existing provider voice with explicit synthesis consent.',
        { editing: false, key: `voice-register:${input.key}`, scopeIds: [projectId], contextDigest: digest(input) });
      return service.register(projectId, actor, input);
    }));
    return reply.header('Cache-Control', 'private, no-store').send({ voice });
  });
  app.post<{ Params: { projectId: string; identityId: string } }>(`${base}/:identityId/revoke`, {
    schema: { params: object({ projectId: id, identityId: hash }, ['projectId', 'identityId']), querystring: object({}), body: object({}) },
  }, async (request, reply) => {
    const projectId = request.params.projectId, input = { key: key(request), identityId: request.params.identityId };
    const revocation = production.store.transaction(() => production.store.command(`local-user:${projectId}:personal-voice-revoke`, input.key, digest(input), () => {
      const actor = production.beginRequest(projectId, 'local-user', 'Revoke this personal voice for new speech generation.',
        { editing: false, key: `voice-revoke:${input.key}`, scopeIds: [projectId], contextDigest: digest(input) });
      return service.revoke(projectId, actor, input);
    }));
    return reply.header('Cache-Control', 'private, no-store').send({ revocation });
  });
}
