import { invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { Attempt, Candidate, Grant } from "./engine.js";

type Reader = Pick<Store, "get">;

/** Both paid video grants and a confirmation's requested speech retain this owner. */
export function sceneConfirmationIdForCandidate(store: Reader, projectId: string, candidateId: string | null): string | null {
  const candidate = candidateId ? store.get<Candidate>("candidate", candidateId) : undefined;
  const grant = candidate?.projectId === projectId ? store.get<Grant>("grant", candidate.grantId) : undefined;
  if (grant?.projectId !== projectId) return null;
  const mapped = store.get<{ projectId: string; candidateId: string; confirmationId: string }>("scene_confirmation_candidate", candidate!.id);
  if (mapped) {
    const confirmation = store.get<{ projectId: string }>("scene_confirmation", mapped.confirmationId);
    invariant(mapped.projectId === projectId && mapped.candidateId === candidate!.id && confirmation?.projectId === projectId,
      "SCOPE_DENIED", "The scene candidate lost its original confirmation");
    return mapped.confirmationId;
  }
  const speech = store.get<{ projectId: string; requestId: string }>("narration_speech_review", grant.id);
  const request = speech?.projectId === projectId ? store.get<{ projectId: string; confirmationId: string }>("scene_confirmation_request", speech.requestId) : undefined;
  const id = request?.projectId === projectId ? request.confirmationId : grant.authorityId;
  const confirmation = store.get<{ projectId: string }>("scene_confirmation", id);
  return confirmation?.projectId === projectId ? id : null;
}

/** Effective authority, shared by executor admission and its read-only projection. */
export function automaticRetriesLeft(store: Reader, attempt: Readonly<Attempt>, maxRetries: number): number {
  if (attempt.phase !== "failed" || attempt.released || !attempt.candidateId || !attempt.failure?.technical || !attempt.failure.retryAllowed
    || store.get("candidate_stop", attempt.candidateId) || sceneConfirmationIdForCandidate(store, attempt.projectId, attempt.candidateId)) return 0;
  return Math.max(0, maxRetries + 1 - attempt.ordinal);
}
