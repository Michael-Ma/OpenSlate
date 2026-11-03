import { canonical, digest, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionRequest } from "@openslate/providers";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Attempt } from "../execution/engine.js";
import { configuredProfileMatches } from "../execution/provider-use.js";
import type { Store } from "../persistence/store.js";
import type { CodePlanExecutionRecord } from "./execution.js";
import type { CodePlanCapabilityLock } from "./models.js";
import type { CodePlanHold, CodePlanRun, CodePlanStep } from "./records.js";
import { codePlanProviderArgs } from "./provider-input.js";
import { modelPrice, supportedCodePlanAdapters } from "./models.js";
import { isCodePlanVideoResolution, videoSubmissionLock, type VideoSubmissionPolicy } from "./video-settings.js";

export type CodePlanAuthorityStore = Pick<Store, "get" | "getProject" | "db">;
export interface CodePlanProviderAdmission {
  attempt: Attempt; candidate: null; grant: null; codePlan: CodePlanExecutionRecord;
  profile: ProviderProfile; capabilityLock: CodePlanCapabilityLock;
  /** Original profile used by the journal identity; resolution alone may differ at submission. */
  identityProfile?: ProviderProfile;
  /** Measured owned PNG dimensions, resolved by the host from the first-frame or first-reference image. */
  priceFrame?: { width: number; height: number };
  /** Adapter receipt projection of the step reservation, never a graph reservation row. */
  reservation: { id: string; projectId: string; attemptId: string; micros: string; state: string };
}
export const isCodePlanAttempt = (attempt: Pick<Attempt, "workKey">): boolean => attempt.workKey?.startsWith("code-plan:") === true;
const check = (value: unknown): void => invariant(value, "CODE_PLAN_PROVIDER_AUTHORITY", "Provider execution requires its exact saved code-plan intent and profile lock");

export function assertCodePlanProviderAdmission(value: CodePlanProviderAdmission): void {
  const { attempt, profile, capabilityLock: lock, codePlan: record } = value, request = attempt.request;
  if (value.identityProfile) {
    const policy = lock.codePlanVideo as VideoSubmissionPolicy | undefined, original = value.identityProfile;
    check(policy && policy.sourceProfileDefinitionDigest === digest(original) && original.adapter === "viggle-h3"
      && canonical(profile) === canonical({ ...original,
        configuration: { ...original.configuration!, settings: { ...original.configuration!.settings!, resolution: policy.resolution } } }));
  }
  const args = providerProfileArguments(profile);
  check(isCodePlanAttempt(attempt) && attempt.candidateId === null && attempt.reservationId === null && value.candidate === null && value.grant === null
    && attempt.id === request.attemptId && attempt.nodeId === request.nodeId && attempt.fingerprint === request.fingerprint
    && record.id === attempt.id && record.projectId === attempt.projectId && record.requestDigest === digest(request)
    && Number.isSafeInteger(record.planVersion) && Number(record.planVersion) > 0 && record.normalizedInput && record.priceMicros !== undefined
    && attempt.fingerprint === digest({ kind: request.kind, input: record.normalizedInput }) && attempt.specDigest === attempt.fingerprint
    && attempt.nodeId === attempt.workKey && (attempt.workKey === `code-plan:${attempt.projectId}:${attempt.fingerprint}:${attempt.ordinal}`
      || attempt.ordinal === 1 && attempt.workKey === `code-plan:${attempt.fingerprint}`)
    && supportedCodePlanAdapters.has(profile.adapter) && profile.kind === request.kind
    && request.execution.adapter === profile.adapter && request.execution.version === profile.executionVersion
    && lock.projectId === attempt.projectId && lock.profiles.length <= 64 && Buffer.byteLength(canonical(lock)) <= 65536
    && lock.profiles.some(row => canonical(row) === canonical(profile))
    && configuredProfileMatches(request, profile, lock.id, digest(lock))
    && request.profile?.id === profile.id && request.profile.revision === profile.revision && request.profile.digest === args.profileDigest
    && canonical(request.profile.configuration) === canonical(profile.configuration)
    && Object.entries(args).every(([key, item]) => canonical(request.args[key]) === canonical(item))
    && canonical(request.args) === canonical(codePlanProviderArgs(profile, record.normalizedInput, request.args.enhance === false ? { enhance: false } : {}))
    && record.normalizedInput.profileDefinitionDigest === digest(value.identityProfile ?? profile)
    && record.priceMicros === (profile.adapter === "viggle-h3" && request.args.enhance === undefined ? profile.unitCostMicros : modelPrice({ kind: request.kind as "image" | "video" | "speech" | "music", priceMicros: profile.unitCostMicros, profile }, record.normalizedInput, value.priceFrame))
    && ["reserved", "charged", "released"].includes(record.liability)
    && value.reservation.id === attempt.id && value.reservation.attemptId === attempt.id && value.reservation.projectId === attempt.projectId
    && value.reservation.micros === record.priceMicros && value.reservation.state === record.liability);
}

/** Historical verification does not depend on current version, installation readiness, Stop or human holds. */
export function resolveCodePlanProviderAdmission(store: CodePlanAuthorityStore, request: Readonly<ExecutionRequest>,
  pin?: { capabilityLockId: string; capabilityLockDigest: string; profileDefinition: ProviderProfile }): CodePlanProviderAdmission | null {
  const attempt = store.get<Attempt>("attempt", request.attemptId);
  if (!attempt || !isCodePlanAttempt(attempt)) return null;
  check(store.getProject(attempt.projectId).planMode === "code" && canonical(attempt.request) === canonical(request));
  const result = codePlanAdmissionFromAttempt(store, attempt);
  if (pin) check(pin.capabilityLockId === result.capabilityLock.id && pin.capabilityLockDigest === digest(result.capabilityLock)
    && canonical(pin.profileDefinition) === canonical(result.profile));
  return result;
}

/** Store insertion validates the receipt before the attempt row exists, within the same admission transaction. */
export function codePlanAdmissionFromAttempt(store: Pick<Store, "get">, attempt: Attempt): CodePlanProviderAdmission {
  const request = attempt.request;
  const record = store.get<CodePlanExecutionRecord>("code_plan_execution", attempt.id), use = request.providerUse;
  const lock = use ? store.get<CodePlanCapabilityLock>("capability_lock", use.capabilityLockId) : undefined;
  const profile = lock?.profiles.find(row => digest(row) === use?.profileDefinitionDigest);
  check(record && lock && profile);
  let identityProfile: ProviderProfile | undefined;
  if (lock?.codePlanVideo !== undefined) {
    const policy = lock.codePlanVideo as VideoSubmissionPolicy;
    const source = store.get<CodePlanCapabilityLock>("capability_lock", policy.sourceCapabilityLockId);
    identityProfile = source?.profiles.find(row => digest(row) === policy.sourceProfileDefinitionDigest);
    check(policy.version === 1 && isCodePlanVideoResolution(policy.resolution) && source?.projectId === attempt.projectId
      && identityProfile && canonical(lock) === canonical(videoSubmissionLock(source!, identityProfile, policy.resolution)));
  }
  const result: CodePlanProviderAdmission = { attempt, candidate: null, grant: null, codePlan: record!, profile: profile!, capabilityLock: lock!,
    ...(identityProfile ? { identityProfile } : {}),
    reservation: { id: attempt.id, projectId: attempt.projectId, attemptId: attempt.id, micros: record!.priceMicros!, state: record!.liability } };
  const frame = attempt.request.inputs.find(row => row.kind === "image" && row.sha256 === (attempt.request.args.firstFrameSha256 ?? (Array.isArray(attempt.request.args.references) ? attempt.request.args.references[0] : undefined)));
  const artifact = frame ? store.get<{ projectId: string; width: number; height: number; artifact: { sha256: string } }>("artifact", frame.artifactId) : undefined;
  if (artifact?.projectId === attempt.projectId && artifact.artifact.sha256 === frame?.sha256) result.priceFrame = { width: artifact.width, height: artifact.height };
  assertCodePlanProviderAdmission(result);
  return result;
}

/** Lease-only check permits a definitive no-submit receipt after a newer edit fences first dispatch. */
export function assertCodePlanProviderLease(store: Store, previous: Attempt, expected: ExecutionCallOptions["expectedLease"], reconciling = false): void {
  new InstallationRecoveryGuard(store).assertFirstSubmit(previous.projectId, previous.id);
  const current = resolveCodePlanProviderAdmission(store, previous.request);
  check(current && expected && Object.keys(expected).length === 2 && expected.owner === previous.leaseOwner && expected.epoch === previous.leaseEpoch
    && current.attempt.leaseOwner === expected.owner && current.attempt.leaseEpoch === expected.epoch && current.attempt.leaseExpiresAt > Date.now()
    && (current.attempt.phase === "submitting" || reconciling && current.attempt.phase === "submission_unknown") && current.codePlan.liability === "reserved");
}

export function assertCodePlanFirstDispatch(store: Store, previous: Attempt, expected: ExecutionCallOptions["expectedLease"]): void {
  assertCodePlanProviderLease(store, previous, expected);
  const admission = resolveCodePlanProviderAdmission(store, previous.request)!;
  const project = store.getProject(previous.projectId), run = store.get<CodePlanRun>("code_plan_run", project.id);
  const step = store.get<CodePlanStep>("code_plan_step", digest({ projectId: project.id, key: previous.fingerprint }));
  const lock = store.get<CodePlanCapabilityLock>("capability_lock", project.capabilityLockId);
  invariant(run?.planVersion === admission.codePlan.planVersion && step?.attemptId === previous.id
    && step.priceMicros === admission.codePlan.priceMicros && lock?.profiles.some(row => canonical(row) === canonical(admission.identityProfile ?? admission.profile))
    && !store.get<{ paused: boolean }>("execution_control", project.id)?.paused,
  "CODE_PLAN_SELECTION_CHANGED", "A later plan, profile change or Stop fenced this submission");
  if (moneyMicros(step.priceMicros) > 0n) invariant(!store.list<CodePlanHold>("code_plan_hold", project.id).some(hold => !hold.released),
    "CODE_PLAN_SELECTION_CHANGED", "A human request holds new paid work");
  const admitted = store.list<CodePlanExecutionRecord>("code_plan_execution", project.id);
  const liability = admitted.reduce((sum, record) => sum + (record.liability === "released" ? 0n : moneyMicros(record.priceMicros ?? "0")), 0n);
  invariant(liability <= moneyMicros(run!.ceilingMicros) && admitted.length <= 200, "CODE_PLAN_CEILING", "Code-plan admission exceeds its circuit breakers");
}
