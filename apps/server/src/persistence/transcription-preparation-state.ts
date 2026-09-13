import { canonical, digest, invariant } from "@openslate/core";
import type { Attempt } from "../execution/engine.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { transcriptionAudioInput } from "../execution/transcription-audio.js";
import type { TranscriptionAuthorityStore } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionMappingAdmission, resolveTranscriptionAdmission, resolveTranscriptionPreparation } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionExecutionDispatch, assertTranscriptionExecutionResult } from "../execution/transcription-execution-receipts.js";
import type { TranscriptionExecutionDispatch, TranscriptionExecutionMapping, TranscriptionExecutionResult } from "../execution/transcription-execution-receipts.js";
import { resolveTranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import type { TranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import type { OutputReceipt } from "../execution/output-store.js";

const fail = (value: unknown, message: string): void => invariant(value, "SUBMISSION_PREPARATION_INVALID", message);
const obsolete = { id: "PREPARATION_OBSOLETE", technical: false, source: "application:submission-preparation/1", retryAllowed: false };

export function assertTranscriptionPreparationMapping(proof: TranscriptionPreparationIntent, mapping: TranscriptionExecutionMapping): void {
  fail(mapping.capabilityLockId === proof.capabilityLockId && mapping.capabilityLockDigest === proof.capabilityLockDigest
    && mapping.profileDefinitionDigest === proof.profileDefinitionDigest && canonical(mapping.profileDefinition) === canonical(proof.profileDefinition)
    && canonical(mapping.source.record) === canonical(proof.sourceRecord) && canonical(mapping.source.descriptor) === canonical(proof.source)
    && mapping.source.startSample === proof.sourceStartSample && mapping.source.endSample === proof.sourceEndSample,
  "Transport mapping differs from the retained preparation proof");
}

/** SQL-only historical closure, shared with backup. Live lease/current-selection authority belongs to the Engine and port. */
export function assertTranscriptionPreparationAttemptState(store: TranscriptionAuthorityStore, attempt: Readonly<Attempt>, requireSettledLiability = false): void {
  const saved = store.get("transcription_preparation_intent", attempt.id);
  if (!Object.hasOwn(attempt, "preparation")) {
    fail(attempt.phase !== "preparing" && !saved, "Waiting preparation requires its exact retained proof and metadata");
    return;
  }
  const metadata = attempt.preparation;
  fail(metadata && typeof metadata === "object" && !Array.isArray(metadata)
    && [Object.prototype, null].includes(Object.getPrototypeOf(metadata))
    && Reflect.ownKeys(metadata).length === 4
    && ["intentId", "intentDigest", "waitCount", "nextEligibleAt"].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(metadata, key); return descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable;
    }), "Preparation wakeup metadata must have the exact supported shape");
  fail(Number.isSafeInteger(metadata!.waitCount) && metadata!.waitCount >= 0 && metadata!.waitCount <= 1_000_000
    && Number.isSafeInteger(metadata!.nextEligibleAt) && metadata!.nextEligibleAt >= 0,
  "Preparation wakeup metadata is outside its supported bounds");
  const proof = resolveTranscriptionPreparationIntent(store, attempt);
  fail(attempt.reservationId === proof.reservation.id, "Preparation must retain its original reserved liability");
  const input = transcriptionAudioInput(attempt), artifact = store.get<ArtifactRecord>("artifact", input.artifactId);
  fail(artifact?.projectId === attempt.projectId && canonical(artifact.artifact) === canonical(input),
    "Preparation must retain its exact same-project input artifact");
  const mapping = store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
  const dispatch = store.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attempt.id);
  const result = store.get<TranscriptionExecutionResult>("transcription_execution_result", attempt.id);
  const preparation = mapping ? resolveTranscriptionPreparation(store, attempt, mapping) : undefined;
  if (mapping) {
    assertTranscriptionMappingAdmission(resolveTranscriptionAdmission(store, attempt.request, proof), mapping, preparation!);
    assertTranscriptionPreparationMapping(proof, mapping);
  }
  if (dispatch) {
    fail(mapping && preparation, "Preparation dispatch requires its complete transport mapping");
    assertTranscriptionExecutionDispatch(attempt, mapping!, dispatch, preparation!);
  }
  if (result) {
    const output = result.observation.kind === "completed" ? store.get<OutputReceipt>("execution_output_receipt", result.observation.outputReceiptId) : undefined;
    assertTranscriptionExecutionResult(attempt, mapping, dispatch, result, preparation, output);
  }
  if (attempt.phase === "preparing") {
    const reservation = store.get<{ state: string }>("reservation", proof.reservation.id);
    fail(!dispatch && (!result || result.observation.kind === "not_dispatched") && reservation?.state === "reserved"
      && attempt.taskId === null && attempt.failure === null && canonical(attempt.outputs) === canonical({}),
    "Waiting preparation cannot contain dispatched work or a settled liability");
  } else if (!dispatch) {
    const local = result?.observation.kind === "not_dispatched" ? result.observation : null;
    const exactLocalFailure = local && canonical(attempt.failure) === canonical({ id: `transcription-${digest(result).slice(0, 32)}`, technical: true,
      source: "openai-transcription_provider", retryAllowed: false });
    fail(attempt.phase === "failed" && attempt.taskId === null && canonical(attempt.outputs) === canonical({}) && attempt.leaseExpiresAt === 0
      && (canonical(attempt.failure) === canonical(obsolete) && !result || exactLocalFailure),
    "Preparation may leave waiting only through its dispatch or a proven local settlement");
  } else fail(["submitting", "remote_pending", "submission_unknown", "ingesting", "succeeded", "failed"].includes(attempt.phase),
    "Unsupported preparation attempt phase");
  // Store writes the attempt before settling its reservation in the same transaction.
  // Backup observes committed state and therefore also verifies the final liability.
  if (requireSettledLiability) {
    const expected = attempt.phase === "succeeded" ? "charged" : attempt.phase === "failed"
      ? !dispatch || result?.observation.kind === "rejected" ? "released" : "charged" : "reserved";
    fail(store.get<{ state: string }>("reservation", proof.reservation.id)?.state === expected,
      "Committed preparation phase differs from its reserved liability settlement");
  }
}

/** No generic update can install a protocol on uncertain work or remove its immutable identity after dispatch. */
export function assertTranscriptionPreparationTransition(previous: Readonly<Attempt>, next: Readonly<Attempt>): void {
  if (!Object.hasOwn(previous, "preparation") && !Object.hasOwn(next, "preparation")) return;
  if (!Object.hasOwn(previous, "preparation")) {
    fail(previous.phase === "submitting" && next.phase === "preparing" && next.preparation?.waitCount === 0,
      "Preparation can only be installed on the original submitting attempt");
    return;
  }
  fail(next.preparation && previous.preparation!.intentId === next.preparation.intentId
    && previous.preparation!.intentDigest === next.preparation.intentDigest && previous.reservationId === next.reservationId,
  "Preparation identity cannot change or disappear");
  if (previous.phase === "preparing" && next.phase === "preparing")
    fail(next.preparation!.waitCount >= previous.preparation!.waitCount, "Preparation waiting count cannot rewind");
  else {
    fail(canonical(previous.preparation) === canonical(next.preparation), "Preparation metadata is retained after leaving the waiting phase");
    fail(next.phase !== "preparing", "Dispatched or settled preparation cannot re-enter waiting");
  }
  if (["succeeded", "failed"].includes(previous.phase)) fail(next.phase === previous.phase, "Terminal preparation cannot become active again");
}
