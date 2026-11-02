import { digest, invariant, newId } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { ProductionService } from '../application/service.js';
import type { NarrationSession } from './narration-scope.js';

/** An explicit audio operation opens its application session; there is no separate session-approval step. */
export function audioRequestActor(production: ProductionService, projectId: string, commandKey: string, sessionId: string | undefined,
  actorFor: (projectId: string, sessionId: string) => ActorContext, text: string): ActorContext {
  const store = production.store;
  invariant(!store.get<{ paused: boolean }>('execution_control', projectId)?.paused, 'EXECUTION_PAUSED', 'Work is stopped. Send a fresh direction before requesting audio.');
  if (sessionId) return actorFor(projectId, sessionId);
  const session = store.command(`local-user:${projectId}:audio-request-session`, commandKey, digest({ text }), () => {
    const head = store.get<{ sessionId: string }>('narration_session_head', projectId);
    const previous = head ? store.get<NarrationSession>('narration_session', head.sessionId) : undefined;
    invariant(!previous || previous.projectId === projectId && previous.principalId === 'local-user' && !previous.shotId,
      'NARRATION_SESSION_STALE', 'Saved narration session does not belong to this project.');
    const actor = production.beginRequest(projectId, 'local-user', text, { source: "app", scopeIds: [projectId], editing: true,
      key: digest({ key: commandKey, action: 'audio-request' }), ...(previous ? { continuationRequestId: previous.requestId } : {}) });
    const next: NarrationSession = { id: newId(), projectId, requestId: actor.requestId, principalId: 'local-user' };
    store.insert('narration_session', next.id, projectId, next);
    store.put('narration_session_head', projectId, projectId, { sessionId: next.id });
    return next;
  });
  return actorFor(projectId, session.id);
}
