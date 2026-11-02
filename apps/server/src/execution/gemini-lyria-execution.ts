import { canonical, digest, invariant } from "@openslate/core";
import { assertExecutionRequest, GeminiLyriaAdapter, lyriaBody, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, LyriaResult } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { resolveCodePlanProviderAdmission, assertCodePlanFirstDispatch, assertCodePlanProviderLease } from "../code-plan/provider-authority.js";
import type { Store } from "../persistence/store.js";
import type { Attempt } from "./engine.js";
import { ExecutionOutputStore, assertOutputReceiptIdentity } from "./output-store.js";
import type { OutputReceipt } from "./output-store.js";

interface Dispatch { id: string; projectId: string; requestDigest: string; bodyDigest: string; createdAt: string }
type Observation = Exclude<LyriaResult, { kind: "completed" }>
  | { kind: "completed"; receiptId: string; sha256: string; mimeType: "audio/mpeg" | "audio/wav"; byteLength: number };
interface Result { id: string; projectId: string; requestDigest: string; dispatchDigest: string | null; observation: Observation; observationDigest: string }
const unknown = (): ExecutionOutcome => ({ type: "unknown", diagnostic: "Lyria may have charged; no vendor lookup exists. Never resubmit this attempt." });
export const lyriaFailureMessage = (code: string): string => code === "LYRIA_KEY_BILLING_REQUIRED"
  ? "Lyria requires a valid Gemini key whose Google project has billing enabled; the free tier cannot generate music."
  : code === "LYRIA_SAFETY_REFUSAL" ? "Lyria refused this music prompt under its safety policy. Change the prompt before generating again."
  : ["LYRIA_INPUT_INVALID", "LYRIA_INPUT_REJECTED"].includes(code) ? "Lyria refused the music input before generation. Correct the prompt or options before trying again."
  : code === "LYRIA_BUSY" ? "Lyria is busy. The request was refused before generation."
  : code === "LYRIA_AUDIO_MISSING" ? "Lyria returned no audio block. The call may have charged; retrying can charge another $0.08."
  : code === "LYRIA_NOT_SUBMITTED" ? "Lyria was not contacted. This attempt did not charge."
  : "Lyria did not return usable music. The call may have charged; retrying can charge another $0.08.";

/** Code-only synchronous bridge. Durable pre-send marker, local recovery only, one POST per attempt. */
export class GeminiLyriaExecution implements ExecutionProvider {
  readonly #bytes = new Map<string, Uint8Array>();
  constructor(readonly store: Store, readonly outputs: ExecutionOutputStore, readonly credentials: EnvironmentMediaCredentials,
    readonly transport: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}) {
    invariant(outputs.store === store, "LYRIA_CONFIGURATION", "Lyria requires the application's owned output store");
    registerExecutionProvider(this, { adapter: "gemini-lyria", version: "1" });
  }
  private admission(request: ExecutionRequest) {
    new InstallationRecoveryGuard(this.store).assertWritable(); assertExecutionRequest(this, request);
    const value = resolveCodePlanProviderAdmission(this.store, request);
    invariant(value && value.profile.kind === "music" && value.profile.adapter === "gemini-lyria", "LYRIA_AUTHORITY", "Lyria requires its exact code-plan music intent");
    return value;
  }
  private saved(attempt: Attempt): { dispatch?: Dispatch; result?: Result } {
    const dispatch = this.store.get<Dispatch>("lyria_dispatch", attempt.id), result = this.store.get<Result>("lyria_result", attempt.id);
    const requestDigest = digest(attempt.request);
    invariant(!dispatch || dispatch.id === attempt.id && dispatch.projectId === attempt.projectId && dispatch.requestDigest === requestDigest
      && dispatch.bodyDigest === digest(this.body(attempt.request)), "LYRIA_RECEIPT_CONFLICT", "Lyria dispatch differs from its intent");
    invariant(!result || result.id === attempt.id && result.projectId === attempt.projectId && result.requestDigest === requestDigest
      && result.dispatchDigest === (dispatch ? digest(dispatch) : null) && result.observationDigest === digest(result.observation),
    "LYRIA_RECEIPT_CONFLICT", "Lyria result differs from its dispatch");
    return { ...(dispatch ? { dispatch } : {}), ...(result ? { result } : {}) };
  }
  private body(request: ExecutionRequest) {
    return { prompt: request.args.prompt as string, durationSeconds: request.args.durationSeconds as number, instrumental: request.args.instrumental as boolean };
  }
  private save(attempt: Attempt, observation: Observation): void {
    const dispatch = this.store.get<Dispatch>("lyria_dispatch", attempt.id);
    const proposed = { id: attempt.id, projectId: attempt.projectId, requestDigest: digest(attempt.request),
      dispatchDigest: dispatch ? digest(dispatch) : null, observation, observationDigest: digest(observation) };
    const saved = this.store.get<Result>("lyria_result", attempt.id);
    invariant(!saved || canonical(saved) === canonical(proposed), "LYRIA_RECEIPT_CONFLICT", "Lyria already has a different outcome");
    if (!saved) this.store.insert("lyria_result", attempt.id, attempt.projectId, proposed);
  }
  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const request = structuredClone(input), { attempt } = this.admission(request);
    const previous = this.saved(attempt);
    if (previous.dispatch || previous.result) return this.recover(attempt);
    let adapter: GeminiLyriaAdapter;
    try {
      lyriaBody(this.body(request));
      adapter = new GeminiLyriaAdapter({ apiKey: this.credentials.resolve("gemini-music"), ...this.transport });
    } catch {
      this.store.transaction(() => { assertCodePlanProviderLease(this.store, attempt, options.expectedLease);
        if (!this.saved(attempt).dispatch) this.save(attempt, { kind: "rejected", code: "LYRIA_KEY_BILLING_REQUIRED", retry: "none" }); });
      return this.recover(attempt);
    }
    const claimed = this.store.transaction(() => {
      if (this.saved(attempt).dispatch || this.saved(attempt).result) return false;
      assertCodePlanFirstDispatch(this.store, attempt, options.expectedLease);
      if (options.signal?.aborted) { this.save(attempt, { kind: "rejected", code: "LYRIA_NOT_SUBMITTED", retry: "safe" }); return false; }
      this.store.insert("lyria_dispatch", attempt.id, attempt.projectId, { requestDigest: digest(request), bodyDigest: digest(this.body(request)), createdAt: new Date().toISOString() });
      return true;
    });
    if (!claimed) return this.recover(attempt);
    const response = await adapter.generate(this.body(request), options.signal ? { signal: options.signal } : {});
    if (response.kind === "completed") {
      // Keep returned paid bytes even if local capacity/cancellation delays the spool.
      this.#bytes.set(attempt.id, response.bytes);
      this.store.transaction(() => {
        const receipt = this.outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(request),
          port: "audio", kind: "audio", mimeType: response.mimeType, vendorTaskId: null, diagnosticRequestId: null,
          source: { kind: "returned_bytes", sha256: response.sha256, byteLength: response.bytes.byteLength } });
        this.save(attempt, { kind: "completed", receiptId: receipt.id, sha256: response.sha256, mimeType: response.mimeType, byteLength: response.bytes.byteLength });
      });
    } else this.save(attempt, response);
    return response.kind === "unknown" ? unknown() : this.recover(attempt);
  }
  async lookup(id: string, request?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const attempt = this.store.get<Attempt>("attempt", id);
    invariant(attempt && (!request || request.attemptId === id), "LYRIA_AUTHORITY", "Unknown Lyria attempt");
    this.admission(structuredClone(request ?? attempt.request));
    const saved = this.saved(attempt);
    if (!saved.dispatch && !saved.result) this.store.transaction(() => {
      assertCodePlanProviderLease(this.store, attempt, options.expectedLease, true);
      this.save(attempt, { kind: "rejected", code: "LYRIA_NOT_SUBMITTED", retry: "safe" });
    });
    return this.recover(attempt);
  }
  async poll(_id: string, request?: Readonly<ExecutionRequest>, options?: ExecutionCallOptions): Promise<ExecutionOutcome> {
    invariant(request, "LYRIA_AUTHORITY", "Synchronous Lyria recovery requires its original request");
    return this.lookup(request.attemptId, request, options);
  }
  private async recover(attempt: Attempt): Promise<ExecutionOutcome> {
    this.admission(attempt.request);
    const { dispatch, result } = this.saved(attempt), observation = result?.observation;
    if (!observation) return dispatch && Date.now() - Date.parse(dispatch.createdAt) >= 600000
      ? { type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false } : unknown();
    if (observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted", failureId: observation.code,
      technical: observation.code !== "LYRIA_SAFETY_REFUSAL", retryAllowed: observation.retry === "safe" };
    if (observation.kind === "unknown") return { type: "failed", taskId: null,
      failureId: observation.code === "LYRIA_AUDIO_MISSING" || observation.code === "LYRIA_AUDIO_INVALID" ? observation.code : "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false };
    invariant(dispatch, "LYRIA_RECEIPT_CONFLICT", "A completed Lyria result requires dispatch evidence");
    const receipt = this.store.get<OutputReceipt>("execution_output_receipt", observation.receiptId);
    invariant(receipt, "LYRIA_RECEIPT_CONFLICT", "Lyria output receipt is missing");
    assertOutputReceiptIdentity(receipt, attempt);
    invariant(receipt.mimeType === observation.mimeType && receipt.source.kind === "returned_bytes" && receipt.source.sha256 === observation.sha256
      && receipt.source.byteLength === observation.byteLength, "LYRIA_RECEIPT_CONFLICT", "Lyria bytes differ from the returned result");
    const bytes = this.#bytes.get(attempt.id);
    if (bytes) {
      await this.outputs.spool(attempt.projectId, receipt.id, async function* () {
        for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) yield bytes.subarray(offset, offset + 1024 * 1024);
      });
      this.#bytes.delete(attempt.id);
    }
    await this.outputs.recover(attempt.projectId, receipt.id);
    const completion = await this.outputs.recoverCompletion(attempt.projectId, attempt.id);
    return completion ?? unknown();
  }
}
