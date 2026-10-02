import { digest, invariant } from '@openslate/core';
import type { ProjectRecord } from '@openslate/core';
import type { Store } from '../persistence/store.js';

export interface PendingEditContinuation { requestId: string; scopeIds: string[]; holdsDigest: string }
export interface ContinueEdits { headVersion: number; requestIds: string[]; holdsDigest: string }
export const continueEditsSchema = { type: 'object', additionalProperties: false, required: ['headVersion', 'requestIds', 'holdsDigest'], properties: {
  headVersion: { type: 'integer', minimum: 0 },
  requestIds: { type: 'array', minItems: 1, maxItems: 400, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 160 } },
  holdsDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
} };
interface Hold { id: string; ownerId: string; scopeId: string; active: boolean }
interface Request { id: string; projectId: string; principalId: string; editing: boolean }

export function pendingEditContinuations(store: Store, projectId: string, principalId: string): PendingEditContinuation[] {
  const grouped = new Map<string, Hold[]>();
  for (const hold of store.list<Hold>('hold', projectId).filter(h => h.active)) {
    const request = store.get<Request>('message', hold.ownerId);
    if (request?.projectId !== projectId || request.principalId !== principalId || !request.editing) continue;
    const previous = grouped.get(request.id);
    if (previous) previous.push(hold); else grouped.set(request.id, [hold]);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([requestId, holds]) => ({ requestId,
    scopeIds: [...new Set(holds.map(h => h.scopeId))].sort(),
    holdsDigest: digest(holds.map(h => [h.id, h.scopeId, h.ownerId]).sort((a, b) => a[0]!.localeCompare(b[0]!))),
  }));
}
export function continuationCovers(project: ProjectRecord, scopeIds: string[], heldScopeId: string): boolean {
  return scopeIds.includes(project.id) || scopeIds.includes(heldScopeId)
    || project.shots.some(shot => shot.id === heldScopeId && scopeIds.includes(shot.sceneId));
}
export function continuationDigest(groups: PendingEditContinuation[]): string {
  return digest([...groups].sort((a, b) => a.requestId.localeCompare(b.requestId)).map(group => [group.requestId, group.holdsDigest]));
}
/** Follow only explicit application-recorded continuation edges. Linear traversal terminates even with repeated/cyclic historical links. */
export function continuedRequestAuthorities(store: Pick<Store, 'list'>, projectId: string, requestId: string): Set<string> {
  const edges = store.list<{ fromRequestId: string; toRequestId: string }>('request_continuation', projectId), predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const previous = predecessors.get(edge.toRequestId);
    if (previous) previous.push(edge.fromRequestId); else predecessors.set(edge.toRequestId, [edge.fromRequestId]);
  }
  const authorities = new Set([requestId]), queue = [requestId];
  for (let at = 0; at < queue.length; at++) for (const prior of predecessors.get(queue[at]!) ?? []) {
    if (authorities.has(prior)) continue;
    authorities.add(prior); queue.push(prior);
  }
  return authorities;
}
/** Authenticated human review. Does not release holds or produce generation authority. */
export function reviewPendingEdits(store: Store, projectId: string, principalId: string, scopeIds: string[]): ContinueEdits | null {
  const project = store.getProject(projectId), groups = pendingEditContinuations(store, projectId, principalId)
    .filter(group => group.scopeIds.every(id => continuationCovers(project, scopeIds, id)));
  return groups.length ? { headVersion: project.headVersion, requestIds: groups.map(group => group.requestId), holdsDigest: continuationDigest(groups) } : null;
}
/** Recheck exact selected owners and hold topology in the message transaction, before fencing or publication. */
export function assertContinueEdits(store: Store, project: ProjectRecord, principalId: string, scopeIds: string[], input: ContinueEdits): void {
  invariant(Number.isSafeInteger(input.headVersion) && input.headVersion === project.headVersion, 'REVISION_CONFLICT', 'The project changed. Review the pending edits before continuing.');
  invariant(Array.isArray(input.requestIds) && input.requestIds.length > 0 && input.requestIds.length <= 400 && input.requestIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 160)
    && new Set(input.requestIds).size === input.requestIds.length && typeof input.holdsDigest === 'string', 'VALIDATION_ERROR', 'Select a bounded set of earlier edits.');
  const groups = pendingEditContinuations(store, project.id, principalId).filter(group => input.requestIds.includes(group.requestId));
  invariant(groups.length === input.requestIds.length, 'CONTINUATION_CHANGED', 'An earlier edit was resolved or belongs to another user. Refresh the conversation.');
  invariant(groups.every(group => group.scopeIds.every(id => continuationCovers(project, scopeIds, id))), 'SCOPE_DENIED', 'The new conversation must cover every part of each selected earlier edit.');
  invariant(continuationDigest(groups) === input.holdsDigest, 'CONTINUATION_CHANGED', 'Pending edits changed. Review them before continuing.');
}
