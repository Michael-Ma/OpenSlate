import { canonical, digest, invariant } from '@openslate/core';
import type { ActorContext, DirectorGenerationBlock } from '@openslate/core';
import type { ProductionService } from './service.js';
import { GENERATION_BLOCKER_LIMIT } from './generation-blockers.js';

export interface DirectorGenerationBlockRecord {
  id: string; projectId: string; requestId: string; epochId: string; key: string;
  block: DirectorGenerationBlock;
}

/** Persist with the refusal receipt. Recording history never grants fresh generation authority. */
export function recordDirectorGenerationBlock(service: ProductionService, projectId: string, actor: ActorContext,
  key: string, block: DirectorGenerationBlock): void {
  invariant(actor.kind === 'director' && key.length > 0 && key.length <= 320,
    'VALIDATION_ERROR', 'Generation blocks require an exact operation identity');
  const id = digest({ purpose: 'director_generation_block', projectId, requestId: actor.requestId, epochId: actor.epochId, key });
  const prior = service.store.get<DirectorGenerationBlockRecord>('director_generation_block', id);
  if (prior) {
    const { at: _oldAt, ...oldBlock } = prior.block, { at: _newAt, ...newBlock } = block;
    invariant(prior.projectId === projectId && prior.requestId === actor.requestId && prior.epochId === actor.epochId
      && canonical(oldBlock) === canonical(newBlock), 'IDEMPOTENCY_CONFLICT', 'This generation block already describes a different refusal');
    return;
  }
  service.store.insert('director_generation_block', id, projectId, { id, projectId, requestId: actor.requestId,
    epochId: actor.epochId, key, block } satisfies DirectorGenerationBlockRecord);
}

/** Public history is bounded across all calls in the turn and never carries recovery commands. */
export function directorGenerationBlocks(records: readonly DirectorGenerationBlockRecord[]): DirectorGenerationBlock[] {
  let remaining = GENERATION_BLOCKER_LIMIT;
  return records.slice(0, GENERATION_BLOCKER_LIMIT).map(({ block }) => {
    const attempts = block.attempts?.slice(0, remaining).map(attempt => ({ attemptId: attempt.attemptId,
      shotId: attempt.shotId, kind: attempt.kind, phase: attempt.phase, action: attempt.action }));
    remaining -= attempts?.length ?? 0;
    return { kind: 'keyframes', sceneId: block.sceneId, code: block.code, shotIds: [...block.shotIds],
      ...(attempts ? { attempts } : {}), at: block.at };
  });
}
