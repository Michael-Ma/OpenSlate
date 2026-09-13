import { DomainError, invariant } from "@openslate/core";
import type { ExecutionOutcome, ExecutionRequest } from "@openslate/providers";

export type PreparationEligibility = { type: "ready" }
  | { type: "deferred"; reason: "paused" | "held" }
  | { type: "obsolete"; reason: "binding_changed" | "inputs_changed" | "intent_changed" };
export interface SubmissionPreparationContext {
  readonly signal: AbortSignal;
  readonly expectedLease: Readonly<{ owner: string; epoch: number }>;
  /** Synchronous current-work authority supplied by the Engine, never persisted or inferred by lookup. */
  readonly eligibility: () => PreparationEligibility;
}
export interface SubmissionPreparationDeferred {
  type: "preparation_deferred"; intentId: string; intentDigest: string;
  reason: "local_media_busy" | "paused" | "held" | "cancelled";
}
export type PreparationSubmissionOutcome = ExecutionOutcome | SubmissionPreparationDeferred;
export interface SubmissionPreparationPort {
  readonly identity: Readonly<{ adapter: "openai-transcription"; version: "1" }>;
  start(request: Readonly<ExecutionRequest>, context: SubmissionPreparationContext): Promise<PreparationSubmissionOutcome>;
  resume(request: Readonly<ExecutionRequest>, context: SubmissionPreparationContext): Promise<PreparationSubmissionOutcome>;
}
export type SubmissionPreparationEligibility = PreparationEligibility;
export type SubmissionPreparationOutcome = PreparationSubmissionOutcome;

/** Snapshot the caller's signal, lease and callback before the first asynchronous operation. */
export function snapshotSubmissionPreparationContext(input: SubmissionPreparationContext): SubmissionPreparationContext {
  const dataFields = (value: unknown, fields: string[]): void => invariant(value && typeof value === "object"
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === fields.length
    && fields.every(key => { const property = Object.getOwnPropertyDescriptor(value, key); return property && property.enumerable && Object.hasOwn(property, "value"); }),
  "SUBMISSION_PREPARATION_INVALID", "Preparation context requires exact own data fields");
  dataFields(input, ["signal", "expectedLease", "eligibility"]);
  const signal = input.signal, lease = input.expectedLease, eligibility = input.eligibility;
  dataFields(lease, ["owner", "epoch"]);
  invariant(signal instanceof AbortSignal && lease && typeof lease.owner === "string" && lease.owner.length > 0
    && Number.isSafeInteger(lease.epoch) && lease.epoch > 0 && typeof eligibility === "function",
  "SUBMISSION_PREPARATION_INVALID", "Preparation requires its original signal, lease and synchronous eligibility check");
  return Object.freeze({ signal, expectedLease: Object.freeze({ owner: lease.owner, epoch: lease.epoch }), eligibility });
}

/** Control failures remain local scheduling decisions; they are never provider observations. */
export function assertSubmissionPreparationEligibility(context: SubmissionPreparationContext): void {
  const state = context.eligibility();
  invariant(state && typeof state === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(state))
    && Reflect.ownKeys(state).every(key => typeof key === "string" && ["type", "reason"].includes(key)
      && Object.getOwnPropertyDescriptor(state, key)!.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(state, key)!, "value")),
  "SUBMISSION_PREPARATION_INVALID", "Preparation eligibility must return a synchronous data decision");
  if (state.type === "ready") {
    invariant(Object.keys(state).length === 1, "SUBMISSION_PREPARATION_INVALID", "Invalid preparation eligibility decision"); return;
  }
  invariant(Object.keys(state).length === 2, "SUBMISSION_PREPARATION_INVALID", "Invalid preparation eligibility decision");
  if (state.type === "obsolete") {
    invariant(["binding_changed", "inputs_changed", "intent_changed"].includes(state.reason), "SUBMISSION_PREPARATION_INVALID", "Invalid obsolete preparation reason");
    throw new DomainError("SUBMISSION_PREPARATION_OBSOLETE", "Unstarted transcription no longer matches the selected work");
  }
  invariant(state.type === "deferred" && (state.reason === "paused" || state.reason === "held"),
    "SUBMISSION_PREPARATION_INVALID", "Invalid preparation eligibility decision");
  throw new DomainError(state.reason === "paused" ? "SUBMISSION_PREPARATION_PAUSED" : "SUBMISSION_PREPARATION_HELD", "Transcription preparation is paused or held");
}
