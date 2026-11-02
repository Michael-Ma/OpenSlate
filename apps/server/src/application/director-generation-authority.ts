import { digest, invariant, toolCatalog, toolContractAtLeast, toolHandlerId } from '@openslate/core';
import type { ToolContractVersion } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { SkillCapabilityLock } from '@openslate/director';
import type { ProductionService, RequestRecord } from './service.js';
import { requestSource } from './request-source.js';

/** A conversation may spend only its own fresh human request's authority. */
export function assertDirectorGenerationAuthority(service: ProductionService, projectId: string, actor: ActorContext): Extract<ActorContext, { kind: 'human' }> {
  invariant(actor.kind === 'director', 'ORIGIN_NOT_AUTHORIZED', 'Paid Director work requires an editing conversation epoch');
  service.assertActor(projectId, actor);
  const store = service.store, request = store.get<RequestRecord>('message', actor.requestId);
  invariant(request?.projectId === projectId && request.principalId === actor.principalId && request.state === 'active'
    && request.editing === true && requestSource(store, request) === 'user'
    && !store.get('keyframe_review_request', actor.requestId)
    && !store.list<{ answerRequestId?: string; requestId: string }>('director_question', projectId)
      .some(question => question.answerRequestId === actor.requestId && !!store.get('keyframe_review_request', question.requestId)),
  'ORIGIN_NOT_AUTHORIZED', 'Only a fresh human editing conversation may start this work');
  service.assertActor(projectId, actor, true);
  const binding = store.get<{ projectId: string; requestId: string; lockId: string }>('director_epoch_lock', actor.epochId);
  const record = binding ? store.get<{ projectId: string; lock: SkillCapabilityLock }>('director_skill_lock', binding.lockId) : undefined;
  invariant(binding?.projectId === projectId && binding.requestId === actor.requestId && record?.projectId === projectId
    && record.lock.id === binding.lockId && toolContractAtLeast(record.lock.compatibility.toolContract, '6.0.0'),
  'ORIGIN_NOT_AUTHORIZED', 'This operation requires a locked 6.0.0 or later Director conversation');
  const version = record.lock.compatibility.toolContract as ToolContractVersion;
  const { lockDigest, ...body } = record.lock, catalog = toolCatalog(version);
  invariant(digest(body) === lockDigest && record.lock.bindings.some(item => item.kind === 'handler'
    && item.id === toolHandlerId(version) && item.digest === catalog.digest),
  'CAPABILITY_MISMATCH', 'Director generation differs from its immutable tool lock');
  invariant(!store.get<{ paused: boolean }>('execution_control', projectId)?.paused,
    'EXECUTION_PAUSED', 'Continue the stopped film before starting new work');
  return { kind: 'human', principalId: actor.principalId, requestId: actor.requestId };
}
