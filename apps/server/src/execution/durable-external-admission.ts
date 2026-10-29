import { characterSheetJobNode } from "./character-sheet-execution.js";
import { canonical, digest, DomainError, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { ProjectRecord, ProviderProfile } from "@openslate/core";
import { isLegacyExecution, profileExecutionIdentity } from "@openslate/providers";
import { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Attempt, Candidate, ExternalExecutionAdmission, NodeBinding, PlanRecord } from "./engine.js";
import type { AllowanceSelection, ExternalAllowance, ExternalAllowanceConsumption } from "./external-allowance-records.js";

/** Re-read the exact canonical selection and pinned profile before any external dispatch. */
export function currentExternalSelection(store: Store, projectId: string, selection: AllowanceSelection, profileDigest: string, profileDefinitionDigest: string): {
  project: ProjectRecord; binding: NodeBinding; profile: ProviderProfile;
} {
  const project = store.getProject(projectId), binding = store.get<NodeBinding>("node_binding", selection.nodeId);
  const candidate = store.get<Candidate>("candidate", selection.candidateId);
  const plan = project.activePlanId ? store.get<PlanRecord>("plan", project.activePlanId) : undefined;
  // A character sheet runs outside the shot plan; its recorded job node stands in for the compiled plan node.
  const sheetNode = binding?.projectId === projectId ? characterSheetJobNode(store, binding) : undefined;
  const node = sheetNode ?? plan?.compiled.nodes.find(node => node.id === selection.nodeId);
  const lock = store.get<{ projectId: string; profiles: ProviderProfile[] }>("capability_lock", project.capabilityLockId);
  const profile = lock?.projectId === projectId && Array.isArray(lock.profiles) ? lock.profiles.find(profile => profile.id === node?.profileId) : undefined;
  invariant(binding?.projectId === projectId && binding.state === "active" && (sheetNode !== undefined || binding.planId === project.activePlanId)
    && binding.candidateId === selection.candidateId && binding.node.specDigest === selection.specDigest && node
    && Object.keys(binding.outputs).length === 0 && canonical(node) === canonical(binding.node)
    && candidate?.projectId === projectId && candidate.nodeId === selection.nodeId && profile?.kind === node.kind,
  "EXTERNAL_SELECTION_STALE", "Provider selection must match the current unfinished plan node and candidate");
  const args = providerProfileArguments(profile);
  invariant(!isLegacyExecution(profileExecutionIdentity(profile)) && args.profileDigest === profileDigest && digest(profile) === profileDefinitionDigest
    && Object.entries(args).every(([key, value]) => Object.hasOwn(node.args, key) && canonical(node.args[key]) === canonical(value)),
  "EXTERNAL_PROFILE_MISMATCH", "Dispatch requires the exact current external profile and compiled settings");
  return { project, binding, profile };
}

/** Compatibility for historical allowance tooling; new dispatch uses currentExternalSelection. */
export function currentAllowanceSelection(...input: Parameters<typeof currentExternalSelection>): ReturnType<typeof currentExternalSelection> {
  try { return currentExternalSelection(...input); }
  catch (error) {
    if (error instanceof DomainError && ["EXTERNAL_SELECTION_STALE", "EXTERNAL_PROFILE_MISMATCH"].includes(error.code))
      throw new DomainError(error.code === "EXTERNAL_SELECTION_STALE" ? "ALLOWANCE_SELECTION_STALE" : "ALLOWANCE_PROFILE_MISMATCH", error.message);
    throw error;
  }
}

export function allowanceUsage(store: Store, allowance: ExternalAllowance): { attempts: number; estimatedMicros: string } {
  const consumed = store.list<ExternalAllowanceConsumption>("external_allowance_consumption", allowance.projectId).filter(row => row.allowanceId === allowance.id);
  return { attempts: consumed.length, estimatedMicros: consumed.reduce((total, row) => total + moneyMicros(row.estimatedMicros), 0n).toString() };
}

/** Current app policy: configured provider use requires readiness, never a spending allowance. */
export class ConfiguredExternalAdmission implements ExternalExecutionAdmission {
  readonly recovery: InstallationRecoveryGuard;
  constructor(readonly store: Store, private readonly assertReady: (profile: Readonly<ProviderProfile>) => void) {
    this.recovery = new InstallationRecoveryGuard(store);
    invariant(typeof assertReady === "function" && assertReady.constructor.name !== "AsyncFunction", "ASYNC_TRANSACTION", "Credential readiness must be a synchronous host check");
  }
  authorize(input: Parameters<ExternalExecutionAdmission["authorize"]>[0]): Record<string, never> {
    this.recovery.assertWritable(input.projectId);
    this.recovery.assertFreshAuthority(input.projectId, "candidate", input.candidateId);
    invariant(this.store.db.inTransaction, "EXTERNAL_ADMISSION_TRANSACTION_REQUIRED", "Provider readiness must share the Engine transaction");
    const binding = this.store.get<NodeBinding>("node_binding", input.nodeId);
    invariant(binding, "EXTERNAL_SELECTION_STALE", "Selected node no longer exists");
    const current = currentExternalSelection(this.store, input.projectId,
      { candidateId: input.candidateId, nodeId: input.nodeId, specDigest: binding.node.specDigest },
      String(providerProfileArguments(input.profile).profileDigest), digest(input.profile));
    invariant(canonical(current.profile) === canonical(input.profile) && input.estimatedMicros === current.profile.unitCostMicros,
      "EXTERNAL_PROFILE_MISMATCH", "Admission must use the exact pinned provider profile");
    const ready = this.assertReady(structuredClone(current.profile)) as unknown;
    invariant(!(ready && typeof (ready as { then?: unknown }).then === "function"), "ASYNC_TRANSACTION", "Credential readiness cannot return a promise");
    return {};
  }
}

/** Historical opt-in policy retained for saved allowance records and compatibility tools. The app uses ConfiguredExternalAdmission. */
export class DurableExternalAdmission implements ExternalExecutionAdmission {
  readonly recovery: InstallationRecoveryGuard;
  constructor(readonly store: Store, private readonly assertReady: (profile: Readonly<ProviderProfile>) => void) {
    this.recovery = new InstallationRecoveryGuard(store);
    invariant(typeof assertReady === "function" && assertReady.constructor.name !== "AsyncFunction", "ASYNC_TRANSACTION", "Credential readiness must be a synchronous host check");
  }
  authorize(input: Parameters<ExternalExecutionAdmission["authorize"]>[0]): { allowanceId: string } {
    this.recovery.assertWritable(input.projectId);
    this.recovery.assertFreshAuthority(input.projectId, "candidate", input.candidateId);
    this.inTransaction();
    const binding = this.store.get<NodeBinding>("node_binding", input.nodeId);
    invariant(binding, "ALLOWANCE_SELECTION_STALE", "Selected node no longer exists");
    const selected = { candidateId: input.candidateId, nodeId: input.nodeId, specDigest: binding.node.specDigest };
    const profileDigest = String(providerProfileArguments(input.profile).profileDigest);
    const profileDefinitionDigest = digest(input.profile);
    const current = currentAllowanceSelection(this.store, input.projectId, selected, profileDigest, profileDefinitionDigest);
    invariant(canonical(current.profile) === canonical(input.profile) && input.estimatedMicros === current.profile.unitCostMicros,
      "ALLOWANCE_PROFILE_MISMATCH", "Admission must use the exact pinned profile estimate");
    const ready = this.assertReady(structuredClone(current.profile)) as unknown;
    invariant(!(ready && typeof (ready as { then?: unknown }).then === "function"), "ASYNC_TRANSACTION", "Credential readiness cannot return a promise");
    const matches = this.store.list<ExternalAllowance>("external_allowance", input.projectId)
      .filter(allowance => allowance.profileDigest === profileDigest && allowance.profileDefinitionDigest === profileDefinitionDigest
        && allowance.selections.some(value => canonical(value) === canonical(selected)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const chosen = matches.find(allowance => this.available(allowance, input.estimatedMicros));
    invariant(chosen, "EXTERNAL_ALLOWANCE_UNAVAILABLE", "No current allowance covers this exact work within its remaining start and estimate caps");
    return { allowanceId: chosen.id };
  }
  recordAdmission(input: Readonly<Attempt>): void {
    this.recovery.assertFirstSubmit(input.projectId, input.id);
    this.inTransaction();
    const attempt = this.store.get<Attempt>("attempt", input.id);
    invariant(attempt && canonical(attempt) === canonical(input) && attempt.phase === "submitting" && attempt.candidateId && attempt.reservationId,
      "ALLOWANCE_CONSUMPTION_INVALID", "Record consumption only for the exact newly admitted attempt");
    const allowance = this.store.get<ExternalAllowance>("external_allowance", attempt.request.externalAllowanceId ?? "");
    const reservation = this.store.get<{ projectId: string; attemptId: string; micros: string; state: string }>("reservation", attempt.reservationId);
    invariant(allowance?.projectId === attempt.projectId && reservation?.projectId === attempt.projectId && reservation.attemptId === attempt.id
      && reservation.state === "reserved", "ALLOWANCE_CONSUMPTION_INVALID", "Allowance and reservation must belong to the admitted attempt");
    const existing = this.store.get<ExternalAllowanceConsumption>("external_allowance_consumption", attempt.id);
    if (existing) {
      invariant(existing.allowanceId === allowance.id && existing.requestDigest === digest(attempt.request) && existing.estimatedMicros === reservation.micros,
        "ALLOWANCE_CONSUMPTION_INVALID", "Existing consumption differs from the admitted attempt"); return;
    }
    currentAllowanceSelection(this.store, attempt.projectId, { candidateId: attempt.candidateId, nodeId: attempt.nodeId, specDigest: attempt.specDigest },
      allowance.profileDigest, allowance.profileDefinitionDigest);
    invariant(this.available(allowance, reservation.micros), "EXTERNAL_ALLOWANCE_UNAVAILABLE", "Allowance changed before admission committed");
    this.store.insert("external_allowance_consumption", attempt.id, attempt.projectId, { version: 1, attemptId: attempt.id, allowanceId: allowance.id,
      candidateId: attempt.candidateId, nodeId: attempt.nodeId, specDigest: attempt.specDigest, profileDigest: allowance.profileDigest,
      profileDefinitionDigest: allowance.profileDefinitionDigest,
      requestDigest: digest(attempt.request), estimatedMicros: reservation.micros, recordedAt: new Date().toISOString() });
  }
  private inTransaction(): void {
    invariant(this.store.db.inTransaction, "ALLOWANCE_TRANSACTION_REQUIRED", "External admission must share the Engine transaction");
  }
  private available(allowance: ExternalAllowance, estimatedMicros: string): boolean {
    if (this.recovery.isImported(allowance.projectId, "external_allowance", allowance.id)) return false;
    if (Date.parse(allowance.expiresAt) <= Date.now() || this.store.get("external_allowance_revocation", allowance.id)) return false;
    const used = allowanceUsage(this.store, allowance);
    return used.attempts < allowance.maxAttempts && moneyMicros(used.estimatedMicros) + moneyMicros(estimatedMicros) <= moneyMicros(allowance.maxEstimatedMicros);
  }
}
