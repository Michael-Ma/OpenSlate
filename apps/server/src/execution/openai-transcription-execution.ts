import { canonical, digest, DomainError, invariant } from "@openslate/core";
import { assertExecutionRequest, OpenAITranscriptionAdapter, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Store } from "../persistence/store.js";
import type { TranscriptionAudioService } from "./transcription-audio-service.js";
import type { Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { assertTranscriptionFirstDispatch, assertTranscriptionMappingAdmission, createTranscriptionExecutionMapping, resolveTranscriptionAdmission, resolveTranscriptionPreparation } from "./transcription-execution-authority.js";
import { assertTranscriptionExecutionDispatch, assertTranscriptionExecutionResult, compactTranscriptionExecutionResult, prepareTranscriptionExecutionRequest, transcriptionExecutionOptions, TRANSCRIPTION_EXECUTION_PARSER } from "./transcription-execution-receipts.js";
import type { TranscriptionExecutionDispatch, TranscriptionExecutionMapping, TranscriptionExecutionObservation, TranscriptionExecutionResult } from "./transcription-execution-receipts.js";
import { assertSubmissionPreparationEligibility, snapshotSubmissionPreparationContext } from "./submission-preparation.js";
import type { PreparationSubmissionOutcome, SubmissionPreparationContext, SubmissionPreparationDeferred, SubmissionPreparationPort } from "./submission-preparation.js";
import { assertOwnedTranscriptionPreparation, createTranscriptionPreparationIntent, resolveTranscriptionPreparationIntent } from "./transcription-preparation.js";

const unknown = (diagnostic: string): ExecutionOutcome => ({ type: "unknown", diagnostic });
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "TRANSCRIPTION_EXECUTION_CANCELLED", "Transcription preparation was cancelled");

/** Explicit host bridge: registration is availability, never a spending allowance or default activation. */
export class OpenAITranscriptionExecution implements ExecutionProvider, SubmissionPreparationPort {
  readonly identity = Object.freeze({ adapter: "openai-transcription", version: "1" } as const);
  readonly #store: Store;
  readonly #outputs: ExecutionOutputStore;
  readonly #preparation: TranscriptionAudioService;
  readonly #credentials: EnvironmentMediaCredentials;
  readonly #recovery: InstallationRecoveryGuard;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #timeoutMs: number | undefined;
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; credentials: EnvironmentMediaCredentials; preparation: TranscriptionAudioService;
    fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    invariant(options.outputStore.store === options.store && options.preparation.store === options.store, "TRANSCRIPTION_EXECUTION_CONFIGURATION", "Transcription requires one application store and its owned output store");
    this.#store = options.store; this.#outputs = options.outputStore; this.#preparation = options.preparation; this.#credentials = options.credentials;
    this.#recovery = new InstallationRecoveryGuard(options.store); this.#fetch = options.fetch; this.#timeoutMs = options.timeoutMs;
    registerExecutionProvider(this, { adapter: "openai-transcription", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal, expectedLease = options.expectedLease ? { ...options.expectedLease } : undefined;
    const request = structuredClone(input), admission = this.admission(request), attempt = admission.attempt;
    // Only the explicit Engine port can resume a saved preparation protocol.
    if (this.#store.get("transcription_preparation_intent", attempt.id)) return this.recover(attempt, signal);
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    assertTranscriptionFirstDispatch(this.#store, admission, expectedLease);
    return this.execute(admission, signal, expectedLease) as Promise<ExecutionOutcome>;
  }

  async start(input: Readonly<ExecutionRequest>, options: SubmissionPreparationContext): Promise<PreparationSubmissionOutcome> {
    const context = snapshotSubmissionPreparationContext(options), request = structuredClone(input);
    let admission = this.admission(request);
    if (this.hasDispatchOrResult(admission.attempt.id)) return this.recover(admission.attempt, context.signal);
    if (this.#store.get("transcription_preparation_intent", admission.attempt.id)) return this.resume(request, context);
    let control: unknown;
    try { this.#store.transaction(() => {
      assertTranscriptionFirstDispatch(this.#store, admission, context.expectedLease);
      const intent = createTranscriptionPreparationIntent(this.#store, admission.attempt);
      // Paused or obsolete work still receives positive pre-submit evidence so
      // the Engine can defer or retire it without treating absence as authority.
      try { assertSubmissionPreparationEligibility(context); }
      catch (error) {
        if (!(error instanceof DomainError) || !["SUBMISSION_PREPARATION_OBSOLETE", "SUBMISSION_PREPARATION_PAUSED", "SUBMISSION_PREPARATION_HELD"].includes(error.code)) throw error;
        control = error;
      }
      this.#store.insert("transcription_preparation_intent", intent.id, intent.projectId, intent);
      const current = this.#store.get<Attempt>("attempt", admission.attempt.id)!;
      this.#store.put("attempt", current.id, current.projectId, { ...current, phase: "preparing",
        preparation: { intentId: intent.id, intentDigest: digest(intent), waitCount: 0, nextEligibleAt: 0 } });
      this.#store.appendEvent(current.projectId, "attempt.state_changed", { attemptId: current.id, phase: "preparing", nodeId: current.nodeId });
    }); } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "SUBMISSION_PREPARATION_INPUT_INVALID") throw error;
      // Only classified input validation failed. No proof or POST was installed;
      // the ordinary original-lease local rejection remains authoritative.
      return this.notDispatched(admission, context.expectedLease, "LOCAL_INPUT_INVALID", context.signal);
    }
    admission = this.admission(request);
    if (control) return this.preparationFailure(admission, context.expectedLease, control, context.signal, context);
    return this.execute(admission, context.signal, context.expectedLease, context);
  }

  async resume(input: Readonly<ExecutionRequest>, options: SubmissionPreparationContext): Promise<PreparationSubmissionOutcome> {
    const context = snapshotSubmissionPreparationContext(options), admission = this.admission(structuredClone(input));
    resolveTranscriptionPreparationIntent(this.#store, admission.attempt);
    if (this.hasDispatchOrResult(admission.attempt.id)) return this.recover(admission.attempt, context.signal);
    return this.execute(admission, context.signal, context.expectedLease, context);
  }

  private async execute(admission: ReturnType<typeof resolveTranscriptionAdmission>, signal: AbortSignal | undefined,
    expectedLease: ExecutionCallOptions["expectedLease"], context?: SubmissionPreparationContext): Promise<PreparationSubmissionOutcome> {
    const attempt = admission.attempt, request = attempt.request;
    const owned = () => context ? assertOwnedTranscriptionPreparation(this.#store, attempt, context)
      : assertTranscriptionFirstDispatch(this.#store, admission, expectedLease);
    let prepared: ReturnType<typeof prepareTranscriptionExecutionRequest>, mapping: TranscriptionExecutionMapping;
    try {
      owned(); stopped(signal); transcriptionExecutionOptions(request);
      const preparationSignal = signal ?? new AbortController().signal;
      const completed = await this.#preparation.prepare(attempt, { expectedLease: expectedLease!, signal: preparationSignal,
        ...(context ? { submissionPreparation: context } : {}) });
      owned(); stopped(signal);
      const preparation = resolveTranscriptionPreparation(this.#store, attempt);
      invariant(digest(completed.receipt) === digest(preparation.receipt), "TRANSCRIPTION_EXECUTION_CONFLICT", "Preparation returned a different saved receipt");
      const upload = await this.#preparation.files.readUpload(preparation.intent, { signal: preparationSignal });
      owned(); stopped(signal);
      invariant(digest(upload.receipt) === digest(preparation.receipt), "TRANSCRIPTION_EXECUTION_CONFLICT", "Upload differs from the prepared receipt");
      prepared = prepareTranscriptionExecutionRequest(request, preparation, upload.bytes);
      const proposed = createTranscriptionExecutionMapping(admission, preparation.intent, preparation.receipt, prepared.description);
      mapping = this.#store.transaction(() => {
        owned(); stopped(signal);
        assertTranscriptionMappingAdmission(admission, proposed, resolveTranscriptionPreparation(this.#store, attempt));
        const existing = this.#store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
        if (existing) {
          invariant(canonical(existing) === canonical(proposed), "TRANSCRIPTION_EXECUTION_CONFLICT", "Prepared transcription mapping changed for this attempt");
          return existing;
        }
        return this.#store.insert("transcription_execution_mapping", attempt.id, attempt.projectId, proposed);
      });
    } catch (error) {
      if (context) return this.preparationFailure(admission, expectedLease, error, signal, context);
      return this.notDispatched(admission, expectedLease, signal?.aborted ? "LOCAL_CANCELLED"
        : error instanceof DomainError && error.code === "MEDIA_BUSY" ? "LOCAL_PREPARATION_BUSY" : "LOCAL_INPUT_INVALID", signal);
    }
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    let transport: OpenAITranscriptionAdapter;
    try {
      owned(); stopped(signal);
      transport = new OpenAITranscriptionAdapter({ apiKey: this.#credentials.resolve("openai-media"),
        maxResponseBytes: TRANSCRIPTION_EXECUTION_PARSER.maxResponseBytes, maxTextBytes: TRANSCRIPTION_EXECUTION_PARSER.maxTextBytes,
        maxWords: TRANSCRIPTION_EXECUTION_PARSER.maxWords, maxWordBytes: TRANSCRIPTION_EXECUTION_PARSER.maxWordBytes,
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }), ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }) });
      stopped(signal);
    } catch (error) {
      if (context) return this.preparationFailure(admission, expectedLease, error, signal, context, "LOCAL_CREDENTIAL_UNAVAILABLE");
      return this.notDispatched(admission, expectedLease, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal);
    }
    let claimed: boolean;
    try {
      claimed = this.#store.transaction(() => {
        if (this.hasDispatchOrResult(attempt.id)) return false;
        owned(); stopped(signal);
        assertTranscriptionMappingAdmission(admission, mapping, resolveTranscriptionPreparation(this.#store, attempt, mapping));
        const marker: TranscriptionExecutionDispatch = { ...this.recordIdentity(attempt), mappingDigest: digest(mapping),
          transportDigest: mapping.transport.requestDigest, bodySha256: mapping.transport.bodySha256,
          allowanceId: admission.allowance.id, createdAt: new Date().toISOString() };
        this.#store.insert("transcription_execution_dispatch", attempt.id, attempt.projectId, marker);
        if (context) {
          const current = this.#store.get<Attempt>("attempt", attempt.id)!;
          this.#store.put("attempt", current.id, current.projectId, { ...current, phase: "submitting" });
        }
        return true;
      });
    } catch (error) {
      if (context) return this.preparationFailure(admission, expectedLease, error, signal, context);
      throw error;
    }
    if (!claimed) return this.recover(attempt, signal);

    let bytes: Uint8Array | undefined;
    try {
      const response = await transport.submit(prepared.request, { attemptId: attempt.id,
        expectedRequestDigest: mapping.transport.requestDigest, expectedBodySha256: mapping.transport.bodySha256,
        ...(signal ? { signal } : {}) });
      if (response.kind === "completed") {
        bytes = Uint8Array.from(response.result.rawResponseBytes);
        // Late observations retain evidence independently of publication authority; the Engine still owns its original lease.
        this.#store.transaction(() => {
          const receipt = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(request),
            port: "cues", kind: "data", mimeType: "application/json", vendorTaskId: null, diagnosticRequestId: response.receipt.requestId,
            source: { kind: "returned_bytes", sha256: response.result.rawResponseSha256, byteLength: bytes!.byteLength } });
          this.saveResult(attempt, { kind: "completed", receipt: response.receipt, reportedModel: response.reportedModel,
            result: compactTranscriptionExecutionResult(response.result), outputReceiptId: receipt.id });
        });
      } else this.saveResult(attempt, response);
    } catch {
      // An irreversible marker cannot be turned into a definite local non-dispatch after the fact.
      return unknown("Transcription dispatch has no durable outcome; automatic resubmission is disabled");
    }
    if (bytes) {
      const result = this.#store.get<TranscriptionExecutionResult>("transcription_execution_result", attempt.id)!;
      if (result.observation.kind === "completed") {
        try {
          const saved = bytes;
          await this.#outputs.spool(attempt.projectId, result.observation.outputReceiptId, async function* () {
            for (let offset = 0; offset < saved.byteLength; offset += 1024 * 1024) yield saved.subarray(offset, offset + 1024 * 1024);
          }, signal ? { signal } : {});
        } catch { return unknown("Transcription completed; owned output storage needs recovery without resubmission"); }
      }
    }
    return this.recover(attempt, signal);
  }

  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal;
    this.#recovery.assertWritable();
    const saved = this.#store.get<Attempt>("attempt", attemptId);
    invariant(saved && (!input || input.attemptId === attemptId), "TRANSCRIPTION_EXECUTION_CONFLICT", "Unknown or mismatched transcription attempt");
    const admission = this.admission(structuredClone(input ?? saved.request));
    return this.recover(admission.attempt, signal);
  }

  async poll(_taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    this.#recovery.assertWritable();
    if (input) this.admission(structuredClone(input));
    stopped(options.signal);
    return unknown("Synchronous transcription has no pollable vendor task");
  }

  private recordIdentity(attempt: Attempt) {
    return { id: attempt.id, version: 1 as const, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) };
  }
  private admission(request: ExecutionRequest) {
    this.#recovery.assertWritable(); assertExecutionRequest(this, request);
    const mapping = this.#store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", request.attemptId);
    const stored = this.#store.get<Attempt>("attempt", request.attemptId);
    const proof = this.#store.get("transcription_preparation_intent", request.attemptId)
      ? resolveTranscriptionPreparationIntent(this.#store, stored!) : undefined;
    const result = resolveTranscriptionAdmission(this.#store, request, mapping ?? proof);
    if (mapping) assertTranscriptionMappingAdmission(result, mapping, resolveTranscriptionPreparation(this.#store, result.attempt, mapping));
    return result;
  }
  private hasDispatchOrResult(id: string): boolean {
    return !!(this.#store.get("transcription_execution_dispatch", id) || this.#store.get("transcription_execution_result", id));
  }
  private saveResult(attempt: Attempt, observation: TranscriptionExecutionObservation): TranscriptionExecutionResult {
    const mapping = this.#store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
    const dispatch = this.#store.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attempt.id);
    return this.#store.insert("transcription_execution_result", attempt.id, attempt.projectId, { ...this.recordIdentity(attempt),
      mappingDigest: mapping ? digest(mapping) : null, dispatchDigest: dispatch ? digest(dispatch) : null, observation });
  }
  private async notDispatched(admission: ReturnType<typeof resolveTranscriptionAdmission>, expectedLease: ExecutionCallOptions["expectedLease"],
    code: Extract<TranscriptionExecutionObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal, context?: SubmissionPreparationContext): Promise<ExecutionOutcome> {
    try {
      this.#store.transaction(() => {
        if (this.hasDispatchOrResult(admission.attempt.id)) return;
        // Even a definite local error belongs to the original submitting owner. Never block a replacement worker with a stale failure.
        if (context) assertOwnedTranscriptionPreparation(this.#store, admission.attempt, context);
        else assertTranscriptionFirstDispatch(this.#store, admission, expectedLease);
        this.saveResult(admission.attempt, { kind: "not_dispatched", code });
      });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "TRANSCRIPTION_EXECUTION_NOT_DISPATCHABLE") throw error;
      // No local decision was installed. A replacement may already have retained an outcome; otherwise recovery stays unknown.
    }
    return this.recover(admission.attempt, signal);
  }

  private deferred(attempt: Attempt, reason: SubmissionPreparationDeferred["reason"]): SubmissionPreparationDeferred {
    const current = this.#store.get<Attempt>("attempt", attempt.id)!;
    const proof = resolveTranscriptionPreparationIntent(this.#store, current);
    return { type: "preparation_deferred", intentId: proof.id, intentDigest: digest(proof), reason };
  }

  private async preparationFailure(admission: ReturnType<typeof resolveTranscriptionAdmission>, expectedLease: ExecutionCallOptions["expectedLease"],
    error: unknown, signal: AbortSignal | undefined, context: SubmissionPreparationContext,
    code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" = "LOCAL_INPUT_INVALID"): Promise<PreparationSubmissionOutcome> {
    if (this.hasDispatchOrResult(admission.attempt.id)) return this.recover(admission.attempt, signal);
    // Re-evaluate authority after any awaited failure. A stale local callback
    // cannot settle or defer a replacement owner's preparation.
    try { assertOwnedTranscriptionPreparation(this.#store, admission.attempt, context); }
    catch (control) {
      if (control instanceof DomainError && (control.code === "SUBMISSION_PREPARATION_PAUSED" || control.code === "SUBMISSION_PREPARATION_HELD"))
        return this.deferred(admission.attempt, control.code === "SUBMISSION_PREPARATION_PAUSED" ? "paused" : "held");
      throw control;
    }
    if (error instanceof DomainError && ["SUBMISSION_PREPARATION_OBSOLETE", "SUBMISSION_PREPARATION_LEASE_LOST", "SUBMISSION_PREPARATION_INVALID"].includes(error.code)) throw error;
    if (error instanceof DomainError && (error.code === "SUBMISSION_PREPARATION_PAUSED" || error.code === "SUBMISSION_PREPARATION_HELD"))
      return this.deferred(admission.attempt, error.code === "SUBMISSION_PREPARATION_PAUSED" ? "paused" : "held");
    if (signal?.aborted) return this.deferred(admission.attempt, "cancelled");
    if (error instanceof DomainError && error.code === "MEDIA_BUSY") return this.deferred(admission.attempt, "local_media_busy");
    return this.notDispatched(admission, expectedLease, code, signal, context);
  }
  private async recover(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const admission = this.admission(attempt.request);
    const mapping = this.#store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
    const dispatch = this.#store.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attempt.id);
    const result = this.#store.get<TranscriptionExecutionResult>("transcription_execution_result", attempt.id);
    const preparation = mapping ? resolveTranscriptionPreparation(this.#store, admission.attempt, mapping) : undefined;
    if (mapping) assertTranscriptionMappingAdmission(admission, mapping, preparation!);
    if (dispatch) {
      invariant(mapping, "TRANSCRIPTION_EXECUTION_CONFLICT", "Transcription dispatch has no prepared mapping");
      assertTranscriptionExecutionDispatch(admission.attempt, mapping, dispatch, preparation!);
    }
    if (!result) return unknown("Transcription dispatch has no durable outcome; automatic resubmission is disabled");
    const observation = result.observation;
    assertTranscriptionExecutionResult(admission.attempt, mapping, dispatch, result, preparation, observation.kind === "completed"
      ? this.#store.get("execution_output_receipt", observation.outputReceiptId) : undefined);
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted",
      failureId: `transcription-${digest(result).slice(0, 32)}`, technical: observation.kind === "not_dispatched" || observation.source === "local", retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`Transcription submission unresolved: ${observation.code}`);
    try {
      await this.#outputs.recover(attempt.projectId, observation.outputReceiptId, signal ? { signal } : {});
      const completion = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
      stopped(signal);
      invariant(completion && completion.receiptId === observation.outputReceiptId && completion.vendorTaskId === null && completion.outputs[0].sha256 === observation.result.rawResponseSha256
        && completion.outputs[0].byteLength === observation.result.rawResponseByteLength, "TRANSCRIPTION_EXECUTION_CONFLICT", "Winning transcription output differs from its observed returned bytes");
      return completion;
    } catch { return unknown("Transcription completed; owned output storage needs recovery without resubmission"); }
  }
}
