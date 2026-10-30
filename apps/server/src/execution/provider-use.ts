import { codePlanAdmissionFromAttempt, isCodePlanAttempt } from "../code-plan/provider-authority.js";
import { canonical, digest, invariant, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionRequest } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import type { Attempt, Candidate, Grant } from "./engine.js";

const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const externalV1 = new Set(["openai-image", "codex-image", "minimax-h3", "viggle-h3", "openai-speech", "openai-transcription", "fal-h3-lipsync", "gemini-lyria"]);

/** A recorded host policy binding the exact capability lock and full profile definition. */
export function configuredProviderUse(request: ExecutionRequest): boolean {
  const use = request.providerUse;
  return !!use && use.kind === "configured"
    && Object.keys(use).length === 4 && id(use.capabilityLockId) && hash(use.capabilityLockDigest) && hash(use.profileDefinitionDigest);
}
export function providerAdmissionRequest(request: ExecutionRequest): boolean {
  return configuredProviderUse(request);
}
export function configuredProfileMatches(request: ExecutionRequest, profile: ProviderProfile, lockId: string, lockDigest: string): boolean {
  return configuredProviderUse(request) && request.providerUse!.capabilityLockId === lockId
    && request.providerUse!.capabilityLockDigest === lockDigest && request.providerUse!.profileDefinitionDigest === digest(profile);
}

/** Historical identity check also usable before the reservation is inserted in the admission transaction. */
export function assertConfiguredProviderPin(store: Pick<Store, "get">, attempt: Attempt): ProviderProfile | null {
  if (!attempt.request) return null;
  if (isCodePlanAttempt(attempt) && Object.hasOwn(attempt.request, "providerUse")) return codePlanAdmissionFromAttempt(store, attempt).profile;
  if (!Object.hasOwn(attempt.request, "providerUse")) {
    if (attempt.request.execution?.version === "1" && externalV1.has(attempt.request.execution.adapter))
      invariant(false, "CONFIGURED_PROVIDER_ADMISSION_CONFLICT", "External work requires its recorded provider-use proof");
    return null;
  }
  invariant(configuredProviderUse(attempt.request), "CONFIGURED_PROVIDER_ADMISSION_CONFLICT", "Configured provider use must retain its exact recorded proof");
  const use = attempt.request.providerUse!, lock = store.get<{ id: string; projectId: string; profiles: ProviderProfile[] }>("capability_lock", use.capabilityLockId);
  const candidate = store.get<Candidate>("candidate", attempt.candidateId ?? ""), grant = candidate ? store.get<Grant>("grant", candidate.grantId) : undefined;
  const profile = Array.isArray(lock?.profiles) ? lock.profiles.find(row => digest(row) === use.profileDefinitionDigest) : undefined;
  const args = profile ? providerProfileArguments(profile) : {};
  invariant(id(attempt.id) && attempt.id === attempt.request.attemptId && attempt.nodeId === attempt.request.nodeId
    && attempt.fingerprint === attempt.request.fingerprint && id(attempt.reservationId)
    && lock && lock.id === use.capabilityLockId && lock.projectId === attempt.projectId && profile
    && configuredProfileMatches(attempt.request, profile, lock.id, digest(lock))
    && ["image", "video", "speech", "transcription"].includes(profile.kind) && profile.adapter !== "fake"
    && profile.kind === attempt.request.kind && profile.adapter === attempt.request.execution?.adapter
    && profile.executionVersion === attempt.request.execution.version
    && attempt.request.profile?.id === profile.id && attempt.request.profile.revision === profile.revision
    && attempt.request.profile.digest === args.profileDigest && canonical(attempt.request.profile.configuration) === canonical(profile.configuration)
    && Object.entries(args).every(([key, value]) => canonical(attempt.request.args[key]) === canonical(value))
    && candidate?.id === attempt.candidateId && candidate.projectId === attempt.projectId && candidate.nodeId === attempt.nodeId
    && grant?.id === candidate.grantId && grant.projectId === attempt.projectId && grant.kind === attempt.request.kind && grant.origin === candidate.origin,
  "CONFIGURED_PROVIDER_ADMISSION_CONFLICT", "Provider-use proof differs from its original candidate, grant or pinned profile lock");
  return profile;
}

/** Retained proof; current selection and Stop are checked separately before first submit. */
export function assertConfiguredProviderAdmission(store: Pick<Store, "get">, attempt: Attempt): void {
  const profile = assertConfiguredProviderPin(store, attempt); if (!profile) return;
  if (isCodePlanAttempt(attempt)) { codePlanAdmissionFromAttempt(store, attempt); return; }
  const reservation = store.get<{ id: string; projectId: string; attemptId: string; micros: string; state: string }>("reservation", attempt.reservationId!);
  invariant(reservation?.id === attempt.reservationId && reservation.projectId === attempt.projectId && reservation.attemptId === attempt.id
    && reservation.micros === profile.unitCostMicros && ["reserved", "charged", "released"].includes(reservation.state),
  "CONFIGURED_PROVIDER_ADMISSION_CONFLICT", "Configured provider admission lost its original reservation");
}
