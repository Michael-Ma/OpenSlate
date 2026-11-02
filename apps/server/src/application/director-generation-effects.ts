import { canonical, digest, invariant } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { DirectorGenerationEffect } from '@openslate/core/public';
import type { ProductionService } from './service.js';
import { assertDirectorGenerationAuthority } from './director-generation-authority.js';

export interface DirectorGenerationEffectRecord {
  id: string; projectId: string; requestId: string; epochId: string; key: string;
  effect: DirectorGenerationEffect;
}

/** Call inside the transaction that publishes the corresponding work. */
export function recordDirectorGenerationEffect(service: ProductionService, projectId: string, actor: ActorContext,
  key: string, input: DirectorGenerationEffect): DirectorGenerationEffect {
  assertDirectorGenerationAuthority(service, projectId, actor);
  invariant(actor.kind === 'director' && typeof key === 'string' && key.length > 0 && key.length <= 320,
    'VALIDATION_ERROR', 'Generation effects require an exact operation identity');
  const effect = structuredClone(input), id = digest({ purpose: 'director_generation_effect', projectId,
    requestId: actor.requestId, epochId: actor.epochId, key });
  const prior = service.store.get<DirectorGenerationEffectRecord>('director_generation_effect', id);
  if (prior) {
    const { at: _oldAt, ...oldWork } = prior.effect, { at: _newAt, ...newWork } = effect;
    invariant(prior.projectId === projectId && prior.requestId === actor.requestId && prior.epochId === actor.epochId
      && canonical(oldWork) === canonical(newWork), 'IDEMPOTENCY_CONFLICT', 'This generation effect already describes different work');
    return structuredClone(prior.effect);
  }
  service.store.insert('director_generation_effect', id, projectId, { id, projectId,
    requestId: actor.requestId, epochId: actor.epochId, key, effect } satisfies DirectorGenerationEffectRecord);
  return effect;
}
