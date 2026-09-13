import { canonical, digest, invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionRequest } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Attempt, Candidate, Grant } from "./engine.js";
import { assertExternalAllowance, assertExternalAllowanceConsumption } from "./external-allowance-records.js";
import type { AllowanceHumanRequest, ExternalAllowance, ExternalAllowanceConsumption } from "./external-allowance-records.js";
import { assertTranscriptionExecutionProfile, assertTranscriptionExecutionMapping } from "./transcription-execution-receipts.js";
import type { TranscriptionExecutionMapping } from "./transcription-execution-receipts.js";
import type { TranscriptionExecutionPreparation } from "./transcription-execution-receipts.js";
import { TRANSCRIPTION_EXECUTION_PARSER } from "./transcription-execution-receipts.js";
import { assertTranscriptionAudioIntent, assertTranscriptionAudioReceipt, resolveTranscriptionAudioSource, transcriptionAudioId, transcriptionAudioInput } from "./transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt, TranscriptionAudioSourceRecord } from "./transcription-audio.js";
import type { OpenAITranscriptionDescription } from "@openslate/providers";
import { assertOwnedTranscriptionAttemptCurrent, resolveOwnedTranscriptionAttempt } from "./owned-transcription-execution.js";

export interface TranscriptionCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; [key: string]: unknown }
export interface TranscriptionReservation { id: string; projectId: string; attemptId: string; micros: string; state: string }
export interface TranscriptionAdmission {
  attempt: Attempt; candidate: Candidate; grant: Grant; reservation: TranscriptionReservation;
  allowance: ExternalAllowance; consumption: ExternalAllowanceConsumption; allowanceRequest: AllowanceHumanRequest;
  profile: ProviderProfile; capabilityLock: TranscriptionCapabilityLock;
}
export type TranscriptionProfilePin = Pick<TranscriptionExecutionMapping, "capabilityLockId" | "capabilityLockDigest" | "profileDefinition">;
export type TranscriptionAuthorityStore = Pick<Store, "get" | "getProject" | "db">;
export const TRANSCRIPTION_PROFILE_LOOKUP_LIMITS = Object.freeze({ locks: 128, lockBytes: 65536, profiles: 64 });
const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPTION_EXECUTION_CONFLICT", message);

/** Historical proof only: neither current selection nor current allowance availability is reinterpreted here. */
export function assertTranscriptionAdmission(value: TranscriptionAdmission): void {
  const { attempt, candidate, grant, reservation, allowance, consumption, allowanceRequest, profile, capabilityLock } = value;
  fail(attempt && attempt.id === attempt.request.attemptId && attempt.nodeId === attempt.request.nodeId && attempt.fingerprint === attempt.request.fingerprint
    && attempt.request.kind === "transcription" && attempt.request.execution?.adapter === "openai-transcription" && attempt.request.execution.version === "1"
    && attempt.taskId === null && candidate?.id === attempt.candidateId && candidate.projectId === attempt.projectId && candidate.nodeId === attempt.nodeId
    && grant?.id === candidate.grantId && grant.projectId === attempt.projectId && grant.kind === "transcription" && grant.origin === candidate.origin
    && reservation?.id === attempt.reservationId && reservation.projectId === attempt.projectId && reservation.attemptId === attempt.id
    && ["reserved", "charged", "released"].includes(reservation.state), "Transcription requires its exact admitted candidate, grant and reservation");
  assertExternalAllowance(allowance, allowanceRequest); assertExternalAllowanceConsumption(consumption, allowance, attempt, reservation);
  assertTranscriptionExecutionProfile(profile, attempt);
  fail(digest(profile) === consumption.profileDefinitionDigest && digest(profile) === allowance.profileDefinitionDigest
    && profile.unitCostMicros === consumption.estimatedMicros && profile.unitCostMicros === reservation.micros,
  "Transcription profile estimate differs from its consumed allowance and reservation");
  fail(capabilityLock?.projectId === attempt.projectId && typeof capabilityLock.id === "string"
    && Array.isArray(capabilityLock.profiles) && capabilityLock.profiles.length > 0 && capabilityLock.profiles.length <= TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.profiles
    && Buffer.byteLength(canonical(capabilityLock)) <= TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.lockBytes
    && capabilityLock.profiles.some(item => canonical(item) === canonical(profile)), "Transcription profile lacks retained matching lock evidence");
}
export function assertTranscriptionMappingAdmission(admission: TranscriptionAdmission, mapping: TranscriptionExecutionMapping, preparation: TranscriptionExecutionPreparation): void {
  assertTranscriptionAdmission(admission); assertTranscriptionExecutionMapping(admission.attempt, mapping, preparation);
  fail(mapping.capabilityLockId === admission.capabilityLock.id && mapping.capabilityLockDigest === digest(admission.capabilityLock)
    && canonical(mapping.profileDefinition) === canonical(admission.profile) && mapping.allowanceId === admission.allowance.id
    && mapping.allowanceDigest === digest(admission.allowance) && mapping.consumptionDigest === digest(admission.consumption)
    && mapping.estimatedMicros === admission.reservation.micros, "Transcription mapping lost its exact retained admission evidence");
}

/** Only retained, keyed evidence. This does not run preparation, acquire a lease, read media bytes or create authority. */
export function resolveTranscriptionPreparation(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>, pinned?: TranscriptionExecutionMapping): TranscriptionExecutionPreparation {
  const id = transcriptionAudioId(attempt.projectId, attempt.id);
  fail(!pinned || (pinned.preparation.intentId === id && pinned.preparation.receiptId === id), "Transcription mapping references another preparation");
  const intent = store.get<TranscriptionAudioIntent>("transcription_audio_intent", id), receipt = store.get<TranscriptionAudioReceipt>("transcription_audio_receipt", id);
  fail(intent && receipt, "Transcription requires its exact completed preparation records");
  const owned = resolveOwnedTranscriptionAttempt(store, attempt);
  fail(!owned || canonical(intent!.sourceRecord) === canonical(owned.source.sourceRecord), "Transcription derivative lost its reviewed source provenance");
  const input = transcriptionAudioInput(attempt as Attempt);
  const records = (["media_source", "narration_audio"] as const).flatMap(kind => {
    const record = store.get<TranscriptionAudioSourceRecord["record"]>(kind, input.artifactId); return record ? [{ kind, record }] : [];
  });
  const selected = resolveTranscriptionAudioSource(attempt as Attempt, records, intent!.sourceRecord);
  assertTranscriptionAudioIntent(intent!, attempt as Attempt, selected); assertTranscriptionAudioReceipt(intent!, receipt!);
  fail(!pinned || (pinned.preparation.intentDigest === digest(intent) && pinned.preparation.receiptDigest === digest(receipt)),
    "Transcription mapping lost its exact preparation identity");
  return structuredClone({ intent: intent!, receipt: receipt! });
}

/** The caller supplies the description computed from the verified upload bytes, not a model-authored digest. */
export function createTranscriptionExecutionMapping(admission: TranscriptionAdmission, intent: TranscriptionAudioIntent,
  receipt: TranscriptionAudioReceipt, description: OpenAITranscriptionDescription): TranscriptionExecutionMapping {
  const { attempt, profile, capabilityLock, allowance, consumption, reservation } = admission;
  const mapping: TranscriptionExecutionMapping = { id: attempt.id, projectId: attempt.projectId, version: 1, attemptId: attempt.id,
    requestDigest: digest(attempt.request), profileDigest: attempt.request.profile!.digest, profileDefinitionDigest: digest(profile), profileDefinition: profile,
    capabilityLockId: capabilityLock.id, capabilityLockDigest: digest(capabilityLock), allowanceId: allowance.id, allowanceDigest: digest(allowance),
    consumptionDigest: digest(consumption), estimatedMicros: reservation.micros,
    preparation: { intentId: intent.id, intentDigest: digest(intent), receiptId: receipt.id, receiptDigest: digest(receipt) },
    source: { record: intent.sourceRecord, descriptor: intent.source, startSample: 0, endSample: intent.sourceEndSample }, derivative: receipt.audio,
    parser: TRANSCRIPTION_EXECUTION_PARSER, transport: description };
  assertTranscriptionMappingAdmission(admission, mapping, { intent, receipt }); return structuredClone(mapping);
}

/** Resolve by recorded full-definition digest. The initial bounded scan proves a match, not which lock originated admission. */
export function resolveTranscriptionAdmission(store: TranscriptionAuthorityStore, input: Readonly<ExecutionRequest>, pinned?: TranscriptionProfilePin): TranscriptionAdmission {
  const request = structuredClone(input), attempt = store.get<Attempt>("attempt", request.attemptId);
  fail(attempt && canonical(attempt.request) === canonical(request) && attempt.candidateId && attempt.reservationId,
    "Transcription requires an unchanged stored admission");
  const current = attempt!;
  resolveOwnedTranscriptionAttempt(store, current);
  const candidate = store.get<Candidate>("candidate", current.candidateId!), grant = candidate ? store.get<Grant>("grant", candidate.grantId) : undefined;
  const reservation = store.get<TranscriptionReservation>("reservation", current.reservationId!);
  const allowance = store.get<ExternalAllowance>("external_allowance", request.externalAllowanceId ?? "");
  const consumption = store.get<ExternalAllowanceConsumption>("external_allowance_consumption", current.id);
  const allowanceRequest = allowance ? store.get<AllowanceHumanRequest>("message", allowance.requestId) : undefined;
  fail(candidate && grant && reservation && allowance && consumption && allowanceRequest, "Transcription requires durable allowance consumption and its human issue evidence");
  const lockAt = (id: string): TranscriptionCapabilityLock | undefined => {
    const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='capability_lock' AND id=?").get(id) as { project_id: string; bytes: number } | undefined;
    if (!meta) return undefined;
    fail(meta.project_id === current.projectId && meta.bytes <= TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.lockBytes, "Retained profile lock is foreign or exceeds its byte bound");
    const lock = store.get<TranscriptionCapabilityLock>("capability_lock", id)!;
    fail(lock.id === id && lock.projectId === current.projectId && Array.isArray(lock.profiles) && lock.profiles.length > 0
      && lock.profiles.length <= TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.profiles, "Invalid retained profile lock"); return lock;
  };
  const matching = (lock: TranscriptionCapabilityLock | undefined): ProviderProfile | undefined => lock?.profiles.find(profile => profile
    && profile.id === request.profile?.id && profile.revision === request.profile?.revision && digest(profile) === consumption!.profileDefinitionDigest);
  let capabilityLock: TranscriptionCapabilityLock | undefined, profile: ProviderProfile | undefined;
  if (pinned) {
    capabilityLock = lockAt(pinned.capabilityLockId); profile = matching(capabilityLock);
    fail(capabilityLock && digest(capabilityLock) === pinned.capabilityLockDigest && profile && canonical(profile) === canonical(pinned.profileDefinition),
      "Pinned transcription profile evidence is missing or changed");
  } else {
    capabilityLock = lockAt(store.getProject(current.projectId).capabilityLockId); profile = matching(capabilityLock);
    if (!profile) {
      const rows = store.db.prepare("SELECT id FROM entities WHERE kind='capability_lock' AND project_id=? ORDER BY id LIMIT ?")
        .all(current.projectId, TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.locks + 1) as { id: string }[];
      invariant(rows.length <= TRANSCRIPTION_PROFILE_LOOKUP_LIMITS.locks, "TRANSCRIPTION_PROFILE_LOOKUP_LIMIT", "Historical profile lookup exceeds its fixed bound");
      for (const row of rows) { const lock = lockAt(row.id), found = matching(lock); if (found) { capabilityLock = lock; profile = found; break; } }
    }
    fail(profile, "The consumed transcription profile definition has no retained matching lock");
  }
  const result = { attempt: current, candidate: candidate!, grant: grant!, reservation: reservation!, allowance: allowance!, consumption: consumption!,
    allowanceRequest: allowanceRequest!, profile: profile!, capabilityLock: capabilityLock! };
  assertTranscriptionAdmission(result); return structuredClone(result);
}

/** Use inside the short pre-marker/local-failure transaction; late provider observations use no first-submit check. */
export function assertTranscriptionFirstDispatch(store: Store, original: TranscriptionAdmission, expectedLease: ExecutionCallOptions["expectedLease"]): void {
  assertTranscriptionSubmissionOwner(store, original, expectedLease);
  assertOwnedTranscriptionAttemptCurrent(store, original.attempt);
}

/** Ownership only, so start can retain positive pre-submit proof before settling a newly obsolete selection. */
export function assertTranscriptionSubmissionOwner(store: Store, original: TranscriptionAdmission, expectedLease: ExecutionCallOptions["expectedLease"]): void {
  new InstallationRecoveryGuard(store).assertFirstSubmit(original.attempt.projectId, original.attempt.id);
  const current = resolveTranscriptionAdmission(store, original.attempt.request, { capabilityLockId: original.capabilityLock.id,
    capabilityLockDigest: digest(original.capabilityLock), profileDefinition: original.profile });
  invariant(expectedLease && Object.keys(expectedLease).length === 2 && expectedLease.owner === original.attempt.leaseOwner
    && expectedLease.epoch === original.attempt.leaseEpoch && current.attempt.leaseOwner === expectedLease.owner
    && current.attempt.leaseEpoch === expectedLease.epoch && current.attempt.leaseExpiresAt > Date.now()
    && current.attempt.phase === "submitting" && current.reservation.state === "reserved",
  "TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE", "Transcription no longer owns its original unexpired submitting lease");
}
