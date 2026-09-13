import { canonical, digest, DomainError, invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Attempt } from "./engine.js";
import { resolveTranscriptionAdmission } from "./transcription-execution-authority.js";
import type { TranscriptionAuthorityStore } from "./transcription-execution-authority.js";
import { resolveTranscriptionAudioSource, transcriptionAudioInput } from "./transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioSourceRecord } from "./transcription-audio.js";
import { transcriptionExecutionOptions } from "./transcription-execution-receipts.js";
import type { SubmissionPreparationContext } from "./submission-preparation.js";
import { assertSubmissionPreparationEligibility } from "./submission-preparation.js";
import type { Store } from "../persistence/store.js";

export interface TranscriptionPreparationIntent {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string;
  candidateId: string; candidateDigest: string; grantId: string; grantDigest: string;
  reservation: { id: string; micros: string };
  allowanceId: string; allowanceDigest: string; consumptionDigest: string;
  capabilityLockId: string; capabilityLockDigest: string;
  profileDefinition: ProviderProfile; profileDefinitionDigest: string;
  sourceRecord: TranscriptionAudioIntent["sourceRecord"]; source: TranscriptionAudioIntent["source"];
  sourceStartSample: 0; sourceEndSample: number;
}
const fail = (condition: unknown): void => invariant(condition, "SUBMISSION_PREPARATION_INVALID", "Preparation proof differs from its exact retained admission and source");

function snapshotIntent(input: TranscriptionPreparationIntent): TranscriptionPreparationIntent {
  let nodes = 0, bytes = 0; const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    fail(++nodes <= 2048 && depth <= 16);
    if (typeof value === "string") { bytes += Buffer.byteLength(value); fail(bytes <= 65536); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { fail(Number.isFinite(value)); return value; }
    fail(value && typeof value === "object" && !Array.isArray(value) && !ancestors.has(value as object)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const object = value as object, keys = Reflect.ownKeys(object); fail(keys.length <= 64); ancestors.add(object);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      fail(typeof key === "string"); const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value") && property.enumerable); bytes += Buffer.byteLength(key as string); fail(bytes <= 65536);
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(object); return result;
  };
  const result = copy(input, 0) as TranscriptionPreparationIntent; fail(Buffer.byteLength(canonical(result)) <= 65536); return result;
}
function selectedSource(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>, pin?: TranscriptionPreparationIntent["sourceRecord"]) {
  const input = transcriptionAudioInput(attempt as Attempt);
  const records = (["media_source", "narration_audio"] as const).flatMap(kind => {
    const record = store.get<TranscriptionAudioSourceRecord["record"]>(kind, input.artifactId); return record ? [{ kind, record }] : [];
  });
  return resolveTranscriptionAudioSource(attempt as Attempt, records, pin);
}
function initialInput<T>(read: () => T): T {
  try { return read(); }
  catch (error) {
    const code = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "code")?.value : undefined;
    // This wrapper is used only around the pure operation/source selection
    // checks, never admission, persistence, lease or eligibility operations.
    if (error instanceof DomainError && ["TRANSCRIPTION_AUDIO_CONFLICT", "TRANSCRIPTION_EXECUTION_CONFLICT"].includes(code)
      || error instanceof Error && ["UNSUPPORTED_MODEL", "UNSUPPORTED_TIMING", "INVALID_LANGUAGE"].includes(code))
      throw new DomainError("SUBMISSION_PREPARATION_INPUT_INVALID", "The admitted transcription input is unsupported or has no exact owned source");
    throw error;
  }
}
function expectedIntent(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>, pin?: TranscriptionPreparationIntent, initial = false): TranscriptionPreparationIntent {
  fail(attempt && typeof attempt.id === "string" && attempt.request);
  if (initial) initialInput(() => transcriptionExecutionOptions(attempt.request)); else transcriptionExecutionOptions(attempt.request);
  const admission = resolveTranscriptionAdmission(store, attempt.request, pin);
  const selected = initial ? initialInput(() => selectedSource(store, attempt, pin?.sourceRecord)) : selectedSource(store, attempt, pin?.sourceRecord);
  const source = (selected.kind === "media_source" ? selected.record.source : selected.record.media)!;
  return { id: attempt.id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request),
    candidateId: admission.candidate.id, candidateDigest: digest(admission.candidate), grantId: admission.grant.id, grantDigest: digest(admission.grant),
    reservation: { id: admission.reservation.id, micros: admission.reservation.micros }, allowanceId: admission.allowance.id,
    allowanceDigest: digest(admission.allowance), consumptionDigest: digest(admission.consumption),
    capabilityLockId: admission.capabilityLock.id, capabilityLockDigest: digest(admission.capabilityLock),
    profileDefinition: admission.profile, profileDefinitionDigest: digest(admission.profile),
    sourceRecord: { kind: selected.kind, id: selected.record.id, digest: digest(selected.record) }, source,
    sourceStartSample: 0, sourceEndSample: source.probe.audio!.samples! };
}

/** Synchronous only: pins the owned descriptor before any physical reads, recipe discovery or conversion. */
export function createTranscriptionPreparationIntent(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>): TranscriptionPreparationIntent {
  return snapshotIntent(expectedIntent(store, attempt, undefined, true));
}
/** Historical closure. No active lease, current plan, or present reservation state is required here. */
export function assertTranscriptionPreparationIntent(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>, input: TranscriptionPreparationIntent): void {
  const proof = snapshotIntent(input);
  fail(canonical(proof) === canonical(expectedIntent(store, attempt, proof)));
}
export function resolveTranscriptionPreparationIntent(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>): TranscriptionPreparationIntent {
  fail(attempt && typeof attempt.id === "string");
  const proof = store.get<TranscriptionPreparationIntent>("transcription_preparation_intent", attempt.id);
  fail(proof && attempt.preparation && attempt.preparation.intentId === attempt.id && attempt.preparation.intentDigest === digest(proof));
  assertTranscriptionPreparationIntent(store, attempt, proof!); return snapshotIntent(proof!);
}

/** Active authority is separate from immutable proof validation and is captured by the original caller. */
export function assertOwnedTranscriptionPreparation(store: Store, attempt: Readonly<Attempt>, context: SubmissionPreparationContext): TranscriptionPreparationIntent {
  const current = store.get<Attempt>("attempt", attempt.id), lease = context.expectedLease;
  invariant(current && current.projectId === attempt.projectId && canonical(current.request) === canonical(attempt.request)
    && current.phase === "preparing" && current.leaseOwner === lease.owner && current.leaseEpoch === lease.epoch
    && attempt.leaseOwner === lease.owner && attempt.leaseEpoch === lease.epoch && current.leaseExpiresAt > Date.now(),
  "SUBMISSION_PREPARATION_LEASE_LOST", "Preparation no longer owns its original active lease");
  const proof = resolveTranscriptionPreparationIntent(store, current);
  const reservation = store.get<{ state: string }>("reservation", proof.reservation.id);
  invariant(reservation?.state === "reserved", "SUBMISSION_PREPARATION_LEASE_LOST", "Preparation requires its original reserved liability");
  new InstallationRecoveryGuard(store).assertFirstSubmit(attempt.projectId, attempt.id);
  assertSubmissionPreparationEligibility(context);
  return proof;
}
