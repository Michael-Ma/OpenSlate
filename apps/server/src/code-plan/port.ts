import type { CodePlanDiff, CodePlanSourceView, CodePlanStepDetail, CodePlanView } from "@openslate/core/public";

/**
 * What the Director (card P2a) and the HTTP routes (card P3a) may ask of a code-plan project.
 * The runtime (card P2b) implements it. Lead-owned: change it only together with all three.
 *
 * Every method refuses a graph project with CODE_PLAN_MODE and an unknown project with NOT_FOUND,
 * and every write refuses while installation recovery is quarantined.
 */
export interface CodePlanPort {
  /** Read model for GET routes and for the Director's read_film tool. */
  view(projectId: string): CodePlanView;

  /** Complete prompt and safe recorded call metadata. NOT_FOUND for an unknown step. */
  stepDetail(projectId: string, stepKey: string): CodePlanStepDetail;

  /** One stored version's source. NOT_FOUND for an unknown version. */
  source(projectId: string, version: number): CodePlanSourceView;

  /**
   * Replays `source` against the current journal with dispatch disabled.
   * Writes nothing: no step, choice, attempt, run or event.
   */
  dryRun(projectId: string, source: string): Promise<CodePlanDiff>;

  /**
   * Dry-runs, then stores a new version together with its diff and wakes the run.
   * - REVISION_CONFLICT when basedOnVersion is not the current version (null means "no plan yet").
   * - CODE_PLAN_REJECTED with details.diff when the dry run finds SOURCE_SYNTAX or RUNTIME_ERROR; nothing is stored.
   * - The same invocationId always returns the same result, so a retried call after a lost response
   *   never creates a second version.
   */
  submit(projectId: string, input: {
    source: string; author: "director" | "user"; basedOnVersion: number | null; invocationId: string;
  }): Promise<{ version: number; diff: CodePlanDiff }>;

  /** Records an answer that must equal one of the choice's options exactly, then wakes the run. */
  answer(projectId: string, input: { choiceId: string; optionsDigest: string; answer: unknown }): CodePlanView;

  /** The new ceiling must be higher than the current one. Wakes the run. */
  raiseCeiling(projectId: string, ceilingMicros: string): CodePlanView;

  retryStep(projectId: string, input: { stepKey: string; consent: { by: "person" } | { by: "director"; quote: string; invocationId: string } }): CodePlanView;
  setCeiling(projectId: string, input: { ceilingMicros: string; by: "person" } | { ceilingMicros: string; by: "director"; quote: string; invocationId: string }): CodePlanView;

  /**
   * While at least one hold is open, no new paid step is dispatched; in-flight work continues and
   * free steps (render) still run. Both calls are idempotent per holdId and survive restart.
   */
  hold(projectId: string, holdId: string): void;
  release(projectId: string, holdId: string): void;

  /** The latest pass error of the current version, for the Director's repair turn. */
  failure(projectId: string): { version: number; message: string; stack: string } | null;
}
