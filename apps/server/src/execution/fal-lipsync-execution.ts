import { assertConfiguredProviderAdmission, configuredProviderUse, providerAdmissionRequest } from "./provider-use.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertExecutionRequest, describeFalH3LipSyncRequest, falH3LipSyncBody, FalH3LipSyncProvider, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, FalH3LipSyncRequest, FalH3LipSyncResolution, FalH3LipSyncSubmitResult } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { Store } from "../persistence/store.js";
import type { ArtifactRecord, Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { ProtectedVideoDownloader } from "./video-download.js";
import { assertCurrentGeneratedSelection } from "./current-generated-selection.js";
import { lipSyncAudio } from "../media/song-segment.js";
import { assertLipSyncSettings, lipSyncSettings } from "./lip-sync.js";
import { soundtrackSong } from "./lip-sync-routing.js";
import { assertFalLipSyncDispatch, assertFalLipSyncMapping, assertFalLipSyncObservation, assertFalLipSyncOperationOptions, assertFalLipSyncPollPolicy,
  assertFalLipSyncPollSchedule, assertFalLipSyncSubmit, falFields, falHash, falObservationId, FAL_TASK } from "./fal-lipsync-receipts.js";
import type { FalLipSyncDispatch, FalLipSyncMapping, FalLipSyncObservation, FalLipSyncPollObservation, FalLipSyncPollPolicy, FalLipSyncPollSchedule,
  FalLipSyncSubmit, FalLipSyncSubmitObservation } from "./fal-lipsync-receipts.js";

/** Any host's POST has ended by then, whatever timeout the original host used. */
const MAX_SUBMIT_TIMEOUT_MS = 120000;
/** fal cannot find a request without its id. A lost POST reply is final, counted as possibly charged; only a human press buys again. */
const responseLost = (): ExecutionOutcome => ({ type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false });
const unknown = (diagnostic: string, taskId?: string): ExecutionOutcome => ({ type: "unknown", diagnostic, ...(taskId ? { taskId } : {}) });
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "FAL_LIPSYNC_EXECUTION_CANCELLED", "Lip-sync operation was cancelled");
const conflict = (condition: unknown, message: string): void => invariant(condition, "FAL_LIPSYNC_EXECUTION_CONFLICT", message);

/** Trusted host lookup of the owned normalized song file. Returns a verified absolute path. */
export type LipSyncSongSource = (input: { projectId: string; audioId: string; sha256: string; signal?: AbortSignal }) => Promise<string>;

/**
 * Trusted opt-in bridge for fal MiniMax H3 Max lip sync. Same rules as the H3 bridges: the mapping and a dispatch
 * marker are saved before the paid POST, an unknown acceptance is never resubmitted, a lost reply with no request id
 * is spent, and a refusal before any request id exists is not charged. Uploading inputs is free and precedes dispatch.
 */
export class FalH3LipSyncExecution implements ExecutionProvider {
  readonly #recovery: InstallationRecoveryGuard;
  readonly #store: Store; readonly #outputs: ExecutionOutputStore; readonly #root: string;
  readonly #credentials: EnvironmentMediaCredentials; readonly #download: ProtectedVideoDownloader; readonly #song: LipSyncSongSource;
  readonly #fetch: typeof globalThis.fetch | undefined; readonly #timeout: number; readonly #now: () => number;
  readonly #policy: FalLipSyncPollPolicy;
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; artifactRoot: string; credentials: EnvironmentMediaCredentials;
    downloader: ProtectedVideoDownloader; songSource: LipSyncSongSource; fetch?: typeof globalThis.fetch; timeoutMs?: number;
    pollPolicy?: { initialMs?: number; maximumMs?: number; retryAfterMaximumMs?: number }; now?: () => number }) {
    invariant(options.outputStore.store === options.store && isAbsolute(options.artifactRoot) && options.artifactRoot !== "/" && typeof options.songSource === "function",
      "FAL_LIPSYNC_EXECUTION_CONFIGURATION", "Use one application store, an owned artifact root and a trusted song source");
    this.#store = options.store; this.#outputs = options.outputStore; this.#credentials = options.credentials; this.#download = options.downloader;
    this.#song = options.songSource; this.#recovery = new InstallationRecoveryGuard(options.store);
    this.#fetch = options.fetch; this.#timeout = options.timeoutMs ?? 30000; this.#now = options.now ?? Date.now;
    invariant(Number.isSafeInteger(this.#timeout) && this.#timeout >= 1 && this.#timeout <= MAX_SUBMIT_TIMEOUT_MS,
      "FAL_LIPSYNC_EXECUTION_CONFIGURATION", "fal request timeout must be bounded");
    // fal lip sync renders for minutes; poll gently.
    this.#policy = Object.freeze({ initialMs: options.pollPolicy?.initialMs ?? 5000, maximumMs: options.pollPolicy?.maximumMs ?? 20000,
      retryAfterMaximumMs: options.pollPolicy?.retryAfterMaximumMs ?? 86400000, claimMs: this.#timeout + 301000 });
    assertFalLipSyncPollPolicy(this.#policy);
    mkdirSync(options.artifactRoot, { recursive: true, mode: 0o700 }); this.#root = realpathSync(options.artifactRoot);
    registerExecutionProvider(this, { adapter: "fal-h3-lipsync", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const request = structuredClone(input), signal = options.signal, expected = options.expectedLease ? { ...options.expectedLease } : undefined;
    const attempt = this.admitted(request);
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    this.leaseOwned(attempt, expected);
    try { this.dispatchable(attempt, expected); }
    catch { return this.notDispatched(attempt, expected, "LOCAL_CANCELLED", signal); }
    let prepared: FalH3LipSyncRequest, mapping: FalLipSyncMapping;
    try {
      stopped(signal); prepared = await this.prepare(attempt, signal); stopped(signal);
      assertLipSyncSettings(request.args.settings);
      const proposed: FalLipSyncMapping = { ...this.identity(attempt), profileDigest: request.profile!.digest,
        externalAllowanceId: (request.externalAllowanceId ?? null), firstFrameArtifactId: request.inputs[0]!.artifactId,
        lipSync: structuredClone(request.args.settings.lipSync), transport: describeFalH3LipSyncRequest(prepared) };
      assertFalLipSyncMapping(attempt, proposed);
      mapping = this.#store.transaction(() => {
        this.dispatchable(attempt, expected);
        const saved = this.#store.get<FalLipSyncMapping>("fal_lipsync_execution_mapping", attempt.id);
        conflict(!this.started(attempt.id) || saved, "Closed preparation cannot acquire a mapping");
        if (saved) { conflict(canonical(saved) === canonical(proposed), "Prepared lip-sync payload changed"); return saved; }
        return this.#store.insert("fal_lipsync_execution_mapping", attempt.id, attempt.projectId, proposed);
      });
    } catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_INPUT_INVALID", signal); }
    if (this.started(attempt.id)) return this.replay(attempt, signal);
    let transport: FalH3LipSyncProvider;
    try { stopped(signal); transport = this.transport(); }
    catch { return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal); }
    // Free uploads. Any failure is a refusal before a paid request exists.
    const image = await transport.upload(prepared.image.bytes, "image/png", `keyframe-${prepared.image.sha256.slice(0, 16)}.png`, signal ? { signal } : {});
    const audio = image.kind === "uploaded" ? await transport.upload(prepared.audio.bytes, "audio/wav", `song-${prepared.audio.sha256.slice(0, 16)}.wav`, signal ? { signal } : {}) : image;
    if (image.kind !== "uploaded" || audio.kind !== "uploaded")
      return this.notDispatched(attempt, expected, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_UPLOAD_FAILED", signal, image.kind === "failed" ? image.error : audio.kind === "failed" ? audio.error : undefined);
    let body: string;
    try { body = falH3LipSyncBody(mapping.transport, { imageUrl: image.fileUrl, audioUrl: audio.fileUrl }); }
    catch { return this.notDispatched(attempt, expected, "LOCAL_UPLOAD_FAILED", signal); }
    const bodySha256 = createHash("sha256").update(body).digest("hex");
    let claimed: boolean;
    try {
      claimed = this.#store.transaction(() => {
        if (this.started(attempt.id)) return false;
        stopped(signal); this.dispatchable(attempt, expected);
        const dispatch: FalLipSyncDispatch = { ...this.identity(attempt), mappingDigest: digest(mapping), bodySha256,
          externalAllowanceId: (request.externalAllowanceId ?? null), createdAt: this.now() };
        this.#store.insert("fal_lipsync_execution_dispatch", attempt.id, attempt.projectId, dispatch); return true;
      });
    } catch { return this.notDispatched(attempt, expected, "LOCAL_CANCELLED", signal); }
    if (!claimed) return this.replay(attempt, signal);
    let observation: FalH3LipSyncSubmitResult | undefined;
    try {
      observation = await transport.submit(body, bodySha256, signal ? { signal } : {});
      // Preserve accepted/unknown evidence even if the caller's lease was lost during the POST.
      this.#store.transaction(() => {
        const result = this.saveSubmit(attempt, observation!);
        if (result.observation.kind === "accepted") this.schedule(attempt, result);
      });
    } catch {
      // The dispatch marker is never removed: automatic resubmission stays disabled.
      if (observation?.kind === "accepted") return { type: "accepted", taskId: observation.taskId };
      return unknown("Lip-sync submission observation needs recovery; automatic resubmission is disabled");
    }
    return this.replay(attempt, signal);
  }

  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const saved = this.#store.get<Attempt>("attempt", attemptId);
    conflict(saved && (!input || input.attemptId === attemptId), "Unknown or mismatched lip-sync attempt");
    const attempt = this.admitted(structuredClone(input ?? saved!.request));
    this.fenceNeverDispatched(attempt, options);
    return this.replay(attempt, options.signal);
  }

  async poll(taskId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    conflict(input, "Polling requires the exact admitted request");
    const signal = options.signal, attempt = this.admitted(structuredClone(input!));
    const submission = this.submission(attempt);
    if (submission?.observation.kind === "accepted") conflict(taskId === submission.observation.taskId
      && (!attempt.taskId || taskId === attempt.taskId), "Cannot poll a different request");
    const local = await this.replay(attempt, signal);
    if (local.type !== "accepted") return local;
    conflict(taskId === local.taskId && (!attempt.taskId || taskId === attempt.taskId), "Cannot poll a different request");
    const submit = this.submission(attempt)!;
    const claim = this.#store.transaction(() => {
      stopped(signal); const schedule = this.schedule(attempt, submit);
      if (schedule.nextPollAt > this.now()) return null;
      const next: FalLipSyncPollSchedule = { ...schedule, count: schedule.count + 1, claimId: randomUUID(), nextPollAt: this.now() + schedule.policy.claimMs };
      return this.#store.put("fal_lipsync_poll_schedule", attempt.id, attempt.projectId, next);
    });
    if (!claim) return local;
    let saved: FalLipSyncObservation | undefined, result: ExecutionOutcome = unknown("Lip-sync observation is unavailable", taskId);
    try {
      let response;
      try { stopped(signal); response = await this.transport(Math.min(this.#timeout, claim.policy.claimMs - 301000)).poll(taskId, signal ? { signal } : {}); }
      catch { response = { kind: "unknown" as const, taskId, error: { code: "FAL_LOCAL_CREDENTIAL_UNAVAILABLE", category: "auth" as const }, receipt: { requestId: null, httpStatus: null } }; }
      if (response.kind === "completed") {
        saved = this.#store.transaction(() => {
          const output = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(attempt.request),
            port: "video", kind: "video", mimeType: "video/mp4", vendorTaskId: taskId, diagnosticRequestId: null,
            source: { kind: "protected_locator", locator: response.output.url, expiresAt: response.output.expiresAt } });
          const { output: _output, ...redacted } = response;
          return this.saveObservation(attempt, { ...redacted, outputReceiptId: output.id });
        });
        const observation = saved.observation;
        conflict(observation.kind === "completed", "Expected completed polling evidence");
        const receipt = this.#store.get<import("./output-store.js").OutputReceipt>("execution_output_receipt", (observation as { outputReceiptId: string }).outputReceiptId)!;
        try {
          await this.#outputs.spool(attempt.projectId, receipt.id, this.#download.source(receipt), signal ? { signal } : {});
          const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
          conflict(completed, "Downloaded output has no winning slot"); result = completed!;
        } catch { result = unknown("Lip sync completed; owned video storage needs recovery", taskId); }
      } else {
        saved = this.saveObservation(attempt, response);
        result = this.outcome(saved);
      }
    } catch { result = unknown("Lip-sync observation needs recovery", taskId); }
    finally {
      // A late worker may retain evidence, but cannot shorten a replacement poller's cooldown.
      this.#store.transaction(() => {
        const current = this.#store.get<FalLipSyncPollSchedule>("fal_lipsync_poll_schedule", attempt.id);
        if (current?.claimId !== claim.claimId) return;
        let delay = Math.min(current.policy.maximumMs, current.policy.initialMs * 2 ** Math.min(current.count - 1, 20));
        const observation = saved?.observation;
        if (observation?.kind === "unknown" && ["auth", "quota", "throttled"].includes(observation.error.category))
          delay = Math.max(delay, Math.min(current.policy.retryAfterMaximumMs, observation.error.retryAfterMs ?? 0));
        this.#store.put("fal_lipsync_poll_schedule", attempt.id, attempt.projectId, { ...current, claimId: null, nextPollAt: this.now() + delay,
          lastObservationId: saved?.id ?? current.lastObservationId });
      });
    }
    return result;
  }

  private now(): number {
    const value = this.#now(); invariant(Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER - 86400000,
      "FAL_LIPSYNC_EXECUTION_CONFIGURATION", "Invalid trusted polling clock"); return value;
  }
  private identity(attempt: Attempt) { return { id: attempt.id, version: 1 as const, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request) }; }
  private admitted(request: ExecutionRequest): Attempt {
    this.#recovery.assertWritable();
    assertExecutionRequest(this, request);
    const attempt = this.#store.get<Attempt>("attempt", request.attemptId);
    conflict(attempt && attempt.nodeId === request.nodeId && attempt.fingerprint === request.fingerprint && attempt.candidateId && attempt.reservationId
      && request.kind === "video" && canonical(attempt.request) === canonical(request) && providerAdmissionRequest(request),
    "Lip sync requires its exact admitted attempt and provider-use evidence");
    const reservation = this.#store.get<{ projectId: string; attemptId: string }>("reservation", attempt!.reservationId!);
    conflict(reservation?.projectId === attempt!.projectId && reservation.attemptId === attempt!.id, "Lip-sync attempt lost its reservation");
    assertConfiguredProviderAdmission(this.#store, attempt!);
    return attempt!;
  }
  private dispatchable(previous: Attempt, expected: ExecutionCallOptions["expectedLease"]): void {
    this.leaseOwned(previous, expected);
    assertCurrentGeneratedSelection(this.#store, previous, "FAL_LIPSYNC_NOT_DISPATCHABLE");
  }
  private leaseOwned(previous: Attempt, expected: ExecutionCallOptions["expectedLease"]): void {
    this.#recovery.assertFirstSubmit(previous.projectId, previous.id);
    const current = this.admitted(previous.request), reservation = this.#store.get<{ state: string }>("reservation", current.reservationId!);
    invariant(expected && Object.keys(expected).every(key => ["owner", "epoch"].includes(key)) && expected.owner === current.leaseOwner
      && expected.epoch === current.leaseEpoch && previous.leaseOwner === current.leaseOwner && previous.leaseEpoch === current.leaseEpoch
      && current.phase === "submitting" && current.leaseExpiresAt > Date.now() && reservation?.state === "reserved",
    "FAL_LIPSYNC_NOT_DISPATCHABLE", "First lip-sync POST requires the caller's original live admission lease");
  }
  private fenceNeverDispatched(attempt: Attempt, options: ExecutionCallOptions): void {
    this.#store.transaction(() => {
      const current = this.admitted(attempt.request), expected = options.expectedLease;
      if (options.signal?.aborted || this.started(current.id) || current.taskId || !expected || current.phase !== "submission_unknown"
        || current.leaseOwner !== expected.owner || current.leaseEpoch !== expected.epoch || current.leaseExpiresAt <= Date.now()
        || this.#store.get<{ state: string }>("reservation", current.reservationId!)?.state !== "reserved") return;
      this.saveSubmit(current, { kind: "not_dispatched", code: "LOCAL_CANCELLED" });
    });
  }
  private started(id: string): boolean { return !!(this.#store.get("fal_lipsync_execution_dispatch", id) || this.#store.get("fal_lipsync_execution_submit", id)); }
  private transport(timeoutMs = this.#timeout): FalH3LipSyncProvider {
    return new FalH3LipSyncProvider({ apiKey: this.#credentials.resolve("fal-video"), ...(this.#fetch ? { fetch: this.#fetch } : {}), timeoutMs });
  }
  private submission(attempt: Attempt): FalLipSyncSubmit | undefined {
    const mapping = this.#store.get<FalLipSyncMapping>("fal_lipsync_execution_mapping", attempt.id), dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id);
    if (mapping) assertFalLipSyncMapping(attempt, mapping);
    if (dispatch) { conflict(mapping, "Lip-sync dispatch lost its mapping"); assertFalLipSyncDispatch(attempt, mapping!, dispatch); }
    let result = this.#store.get<FalLipSyncSubmit>("fal_lipsync_execution_submit", attempt.id);
    // An Engine task receipt can preserve a valid acceptance if a local bridge write failed after HTTP.
    if (!result && dispatch && mapping && attempt.taskId && FAL_TASK.test(attempt.taskId)) {
      const evidence = this.#store.list<{ attemptId: string; outcome: ExecutionOutcome; outcomeDigest: string }>("execution_evidence", attempt.projectId);
      if (evidence.some(item => item.attemptId === attempt.id && item.outcomeDigest === digest(item.outcome)
        && item.outcome.type === "accepted" && item.outcome.taskId === attempt.taskId))
        result = this.saveSubmit(attempt, { kind: "accepted", taskId: attempt.taskId, receipt: { requestId: null, httpStatus: null } });
    }
    if (result) assertFalLipSyncSubmit(attempt, mapping, dispatch, result);
    return result;
  }
  private saveSubmit(attempt: Attempt, observation: FalLipSyncSubmitObservation): FalLipSyncSubmit {
    const mapping = this.#store.get<FalLipSyncMapping>("fal_lipsync_execution_mapping", attempt.id), dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id);
    const value: FalLipSyncSubmit = { ...this.identity(attempt), mappingDigest: mapping ? digest(mapping) : null,
      dispatchDigest: dispatch ? digest(dispatch) : null, observedAt: this.now(), observation };
    assertFalLipSyncSubmit(attempt, mapping, dispatch, value);
    return this.#store.insert("fal_lipsync_execution_submit", attempt.id, attempt.projectId, value);
  }
  private async notDispatched(attempt: Attempt, expected: ExecutionCallOptions["expectedLease"],
    code: Extract<FalLipSyncSubmitObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal, error?: import("@openslate/providers").FalDiagnostic): Promise<ExecutionOutcome> {
    this.#store.transaction(() => {
      // The original live owner can seal its own known no-POST result. An existing irreversible marker cannot be refunded here.
      if (!this.started(attempt.id)) { this.leaseOwned(attempt, expected); this.saveSubmit(attempt, { kind: "not_dispatched", code, ...(error ? { error } : {}) }); }
    });
    return this.replay(attempt, signal);
  }
  private schedule(attempt: Attempt, submit: FalLipSyncSubmit): FalLipSyncPollSchedule {
    const saved = this.#store.get<FalLipSyncPollSchedule>("fal_lipsync_poll_schedule", attempt.id);
    if (saved) { assertFalLipSyncPollSchedule(attempt, submit, saved); return saved; }
    conflict(submit.observation.kind === "accepted", "Only accepted requests can have a polling schedule");
    return this.#store.insert("fal_lipsync_poll_schedule", attempt.id, attempt.projectId, { ...this.identity(attempt),
      taskId: (submit.observation as { taskId: string }).taskId, policy: this.#policy, count: 0, nextPollAt: this.now() + this.#policy.initialMs, claimId: null, lastObservationId: null });
  }
  private saveObservation(attempt: Attempt, observation: FalLipSyncPollObservation): FalLipSyncObservation {
    const id = falObservationId(attempt.id, observation), previous = this.#store.get<FalLipSyncObservation>("fal_lipsync_execution_observation", id);
    if (previous) return previous;
    const mapping = this.#store.get<FalLipSyncMapping>("fal_lipsync_execution_mapping", attempt.id)!, dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id)!;
    return this.#store.insert("fal_lipsync_execution_observation", id, attempt.projectId, { ...this.identity(attempt), id, mappingDigest: digest(mapping),
      dispatchDigest: digest(dispatch), observedAt: this.now(), observation });
  }
  private async replay(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const retained = this.submission(attempt);
    // Definite non-acceptance is SQL evidence: a refused job is not charged.
    if (retained?.observation.kind === "not_dispatched" || retained?.observation.kind === "rejected") return this.refused(retained);
    try { const completed = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {}); if (completed) return completed; }
    catch { return unknown("Lip-sync owned output requires local recovery", attempt.taskId ?? undefined); }
    const submit = retained ?? this.submission(attempt);
    if (!submit) {
      const dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id);
      if (!attempt.taskId && dispatch && this.now() - dispatch.createdAt >= MAX_SUBMIT_TIMEOUT_MS) return responseLost();
      return unknown("Lip-sync acceptance is unresolved; automatic resubmission is disabled", attempt.taskId ?? undefined);
    }
    const observation = submit.observation;
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return this.refused(submit);
    if (observation.kind === "unknown") {
      const dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id)!;
      return !attempt.taskId && this.now() - dispatch.createdAt >= MAX_SUBMIT_TIMEOUT_MS ? responseLost()
        : unknown(`Lip-sync submission unresolved: ${observation.error.code}`, attempt.taskId ?? undefined);
    }
    conflict(!attempt.taskId || attempt.taskId === observation.taskId, "Accepted identity contradicts the saved request");
    const schedule = this.#store.transaction(() => this.schedule(attempt, submit));
    const mapping = this.#store.get<FalLipSyncMapping>("fal_lipsync_execution_mapping", attempt.id)!, dispatch = this.#store.get<FalLipSyncDispatch>("fal_lipsync_execution_dispatch", attempt.id)!;
    // A terminal observation can survive a crash before the mutable cooldown pointer was updated.
    const terminal = this.#store.list<FalLipSyncObservation>("fal_lipsync_execution_observation", attempt.projectId)
      .find(item => item.attemptId === attempt.id && item.observation.kind === "failed");
    if (terminal) { assertFalLipSyncObservation(attempt, mapping, dispatch, submit, terminal); return this.outcome(terminal); }
    const last = schedule.lastObservationId ? this.#store.get<FalLipSyncObservation>("fal_lipsync_execution_observation", schedule.lastObservationId) : undefined;
    if (last) assertFalLipSyncObservation(attempt, mapping, dispatch, submit, last,
      last.observation.kind === "completed" ? this.#store.get("execution_output_receipt", last.observation.outputReceiptId) : undefined);
    return { type: "accepted", taskId: observation.taskId };
  }
  private refused(submit: FalLipSyncSubmit): ExecutionOutcome {
    const observation = submit.observation;
    const technical = observation.kind === "not_dispatched" || observation.kind === "rejected" && ["throttled", "transport", "provider_failure"].includes(observation.error.category);
    return { type: "rejected", certainty: "not_accepted", failureId: `fal-${digest(submit).slice(0, 32)}`, technical, retryAllowed: false };
  }
  /** Accepted, then failed: the request ran on fal, so it may be charged. */
  private outcome(record: FalLipSyncObservation): ExecutionOutcome {
    const observation = record.observation;
    if (observation.kind === "failed") return { type: "failed", taskId: observation.taskId, failureId: `fal-${record.id.slice(0, 32)}`, technical: false, retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`Lip-sync polling unresolved: ${observation.error.code}`, observation.taskId);
    return { type: "accepted", taskId: observation.taskId };
  }

  private async prepare(attempt: Attempt, signal?: AbortSignal): Promise<FalH3LipSyncRequest> {
    const request = attempt.request, configuration = request.profile!.configuration;
    falFields(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", ...(configuredProviderUse(request) ? ["providerUse"] : ["externalAllowanceId"])]);
    assertFalLipSyncOperationOptions({ kind: request.kind, adapter: "fal-h3-lipsync", configuration: configuration as never }, request.args);
    assertLipSyncSettings(request.args.settings);
    const lipSync = request.args.settings.lipSync;
    conflict(request.inputs.length === 1 && request.inputs[0]!.kind === "image", "Lip sync requires one reviewed keyframe");
    conflict(this.#store.list<{ videoNodeId: string; approvalDigest: string }>("approval", attempt.projectId)
      .some(approval => approval.videoNodeId === request.nodeId && approval.approvalDigest === request.fingerprint), "Lip-sync keyframe lacks its exact human approval");
    // The reviewed song window must still be what the film plays under this shot right now.
    const project = this.#store.getProject(attempt.projectId), binding = this.#store.get<{ node: { shotId: string | null } }>("node_binding", request.nodeId);
    const shot = project.shots.find(row => row.id === binding?.node.shotId), song = soundtrackSong(this.#store, project);
    conflict(shot?.performance === "singing" && song && canonical(lipSyncSettings(project, shot.id, song, Number(request.args.durationFrames))) === canonical(lipSync),
      "The film's song under this shot changed after review");
    const reference = request.inputs[0]!, record = this.#store.get<ArtifactRecord>("artifact", reference.artifactId);
    conflict(record && record.projectId === attempt.projectId && canonical(record.artifact) === canonical(reference) && record.fixture === false
      && record.mimeType === "image/png" && falHash(record.validationDigest) && Number.isSafeInteger(record.byteLength)
      && record.byteLength! >= 33 && record.byteLength! <= 30_000_000 && isAbsolute(record.path), "Lip sync requires an exact validated owned PNG");
    const path = await realpath(record!.path), child = relative(this.#root, path);
    conflict(path === record!.path && child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child), "Keyframe must remain inside the owned artifact root");
    stopped(signal); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); let bytes: Buffer;
    try {
      const stat = await file.stat(); conflict(stat.isFile() && stat.size === record!.byteLength, "Reviewed PNG size changed");
      bytes = Buffer.alloc(stat.size + 1); let size = 0;
      while (size < bytes.length) { stopped(signal); const read = await file.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
      conflict(size === stat.size && createHash("sha256").update(bytes.subarray(0, size)).digest("hex") === reference.sha256, "Reviewed PNG bytes changed");
      bytes = bytes.subarray(0, size);
    } finally { await file.close(); }
    stopped(signal);
    const songPath = await this.#song({ projectId: attempt.projectId, audioId: lipSync.audioId, sha256: lipSync.sha256, ...(signal ? { signal } : {}) });
    const audio = await lipSyncAudio(songPath, lipSync, signal);
    return { resolution: (configuration.settings as { resolution: FalH3LipSyncResolution }).resolution, enableTranscription: false,
      image: { bytes, sha256: reference.sha256, width: record!.width!, height: record!.height!, byteLength: bytes.length, mediaType: "image/png" },
      audio: { bytes: audio, sha256: createHash("sha256").update(audio).digest("hex"), byteLength: audio.length, samples: lipSync.clipSamples,
        sampleRate: 48000, channels: 1, mediaType: "audio/wav" } };
  }
}
