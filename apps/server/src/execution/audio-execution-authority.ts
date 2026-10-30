import { configuredProfileMatches, providerAdmissionRequest } from "./provider-use.js";
import { canonical, digest, invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionRequest } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Attempt, Candidate, Grant } from "./engine.js";
import { assertSpeechExecutionProfile, assertSpeechExecutionMapping } from "./audio-execution-receipts.js";
import type { SpeechExecutionMapping } from "./audio-execution-receipts.js";
import { assertNarrationSpeechAttemptInput } from "../narration/narration-speech-authorization.js";
import { assertNarrationSpeechAttemptCurrent } from "./narration-speech-execution.js";

export interface SpeechCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; [key: string]: unknown }
export interface SpeechReservation { id: string; projectId: string; attemptId: string; micros: string; state: string }
export interface SpeechAdmission {
  attempt: Attempt; candidate: Candidate; grant: Grant; reservation: SpeechReservation;
  profile: ProviderProfile; capabilityLock: SpeechCapabilityLock;
}
export type SpeechProfilePin = Pick<SpeechExecutionMapping, "capabilityLockId" | "capabilityLockDigest" | "profileDefinition">;
export type SpeechAuthorityStore = Pick<Store, "get" | "getProject" | "db">;
export const SPEECH_PROFILE_LOOKUP_LIMITS = Object.freeze({ lockBytes: 65536, profiles: 64 });
const fail = (condition: unknown, message: string): void => invariant(condition, "SPEECH_EXECUTION_CONFLICT", message);

/** Retained admission proof; current selection is checked separately before first submit. */
export function assertSpeechAdmission(value: SpeechAdmission): void {
  const { attempt, candidate, grant, reservation, profile, capabilityLock } = value;
  fail(attempt && attempt.id === attempt.request.attemptId && attempt.nodeId === attempt.request.nodeId && attempt.fingerprint === attempt.request.fingerprint
    && attempt.request.kind === "speech" && attempt.request.execution?.adapter === "openai-speech" && attempt.request.execution.version === "1"
    && attempt.taskId === null && candidate?.id === attempt.candidateId && candidate.projectId === attempt.projectId && candidate.nodeId === attempt.nodeId
    && grant?.id === candidate.grantId && grant.projectId === attempt.projectId && grant.kind === "speech" && grant.origin === candidate.origin
    && reservation?.id === attempt.reservationId && reservation.projectId === attempt.projectId && reservation.attemptId === attempt.id
    && ["reserved", "charged", "released"].includes(reservation.state), "Speech requires its exact admitted candidate, grant and reservation");
  fail(configuredProfileMatches(attempt.request, profile, capabilityLock.id, digest(capabilityLock)), "Configured provider proof differs from its exact original profile lock");
  assertSpeechExecutionProfile(profile, attempt);
  fail(profile.unitCostMicros === reservation.micros, "Speech profile estimate differs from its reservation");
  fail(capabilityLock?.projectId === attempt.projectId && typeof capabilityLock.id === "string"
    && Array.isArray(capabilityLock.profiles) && capabilityLock.profiles.length > 0 && capabilityLock.profiles.length <= SPEECH_PROFILE_LOOKUP_LIMITS.profiles
    && Buffer.byteLength(canonical(capabilityLock)) <= SPEECH_PROFILE_LOOKUP_LIMITS.lockBytes
    && capabilityLock.profiles.some(item => canonical(item) === canonical(profile)), "Speech profile lacks retained matching lock evidence");
}
export function assertSpeechMappingAdmission(admission: SpeechAdmission, mapping: SpeechExecutionMapping): void {
  assertSpeechAdmission(admission); assertSpeechExecutionMapping(admission.attempt, mapping);
  fail(mapping.capabilityLockId === admission.capabilityLock.id && mapping.capabilityLockDigest === digest(admission.capabilityLock)
    && canonical(mapping.profileDefinition) === canonical(admission.profile)
    && mapping.estimatedMicros === admission.reservation.micros, "Speech mapping lost its exact retained admission evidence");
}

/** Resolve the exact original lock and full profile definition recorded at admission. */
export function resolveSpeechAdmission(store: SpeechAuthorityStore, input: Readonly<ExecutionRequest>, pinned?: SpeechProfilePin): SpeechAdmission {
  const request = structuredClone(input), attempt = store.get<Attempt>("attempt", request.attemptId);
  fail(attempt && canonical(attempt.request) === canonical(request) && attempt.candidateId && attempt.reservationId,
    "Speech requires an unchanged stored admission");
  const current = attempt!;
  assertNarrationSpeechAttemptInput(store, current);
  const candidate = store.get<Candidate>("candidate", current.candidateId!), grant = candidate ? store.get<Grant>("grant", candidate.grantId) : undefined;
  const reservation = store.get<SpeechReservation>("reservation", current.reservationId!);
  fail(providerAdmissionRequest(request) && candidate && grant && reservation, "Dispatch requires its exact candidate, grant and recorded provider-use evidence");
  const lockAt = (id: string): SpeechCapabilityLock | undefined => {
    const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='capability_lock' AND id=?").get(id) as { project_id: string; bytes: number } | undefined;
    if (!meta) return undefined;
    fail(meta.project_id === current.projectId && meta.bytes <= SPEECH_PROFILE_LOOKUP_LIMITS.lockBytes, "Retained profile lock is foreign or exceeds its byte bound");
    const lock = store.get<SpeechCapabilityLock>("capability_lock", id)!;
    fail(lock.id === id && lock.projectId === current.projectId && Array.isArray(lock.profiles) && lock.profiles.length > 0
      && lock.profiles.length <= SPEECH_PROFILE_LOOKUP_LIMITS.profiles, "Invalid retained profile lock"); return lock;
  };
  const matching = (lock: SpeechCapabilityLock | undefined): ProviderProfile | undefined => lock?.profiles.find(profile => profile
    && profile.id === request.profile?.id && profile.revision === request.profile?.revision && digest(profile) === request.providerUse!.profileDefinitionDigest);
  let capabilityLock: SpeechCapabilityLock | undefined, profile: ProviderProfile | undefined;
  if (pinned) {
    capabilityLock = lockAt(pinned.capabilityLockId); profile = matching(capabilityLock);
    fail(capabilityLock && digest(capabilityLock) === pinned.capabilityLockDigest && profile && canonical(profile) === canonical(pinned.profileDefinition),
      "Pinned speech profile evidence is missing or changed");
  } else {
    capabilityLock = lockAt(request.providerUse!.capabilityLockId); profile = matching(capabilityLock);
    fail(profile, "The admitted speech profile definition has no retained matching lock");
  }
  const result = { attempt: current, candidate: candidate!, grant: grant!, reservation: reservation!, profile: profile!, capabilityLock: capabilityLock! };
  assertSpeechAdmission(result); return structuredClone(result);
}

/** Use inside the short pre-marker/local-failure transaction; late provider observations use no first-submit check. */
export function assertSpeechFirstDispatch(store: Store, original: SpeechAdmission, expectedLease: ExecutionCallOptions["expectedLease"]): void {
  new InstallationRecoveryGuard(store).assertFirstSubmit(original.attempt.projectId, original.attempt.id);
  const current = resolveSpeechAdmission(store, original.attempt.request, { capabilityLockId: original.capabilityLock.id,
    capabilityLockDigest: digest(original.capabilityLock), profileDefinition: original.profile });
  invariant(expectedLease && Object.keys(expectedLease).length === 2 && expectedLease.owner === original.attempt.leaseOwner
    && expectedLease.epoch === original.attempt.leaseEpoch && current.attempt.leaseOwner === expectedLease.owner
    && current.attempt.leaseEpoch === expectedLease.epoch && current.attempt.leaseExpiresAt > Date.now()
    && current.attempt.phase === "submitting" && current.reservation.state === "reserved",
  "SPEECH_EXECUTION_NOT_DISPATCHABLE", "Speech no longer owns its original unexpired submitting lease");
  invariant(!current.attempt.candidateId || !store.get("candidate_stop", current.attempt.candidateId),
    "SPEECH_EXECUTION_NOT_DISPATCHABLE", "Stop ended this candidate's first-dispatch authority");
  assertNarrationSpeechAttemptCurrent(store, current.attempt);
}
