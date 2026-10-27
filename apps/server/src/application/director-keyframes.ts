import { digest, DomainError, invariant } from '@openslate/core';
import type { ActorContext, DirectorGenerationEffect, JsonValue } from '@openslate/core';
import type { ProductionService } from './service.js';
import type { NarrationService } from '../narration/service.js';
import { generateScene, sceneView, type EnqueueSceneVoice } from '../scene-generation.js';
import { assertDirectorGenerationAuthority } from './director-generation-authority.js';
import { GENERATION_BLOCKER_LIMIT, GenerationAttemptBlockedError, type GenerationAttemptRecovery } from './generation-blockers.js';

export interface MakeKeyframesInput { sceneIds?: string[]; shotIds?: string[]; regenerate?: boolean }
export interface DirectorKeyframesReceipt {
  projectId: string; requestId: string; epochId: string; argumentsDigest: string; complete: boolean;
  started: (DirectorGenerationEffect & { sceneId: string })[];
  refused: { sceneId: string; code: string; message: string; recovery?: GenerationAttemptRecovery }[];
}
/** Every scene publishes atomically; a later refusal never rolls back another scene's paid intent. */
export async function makeDirectorKeyframes(service: ProductionService, projectId: string, actor: ActorContext,
  invocationId: string, input: MakeKeyframesInput, narration: NarrationService, enqueueVoice: EnqueueSceneVoice,
  signal?: AbortSignal): Promise<JsonValue> {
  assertDirectorGenerationAuthority(service, projectId, actor);
  invariant(actor.kind === 'director', 'ORIGIN_NOT_AUTHORIZED', 'An editing Director epoch is required');
  invariant(!!input.sceneIds !== !!input.shotIds && (!input.regenerate || !!input.shotIds?.length),
    'VALIDATION_ERROR', 'Choose exactly one of sceneIds or shotIds; new takes require explicit shotIds');
  const store = service.store, project = store.getProject(projectId);
  const scenes = input.sceneIds ?? [...new Set(input.shotIds!.map(id => {
    const shot = project.shots.find(shot => shot.id === id);
    invariant(shot, 'NOT_FOUND', 'A requested shot no longer belongs to this film');
    return shot.sceneId;
  }))];
  const receipt: DirectorKeyframesReceipt = { projectId, requestId: actor.requestId, epochId: actor.epochId,
    argumentsDigest: digest(input), complete: false, started: [], refused: [] };
  // A started transport receipt cannot re-enter this function. Keep per-scene progress for reconciliation only.
  invariant(!store.get('director_keyframes_receipt', invocationId), 'TOOL_CALL_UNRESOLVED', 'Reconcile the original keyframe operation');
  store.insert('director_keyframes_receipt', invocationId, projectId, receipt);
  for (const sceneId of scenes) {
    try {
      invariant(!signal?.aborted, 'TOOL_CALL_CANCELLED', 'Tool invocation was cancelled');
      assertDirectorGenerationAuthority(service, projectId, actor);
      const targetShotIds = input.shotIds?.filter(id => project.shots.some(shot => shot.id === id && shot.sceneId === sceneId));
      const request = store.get<{ scopeIds: string[] }>('message', actor.requestId)!;
      const requestedIds = targetShotIds ?? project.shots.filter(shot => shot.sceneId === sceneId).map(shot => shot.id);
      invariant(requestedIds.every(id => request.scopeIds.includes(projectId) || request.scopeIds.includes(sceneId) || request.scopeIds.includes(id)),
        'SCOPE_DENIED', 'Generation exceeds this conversation scope');
      const captured = sceneView(service, projectId, sceneId, undefined, targetShotIds, actor.requestId);
      const result = await generateScene(service, projectId, sceneId, {
        kind: 'image', headVersion: captured.view.headVersion, revisionId: captured.view.revisionId,
        reviewedFrames: [], reviewedHoldDigest: captured.view.reviewedHoldDigest,
        reviewedControlAuthorityId: captured.view.reviewedControlAuthorityId,
        ...(targetShotIds ? { targetShotIds } : {}), ...(input.regenerate ? { regenerate: true } : {}),
      }, `director-keyframes:${invocationId}:${sceneId}`, narration, { directorActor: actor, enqueueVoice, ...(signal ? { signal } : {}) });
      const effect = (result as { generation?: DirectorGenerationEffect }).generation;
      invariant(effect, 'TOOL_CALL_UNRESOLVED', 'The scene generation effect is unavailable');
      receipt.started.push({ ...effect, sceneId });
    } catch (error) {
      // Unexpected failure may have committed a scene. Leave the receipt incomplete and never dispatch it again.
      if (!(error instanceof DomainError) || error.code === 'TOOL_CALL_UNRESOLVED') throw error;
      // The catalog accepts up to 400 scenes. Bound job identities across the
      // whole receipt so detailed refusals cannot exceed the tool-result limit.
      const remaining = GENERATION_BLOCKER_LIMIT - receipt.refused.reduce((count, refusal) => count + (refusal.recovery?.attempts.length ?? 0), 0);
      const recovery = error instanceof GenerationAttemptBlockedError ? { ...error.recovery,
        attempts: error.recovery.attempts.slice(0, remaining), truncated: error.recovery.total > remaining } : undefined;
      receipt.refused.push({ sceneId, code: error.code, message: error.message, ...(recovery ? { recovery } : {}) });
    }
    store.put('director_keyframes_receipt', invocationId, projectId, receipt);
  }
  receipt.complete = true;
  store.put('director_keyframes_receipt', invocationId, projectId, receipt);
  return JSON.parse(JSON.stringify({ started: receipt.started, refused: receipt.refused,
    next: receipt.started.length ? 'Follow these saved keyframe and voice jobs. When the returned frames and video recipe are ready, the person confirms each scene to generate video.'
      : 'Use the recovery steps for the requested scenes to choose the next action. Preserve unresolved work for reconciliation before any further submission.' })) as JsonValue;
}
