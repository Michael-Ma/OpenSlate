import { canonical, digest, invariant } from "@openslate/core";
import type { Attempt } from "./engine.js";
import type { OutputReceipt, OutputSpool } from "./output-store.js";
import { assertSpeechMappingAdmission, resolveSpeechAdmission } from "./audio-execution-authority.js";
import type { SpeechAuthorityStore } from "./audio-execution-authority.js";
import { assertSpeechExecutionResult } from "./audio-execution-receipts.js";
import type { SpeechExecutionDispatch, SpeechExecutionMapping, SpeechExecutionResult } from "./audio-execution-receipts.js";

/** Speech-v1 provenance only. Safe for read-only backup validation; no lease, provider, filesystem or credential work. */
export function assertSpeechSpoolLineage(store: SpeechAuthorityStore, attempt: Readonly<Attempt>, spoolId: string): void {
  // Historical fixtures and separately registered providers retain their existing ingestion contracts.
  if (attempt.request.execution?.adapter !== "openai-speech" || attempt.request.execution.version !== "1") return;
  const mapping = store.get<SpeechExecutionMapping>("speech_execution_mapping", attempt.id);
  const dispatch = store.get<SpeechExecutionDispatch>("speech_execution_dispatch", attempt.id);
  const result = store.get<SpeechExecutionResult>("speech_execution_result", attempt.id);
  invariant(mapping && dispatch && result?.observation.kind === "completed", "SPEECH_EXECUTION_CONFLICT",
    "Speech ingestion requires its exact saved dispatch and completed provider observation");
  const admission = resolveSpeechAdmission(store, attempt.request, mapping);
  invariant(admission.attempt.id === attempt.id && admission.attempt.projectId === attempt.projectId,
    "SPEECH_EXECUTION_CONFLICT", "Speech output belongs to another admitted attempt");
  assertSpeechMappingAdmission(admission, mapping);
  const spool = store.get<OutputSpool>("execution_output_spool", spoolId);
  const receipt = spool ? store.get<OutputReceipt>("execution_output_receipt", spool.receiptId) : undefined;
  assertSpeechExecutionResult(admission.attempt, mapping, dispatch, result, receipt);
  const raw = result.observation.result, observedReceiptId = result.observation.outputReceiptId;
  invariant(spool && spoolId === observedReceiptId && spool.id === spoolId && spool.receiptId === observedReceiptId
    && typeof spool.storageId === "string" && spool.storageId.length > 0 && spool.storageId.length <= 160
    && canonical(spool) === canonical({ id: observedReceiptId, projectId: attempt.projectId, version: 1, storageId: spool.storageId,
      receiptId: observedReceiptId, attemptId: attempt.id, requestDigest: digest(attempt.request), port: "audio",
      sha256: raw.sha256, byteLength: raw.byteLength, blobKey: `${raw.sha256}.blob` }),
  "SPEECH_EXECUTION_CONFLICT", "Speech normalization cannot substitute a different returned-byte receipt or spool");
  const slotId = digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "audio" });
  const slot = store.get("execution_output_slot", slotId);
  invariant(slot && canonical(slot) === canonical({ id: slotId, projectId: attempt.projectId, version: 1, storageId: spool.storageId,
    attemptId: attempt.id, port: "audio", spoolId, sha256: raw.sha256, byteLength: raw.byteLength }),
  "SPEECH_EXECUTION_CONFLICT", "Speech normalization requires the exact observed receipt to own the winning output slot");
}
