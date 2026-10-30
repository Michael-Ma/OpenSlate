import { characterSheetJobNode } from "./character-sheet-execution.js";
import { canonical, digest, invariant, providerProfileArguments } from "@openslate/core";
import type { ProjectRecord, ProviderProfile } from "@openslate/core";
import { isDemoExecution, profileExecutionIdentity } from "@openslate/providers";
import { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Candidate, ExternalExecutionAdmission, NodeBinding, PlanRecord } from "./engine.js";
export interface ExternalSelection { candidateId: string; nodeId: string; specDigest: string }

/** Re-read the exact canonical selection and pinned profile before any external dispatch. */
export function currentExternalSelection(store: Store, projectId: string, selection: ExternalSelection, profileDigest: string, profileDefinitionDigest: string): {
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
  invariant(!isDemoExecution(profileExecutionIdentity(profile)) && args.profileDigest === profileDigest && digest(profile) === profileDefinitionDigest
    && Object.entries(args).every(([key, value]) => Object.hasOwn(node.args, key) && canonical(node.args[key]) === canonical(value)),
  "EXTERNAL_PROFILE_MISMATCH", "Dispatch requires the exact current external profile and compiled settings");
  return { project, binding, profile };
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

