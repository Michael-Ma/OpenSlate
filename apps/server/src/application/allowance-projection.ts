import { DomainError, digest, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { isLegacyExecution, profileExecutionIdentity } from "@openslate/providers";
import type { ProductionService } from "./service.js";
import type { Attempt, Candidate, NodeBinding, PlanRecord } from "../execution/engine.js";
import { allowanceUsage, currentAllowanceSelection } from "../execution/durable-external-admission.js";
import type { ExternalAllowance, ExternalAllowanceRevocation } from "../execution/external-allowance-records.js";
import { MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS } from "../execution/external-allowance-records.js";
import { projectBudgetSnapshot } from "./project-budget.js";
import { spendingHistoryDisplay, spendingProviderDisplay } from "./spending-display.js";

export const SPENDING_PAGE_LIMITS = Object.freeze({ candidates: 100, allowances: 40 });
const coverage = (offset: number, returned: number, total: number) => ({ offset, returned, total, nextOffset: offset + returned < total ? offset + returned : null });

/** Caller must already be the authenticated local human. No application request is minted for a read. */
export function projectSpendingProjection(service: ProductionService, projectId: string,
  offsets: { candidateOffset?: number; allowanceOffset?: number } = {}) {
  const store = service.store;
  // A deferred read transaction gives every projection field the same SQLite snapshot without claiming a writer.
  return store.db.transaction(() => {
    const project = store.getProject(projectId), attempts = store.list<Attempt>("attempt", projectId);
    const lock = store.get<{ profiles: ProviderProfile[]; projectId: string }>("capability_lock", project.capabilityLockId);
    const profiles = lock?.projectId === projectId && Array.isArray(lock.profiles) ? lock.profiles : [];
    const candidates = store.list<NodeBinding>("node_binding", projectId)
      .filter(binding => binding.state === "active" && binding.planId === project.activePlanId && binding.candidateId)
      .flatMap(binding => {
        const profile = profiles.find(value => value.id === binding.node.profileId);
        if (profile) {
          try { if (isLegacyExecution(profileExecutionIdentity(profile))) return []; }
          catch { /* Keep an incompatible saved external selection visible without offering it. */ }
        } else if (binding.node.args.adapter === "fake") return [];
        const selection = { candidateId: binding.candidateId!, nodeId: binding.id, specDigest: binding.node.specDigest };
        let profileDigest: string | null = null, profileDefinitionDigest: string | null = null, estimatedMicros: string | null = null;
        let selectionCurrent = false, unavailableCode: string | null = null;
        try {
          if (!profile) throw new DomainError("ALLOWANCE_PROFILE_MISMATCH", "Pinned profile is unavailable");
          const args = providerProfileArguments(profile); profileDigest = typeof args.profileDigest === "string" ? args.profileDigest : null;
          profileDefinitionDigest = digest(profile); estimatedMicros = moneyMicros(profile.unitCostMicros).toString();
          currentAllowanceSelection(store, projectId, selection, profileDigest ?? "", profileDefinitionDigest); selectionCurrent = true;
        } catch (error) { if (!(error instanceof DomainError)) throw error; unavailableCode = error.code; }
        const candidate = store.get<Candidate>("candidate", selection.candidateId);
        if (service.recovery.isImported(projectId, "candidate", selection.candidateId)
          || candidate && service.recovery.isImported(projectId, "grant", candidate.grantId)) {
          selectionCurrent = false; unavailableCode = "RESTORED_AUTHORITY_REQUIRES_NEW";
        }
        const history = attempts.filter(attempt => attempt.candidateId === selection.candidateId).sort((a, b) => b.ordinal - a.ordinal);
        const latest = history[0], hasOutput = Object.keys(binding.outputs).length > 0;
        const workState = hasOutput || latest?.phase === "succeeded" ? "completed" : latest?.phase === "submission_unknown" ? "uncertain"
          : latest?.phase === "failed" ? "failed" : latest ? "in_progress" : "unattempted";
        const retryPermitted = unavailableCode !== "RESTORED_AUTHORITY_REQUIRES_NEW" && latest?.phase === "failed" && latest.failure?.technical === true && latest.failure.retryAllowed === true
          && latest.ordinal <= (profile?.maxRetries ?? 0);
        return [{ ...selection, alias: binding.node.alias, shotId: binding.node.shotId ?? null, operation: binding.node.kind,
          profileId: binding.node.profileId ?? null, profileRevision: profile?.revision ?? null, profileDigest, profileDefinitionDigest,
          providerDisplay: spendingProviderDisplay(profile, profileDefinitionDigest),
          estimatedMicros, selectionCurrent, unavailableCode, workState,
          suggestedForIssue: selectionCurrent && (workState === "unattempted" || retryPermitted), matchingAllowanceCount: 0,
          latestAttempt: latest ? { id: latest.id, phase: latest.phase, ordinal: latest.ordinal, retryPermitted } : null }];
      });
    const byCandidate = new Map(candidates.map(candidate => [candidate.candidateId, candidate]));
    const allAllowances = store.list<ExternalAllowance>("external_allowance", projectId).reverse();
    const historyDisplay = spendingHistoryDisplay(projectId,
      store.list<{ projectId: string; profiles: unknown }>("capability_lock", projectId), store.list<PlanRecord>("plan", projectId));
    const candidateOffset = offsets.candidateOffset ?? 0, allowanceOffset = offsets.allowanceOffset ?? 0;
    const projectedAllowances = allAllowances.map(allowance => {
      const restoredHistory = service.recovery.isImported(projectId, "external_allowance", allowance.id);
      const used = allowanceUsage(store, allowance), revocation = store.get<ExternalAllowanceRevocation>("external_allowance_revocation", allowance.id);
      const remainingAttempts = Math.max(0, allowance.maxAttempts - used.attempts);
      const remainingEstimate = moneyMicros(allowance.maxEstimatedMicros) - moneyMicros(used.estimatedMicros);
      const remainingEstimatedMicros = (remainingEstimate > 0n ? remainingEstimate : 0n).toString();
      const currentSelections = restoredHistory ? [] : allowance.selections.flatMap(selection => {
        const candidate = byCandidate.get(selection.candidateId);
        return candidate?.selectionCurrent && candidate.profileDigest === allowance.profileDigest
          && candidate.profileDefinitionDigest === allowance.profileDefinitionDigest && selection.nodeId === candidate.nodeId
          && selection.specDigest === candidate.specDigest ? [candidate] : [];
      });
      const estimate = currentSelections[0]?.estimatedMicros;
      const expired = Date.parse(allowance.expiresAt) <= Date.now();
      const status = revocation ? "revoked" : restoredHistory ? "restored_history" : expired ? "expired" : remainingAttempts === 0 ? "start_limit_reached"
        : !currentSelections.length ? "no_current_work" : estimate !== null && estimate !== undefined && moneyMicros(estimate) > moneyMicros(remainingEstimatedMicros)
          ? "estimate_limit_reached" : "open";
      // Capacity is shared by an allowance's selections; this is matching coverage, never a dedicated reservation.
      if (status === "open") for (const candidate of currentSelections) candidate.matchingAllowanceCount++;
      return { ...allowance, usedAttempts: used.attempts, usedEstimatedMicros: used.estimatedMicros, remainingAttempts, remainingEstimatedMicros,
        ...historyDisplay(allowance, currentSelections),
        revoked: !!revocation, expired, restoredHistory, status, currentSelectionCount: currentSelections.length,
        suggestedSelectionCount: currentSelections.filter(candidate => candidate.suggestedForIssue).length,
        revocation: revocation ? { requestId: revocation.requestId, createdAt: revocation.createdAt } : null };
    });
    const selectedCandidates = candidates.slice(candidateOffset, candidateOffset + SPENDING_PAGE_LIMITS.candidates);
    const allowances = projectedAllowances.slice(allowanceOffset, allowanceOffset + SPENDING_PAGE_LIMITS.allowances);
    return { version: 1 as const, projectId, revisionId: project.revisionId, headVersion: project.headVersion, planId: project.activePlanId,
      currency: "USD" as const, projectBudget: projectBudgetSnapshot(service, projectId),
      notice: "Amounts are configured estimates, not guaranteed provider bills. Spending permission does not approve keyframes or retry uncertain work.",
      limits: { maxSelections: 800, maxAttempts: 10000, maxLifetimeMs: MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS },
      candidates: selectedCandidates, allowances,
      coverage: { candidates: coverage(candidateOffset, selectedCandidates.length, candidates.length),
        allowances: coverage(allowanceOffset, allowances.length, allAllowances.length) } };
  }).deferred();
}

export type ProjectSpendingProjection = ReturnType<typeof projectSpendingProjection>;
