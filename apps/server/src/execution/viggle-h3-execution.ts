import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertExecutionRequest, describeViggleH3Request, ViggleH3Provider, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, ViggleH3Request, ViggleH3Resolution, ViggleH3Quality, ViggleH3AspectRatio, ViggleH3SubmitResult } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { Store } from "../persistence/store.js";
import type { Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { ProtectedVideoDownloader } from "./video-download.js";
import { assertViggleH3ExecutionDispatch, assertViggleH3ExecutionMapping, assertViggleH3ExecutionObservation, assertViggleH3ExecutionSubmit, assertViggleH3OperationOptions, assertViggleH3PollPolicy, assertViggleH3PollSchedule, viggleH3ObservationId } from "./viggle-h3-receipts.js";
import type { ViggleH3ExecutionDispatch, ViggleH3ExecutionMapping, ViggleH3ExecutionObservation, ViggleH3ExecutionSubmit, ViggleH3PollObservation, ViggleH3PollPolicy, ViggleH3PollSchedule, ViggleH3SubmitObservation } from "./viggle-h3-receipts.js";
import { assertViggleFirstDispatch, assertViggleMappingAdmission, resolveViggleAdmission, resolveViggleFrame, viggleFramePin, viggleRecord } from "./viggle-h3-authority.js";
import type { ViggleFrameEvidence } from "./viggle-h3-authority.js";
import { assertViggleSpoolLineage, viggleObservations } from "./viggle-h3-lineage.js";

const unknown = (diagnostic: string, taskId?: string): ExecutionOutcome => ({ type: "unknown", diagnostic, ...(taskId ? { taskId } : {}) });
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "VIGGLE_H3_EXECUTION_CANCELLED", "H3 operation was cancelled");

/** Trusted opt-in application bridge. Construction registers availability, never spending permission. */
export class ViggleH3Execution implements ExecutionProvider {
  readonly #recovery: InstallationRecoveryGuard;
  readonly #store: Store; readonly #outputs: ExecutionOutputStore; readonly #root: string;
  readonly #credentials: EnvironmentMediaCredentials; readonly #download: ProtectedVideoDownloader;
  readonly #fetch: typeof globalThis.fetch | undefined; readonly #timeout: number; readonly #now: () => number;
  readonly #policy: ViggleH3PollPolicy;
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; artifactRoot: string;
    credentials: EnvironmentMediaCredentials; downloader: ProtectedVideoDownloader; fetch?: typeof globalThis.fetch; timeoutMs?: number;
    pollPolicy?: { initialMs?: number; maximumMs?: number; retryAfterMaximumMs?: number }; now?: () => number }) {
    invariant(options.outputStore.store === options.store && isAbsolute(options.artifactRoot) && options.artifactRoot !== "/",
      "VIGGLE_H3_EXECUTION_CONFIGURATION", "Use one application store and an owned artifact root");
    this.#store = options.store; this.#outputs = options.outputStore; this.#credentials = options.credentials; this.#download = options.downloader;
    this.#recovery = new InstallationRecoveryGuard(options.store);
    this.#fetch = options.fetch; this.#timeout = options.timeoutMs ?? 30000; this.#now = options.now ?? Date.now;
    invariant(Number.isSafeInteger(this.#timeout) && this.#timeout >= 1 && this.#timeout <= 120000,
      "VIGGLE_H3_EXECUTION_CONFIGURATION", "H3 request timeout must be bounded");
    this.#policy = Object.freeze({ initialMs: options.pollPolicy?.initialMs ?? 2000, maximumMs: options.pollPolicy?.maximumMs ?? 15000,
      retryAfterMaximumMs: options.pollPolicy?.retryAfterMaximumMs ?? 86400000, claimMs: this.#timeout + 301000 });
    assertViggleH3PollPolicy(this.#policy);
    mkdirSync(options.artifactRoot, { recursive: true, mode: 0o700 }); this.#root = realpathSync(options.artifactRoot);
    registerExecutionProvider(this, { adapter: "viggle-h3", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const request = structuredClone(input), signal = options.signal, expected = options.expectedLease ? { ...options.expectedLease } : undefined;
    const attempt = this.admitted(request);
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    this.dispatchable(attempt, expected);
    let prepared: ViggleH3Request, mapping: ViggleH3ExecutionMapping;
    try {
      const savedMapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id);
      const admission = resolveViggleAdmission(this.#store, request, savedMapping), frame = resolveViggleFrame(this.#store, attempt, savedMapping?.firstFrame);
      stopped(signal); prepared = await this.prepare(attempt, signal, frame); stopped(signal);
      const proposed: ViggleH3ExecutionMapping = { ...this.identity(attempt), profileDigest: request.profile!.digest,
        profileDefinitionDigest: digest(admission.profile), profileDefinition: admission.profile, capabilityLockId: admission.capabilityLock.id,
        capabilityLockDigest: digest(admission.capabilityLock), allowanceId: admission.allowance.id, allowanceDigest: digest(admission.allowance),
        consumptionDigest: digest(admission.consumption), estimatedMicros: admission.reservation.micros, firstFrame: viggleFramePin(frame),
        transport: describeViggleH3Request(prepared) };
      assertViggleH3ExecutionMapping(attempt, proposed);
      mapping = this.#store.transaction(() => {
        this.dispatchable(attempt, expected);
        assertViggleMappingAdmission(resolveViggleAdmission(this.#store, request, proposed), proposed);
        const saved = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id);
        invariant(!this.started(attempt.id) || saved, "VIGGLE_H3_EXECUTION_CONFLICT", "Closed preparation cannot acquire a mapping");
        if (saved) { invariant(canonical(saved) === canonical(proposed), "VIGGLE_H3_EXECUTION_CONFLICT", "Prepared H3 payload changed"); return saved; }
        return this.#store.insert("viggle_h3_execution_mapping", attempt.id, attempt.projectId, proposed);
      });
    } catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_INPUT_INVALID", signal); }
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    let transport: ViggleH3Provider;
    try { stopped(signal); transport = this.transport(); }
    catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal); }
    const claimed = this.#store.transaction(() => {
      if (this.started(attempt.id)) return false;
      stopped(signal); this.dispatchable(attempt, expected);
      assertViggleMappingAdmission(resolveViggleAdmission(this.#store, request, mapping), mapping);
      const dispatch: ViggleH3ExecutionDispatch = { ...this.identity(attempt), mappingDigest: digest(mapping), bodySha256: mapping.transport.bodySha256,
        allowanceId: request.externalAllowanceId!, createdAt: this.now() };
      this.#store.insert("viggle_h3_execution_dispatch", attempt.id, attempt.projectId, dispatch); return true;
    });
    if (!claimed) return this.replay(attempt, signal);
    let observation: ViggleH3SubmitResult | undefined;
    try {
      observation = await transport.submit(prepared, { expectedRequestDigest: mapping.transport.requestDigest, expectedBodySha256: mapping.transport.bodySha256, ...(signal ? { signal } : {}) });
      // Preserve accepted/unknown evidence even if the caller's lease was lost during the POST.
      this.#store.transaction(() => {
        const result = this.saveSubmit(attempt, observation!);
        if (result.observation.kind === "accepted") this.schedule(attempt, result);
      });
    } catch {
      // Keep any task received before a failed local write available to Engine evidence. The POST marker is never removed.
      if (observation?.kind === "accepted") return { type: "accepted", taskId: observation.taskId };
      return unknown("H3 submission observation needs recovery; automatic resubmission is disabled");
    }
    return this.replay(attempt, signal);
  }

  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const saved = this.#store.get<Attempt>("attempt", attemptId);
    invariant(saved && (!input || input.attemptId === attemptId), "VIGGLE_H3_EXECUTION_CONFLICT", "Unknown or mismatched H3 attempt");
    return this.replay(this.admitted(structuredClone(input ?? saved.request)), options.signal);
  }

  async poll(taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    invariant(input, "VIGGLE_H3_EXECUTION_CONFLICT", "Polling requires the exact admitted request");
    const signal = options.signal, attempt = this.admitted(structuredClone(input));
    const submission = this.submission(attempt);
    if (submission?.observation.kind === "accepted") invariant(taskId === submission.observation.taskId
      && (!attempt.taskId || taskId === attempt.taskId), "VIGGLE_H3_EXECUTION_CONFLICT", "Cannot poll a different task");
    const local = await this.replay(attempt, signal);
    if (local.type !== "accepted") return local;
    invariant(taskId === local.taskId && (!attempt.taskId || taskId === attempt.taskId), "VIGGLE_H3_EXECUTION_CONFLICT", "Cannot poll a different task");
    const submit = this.submission(attempt)!;
    const claim = this.#store.transaction(() => {
      stopped(signal); const schedule = this.schedule(attempt, submit);
      if (schedule.nextPollAt > this.now()) return null;
      const next: ViggleH3PollSchedule = { ...schedule, count: schedule.count + 1, claimId: randomUUID(), nextPollAt: this.now() + schedule.policy.claimMs };
      return this.#store.put("viggle_h3_poll_schedule", attempt.id, attempt.projectId, next);
    });
    if (!claim) return local;
    let saved: ViggleH3ExecutionObservation | undefined, result: ExecutionOutcome = unknown("H3 task observation is unavailable", taskId);
    try {
      let response;
      try {
        stopped(signal);
        // A restarted host may raise its default timeout; the original durable poll claim remains the bound.
        response = await this.transport(Math.min(this.#timeout, claim.policy.claimMs - 301000)).poll(taskId, signal ? { signal } : {});
      }
      catch { response = { kind: "unknown" as const, taskId, error: { code: "VIGGLE_H3_LOCAL_CREDENTIAL_UNAVAILABLE", category: "auth" as const }, receipt: { requestId: null, httpStatus: null } }; }
      if (response.kind === "completed") {
        saved = this.#store.transaction(() => {
          const output = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(attempt.request),
            port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: taskId, diagnosticRequestId: response.receipt.requestId,
            source: { kind: "protected_locator", locator: response.output.url, expiresAt: response.output.expiresAt } });
          const { output: _output, ...redacted } = response;
          return this.saveObservation(attempt, { ...redacted, outputReceiptId: output.id });
        });
        const observation = saved.observation;
        invariant(observation.kind === "completed", "VIGGLE_H3_EXECUTION_CONFLICT", "Expected completed polling evidence");
        const receipt = this.#store.get<import("./output-store.js").OutputReceipt>("execution_output_receipt", observation.outputReceiptId)!;
        try {
          await this.#outputs.spool(attempt.projectId, receipt.id, this.#download.source(receipt), signal ? { signal } : {});
          const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
          invariant(completed, "VIGGLE_H3_EXECUTION_CONFLICT", "Downloaded output has no winning slot");
          assertViggleSpoolLineage(this.#store, attempt, completed.outputs[0]!.storage.spoolId); result = completed;
        } catch { result = unknown("H3 completed; owned video storage needs recovery", taskId); }
      } else {
        saved = this.saveObservation(attempt, response.kind === "unknown" ? { ...response, taskId } : response);
        result = this.outcome(saved);
      }
    } catch { result = unknown("H3 task observation needs recovery", taskId); }
    finally {
      // A late worker may retain evidence, but cannot shorten a replacement poller's cooldown.
      this.#store.transaction(() => {
        const current = this.#store.get<ViggleH3PollSchedule>("viggle_h3_poll_schedule", attempt.id);
        if (current?.claimId !== claim.claimId) return;
        let delay = Math.min(current.policy.maximumMs, current.policy.initialMs * 2 ** Math.min(current.count - 1, 20));
        const observation = saved?.observation;
        if (observation?.kind === "unknown" && ["auth", "quota", "throttled"].includes(observation.error.category))
          delay = Math.max(delay, Math.min(current.policy.retryAfterMaximumMs, observation.error.retryAfterMs ?? 0));
        this.#store.put("viggle_h3_poll_schedule", attempt.id, attempt.projectId, { ...current, claimId: null, nextPollAt: this.now() + delay,
          lastObservationId: saved?.id ?? current.lastObservationId });
      });
    }
    return result;
  }

  private now(): number {
    const value = this.#now(); invariant(Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - 86400000,
      "VIGGLE_H3_EXECUTION_CONFIGURATION", "Invalid trusted polling clock"); return value;
  }
  private identity(attempt: Attempt) { return { id: attempt.id, version: 1 as const, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) }; }
  private admitted(request: ExecutionRequest): Attempt {
    this.#recovery.assertWritable();
    assertExecutionRequest(this, request);
    const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", request.attemptId);
    const admission = resolveViggleAdmission(this.#store, request, mapping);
    if (mapping) assertViggleMappingAdmission(admission, mapping);
    return admission.attempt;
  }
  private dispatchable(previous: Attempt, expected: ExecutionCallOptions["expectedLease"]): void {
    const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", previous.id);
    const admission = resolveViggleAdmission(this.#store, previous.request, mapping);
    // Keep the originally captured lease even if another connection changed the stored attempt.
    assertViggleFirstDispatch(this.#store, { ...admission, attempt: previous }, expected);
  }
  private started(id: string): boolean { return !!(this.#store.get("viggle_h3_execution_dispatch", id) || this.#store.get("viggle_h3_execution_submit", id)); }
  private transport(timeoutMs = this.#timeout): ViggleH3Provider {
    return new ViggleH3Provider({ apiKey: this.#credentials.resolve("viggle-video"),
      ...(this.#fetch ? { fetch: this.#fetch } : {}), timeoutMs });
  }
  private submission(attempt: Attempt): ViggleH3ExecutionSubmit | undefined {
    const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id), dispatch = this.#store.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id);
    if (mapping) assertViggleMappingAdmission(resolveViggleAdmission(this.#store, attempt.request, mapping), mapping);
    if (dispatch) { invariant(mapping, "VIGGLE_H3_EXECUTION_CONFLICT", "H3 dispatch lost its mapping"); assertViggleH3ExecutionDispatch(attempt, mapping, dispatch); }
    let result = this.#store.get<ViggleH3ExecutionSubmit>("viggle_h3_execution_submit", attempt.id);
    // An Engine task receipt can preserve a valid acceptance if a local bridge write failed after HTTP.
    if (!result && dispatch && mapping && attempt.taskId && /^vid_[A-Za-z0-9_-]{1,156}$/.test(attempt.taskId)) {
      const rows = this.#store.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='execution_evidence' AND project_id=? AND json_extract(body,'$.attemptId')=? ORDER BY id LIMIT 129")
        .all(attempt.projectId, attempt.id) as { id: string; bytes: number }[];
      invariant(rows.length <= 128 && rows.every(row => row.bytes <= 32768), "VIGGLE_H3_EXECUTION_CONFLICT", "Acceptance evidence exceeds its bound");
      const accepted = rows.map(row => viggleRecord<{ attemptId: string; outcome: ExecutionOutcome; outcomeDigest: string }>(this.#store, "execution_evidence", row.id, attempt.projectId)!)
        .filter(item => item.attemptId === attempt.id && item.outcomeDigest === digest(item.outcome) && item.outcome.type === "accepted");
      const tasks = new Set(accepted.map(item => item.outcome.type === "accepted" ? item.outcome.taskId : ""));
      invariant(tasks.size <= 1 && (!tasks.size || tasks.has(attempt.taskId)), "VIGGLE_H3_EXECUTION_CONFLICT", "Retained accepted task evidence conflicts");
      if (tasks.has(attempt.taskId)) result = this.saveSubmit(attempt, { kind: "accepted", taskId: attempt.taskId, requestedModel: mapping.transport.model,
        receipt: { requestId: null, httpStatus: null } });
    }
    if (result) assertViggleH3ExecutionSubmit(attempt, mapping, dispatch, result);
    return result;
  }
  private saveSubmit(attempt: Attempt, observation: ViggleH3SubmitObservation): ViggleH3ExecutionSubmit {
    const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id), dispatch = this.#store.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id);
    const value: ViggleH3ExecutionSubmit = { ...this.identity(attempt), mappingDigest: mapping ? digest(mapping) : null,
      dispatchDigest: dispatch ? digest(dispatch) : null, observedAt: this.now(), observation };
    assertViggleH3ExecutionSubmit(attempt, mapping, dispatch, value);
    return this.#store.insert("viggle_h3_execution_submit", attempt.id, attempt.projectId, value);
  }
  private async notDispatched(attempt: Attempt, expected: ExecutionCallOptions["expectedLease"], code: Extract<ViggleH3SubmitObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal): Promise<ExecutionOutcome> {
    this.#store.transaction(() => { if (!this.started(attempt.id)) { this.dispatchable(attempt, expected); this.saveSubmit(attempt, { kind: "not_dispatched", code }); } });
    return this.replay(attempt, signal);
  }
  private schedule(attempt: Attempt, submit: ViggleH3ExecutionSubmit): ViggleH3PollSchedule {
    const saved = this.#store.get<ViggleH3PollSchedule>("viggle_h3_poll_schedule", attempt.id);
    if (saved) { assertViggleH3PollSchedule(attempt, submit, saved); return saved; }
    invariant(submit.observation.kind === "accepted", "VIGGLE_H3_EXECUTION_CONFLICT", "Only accepted tasks can have a polling schedule");
    return this.#store.insert("viggle_h3_poll_schedule", attempt.id, attempt.projectId, { ...this.identity(attempt), taskId: submit.observation.taskId,
      policy: this.#policy, count: 0, nextPollAt: this.now() + this.#policy.initialMs, claimId: null, lastObservationId: null });
  }
  private saveObservation(attempt: Attempt, observation: ViggleH3PollObservation): ViggleH3ExecutionObservation {
    const id = viggleH3ObservationId(attempt.id, observation), previous = this.#store.get<ViggleH3ExecutionObservation>("viggle_h3_execution_observation", id);
    if (previous) {
      // The same protected receipt may be reported again with another HTTP trace. Keep its first immutable observation.
      invariant(observation.kind === "completed" && previous.observation.kind === "completed" || canonical(previous.observation) === canonical(observation),
        "VIGGLE_H3_EXECUTION_CONFLICT", "Observation identity collision"); return previous;
    }
    const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id)!;
    return this.#store.insert("viggle_h3_execution_observation", id, attempt.projectId, { ...this.identity(attempt), id, mappingDigest: digest(mapping),
      dispatchDigest: digest(dispatch), observedAt: this.now(), observation });
  }
  private async replay(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    try { const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
      if (completed) { assertViggleSpoolLineage(this.#store, attempt, completed.outputs[0]!.storage.spoolId); return completed; } }
    catch { return unknown("H3 owned output requires local recovery", attempt.taskId ?? undefined); }
    const submit = this.submission(attempt);
    if (!submit) return unknown("H3 acceptance is unresolved; automatic resubmission is disabled", attempt.taskId ?? undefined);
    const observation = submit.observation;
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted",
      failureId: `h3-${digest(submit).slice(0, 32)}`, technical: observation.kind === "not_dispatched", retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`H3 submission unresolved: ${observation.error.code}`, attempt.taskId ?? undefined);
    invariant(!attempt.taskId || attempt.taskId === observation.taskId, "VIGGLE_H3_EXECUTION_CONFLICT", "H3 accepted identity contradicts the saved task");
    const schedule = this.#store.transaction(() => this.schedule(attempt, submit));
    // A terminal observation can survive a crash before the mutable cooldown pointer was updated.
    const terminal = viggleObservations(this.#store, attempt).find(item => ["failed", "cancelled"].includes(item.observation.kind));
    if (terminal) {
      const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id)!;
      assertViggleH3ExecutionObservation(attempt, mapping, dispatch, submit, terminal); return this.outcome(terminal);
    }
    const last = schedule.lastObservationId ? this.#store.get<ViggleH3ExecutionObservation>("viggle_h3_execution_observation", schedule.lastObservationId) : undefined;
    if (last) {
      const mapping = this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<ViggleH3ExecutionDispatch>("viggle_h3_execution_dispatch", attempt.id)!;
      assertViggleH3ExecutionObservation(attempt, mapping, dispatch, submit, last, last.observation.kind === "completed" ? this.#store.get("execution_output_receipt", last.observation.outputReceiptId) : undefined);
      if (last.observation.kind === "failed" || last.observation.kind === "cancelled") return this.outcome(last);
    }
    return { type: "accepted", taskId: observation.taskId };
  }
  private outcome(record: ViggleH3ExecutionObservation): ExecutionOutcome {
    const observation = record.observation;
    if (observation.kind === "failed" || observation.kind === "cancelled") return { type: "failed", taskId: observation.taskId,
      failureId: `h3-${record.id.slice(0, 32)}`, technical: false, retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`H3 polling unresolved: ${observation.error.code}`, observation.taskId);
    return { type: "accepted", taskId: observation.taskId };
  }

  private async prepare(attempt: Attempt, signal: AbortSignal | undefined, captured: ViggleFrameEvidence): Promise<ViggleH3Request> {
    const request = attempt.request, configuration = request.profile!.configuration;
    const admission = resolveViggleAdmission(this.#store, request, this.#store.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attempt.id));
    assertViggleH3OperationOptions(admission.profile, request.args);
    const reference = request.inputs[0]!, record = structuredClone(captured.artifact);
    invariant(isAbsolute(record.path), "VIGGLE_H3_EXECUTION_CONFLICT", "Reviewed PNG must have an owned absolute path");
    const path = await realpath(record.path), child = relative(this.#root, path);
    invariant(path === record.path && child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child),
      "VIGGLE_H3_EXECUTION_CONFLICT", "H3 input must remain inside the owned artifact root");
    stopped(signal); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer;
    try {
      const stat = await file.stat(); invariant(stat.isFile() && stat.size === record.byteLength, "VIGGLE_H3_EXECUTION_CONFLICT", "Reviewed PNG size changed");
      bytes = Buffer.alloc(stat.size + 1); let size = 0;
      while (size < bytes.length) { stopped(signal); const read = await file.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      invariant(size === stat.size && createHash("sha256").update(bytes.subarray(0, size)).digest("hex") === reference.sha256,
        "VIGGLE_H3_EXECUTION_CONFLICT", "Reviewed PNG bytes changed"); bytes = bytes.subarray(0, size);
    } finally { await file.close(); }
    stopped(signal);
    invariant(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(16) === record.width && bytes.readUInt32BE(20) === record.height,
    "VIGGLE_H3_EXECUTION_CONFLICT", "Reviewed PNG dimensions differ from their validated record");
    return { prompt: String(request.args.prompt), durationSeconds: Number(request.args.durationFrames) / 30,
      resolution: configuration.settings!.resolution as ViggleH3Resolution, quality: configuration.settings!.quality as ViggleH3Quality,
      aspectRatio: configuration.settings!.aspectRatio as ViggleH3AspectRatio, watermark: false,
      firstFrame: { bytes, sha256: reference.sha256, width: record.width!, height: record.height!,
        byteLength: bytes.length, mediaType: "image/png" } };
  }
}
