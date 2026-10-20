import { canonical, digest, DomainError, invariant } from "@openslate/core";
import { assertExecutionRequest, OpenAISpeechAdapter, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { Store } from "../persistence/store.js";
import type { Attempt } from "./engine.js";
import { ExecutionOutputStore, isOutputStoreCapacityError } from "./output-store.js";
import { assertSpeechFirstDispatch, assertSpeechMappingAdmission, resolveSpeechAdmission } from "./audio-execution-authority.js";
import { assertSpeechExecutionDispatch, assertSpeechExecutionMapping, assertSpeechExecutionResult, prepareSpeechExecutionRequest } from "./audio-execution-receipts.js";
import type { SpeechExecutionDispatch, SpeechExecutionMapping, SpeechExecutionObservation, SpeechExecutionResult } from "./audio-execution-receipts.js";
import { assertPersonalVoiceCurrent } from '../narration/personal-voices.js';

const unknown = (diagnostic: string): ExecutionOutcome => ({ type: "unknown", diagnostic });
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "SPEECH_EXECUTION_CANCELLED", "Speech preparation was cancelled");

/** Explicit host bridge: registration is availability, never a spending allowance or default activation. */
export class OpenAISpeechExecution implements ExecutionProvider {
  readonly #store: Store;
  readonly #outputs: ExecutionOutputStore;
  readonly #credentials: EnvironmentMediaCredentials;
  readonly #recovery: InstallationRecoveryGuard;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #timeoutMs: number | undefined;
  /** Retain charged responses until a durable spool exists, including a deferred local capacity retry. */
  readonly #returnedBytes = new Map<string, Uint8Array>();
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; credentials: EnvironmentMediaCredentials;
    fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    invariant(options.outputStore.store === options.store, "SPEECH_EXECUTION_CONFIGURATION", "Speech requires one application store and its owned output store");
    this.#store = options.store; this.#outputs = options.outputStore; this.#credentials = options.credentials;
    this.#recovery = new InstallationRecoveryGuard(options.store); this.#fetch = options.fetch; this.#timeoutMs = options.timeoutMs;
    registerExecutionProvider(this, { adapter: "openai-speech", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal, expectedLease = options.expectedLease ? { ...options.expectedLease } : undefined;
    const request = structuredClone(input), admission = this.admission(request), attempt = admission.attempt;
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    assertSpeechFirstDispatch(this.#store, admission, expectedLease);
    let prepared: ReturnType<typeof prepareSpeechExecutionRequest>, mapping: SpeechExecutionMapping;
    try {
      stopped(signal); assertPersonalVoiceCurrent(this.#store, attempt.projectId, String(request.args.voice)); prepared = prepareSpeechExecutionRequest(request);
      const proposed: SpeechExecutionMapping = { ...this.identity(attempt), profileDigest: request.profile!.digest,
        profileDefinitionDigest: digest(admission.profile), profileDefinition: admission.profile,
        capabilityLockId: admission.capabilityLock.id, capabilityLockDigest: digest(admission.capabilityLock),
        allowanceId: (admission.allowance?.id ?? null), allowanceDigest: (admission.allowance ? digest(admission.allowance) : null), consumptionDigest: (admission.consumption ? digest(admission.consumption) : null),
        estimatedMicros: admission.reservation.micros, transport: prepared.description, bodyByteLength: prepared.bodyByteLength };
      mapping = this.#store.transaction(() => {
        stopped(signal); assertSpeechFirstDispatch(this.#store, admission, expectedLease);
        const existing = this.#store.get<SpeechExecutionMapping>("speech_execution_mapping", attempt.id);
        if (existing) {
          invariant(canonical(existing) === canonical(proposed), "SPEECH_EXECUTION_CONFLICT", "Prepared speech mapping changed for this attempt");
          return existing;
        }
        return this.#store.insert("speech_execution_mapping", attempt.id, attempt.projectId, proposed);
      });
    } catch {
      return this.notDispatched(admission, expectedLease, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_INPUT_INVALID", signal);
    }
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    let transport: OpenAISpeechAdapter;
    try {
      stopped(signal);
      transport = new OpenAISpeechAdapter({ apiKey: this.#credentials.resolve("openai-media"),
        ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }), ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }) });
      stopped(signal);
    } catch {
      return this.notDispatched(admission, expectedLease, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal);
    }
    let claimed: boolean;
    try {
      claimed = this.#store.transaction(() => {
        if (this.hasDispatchOrResult(attempt.id)) return false;
        stopped(signal); assertSpeechFirstDispatch(this.#store, admission, expectedLease);
        assertPersonalVoiceCurrent(this.#store, attempt.projectId, String(request.args.voice));
        const marker: SpeechExecutionDispatch = { ...this.identity(attempt), mappingDigest: digest(mapping),
          transportDigest: mapping.transport.requestDigest, bodySha256: mapping.transport.bodySha256,
          allowanceId: (admission.allowance?.id ?? null), createdAt: new Date().toISOString() };
        this.#store.insert("speech_execution_dispatch", attempt.id, attempt.projectId, marker); return true;
      });
    } catch (error) {
      if (!(error instanceof DomainError) || !error.code.startsWith('PERSONAL_VOICE_')) throw error;
      // Consent was revoked before the irreversible marker: positively retain that no request was sent.
      return this.notDispatched(admission, expectedLease, 'LOCAL_INPUT_INVALID', signal);
    }
    if (!claimed) return this.recover(attempt, signal);

    let bytes: Uint8Array | undefined;
    try {
      const response = await transport.submit(prepared.request, { attemptId: attempt.id,
        expectedRequestDigest: mapping.transport.requestDigest, expectedBodySha256: mapping.transport.bodySha256,
        ...(signal ? { signal } : {}) });
      if (response.kind === "completed") {
        bytes = Uint8Array.from(response.result.bytes);
        // Late observations retain evidence independently of publication authority; the Engine still owns its original lease.
        this.#store.transaction(() => {
          const receipt = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(request),
            port: "audio", kind: "audio", mimeType: "audio/wav", vendorTaskId: null, diagnosticRequestId: response.receipt.requestId,
            source: { kind: "returned_bytes", sha256: response.result.sha256, byteLength: bytes!.byteLength } });
          const { bytes: _bytes, ...result } = response.result;
          this.saveResult(attempt, { ...response, reportedModel: null, result, outputReceiptId: receipt.id });
        });
      } else this.saveResult(attempt, response);
    } catch {
      // An irreversible marker cannot be turned into a definite local non-dispatch after the fact.
      return unknown("Speech dispatch has no durable outcome; automatic resubmission is disabled");
    }
    if (bytes) this.#returnedBytes.set(attempt.id, bytes);
    return this.recover(attempt, signal);
  }

  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal;
    this.#recovery.assertWritable();
    const saved = this.#store.get<Attempt>("attempt", attemptId);
    invariant(saved && (!input || input.attemptId === attemptId), "SPEECH_EXECUTION_CONFLICT", "Unknown or mismatched speech attempt");
    const admission = this.admission(structuredClone(input ?? saved.request));
    return this.recover(admission.attempt, signal);
  }

  async poll(_taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    this.#recovery.assertWritable();
    if (input) this.admission(structuredClone(input));
    stopped(options.signal);
    return unknown("Synchronous speech generation has no pollable vendor task");
  }

  private identity(attempt: Attempt) {
    return { id: attempt.id, version: 1 as const, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) };
  }
  private admission(request: ExecutionRequest) {
    this.#recovery.assertWritable(); assertExecutionRequest(this, request);
    const mapping = this.#store.get<SpeechExecutionMapping>("speech_execution_mapping", request.attemptId);
    const result = resolveSpeechAdmission(this.#store, request, mapping);
    if (mapping) { assertSpeechExecutionMapping(result.attempt, mapping); assertSpeechMappingAdmission(result, mapping); }
    return result;
  }
  private hasDispatchOrResult(id: string): boolean {
    return !!(this.#store.get("speech_execution_dispatch", id) || this.#store.get("speech_execution_result", id));
  }
  private saveResult(attempt: Attempt, observation: SpeechExecutionObservation): SpeechExecutionResult {
    const mapping = this.#store.get<SpeechExecutionMapping>("speech_execution_mapping", attempt.id);
    const dispatch = this.#store.get<SpeechExecutionDispatch>("speech_execution_dispatch", attempt.id);
    return this.#store.insert("speech_execution_result", attempt.id, attempt.projectId, { ...this.identity(attempt),
      mappingDigest: mapping ? digest(mapping) : null, dispatchDigest: dispatch ? digest(dispatch) : null, observation });
  }
  private async notDispatched(admission: ReturnType<typeof resolveSpeechAdmission>, expectedLease: ExecutionCallOptions["expectedLease"],
    code: Extract<SpeechExecutionObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal): Promise<ExecutionOutcome> {
    try {
      this.#store.transaction(() => {
        if (this.hasDispatchOrResult(admission.attempt.id)) return;
        // Even a definite local error belongs to the original submitting owner. Never block a replacement worker with a stale failure.
        assertSpeechFirstDispatch(this.#store, admission, expectedLease);
        this.saveResult(admission.attempt, { kind: "not_dispatched", code });
      });
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "SPEECH_EXECUTION_NOT_DISPATCHABLE") throw error;
      // No local decision was installed. A replacement may already have retained an outcome; otherwise recovery stays unknown.
    }
    return this.recover(admission.attempt, signal);
  }
  private async recover(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const admission = this.admission(attempt.request);
    const mapping = this.#store.get<SpeechExecutionMapping>("speech_execution_mapping", attempt.id);
    const dispatch = this.#store.get<SpeechExecutionDispatch>("speech_execution_dispatch", attempt.id);
    const result = this.#store.get<SpeechExecutionResult>("speech_execution_result", attempt.id);
    if (mapping) assertSpeechMappingAdmission(admission, mapping);
    if (dispatch) {
      invariant(mapping, "SPEECH_EXECUTION_CONFLICT", "Speech dispatch has no prepared mapping");
      assertSpeechExecutionDispatch(admission.attempt, mapping, dispatch);
    }
    if (!result) return unknown("Speech dispatch has no durable outcome; automatic resubmission is disabled");
    const observation = result.observation;
    assertSpeechExecutionResult(admission.attempt, mapping, dispatch, result, observation.kind === "completed"
      ? this.#store.get("execution_output_receipt", observation.outputReceiptId) : undefined);
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted",
      failureId: `speech-${digest(result).slice(0, 32)}`, technical: observation.kind === "not_dispatched" || observation.source === "local", retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`Speech submission unresolved: ${observation.code}`);
    try {
      const saved = this.#returnedBytes.get(attempt.id);
      if (saved) {
        // The paid response must become durable even if the submitting caller is stopped
        // while it waits for a writer. Publication remains fenced by its original lease.
        await this.#outputs.spool(attempt.projectId, observation.outputReceiptId, async function* () {
          for (let offset = 0; offset < saved.byteLength; offset += 1024 * 1024) yield saved.subarray(offset, offset + 1024 * 1024);
        });
        this.#returnedBytes.delete(attempt.id);
      }
      await this.#outputs.recover(attempt.projectId, observation.outputReceiptId, signal ? { signal } : {});
      const completion = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
      stopped(signal);
      invariant(completion && completion.receiptId === observation.outputReceiptId && completion.vendorTaskId === null && completion.outputs[0].sha256 === observation.result.sha256
        && completion.outputs[0].byteLength === observation.result.byteLength, "SPEECH_EXECUTION_CONFLICT", "Winning speech output differs from its observed returned bytes");
      return completion;
    } catch (error) {
      if (isOutputStoreCapacityError(error)) throw error;
      return unknown("Speech completed; owned output storage needs recovery without resubmission");
    }
  }
}
