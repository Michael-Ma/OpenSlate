import { digest, invariant } from '@openslate/core';
import type { ProductionService, RequestRecord } from './service.js';
import type { DirectorTurn } from './director-supervisor.js';
import type { ActorContext } from '@openslate/core';
import type { Attempt, NodeBinding } from '../execution/engine.js';
import type { FastifyInstance } from 'fastify';
import { requiredCommandKey } from './command-key.js';

export interface KeyframeBatch { requestId: string; sceneId: string; kind: string; shotIds: string[]; imageNodes?: { nodeId: string; candidateId: string | null }[] }
export const isKeyframeReview = (service: ProductionService, requestId?: string) => !!requestId && !!service.store.get('keyframe_review_request', requestId);
export const directorReviewEnabled = (service: ProductionService, projectId: string) => service.store.get<{ enabled: boolean }>('director_review_setting', projectId)?.enabled ?? true;
/** Terminal means no further automatic work remains. Unknown submissions deliberately wait. */
export function keyframeBatchTerminal(batch: KeyframeBatch, bindings: NodeBinding[], attempts: Attempt[], maxRetries: (binding: NodeBinding) => number): boolean {
  return !!batch.imageNodes?.length && batch.imageNodes.every(pin => {
    const binding = bindings.find(b => b.id === pin.nodeId && b.candidateId === pin.candidateId && b.state === 'active');
    if (!binding) return false;
    if (Object.keys(binding.outputs).length) return true;
    const last = attempts.filter(a => a.nodeId === pin.nodeId && a.candidateId === pin.candidateId).sort((a, b) => b.ordinal - a.ordinal)[0];
    return last?.phase === 'failed' && (!last.failure?.technical || !last.failure.retryAllowed || last.ordinal > maxRetries(binding));
  });
}
export function reviewEligible(input: { enabled: boolean; paused: boolean; busy: boolean; terminal: boolean; reviewed: boolean }): boolean {
  return input.enabled && !input.paused && !input.busy && input.terminal && !input.reviewed;
}
/** Called on each executor/controller tick; request + dedup marker + queued turn commit atomically. */
export function triggerKeyframeReviews(service: ProductionService, enqueue: (projectId: string, actor: ActorContext) => unknown): void {
  if (service.recovery.isQuarantined()) return;
  const store = service.store;
  for (const project of store.listProjects()) store.transaction(() => {
    const enabled = directorReviewEnabled(service, project.id), paused = store.get<{ paused: boolean }>('execution_control', project.id)?.paused ?? false;
    const busy = store.list<DirectorTurn>('director_turn', project.id).some(t => ['queued', 'running'].includes(t.state) && store.get<RequestRecord>('message', t.requestId)?.state === 'active');
    const pending = store.list<{ requestId: string; state: string }>('director_question', project.id).some(q => q.state === 'pending' && store.get<RequestRecord>('message', q.requestId)?.state === 'active');
    if (!enabled || paused || busy || pending) return;
    const bindings = store.list<NodeBinding>('node_binding', project.id).filter(b => b.planId === project.activePlanId), attempts = service.engine.attempts(project.id);
    const profiles = store.get<{ profiles: import('@openslate/core').ProviderProfile[] }>('capability_lock', project.capabilityLockId)?.profiles ?? [];
    for (const batch of store.list<KeyframeBatch>('scene_generation_action', project.id).filter(b => b.kind === 'image')) {
      // Older presses did not freeze candidate identities. Never infer a new model call from them.
      if (!batch.imageNodes?.length || service.recovery.isImported(project.id, 'message', batch.requestId)) continue;
      const key = digest({ requestId: batch.requestId, sceneId: batch.sceneId, imageNodes: batch.imageNodes });
      if (!reviewEligible({ enabled, paused, busy, terminal: keyframeBatchTerminal(batch, bindings, attempts, b => profiles.find(p => p.id === b.node.profileId)?.maxRetries ?? 0), reviewed: !!store.get('keyframe_review_batch', key) })) continue;
      if (!batch.shotIds.every(id => project.shots.some(s => s.id === id && s.sceneId === batch.sceneId))) continue;
      const actor = service.beginRequest(project.id, 'local-user', 'Review the newly returned keyframe batch. Read context, record honest notes and propose changes only. Do not edit the film or start generation.', { source: 'app', editing: false, scopeIds: project.shots.filter(s => s.sceneId === batch.sceneId).map(s => s.id), key: `keyframe-review:${key}` });
      store.insert('keyframe_review_request', actor.requestId, project.id, { requestId: actor.requestId, action: 'keyframe_review', batchDigest: key, sceneId: batch.sceneId });
      store.insert('keyframe_review_batch', key, project.id, { id: key, requestId: actor.requestId });
      enqueue(project.id, actor);
      store.appendEvent(project.id, 'director.keyframe_review', { requestId: actor.requestId, sceneId: batch.sceneId, batchDigest: key });
      break;
    }
  });
}
export function registerDirectorReviewSetting(app: FastifyInstance, getService: () => ProductionService): void {
  const path = '/api/projects/:projectId/settings/director-review';
  app.get<{ Params: { projectId: string } }>(path, async request => { const service = getService(); service.store.getProject(request.params.projectId); return { enabled: directorReviewEnabled(service, request.params.projectId) }; });
  app.post<{ Params: { projectId: string }; Body: { enabled: boolean; expectedHeadVersion: number } }>(path, {
    schema: { body: { type: 'object', additionalProperties: false, required: ['enabled', 'expectedHeadVersion'], properties: { enabled: { type: 'boolean' }, expectedHeadVersion: { type: 'integer', minimum: 0 } } } },
  }, async request => {
    const service = getService(), projectId = request.params.projectId, key = requiredCommandKey(request);
    service.recovery.assertWritable(projectId);
    return service.store.command(`local-user:${projectId}:director-review-setting`, key, digest(request.body), () => {
      invariant(service.store.getProject(projectId).headVersion === request.body.expectedHeadVersion, 'REVISION_CONFLICT', 'Project changed; refresh before saving');
      service.store.put('director_review_setting', projectId, projectId, { enabled: request.body.enabled });
      service.store.appendEvent(projectId, 'director.review_setting', { enabled: request.body.enabled });
      return { enabled: request.body.enabled };
    });
  });
}
