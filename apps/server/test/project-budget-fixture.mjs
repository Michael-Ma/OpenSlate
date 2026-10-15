import { digest } from '@openslate/core';
export function historicalBudget(service, projectId) {
  const input = { expectedRevision: 0, expectedCapMicros: '1000000', capMicros: '2000000' };
  const contextDigest = digest({ purpose: 'project_budget.revise', version: 1, projectId, input });
  const actor = service.beginRequest(projectId, 'human', 'Historical spending limit', { editing: false, contextDigest });
  return service.store.insert('project_budget_revision', actor.requestId, projectId, {
    id: actor.requestId, projectId, version: 1, requestId: actor.requestId, principalId: actor.principalId, contextDigest,
    createdAt: '2026-09-11T00:00:00.000Z', currency: 'USD', priorRevision: 0, priorCapMicros: input.expectedCapMicros,
    revision: 1, capMicros: input.capMicros });
}
