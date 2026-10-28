import { DomainError } from "@openslate/core";
import type { ReleaseAttemptInput } from "@openslate/core";
import type { Attempt, NodeBinding } from "../execution/engine.js";
import { viggleHasCompletedObservation } from "../execution/viggle-h3-execution.js";
import type { ProductionService } from "./service.js";

export const GENERATION_BLOCKER_LIMIT = 20;
export interface GenerationAttemptRecovery {
  total: number;
  truncated: boolean;
  instruction: string;
  attempts: {
    attemptId: string;
    nodeId: string;
    shotId: string;
    kind: "image" | "video";
    phase: Attempt["phase"];
    detached: boolean;
    resolution: {
      action: "follow_existing_job" | "human_release";
      instruction: string;
      /** Display instructions only. A Director cannot perform this human command. */
      release?: { actor: "human"; method: "POST"; path: string; body: ReleaseAttemptInput };
    };
  }[];
}

/** Only this allowlisted projection is carried into Director refusal receipts. */
export class GenerationAttemptBlockedError extends DomainError {
  constructor(readonly recovery: GenerationAttemptRecovery) {
    super("ATTEMPT_EXISTS", "Resolve this shot's existing jobs before creating another keyframe", recovery);
  }
}

/** Historical, detached work retains liability and must have an inspectable resolution. */
export function readGenerationJobBlockers(service: ProductionService, projectId: string, shotIds: readonly string[]): GenerationAttemptRecovery | undefined {
  const shots = new Set(shotIds);
  const bindings = new Map(service.store.list<NodeBinding>("node_binding", projectId)
    .filter(binding => binding.node.shotId && shots.has(binding.node.shotId) && ["image", "video"].includes(binding.node.kind))
    .map(binding => [binding.id, binding]));
  const pending = service.engine.attempts(projectId).filter(attempt => !attempt.released && bindings.has(attempt.nodeId)
    && !["succeeded", "failed"].includes(attempt.phase)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (!pending.length) return;
  const current = new Set(service.engine.currentAttemptIds(projectId, pending));
  const attempts = pending.slice(0, GENERATION_BLOCKER_LIMIT).map(attempt => {
    const binding = bindings.get(attempt.nodeId)!;
    const releasable = attempt.phase === "submission_unknown" && !viggleHasCompletedObservation(service.store, attempt);
    return { attemptId: attempt.id, nodeId: attempt.nodeId, shotId: binding.node.shotId!, kind: binding.node.kind as "image" | "video",
      phase: attempt.phase, detached: !current.has(attempt.id),
      resolution: releasable ? {
        action: "human_release" as const,
        instruction: "Select this shot in Keyframes and use Give up on the unanswered job. The person must acknowledge that the old job may still finish and both jobs may be charged. Release does not start new work; a fresh generation request is required. The Director must not release or resubmit it.",
        release: { actor: "human" as const, method: "POST" as const,
          path: `/api/projects/${encodeURIComponent(projectId)}/attempts/${encodeURIComponent(attempt.id)}/release`,
          body: { expectedPhase: "submission_unknown" as const, acknowledgeDoubleCharge: true as const } },
      } : {
        action: "follow_existing_job" as const,
        instruction: "Follow this existing job in Keyframes. The executor reconciles its saved outcome; do not release a known running job or submit it again.",
      } };
  });
  return { total: pending.length, truncated: pending.length > attempts.length,
    instruction: "Open this scene in Keyframes to inspect every existing job. Unanswered jobs offer Give up for the person to acknowledge possible charges; running jobs stay under executor recovery. The Director must not release or resubmit them.", attempts };
}

/** Refusals and read projections share the exact same pending-job predicate and release rules. */
export function assertGenerationJobsResolved(service: ProductionService, projectId: string, shotIds: readonly string[]): void {
  const recovery = readGenerationJobBlockers(service, projectId, shotIds);
  if (recovery) throw new GenerationAttemptBlockedError(recovery);
}
