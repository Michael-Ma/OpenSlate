import { canonical, invariant, moneyMicros } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import { Store } from "../persistence/store.js";
import { allowanceUsage, currentAllowanceSelection } from "../execution/durable-external-admission.js";
import { allowanceIssueContextDigest, allowanceIssueInput, allowanceRevokeContextDigest, MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS } from "../execution/external-allowance-records.js";
import type { AllowanceHumanRequest, AllowanceIssueInput, AllowanceRevokeInput, ExternalAllowance, ExternalAllowanceRevocation } from "../execution/external-allowance-records.js";

export { allowanceIssueContextDigest, allowanceRevokeContextDigest } from "../execution/external-allowance-records.js";

/** Called only by an authenticated human handler, never exposed as a director tool. */
export class ExternalAllowanceService {
  constructor(readonly store: Store) {}
  issue(projectId: string, actor: ActorContext, value: AllowanceIssueInput): ExternalAllowance {
    const input = structuredClone(value), contextDigest = allowanceIssueContextDigest(projectId, input);
    return this.store.transaction(() => {
      const request = this.human(projectId, actor, contextDigest);
      const existing = this.store.get<ExternalAllowance>("external_allowance", actor.requestId);
      if (existing) {
        invariant(existing.projectId === projectId && canonical(allowanceIssueInput(existing)) === canonical(input), "IDEMPOTENCY_CONFLICT", "This human request already issued a different allowance");
        return existing;
      }
      const createdAt = new Date().toISOString();
      invariant(Date.parse(input.expiresAt) > Date.parse(createdAt), "ALLOWANCE_EXPIRED", "Choose a future allowance expiry");
      invariant(Date.parse(input.expiresAt) - Date.parse(createdAt) <= MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS,
        "ALLOWANCE_EXPIRY_INVALID", "Spending allowances expire within thirty days");
      for (const selection of input.selections) {
        const { project, binding } = currentAllowanceSelection(this.store, projectId, selection, input.profileDigest, input.profileDefinitionDigest);
        const shot = project.shots.find(shot => shot.id === binding.node.shotId);
        invariant(request.scopeIds.includes(projectId) || (shot && (request.scopeIds.includes(shot.id) || request.scopeIds.includes(shot.sceneId))),
          "SCOPE_DENIED", "Spending selection is outside this human request");
      }
      const result = this.store.insert<ExternalAllowance>("external_allowance", actor.requestId, projectId, { ...input,
        id: actor.requestId, projectId, version: 1, requestId: actor.requestId, principalId: actor.principalId, contextDigest, createdAt, currency: "USD" });
      this.store.appendEvent(projectId, "external_allowance.issued", { allowanceId: result.id }); return result;
    });
  }
  revoke(projectId: string, actor: ActorContext, value: AllowanceRevokeInput): ExternalAllowanceRevocation {
    const input = structuredClone(value), contextDigest = allowanceRevokeContextDigest(projectId, input);
    return this.store.transaction(() => {
      const request = this.human(projectId, actor, contextDigest);
      invariant(request.scopeIds.includes(projectId), "SCOPE_DENIED", "Revocation requires a project-scoped human request");
      const allowance = this.store.get<ExternalAllowance>("external_allowance", input.allowanceId);
      invariant(allowance?.projectId === projectId, "SCOPE_DENIED", "Allowance belongs to another project or does not exist");
      const existing = this.store.get<ExternalAllowanceRevocation>("external_allowance_revocation", allowance.id);
      if (existing) return existing;
      const result = this.store.insert<ExternalAllowanceRevocation>("external_allowance_revocation", allowance.id, projectId,
        { id: allowance.id, projectId, version: 1, allowanceId: allowance.id, requestId: actor.requestId, principalId: actor.principalId,
          contextDigest, createdAt: new Date().toISOString() });
      this.store.appendEvent(projectId, "external_allowance.revoked", { allowanceId: allowance.id }); return result;
    });
  }
  list(projectId: string, actor: ActorContext) {
    // Money summaries expose the whole project and therefore require project scope.
    const request = this.request(projectId, actor);
    invariant(actor.kind === "human" && request.scopeIds.includes(projectId), "SCOPE_DENIED", "Allowance summaries require the project human");
    return this.store.list<ExternalAllowance>("external_allowance", projectId).map(allowance => {
      const used = allowanceUsage(this.store, allowance), revoked = !!this.store.get("external_allowance_revocation", allowance.id);
      const expired = Date.parse(allowance.expiresAt) <= Date.now();
      return { ...allowance, usedAttempts: used.attempts, usedEstimatedMicros: used.estimatedMicros,
        remainingAttempts: Math.max(0, allowance.maxAttempts - used.attempts),
        remainingEstimatedMicros: (moneyMicros(allowance.maxEstimatedMicros) > moneyMicros(used.estimatedMicros)
          ? moneyMicros(allowance.maxEstimatedMicros) - moneyMicros(used.estimatedMicros) : 0n).toString(), revoked, expired };
    });
  }
  private human(projectId: string, actor: ActorContext, contextDigest: string): AllowanceHumanRequest {
    const request = this.request(projectId, actor);
    invariant(actor.kind === "human" && request.state === "active" && request.contextDigest === contextDigest,
      "ALLOWANCE_AUTHORITY_INVALID", "Use a dedicated current human request bound to this exact spending action");
    return request;
  }
  private request(projectId: string, actor: ActorContext): AllowanceHumanRequest {
    const request = this.store.get<AllowanceHumanRequest>("message", actor.requestId);
    invariant(request?.projectId === projectId && request.principalId === actor.principalId && Array.isArray(request.scopeIds),
      "ALLOWANCE_AUTHORITY_INVALID", "Spending authority belongs to another request or project");
    return request;
  }
}
