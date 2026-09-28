import type { FastifyInstance } from 'fastify';
import { digest, invariant, newId } from '@openslate/core';
import type { ProjectRecord } from '@openslate/core';
import type { ProductionService } from './application/service.js';
import type { DirectorSupervisor } from './application/director-supervisor.js';

export function registerPlanImports(app: FastifyInstance, service: () => ProductionService, director?: Pick<DirectorSupervisor, 'status' | 'enqueue' | 'tick'>) {
  const base = '/api/projects/:projectId/plan-imports';
  app.post<{ Params: { projectId: string }; Body: { name: string; text: string; expectedHeadVersion: number } }>(base, {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'text', 'expectedHeadVersion'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 160 }, text: { type: 'string', minLength: 1, maxLength: 12000 }, expectedHeadVersion: { type: 'integer', minimum: 0 },
    } } },
  }, async request => {
    const s = service(), id = request.params.projectId, input = request.body, key = request.headers['idempotency-key'] as string | undefined ?? newId();
    invariant(director?.status(id).mode === 'native', 'DIRECTOR_REQUIRED', 'Choose and connect Codex in Project settings to interpret a brief or scene breakdown.');
    invariant(input.text.trim() && !input.text.includes('\0') && /\.(txt|md)$/i.test(input.name), 'VALIDATION_ERROR', 'Use a non-empty UTF-8 .txt or .md document, up to 12,000 characters.');
    const result = s.store.command(`local-user:${id}:plan-import`, key, digest(input), () => {
      s.recovery.assertWritable(id);
      invariant(s.store.getProject(id).headVersion === input.expectedHeadVersion, 'REVISION_CONFLICT', 'The film plan changed before import. Refresh and try again.');
      invariant(!s.store.get<{ paused: boolean }>('execution_control', id)?.paused, 'IMPORT_STALE', 'Send a fresh direction to continue stopped work before importing.');
      invariant(!s.store.list<{ state: string }>('plan_import', id).some(row => row.state === 'pending'), 'IMPORT_PENDING', 'Confirm or discard the current import before adding another.');
      const actor = s.beginRequest(id, 'local-user', `Interpret this supplied document as a proposed film plan. Preserve my material; show optional suggestions separately. Wait for my confirmation before applying anything.\n\nDocument: ${input.name}\n\n${input.text}`, { editing: true, key: `plan-import:${key}`, contextDigest: digest(input) });
      s.store.insert('plan_import', actor.requestId, id, { id: actor.requestId, projectId: id, ...input, sourceDigest: digest({ name: input.name, text: input.text }), state: 'pending' });
      s.store.appendEvent(id, 'plan_import.created', { requestId: actor.requestId });
      director!.enqueue(id, actor);
      return { requestId: actor.requestId };
    });
    director!.tick(); return result;
  });
  app.get<{ Params: { projectId: string } }>(base, async request => {
    const s = service(), id = request.params.projectId, project = s.store.getProject(id);
    const material = s.store.list<{ id: string; name: string; text: string; sourceDigest: string; state: string }>('plan_import', id).filter(row => row.state === 'pending').at(-1);
    if (!material) return { pending: null };
    const prepared = s.store.list<{ id: string; requestId: string; proposalDigest: string; baseVersion: number; next: ProjectRecord; compiled: unknown; proposal: { source?: string } }>('prepared', id).filter(row => row.requestId === material.id && !row.compiled && !row.proposal.source).at(-1);
    const latest = s.store.list<{ id: string; editing: boolean }>('message', id).filter(row => row.editing).at(-1);
    const stale = s.recovery.isImported(id, 'message', material.id) || latest?.id !== material.id || !!s.store.get<{ paused: boolean }>('execution_control', id)?.paused || !!prepared && prepared.baseVersion !== project.headVersion;
    const running = s.store.list<{ requestId: string; state: string }>('director_turn', id).some(turn => turn.requestId === material.id && ['queued', 'running'].includes(turn.state));
    return { pending: { id: material.id, name: material.name, text: material.text, sourceDigest: material.sourceDigest, stale, running,
      draft: prepared ? { preparedId: prepared.id, proposalDigest: prepared.proposalDigest, project: prepared.next } : null } };
  });
  app.post<{ Params: { projectId: string; requestId: string }; Body: { preparedId: string; proposalDigest: string } }>(`${base}/:requestId/confirm`, {
    schema: { body: { type: 'object', additionalProperties: false, required: ['preparedId', 'proposalDigest'], properties: { preparedId: { type: 'string', minLength: 1, maxLength: 160 }, proposalDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } },
  }, async request => service().confirmPlanImport(request.params.projectId, request.params.requestId, request.body.preparedId, request.body.proposalDigest, request.headers['idempotency-key'] as string | undefined ?? newId()));
  app.post<{ Params: { projectId: string; requestId: string }; Body: Record<string, never> }>(`${base}/:requestId/discard`, { schema: { body: { type: 'object', additionalProperties: false, properties: {} } } }, async request => {
    const s = service(), { projectId, requestId } = request.params;
    s.recovery.assertWritable(projectId);
    return s.store.command(`local-user:${projectId}:discard-plan-import`, request.headers['idempotency-key'] as string | undefined ?? newId(), digest({ requestId }), () => {
      const material = s.store.get<{ projectId: string; state: string }>('plan_import', requestId);
      invariant(material?.projectId === projectId && material.state === 'pending', 'IMPORT_STALE', 'This import is no longer pending.');
      // Discard only removes authority; a restored draft may be dismissed after release.
      const source = s.store.get<Record<string, unknown>>('message', requestId)!;
      s.store.put('message', requestId, projectId, { ...source, state: 'superseded' });
      for (const hold of s.store.list<{ id: string; ownerId: string; active: boolean }>('hold', projectId).filter(row => row.ownerId === requestId && row.active)) s.engine.releaseHold(projectId, hold.id, requestId);
      for (const epoch of s.store.list<{ id: string; requestId: string }>('epoch', projectId).filter(row => row.requestId === requestId)) s.store.put('epoch', epoch.id, projectId, { ...epoch, state: 'revoked' });
      s.store.put('plan_import', requestId, projectId, { ...material, state: 'discarded' });
      s.store.appendEvent(projectId, 'plan_import.discarded', { requestId });
      return { discarded: true };
    });
  });
}
