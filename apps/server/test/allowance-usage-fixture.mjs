import { allowanceUsage } from '../dist/execution/durable-external-admission.js';
export function allowanceSummary(store, projectId) {
  return store.list('external_allowance', projectId).map(allowance => {
    const used = allowanceUsage(store, allowance);
    return { usedAttempts: used.attempts, usedEstimatedMicros: used.estimatedMicros,
      remainingAttempts: Math.max(0, allowance.maxAttempts - used.attempts),
      remainingEstimatedMicros: (BigInt(allowance.maxEstimatedMicros) > BigInt(used.estimatedMicros)
        ? BigInt(allowance.maxEstimatedMicros) - BigInt(used.estimatedMicros) : 0n).toString(),
      revoked: !!store.get('external_allowance_revocation', allowance.id) };
  });
}
