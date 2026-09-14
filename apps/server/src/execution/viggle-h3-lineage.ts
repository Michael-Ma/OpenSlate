import { canonical, digest, invariant } from "@openslate/core";
import type { Attempt } from "./engine.js";
import type { OutputReceipt, OutputSpool } from "./output-store.js";
import { assertViggleMappingAdmission, resolveViggleAdmission, viggleRecord } from "./viggle-h3-authority.js";
import type { ViggleAuthorityStore } from "./viggle-h3-authority.js";
import { assertViggleH3ExecutionDispatch, assertViggleH3ExecutionObservation, assertViggleH3ExecutionSubmit, assertViggleH3PollSchedule, viggleH3CompletedObservationId } from "./viggle-h3-receipts.js";
import type { ViggleH3ExecutionMapping, ViggleH3ExecutionDispatch, ViggleH3ExecutionSubmit, ViggleH3ExecutionObservation, ViggleH3PollSchedule } from "./viggle-h3-receipts.js";

export const VIGGLE_OBSERVATION_LIMITS = Object.freeze({ count: 4096, bytes: 32768 });
/** Bounded exact-attempt reads; no project-history hydration and no remote or filesystem calls. */
export function viggleObservations(reader: ViggleAuthorityStore, attempt: Attempt): ViggleH3ExecutionObservation[] {
  const rows = reader.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='viggle_h3_execution_observation' AND project_id=? AND json_extract(body,'$.attemptId')=? ORDER BY id LIMIT ?")
    .all(attempt.projectId, attempt.id, VIGGLE_OBSERVATION_LIMITS.count + 1) as { id: string; bytes: number }[];
  invariant(rows.length <= VIGGLE_OBSERVATION_LIMITS.count && rows.every(row => row.bytes <= VIGGLE_OBSERVATION_LIMITS.bytes), "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle observation history exceeds its bound");
  return rows.map(row => viggleRecord<ViggleH3ExecutionObservation>(reader, "viggle_h3_execution_observation", row.id, attempt.projectId)!);
}
/** All retained facts are historical; incomplete pre-submit/unknown/accepted history remains exportable. */
export function assertViggleRecords(reader: ViggleAuthorityStore, attemptId: string): void {
  const attempt = reader.get<Attempt>("attempt", attemptId);
  invariant(attempt?.id === attemptId && attempt.request.execution?.adapter === "viggle-h3" && attempt.request.execution.version === "1", "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid Viggle attempt");
  const mapping = viggleRecord<ViggleH3ExecutionMapping>(reader, "viggle_h3_execution_mapping", attemptId, attempt.projectId);
  const dispatch = viggleRecord<ViggleH3ExecutionDispatch>(reader, "viggle_h3_execution_dispatch", attemptId, attempt.projectId);
  const submit = viggleRecord<ViggleH3ExecutionSubmit>(reader, "viggle_h3_execution_submit", attemptId, attempt.projectId);
  const schedule = viggleRecord<ViggleH3PollSchedule>(reader, "viggle_h3_poll_schedule", attemptId, attempt.projectId);
  const admission = resolveViggleAdmission(reader, attempt.request, mapping);
  if (mapping) assertViggleMappingAdmission(admission, mapping);
  if (dispatch) { invariant(mapping, "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle dispatch lost its mapping"); assertViggleH3ExecutionDispatch(attempt, mapping, dispatch); }
  if (submit) assertViggleH3ExecutionSubmit(attempt, mapping, dispatch, submit);
  if (schedule) { invariant(submit, "VIGGLE_H3_EXECUTION_CONFLICT", "Polling lost its accepted submit"); assertViggleH3PollSchedule(attempt, submit, schedule); }
  const observations = viggleObservations(reader, attempt);
  for (const value of observations) {
    invariant(mapping && dispatch && submit, "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle poll history lost its submission");
    assertViggleH3ExecutionObservation(attempt, mapping, dispatch, submit, value, value.observation.kind === "completed"
      ? reader.get<OutputReceipt>("execution_output_receipt", value.observation.outputReceiptId) : undefined);
  }
  invariant(!schedule?.lastObservationId || observations.some(value => value.id === schedule.lastObservationId), "VIGGLE_H3_EXECUTION_CONFLICT", "Poll pointer lost its observation");
}

/** Caller may overlay get() with verified filesystem spool/slot manifests before SQL repair. */
export function assertViggleSpoolLineage(reader: ViggleAuthorityStore, attempt: Readonly<Attempt>, spoolId: string): void {
  if (attempt.request.execution?.adapter !== "viggle-h3") return;
  invariant(attempt.request.execution.version === "1", "VIGGLE_H3_EXECUTION_CONFLICT", "Unsupported Viggle execution version");
  const mapping = reader.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id);
  const dispatch = reader.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id);
  const submit = reader.get<ViggleH3ExecutionSubmit>("viggle_h3_execution_submit", attempt.id);
  invariant(mapping && dispatch && submit?.observation.kind === "accepted", "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle output requires exact retained acceptance");
  const admission = resolveViggleAdmission(reader, attempt.request, mapping); assertViggleMappingAdmission(admission, mapping);
  const spool = reader.get<OutputSpool>("execution_output_spool", spoolId);
  const receipt = spool ? reader.get<OutputReceipt>("execution_output_receipt", spool.receiptId) : undefined;
  const observation = receipt ? reader.get<ViggleH3ExecutionObservation>("viggle_h3_execution_observation", viggleH3CompletedObservationId(attempt.id, receipt.id)) : undefined;
  invariant(spool && receipt && observation?.observation.kind === "completed", "VIGGLE_H3_EXECUTION_CONFLICT", "Winning Viggle bytes lost their exact completed receipt");
  assertViggleH3ExecutionObservation(admission.attempt, mapping, dispatch, submit, observation, receipt);
  invariant(spool.id === spoolId && spoolId === receipt.id && spool.receiptId === receipt.id && typeof spool.storageId === "string" && spool.storageId.length > 0 && spool.storageId.length <= 160
    && /^[a-f0-9]{64}$/.test(spool.sha256) && Number.isSafeInteger(spool.byteLength) && spool.byteLength > 0 && spool.byteLength <= 256 * 1024 ** 2
    && canonical(spool) === canonical({ id: receipt.id, projectId: attempt.projectId, version: 1, storageId: spool.storageId, receiptId: receipt.id,
      attemptId: attempt.id, requestDigest: digest(attempt.request), port: "video", sha256: spool.sha256, byteLength: spool.byteLength, blobKey: `${spool.sha256}.blob` }),
  "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle winner differs from its exact provider receipt");
  const slotId = digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "video" }), slot = reader.get("execution_output_slot", slotId);
  invariant(slot && canonical(slot) === canonical({ id: slotId, projectId: attempt.projectId, version: 1, storageId: spool.storageId, attemptId: attempt.id,
    port: "video", spoolId, sha256: spool.sha256, byteLength: spool.byteLength }), "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle output receipt did not win its exact slot");
}
