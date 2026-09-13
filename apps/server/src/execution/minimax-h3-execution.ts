import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertExecutionRequest, describeMiniMaxH3Request, MiniMaxH3Provider, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, MiniMaxH3Model, MiniMaxH3Request, MiniMaxH3Resolution, MiniMaxH3SubmitResult } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { Store } from "../persistence/store.js";
import type { ArtifactRecord, Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { ProtectedVideoDownloader } from "./video-download.js";
import { assertH3ExecutionDispatch, assertH3ExecutionMapping, assertH3ExecutionObservation, assertH3ExecutionSubmit, assertH3PollPolicy, assertH3PollSchedule, h3Fields, h3Hash, h3ObservationId } from "./minimax-h3-receipts.js";
import type { H3ExecutionDispatch, H3ExecutionMapping, H3ExecutionObservation, H3ExecutionSubmit, H3PollObservation, H3PollPolicy, H3PollSchedule, H3SubmitObservation } from "./minimax-h3-receipts.js";

const unknown = (diagnostic: string, taskId?: string): ExecutionOutcome => ({ type: "unknown", diagnostic, ...(taskId ? { taskId } : {}) });
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "H3_EXECUTION_CANCELLED", "H3 operation was cancelled");

/** Trusted opt-in application bridge. Construction registers availability, never spending permission. */
export class MiniMaxH3Execution implements ExecutionProvider {
  readonly #recovery: InstallationRecoveryGuard;
  readonly #store: Store; readonly #outputs: ExecutionOutputStore; readonly #root: string;
  readonly #credentials: EnvironmentMediaCredentials; readonly #download: ProtectedVideoDownloader;
  readonly #fetch: typeof globalThis.fetch | undefined; readonly #timeout: number; readonly #now: () => number;
  readonly #policy: H3PollPolicy;
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; artifactRoot: string;
    credentials: EnvironmentMediaCredentials; downloader: ProtectedVideoDownloader; fetch?: typeof globalThis.fetch; timeoutMs?: number;
    pollPolicy?: { initialMs?: number; maximumMs?: number; retryAfterMaximumMs?: number }; now?: () => number }) {
    invariant(options.outputStore.store === options.store && isAbsolute(options.artifactRoot) && options.artifactRoot !== "/",
      "H3_EXECUTION_CONFIGURATION", "Use one application store and an owned artifact root");
    this.#store = options.store; this.#outputs = options.outputStore; this.#credentials = options.credentials; this.#download = options.downloader;
    this.#recovery = new InstallationRecoveryGuard(options.store);
    this.#fetch = options.fetch; this.#timeout = options.timeoutMs ?? 30000; this.#now = options.now ?? Date.now;
    invariant(Number.isSafeInteger(this.#timeout) && this.#timeout >= 1 && this.#timeout <= 120000,
      "H3_EXECUTION_CONFIGURATION", "H3 request timeout must be bounded");
    this.#policy = Object.freeze({ initialMs: options.pollPolicy?.initialMs ?? 2000, maximumMs: options.pollPolicy?.maximumMs ?? 15000,
      retryAfterMaximumMs: options.pollPolicy?.retryAfterMaximumMs ?? 86400000, claimMs: this.#timeout + 301000 });
    assertH3PollPolicy(this.#policy);
    mkdirSync(options.artifactRoot, { recursive: true, mode: 0o700 }); this.#root = realpathSync(options.artifactRoot);
    registerExecutionProvider(this, { adapter: "minimax-h3", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const request = structuredClone(input), signal = options.signal, expected = options.expectedLease ? { ...options.expectedLease } : undefined;
    const attempt = this.admitted(request);
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    this.dispatchable(attempt, expected);
    let prepared: MiniMaxH3Request, mapping: H3ExecutionMapping;
    try {
      stopped(signal); prepared = await this.prepare(attempt, signal); stopped(signal);
      const proposed: H3ExecutionMapping = { ...this.identity(attempt), profileDigest: request.profile!.digest,
        externalAllowanceId: request.externalAllowanceId!, firstFrameArtifactId: request.inputs[0]!.artifactId,
        transport: describeMiniMaxH3Request(request.profile!.configuration.model as MiniMaxH3Model, prepared) };
      assertH3ExecutionMapping(attempt, proposed);
      mapping = this.#store.transaction(() => {
        this.dispatchable(attempt, expected);
        const saved = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id);
        invariant(!this.started(attempt.id) || saved, "H3_EXECUTION_CONFLICT", "Closed preparation cannot acquire a mapping");
        if (saved) { invariant(canonical(saved) === canonical(proposed), "H3_EXECUTION_CONFLICT", "Prepared H3 payload changed"); return saved; }
        return this.#store.insert("h3_execution_mapping", attempt.id, attempt.projectId, proposed);
      });
    } catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_INPUT_INVALID", signal); }
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    let transport: MiniMaxH3Provider;
    try { stopped(signal); transport = this.transport(mapping.transport.model); }
    catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal); }
    const claimed = this.#store.transaction(() => {
      if (this.started(attempt.id)) return false;
      stopped(signal); this.dispatchable(attempt, expected);
      const dispatch: H3ExecutionDispatch = { ...this.identity(attempt), mappingDigest: digest(mapping), bodySha256: mapping.transport.bodySha256,
        externalAllowanceId: request.externalAllowanceId!, createdAt: this.now() };
      this.#store.insert("h3_execution_dispatch", attempt.id, attempt.projectId, dispatch); return true;
    });
    if (!claimed) return this.replay(attempt, signal);
    let observation: MiniMaxH3SubmitResult | undefined;
    try {
      observation = await transport.submit(prepared, { expectedBodySha256: mapping.transport.bodySha256, ...(signal ? { signal } : {}) });
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
    invariant(saved && (!input || input.attemptId === attemptId), "H3_EXECUTION_CONFLICT", "Unknown or mismatched H3 attempt");
    return this.replay(this.admitted(structuredClone(input ?? saved.request)), options.signal);
  }

  async poll(taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    invariant(input, "H3_EXECUTION_CONFLICT", "Polling requires the exact admitted request");
    const signal = options.signal, attempt = this.admitted(structuredClone(input));
    const submission = this.submission(attempt);
    if (submission?.observation.kind === "accepted") invariant(taskId === submission.observation.taskId
      && (!attempt.taskId || taskId === attempt.taskId), "H3_EXECUTION_CONFLICT", "Cannot poll a different task");
    const local = await this.replay(attempt, signal);
    if (local.type !== "accepted") return local;
    invariant(taskId === local.taskId && (!attempt.taskId || taskId === attempt.taskId), "H3_EXECUTION_CONFLICT", "Cannot poll a different task");
    const submit = this.submission(attempt)!;
    const claim = this.#store.transaction(() => {
      stopped(signal); const schedule = this.schedule(attempt, submit);
      if (schedule.nextPollAt > this.now()) return null;
      const next: H3PollSchedule = { ...schedule, count: schedule.count + 1, claimId: randomUUID(), nextPollAt: this.now() + schedule.policy.claimMs };
      return this.#store.put("h3_poll_schedule", attempt.id, attempt.projectId, next);
    });
    if (!claim) return local;
    let saved: H3ExecutionObservation | undefined, result: ExecutionOutcome = unknown("H3 task observation is unavailable", taskId);
    try {
      let response;
      try {
        stopped(signal);
        // A restarted host may raise its default timeout; the original durable poll claim remains the bound.
        response = await this.transport(attempt.request.profile!.configuration.model as MiniMaxH3Model,
          Math.min(this.#timeout, claim.policy.claimMs - 301000)).poll(taskId, signal ? { signal } : {});
      }
      catch { response = { kind: "unknown" as const, taskId, error: { code: "H3_LOCAL_CREDENTIAL_UNAVAILABLE", category: "auth" as const } }; }
      if (response.kind === "completed") {
        saved = this.#store.transaction(() => {
          const output = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(attempt.request),
            port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: taskId, diagnosticRequestId: null,
            source: { kind: "protected_locator", locator: response.output.url, expiresAt: response.output.expiresAt } });
          const { output: _output, ...redacted } = response;
          return this.saveObservation(attempt, { ...redacted, outputReceiptId: output.id });
        });
        const observation = saved.observation;
        invariant(observation.kind === "completed", "H3_EXECUTION_CONFLICT", "Expected completed polling evidence");
        const receipt = this.#store.get<import("./output-store.js").OutputReceipt>("execution_output_receipt", observation.outputReceiptId)!;
        try {
          await this.#outputs.spool(attempt.projectId, receipt.id, this.#download.source(receipt), signal ? { signal } : {});
          const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
          invariant(completed, "H3_EXECUTION_CONFLICT", "Downloaded output has no winning slot"); result = completed;
        } catch { result = unknown("H3 completed; owned video storage needs recovery", taskId); }
      } else {
        saved = this.saveObservation(attempt, response.kind === "unknown" ? { ...response, taskId } : response);
        result = this.outcome(saved);
      }
    } catch { result = unknown("H3 task observation needs recovery", taskId); }
    finally {
      // A late worker may retain evidence, but cannot shorten a replacement poller's cooldown.
      this.#store.transaction(() => {
        const current = this.#store.get<H3PollSchedule>("h3_poll_schedule", attempt.id);
        if (current?.claimId !== claim.claimId) return;
        let delay = Math.min(current.policy.maximumMs, current.policy.initialMs * 2 ** Math.min(current.count - 1, 20));
        const observation = saved?.observation;
        if (observation?.kind === "unknown" && ["auth", "quota", "throttled"].includes(observation.error.category))
          delay = Math.max(delay, Math.min(current.policy.retryAfterMaximumMs, (observation.error.retryAfterSeconds ?? 0) * 1000));
        this.#store.put("h3_poll_schedule", attempt.id, attempt.projectId, { ...current, claimId: null, nextPollAt: this.now() + delay,
          lastObservationId: saved?.id ?? current.lastObservationId });
      });
    }
    return result;
  }

  private now(): number {
    const value = this.#now(); invariant(Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - 86400000,
      "H3_EXECUTION_CONFIGURATION", "Invalid trusted polling clock"); return value;
  }
  private identity(attempt: Attempt) { return { id: attempt.id, version: 1 as const, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) }; }
  private admitted(request: ExecutionRequest): Attempt {
    this.#recovery.assertWritable();
    assertExecutionRequest(this, request);
    const attempt = this.#store.get<Attempt>("attempt", request.attemptId);
    invariant(attempt && attempt.nodeId === request.nodeId && attempt.fingerprint === request.fingerprint && attempt.candidateId && attempt.reservationId
      && request.kind === "video" && canonical(attempt.request) === canonical(request) && typeof request.externalAllowanceId === "string",
    "H3_EXECUTION_CONFLICT", "H3 execution requires its exact admitted attempt and allowance");
    const reservation = this.#store.get<{ projectId: string; attemptId: string }>("reservation", attempt.reservationId);
    invariant(reservation?.projectId === attempt.projectId && reservation.attemptId === attempt.id, "H3_EXECUTION_CONFLICT", "H3 attempt lost its reservation");
    return attempt;
  }
  private dispatchable(previous: Attempt, expected: ExecutionCallOptions["expectedLease"]): void {
    this.#recovery.assertFirstSubmit(previous.projectId, previous.id);
    const current = this.admitted(previous.request), reservation = this.#store.get<{ state: string }>("reservation", current.reservationId!);
    invariant(expected && Object.keys(expected).every(key => ["owner", "epoch"].includes(key)) && expected.owner === current.leaseOwner
      && expected.epoch === current.leaseEpoch && previous.leaseOwner === current.leaseOwner && previous.leaseEpoch === current.leaseEpoch
      && current.phase === "submitting" && current.leaseExpiresAt > Date.now() && reservation?.state === "reserved",
    "H3_EXECUTION_NOT_DISPATCHABLE", "First H3 POST requires the caller's original live admission lease");
  }
  private started(id: string): boolean { return !!(this.#store.get("h3_execution_dispatch", id) || this.#store.get("h3_execution_submit", id)); }
  private transport(model: MiniMaxH3Model, timeoutMs = this.#timeout): MiniMaxH3Provider {
    return new MiniMaxH3Provider({ apiKey: this.#credentials.resolve("minimax-video"), model,
      ...(this.#fetch ? { fetch: this.#fetch } : {}), timeoutMs });
  }
  private submission(attempt: Attempt): H3ExecutionSubmit | undefined {
    const mapping = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id), dispatch = this.#store.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id);
    if (mapping) assertH3ExecutionMapping(attempt, mapping);
    if (dispatch) { invariant(mapping, "H3_EXECUTION_CONFLICT", "H3 dispatch lost its mapping"); assertH3ExecutionDispatch(attempt, mapping, dispatch); }
    let result = this.#store.get<H3ExecutionSubmit>("h3_execution_submit", attempt.id);
    // An Engine task receipt can preserve a valid acceptance if a local bridge write failed after HTTP.
    if (!result && dispatch && mapping && attempt.taskId && /^[A-Za-z0-9_-]{1,160}$/.test(attempt.taskId)) {
      const evidence = this.#store.list<{ attemptId: string; outcome: ExecutionOutcome; outcomeDigest: string }>("execution_evidence", attempt.projectId);
      if (evidence.some(item => item.attemptId === attempt.id && item.outcomeDigest === digest(item.outcome)
        && item.outcome.type === "accepted" && item.outcome.taskId === attempt.taskId))
        result = this.saveSubmit(attempt, { kind: "accepted", taskId: attempt.taskId, requestedModel: mapping.transport.model });
    }
    if (result) assertH3ExecutionSubmit(attempt, mapping, dispatch, result);
    return result;
  }
  private saveSubmit(attempt: Attempt, observation: H3SubmitObservation): H3ExecutionSubmit {
    const mapping = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id), dispatch = this.#store.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id);
    const value: H3ExecutionSubmit = { ...this.identity(attempt), mappingDigest: mapping ? digest(mapping) : null,
      dispatchDigest: dispatch ? digest(dispatch) : null, observedAt: this.now(), observation };
    return this.#store.insert("h3_execution_submit", attempt.id, attempt.projectId, value);
  }
  private async notDispatched(attempt: Attempt, expected: ExecutionCallOptions["expectedLease"], code: Extract<H3SubmitObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal): Promise<ExecutionOutcome> {
    this.#store.transaction(() => { if (!this.started(attempt.id)) { this.dispatchable(attempt, expected); this.saveSubmit(attempt, { kind: "not_dispatched", code }); } });
    return this.replay(attempt, signal);
  }
  private schedule(attempt: Attempt, submit: H3ExecutionSubmit): H3PollSchedule {
    const saved = this.#store.get<H3PollSchedule>("h3_poll_schedule", attempt.id);
    if (saved) { assertH3PollSchedule(attempt, submit, saved); return saved; }
    invariant(submit.observation.kind === "accepted", "H3_EXECUTION_CONFLICT", "Only accepted tasks can have a polling schedule");
    return this.#store.insert("h3_poll_schedule", attempt.id, attempt.projectId, { ...this.identity(attempt), taskId: submit.observation.taskId,
      policy: this.#policy, count: 0, nextPollAt: this.now() + this.#policy.initialMs, claimId: null, lastObservationId: null });
  }
  private saveObservation(attempt: Attempt, observation: H3PollObservation): H3ExecutionObservation {
    const id = h3ObservationId(attempt.id, observation), previous = this.#store.get<H3ExecutionObservation>("h3_execution_observation", id);
    if (previous) return previous;
    const mapping = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id)!;
    return this.#store.insert("h3_execution_observation", id, attempt.projectId, { ...this.identity(attempt), id, mappingDigest: digest(mapping),
      dispatchDigest: digest(dispatch), observedAt: this.now(), observation });
  }
  private async replay(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    try { const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {}); if (completed) return completed; }
    catch { return unknown("H3 owned output requires local recovery", attempt.taskId ?? undefined); }
    const submit = this.submission(attempt);
    if (!submit) return unknown("H3 acceptance is unresolved; automatic resubmission is disabled", attempt.taskId ?? undefined);
    const observation = submit.observation;
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted",
      failureId: `h3-${digest(submit).slice(0, 32)}`, technical: observation.kind === "not_dispatched", retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`H3 submission unresolved: ${observation.error.code}`, attempt.taskId ?? undefined);
    invariant(!attempt.taskId || attempt.taskId === observation.taskId, "H3_EXECUTION_CONFLICT", "H3 accepted identity contradicts the saved task");
    const schedule = this.#store.transaction(() => this.schedule(attempt, submit));
    // A terminal observation can survive a crash before the mutable cooldown pointer was updated.
    const terminal = this.#store.list<H3ExecutionObservation>("h3_execution_observation", attempt.projectId)
      .find(item => item.attemptId === attempt.id && ["failed", "cancelled"].includes(item.observation.kind));
    if (terminal) {
      const mapping = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id)!;
      assertH3ExecutionObservation(attempt, mapping, dispatch, submit, terminal); return this.outcome(terminal);
    }
    const last = schedule.lastObservationId ? this.#store.get<H3ExecutionObservation>("h3_execution_observation", schedule.lastObservationId) : undefined;
    if (last) {
      const mapping = this.#store.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id)!, dispatch = this.#store.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id)!;
      assertH3ExecutionObservation(attempt, mapping, dispatch, submit, last, last.observation.kind === "completed" ? this.#store.get("execution_output_receipt", last.observation.outputReceiptId) : undefined);
      if (last.observation.kind === "failed" || last.observation.kind === "cancelled") return this.outcome(last);
    }
    return { type: "accepted", taskId: observation.taskId };
  }
  private outcome(record: H3ExecutionObservation): ExecutionOutcome {
    const observation = record.observation;
    if (observation.kind === "failed" || observation.kind === "cancelled") return { type: "failed", taskId: observation.taskId,
      failureId: `h3-${record.id.slice(0, 32)}`, technical: false, retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`H3 polling unresolved: ${observation.error.code}`, observation.taskId);
    return { type: "accepted", taskId: observation.taskId };
  }

  private async prepare(attempt: Attempt, signal?: AbortSignal): Promise<MiniMaxH3Request> {
    const request = attempt.request, configuration = request.profile!.configuration;
    h3Fields(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", "externalAllowanceId"]);
    h3Fields(configuration, ["model", "settings"]); h3Fields(configuration.settings, ["resolution"]);
    h3Fields(request.args.settings, []);
    invariant(request.inputs.length === 1 && request.inputs[0]!.kind === "image" && Number.isSafeInteger(request.args.durationFrames)
      && Number(request.args.durationFrames) % 30 === 0 && canonical(request.args.frameRate) === canonical({ numerator: 30, denominator: 1 }),
    "H3_EXECUTION_CONFLICT", "H3 requires one reviewed first frame and exact integer seconds");
    invariant(this.#store.list<{ videoNodeId: string; approvalDigest: string }>("approval", attempt.projectId)
      .some(approval => approval.videoNodeId === request.nodeId && approval.approvalDigest === request.fingerprint),
    "H3_EXECUTION_CONFLICT", "H3 first frame lacks its exact human approval");
    const reference = request.inputs[0]!, record = this.#store.get<ArtifactRecord>("artifact", reference.artifactId);
    invariant(record && record.projectId === attempt.projectId && canonical(record.artifact) === canonical(reference) && record.fixture === false
      && record.mimeType === "image/png" && h3Hash(record.validationDigest) && Number.isSafeInteger(record.byteLength)
      && record.byteLength! >= 33 && record.byteLength! <= 30_000_000 && isAbsolute(record.path),
    "H3_EXECUTION_CONFLICT", "H3 requires an exact validated owned PNG within its input limit");
    const path = await realpath(record.path), child = relative(this.#root, path);
    invariant(path === record.path && child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child),
      "H3_EXECUTION_CONFLICT", "H3 input must remain inside the owned artifact root");
    stopped(signal); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer;
    try {
      const stat = await file.stat(); invariant(stat.isFile() && stat.size === record.byteLength, "H3_EXECUTION_CONFLICT", "Reviewed PNG size changed");
      bytes = Buffer.alloc(stat.size + 1); let size = 0;
      while (size < bytes.length) { stopped(signal); const read = await file.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      invariant(size === stat.size && createHash("sha256").update(bytes.subarray(0, size)).digest("hex") === reference.sha256,
        "H3_EXECUTION_CONFLICT", "Reviewed PNG bytes changed"); bytes = bytes.subarray(0, size);
    } finally { await file.close(); }
    stopped(signal);
    invariant(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(16) === record.width && bytes.readUInt32BE(20) === record.height,
    "H3_EXECUTION_CONFLICT", "Reviewed PNG dimensions differ from their validated record");
    return { prompt: String(request.args.prompt), durationSeconds: Number(request.args.durationFrames) / 30,
      resolution: configuration.settings.resolution as MiniMaxH3Resolution,
      firstFrame: { url: `data:image/png;base64,${bytes.toString("base64")}`, sha256: reference.sha256, width: record.width!, height: record.height!,
        byteLength: bytes.length, mediaType: "image/png" } };
  }
}
