import { invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { Store } from "../persistence/store.js";
type Reader = Pick<Store, "db" | "get" | "getProject">;

export function requestHoldCutoff(
  reader: Reader,
  projectId: string,
  actor: ActorContext,
): number {
  const row = reader.db
    .prepare(
      "SELECT sequence FROM events WHERE project_id=? AND json_extract(body,'$.kind')='message.recorded' AND json_extract(body,'$.payload.requestId')=? ORDER BY sequence LIMIT 1",
    )
    .get(projectId, actor.requestId) as { sequence: number } | undefined;
  invariant(
    row && Number.isSafeInteger(row.sequence),
    "ACTOR_DENIED",
    "Requested audio requires its recorded application request.",
  );
  if (actor.kind === "director") return row.sequence;
  return (
    reader.db
      .prepare(
        "SELECT coalesce(max(sequence),0) sequence FROM events WHERE project_id=?",
      )
      .get(projectId) as { sequence: number }
  ).sequence;
}
export function assertRequestHoldCutoff(
  reader: Reader,
  projectId: string,
  requestId: string,
  cutoff: unknown,
  epochId?: string,
): asserts cutoff is number {
  const origin = reader.db
    .prepare(
      "SELECT sequence FROM events WHERE project_id=? AND json_extract(body,'$.kind')='message.recorded' AND json_extract(body,'$.payload.requestId')=? ORDER BY sequence LIMIT 1",
    )
    .get(projectId, requestId) as { sequence: number } | undefined;
  const latest = (
    reader.db
      .prepare(
        "SELECT coalesce(max(sequence),0) sequence FROM events WHERE project_id=?",
      )
      .get(projectId) as { sequence: number }
  ).sequence;
  invariant(
    origin &&
      Number.isSafeInteger(cutoff) &&
      Number(cutoff) >= origin.sequence &&
      Number(cutoff) <= latest &&
      (!epochId || cutoff === origin.sequence),
    "SCOPE_DENIED",
    "Requested audio hold cutoff differs from its original application request.",
  );
}
/** Only earlier application-owned planning holds are ignored. New or reactivated pauses remain blocking. */
export function earlierRequestHoldIds(
  reader: Reader,
  projectId: string,
  cutoff: number,
): string[] {
  return (
    reader.db
      .prepare(
        `SELECT h.id FROM entities h JOIN entities m ON m.kind='message' AND m.id=json_extract(h.body,'$.ownerId') AND m.project_id=h.project_id
    JOIN events e ON e.project_id=h.project_id AND json_extract(e.body,'$.kind')='hold.changed' AND json_extract(e.body,'$.payload.holdId')=h.id
      AND e.sequence=(SELECT max(latest.sequence) FROM events latest WHERE latest.project_id=h.project_id AND json_extract(latest.body,'$.kind')='hold.changed' AND json_extract(latest.body,'$.payload.holdId')=h.id)
    WHERE h.kind='hold' AND h.project_id=? AND json_extract(h.body,'$.id')=h.id AND json_extract(h.body,'$.active')=1 AND json_extract(m.body,'$.editing')=1
      AND json_extract(e.body,'$.payload.active')=1 AND e.sequence<=?`,
      )
      .all(projectId, cutoff) as { id: string }[]
  ).map((row) => row.id);
}
export function requestedTranscriptionHoldIds(
  reader: Reader,
  projectId: string,
  candidateId: string | null,
): string[] {
  const candidate = candidateId
    ? reader.get<{ projectId: string; grantId: string }>(
        "candidate",
        candidateId,
      )
    : undefined;
  const review =
    candidate?.projectId === projectId
      ? reader.get<{
          projectId: string;
          requestId: string;
          requested?: true;
          requestedAtCursor?: number;
          epochId?: string;
        }>("owned_transcription_review", candidate.grantId)
      : undefined;
  if (!review?.requested) return [];
  invariant(
    review.projectId === projectId,
    "SCOPE_DENIED",
    "Requested transcription belongs to another project.",
  );
  assertRequestHoldCutoff(
    reader,
    projectId,
    review.requestId,
    review.requestedAtCursor,
    review.epochId,
  );
  return earlierRequestHoldIds(reader, projectId, review.requestedAtCursor!);
}
