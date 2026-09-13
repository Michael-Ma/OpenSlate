import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertExecutionRequest, describeOpenAIImageRequest, OPENAI_IMAGE_MODEL, OpenAIImageAdapter, registerExecutionProvider } from "@openslate/providers";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionProvider, ExecutionRequest, OpenAIImageInput, OpenAIImageModel, OpenAIImageQuality, OpenAIImageRequest } from "@openslate/providers";
import { EnvironmentMediaCredentials } from "../application/provider-credentials.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { Store } from "../persistence/store.js";
import type { ArtifactRecord, Attempt } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { assertImageExecutionDispatch, assertImageExecutionMapping, assertImageExecutionResult } from "./openai-image-receipts.js";
import type { ImageExecutionDispatch, ImageExecutionMapping, ImageExecutionObservation, ImageExecutionResult } from "./openai-image-receipts.js";

const unknown = (diagnostic: string): ExecutionOutcome => ({ type: "unknown", diagnostic });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  invariant(object(value) && Object.keys(value).every(key => fields.includes(key)), "IMAGE_EXECUTION_INPUT_INVALID", "Unsupported image request fields");
}
function stopped(signal?: AbortSignal): void { invariant(!signal?.aborted, "IMAGE_EXECUTION_CANCELLED", "Image preparation was cancelled"); }

/** Offline-tested application bridge. Construction registers availability, never spending authority. */
export class OpenAIImageExecution implements ExecutionProvider {
  readonly #recovery: InstallationRecoveryGuard;
  readonly #store: Store;
  readonly #outputs: ExecutionOutputStore;
  readonly #root: string;
  readonly #credentials: EnvironmentMediaCredentials;
  readonly #fetch: typeof globalThis.fetch | undefined;
  readonly #timeoutMs: number | undefined;
  constructor(options: { store: Store; outputStore: ExecutionOutputStore; artifactRoot: string;
    credentials: EnvironmentMediaCredentials; fetch?: typeof globalThis.fetch; timeoutMs?: number }) {
    invariant(options.outputStore.store === options.store && isAbsolute(options.artifactRoot) && options.artifactRoot !== "/",
      "IMAGE_EXECUTION_CONFIGURATION", "Use one application store and a private absolute artifact root");
    this.#store = options.store; this.#outputs = options.outputStore; this.#credentials = options.credentials;
    this.#recovery = new InstallationRecoveryGuard(options.store);
    this.#fetch = options.fetch; this.#timeoutMs = options.timeoutMs;
    mkdirSync(options.artifactRoot, { recursive: true, mode: 0o700 }); this.#root = realpathSync(options.artifactRoot);
    registerExecutionProvider(this, { adapter: "openai-image", version: "1" });
  }

  async submit(input: ExecutionRequest, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal, expectedLease = options.expectedLease ? { ...options.expectedLease } : undefined;
    const request = structuredClone(input), attempt = this.admitted(request);
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    this.dispatchable(attempt, expectedLease);
    let prepared: OpenAIImageRequest, mapping: ImageExecutionMapping;
    try {
      stopped(signal); prepared = await this.prepare(attempt, signal); stopped(signal);
      const value: ImageExecutionMapping = { ...this.identity(attempt), profileDigest: request.profile!.digest,
        externalAllowanceId: request.externalAllowanceId!, transport: describeOpenAIImageRequest(prepared) };
      mapping = this.#store.transaction(() => {
        this.admitted(request); const existing = this.#store.get<ImageExecutionMapping>("image_execution_mapping", attempt.id);
        if (existing) { invariant(canonical(existing) === canonical(value), "IMAGE_EXECUTION_CONFLICT", "Prepared payload changed for this attempt"); return existing; }
        return this.#store.insert("image_execution_mapping", attempt.id, attempt.projectId, value);
      });
    } catch {
      return this.notDispatched(attempt, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_INPUT_INVALID", signal);
    }
    // Another worker may have claimed the dispatch during the awaited file reads.
    if (this.hasDispatchOrResult(attempt.id)) return this.recover(attempt, signal);
    let transport: OpenAIImageAdapter;
    try {
      stopped(signal);
      transport = new OpenAIImageAdapter({ apiKey: this.#credentials.resolve("openai-media"),
        ...(this.#fetch ? { fetch: this.#fetch } : {}), ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }) });
    } catch {
      return this.notDispatched(attempt, signal?.aborted ? "LOCAL_CANCELLED" : "LOCAL_CREDENTIAL_UNAVAILABLE", signal);
    }
    const claimed = this.#store.transaction(() => {
      if (this.hasDispatchOrResult(attempt.id)) return false;
      stopped(signal); this.dispatchable(attempt, expectedLease);
      const intent: ImageExecutionDispatch = { ...this.identity(attempt), mappingDigest: digest(mapping),
        transportDigest: mapping.transport.requestDigest, externalAllowanceId: request.externalAllowanceId!, createdAt: new Date().toISOString() };
      this.#store.insert("image_execution_dispatch", attempt.id, attempt.projectId, intent); return true;
    });
    if (!claimed) return this.recover(attempt, signal);
    let observation: ImageExecutionObservation;
    let bytes: Uint8Array | undefined;
    try {
      const response = await transport.submit(prepared, { attemptId: attempt.id, expectedRequestDigest: mapping.transport.requestDigest,
        ...(signal ? { signal } : {}) });
      if (response.kind === "completed") {
        bytes = Uint8Array.from(response.output.bytes);
        // Save the provider observation and its output-byte receipt together before local spooling.
        this.#store.transaction(() => {
          const receipt = this.#outputs.recordReceipt(attempt.projectId, { attemptId: attempt.id, expectedRequestDigest: digest(request),
            port: "image", kind: "image", mimeType: "image/png", vendorTaskId: null, diagnosticRequestId: response.receipt.requestId,
            source: { kind: "returned_bytes", sha256: response.output.sha256, byteLength: bytes!.byteLength } });
          const { bytes: _bytes, ...output } = response.output;
          observation = { ...response, output: { ...output, byteLength: bytes!.byteLength }, outputReceiptId: receipt.id };
          this.saveResult(attempt, observation);
        });
      } else { observation = response; this.saveResult(attempt, observation); }
    } catch {
      // The marker is irreversible even when a response/SQL write is lost. Never guess that no HTTP happened.
      return unknown("Image dispatch outcome is unresolved; automatic resubmission is disabled");
    }
    if (bytes) {
      const result = this.#store.get<ImageExecutionResult>("image_execution_result", attempt.id)!;
      if (result.observation.kind === "completed") {
        try {
          const savedBytes = bytes;
          await this.#outputs.spool(attempt.projectId, result.observation.outputReceiptId, async function* () {
            for (let offset = 0; offset < savedBytes.byteLength; offset += 1024 * 1024) yield savedBytes.subarray(offset, offset + 1024 * 1024);
          }, signal ? { signal } : {});
        } catch { return unknown("Image completed; owned output storage needs recovery without resubmission"); }
      }
    }
    return this.recover(attempt, signal);
  }

  async lookup(attemptId: string, input?: Readonly<ExecutionRequest>, options: ExecutionCallOptions = {}): Promise<ExecutionOutcome> {
    const signal = options.signal, saved = this.#store.get<Attempt>("attempt", attemptId);
    invariant(saved && (!input || input.attemptId === attemptId), "IMAGE_EXECUTION_CONFLICT", "Unknown or mismatched image attempt");
    const attempt = this.admitted(structuredClone(input ?? saved.request));
    return this.recover(attempt, signal);
  }

  async poll(_taskId: string, input?: Readonly<ExecutionRequest>): Promise<ExecutionOutcome> {
    this.#recovery.assertWritable();
    if (input) this.admitted(structuredClone(input));
    return unknown("Synchronous image generation has no pollable vendor task");
  }

  private identity(attempt: Attempt) {
    return { id: attempt.id, projectId: attempt.projectId, version: 1 as const, attemptId: attempt.id, requestDigest: digest(attempt.request) };
  }
  private admitted(request: ExecutionRequest): Attempt {
    this.#recovery.assertWritable();
    assertExecutionRequest(this, request);
    const attempt = this.#store.get<Attempt>("attempt", request.attemptId);
    invariant(attempt && attempt.id === request.attemptId && attempt.nodeId === request.nodeId && attempt.fingerprint === request.fingerprint
      && attempt.candidateId && attempt.reservationId && attempt.taskId === null && request.kind === "image"
      && canonical(attempt.request) === canonical(request) && typeof request.externalAllowanceId === "string"
      && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(request.externalAllowanceId),
    "IMAGE_EXECUTION_CONFLICT", "Image execution requires an exact admitted attempt and application allowance");
    const reservation = this.#store.get<{ projectId: string; attemptId: string }>("reservation", attempt.reservationId);
    invariant(reservation?.projectId === attempt.projectId && reservation.attemptId === attempt.id,
      "IMAGE_EXECUTION_CONFLICT", "Image attempt has no matching application reservation");
    return attempt;
  }
  private dispatchable(previous: Attempt, expectedLease: ExecutionCallOptions["expectedLease"]): void {
    this.#recovery.assertFirstSubmit(previous.projectId, previous.id);
    const current = this.admitted(previous.request);
    const reservation = this.#store.get<{ state: string }>("reservation", current.reservationId!);
    invariant(expectedLease && Object.keys(expectedLease).every(key => ["owner", "epoch"].includes(key))
      && expectedLease.owner === current.leaseOwner && expectedLease.epoch === current.leaseEpoch
      && current.phase === "submitting" && current.leaseOwner === previous.leaseOwner && current.leaseEpoch === previous.leaseEpoch
      && current.leaseExpiresAt > Date.now() && reservation?.state === "reserved", "IMAGE_EXECUTION_NOT_DISPATCHABLE",
    "Image dispatch no longer owns its live admission lease");
  }
  private hasDispatchOrResult(id: string): boolean {
    return !!(this.#store.get("image_execution_dispatch", id) || this.#store.get("image_execution_result", id));
  }
  private saveResult(attempt: Attempt, observation: ImageExecutionObservation): ImageExecutionResult {
    const mapping = this.#store.get<ImageExecutionMapping>("image_execution_mapping", attempt.id);
    const dispatch = this.#store.get<ImageExecutionDispatch>("image_execution_dispatch", attempt.id);
    return this.#store.insert("image_execution_result", attempt.id, attempt.projectId, { ...this.identity(attempt),
      mappingDigest: mapping ? digest(mapping) : null, dispatchDigest: dispatch ? digest(dispatch) : null, observation });
  }
  private async notDispatched(attempt: Attempt, code: Extract<ImageExecutionObservation, { kind: "not_dispatched" }>["code"], signal?: AbortSignal): Promise<ExecutionOutcome> {
    this.#store.transaction(() => {
      if (!this.hasDispatchOrResult(attempt.id)) this.saveResult(attempt, { kind: "not_dispatched", code });
    });
    return this.recover(attempt, signal);
  }
  private async recover(attempt: Attempt, signal?: AbortSignal): Promise<ExecutionOutcome> {
    const mapping = this.#store.get<ImageExecutionMapping>("image_execution_mapping", attempt.id);
    const dispatch = this.#store.get<ImageExecutionDispatch>("image_execution_dispatch", attempt.id);
    const result = this.#store.get<ImageExecutionResult>("image_execution_result", attempt.id);
    if (mapping) assertImageExecutionMapping(attempt, mapping);
    if (dispatch) { invariant(mapping, "IMAGE_EXECUTION_CONFLICT", "Dispatch has no prepared mapping"); assertImageExecutionDispatch(attempt, mapping, dispatch); }
    if (!result) return unknown("Image dispatch has no durable outcome; automatic resubmission is disabled");
    const observation = result.observation;
    assertImageExecutionResult(attempt, mapping, dispatch, result, observation.kind === "completed"
      ? this.#store.get("execution_output_receipt", observation.outputReceiptId) : undefined);
    if (observation.kind === "not_dispatched" || observation.kind === "rejected") return { type: "rejected", certainty: "not_accepted",
      failureId: `image-${digest(result).slice(0, 32)}`, technical: observation.kind === "not_dispatched" || observation.source === "local", retryAllowed: false };
    if (observation.kind === "unknown") return unknown(`Image submission unresolved: ${observation.code}`);
    try {
      await this.#outputs.recover(attempt.projectId, observation.outputReceiptId, signal ? { signal } : {});
      const completion = await this.#outputs.recoverCompletion(attempt.projectId, attempt.id, signal ? { signal } : {});
      stopped(signal);
      invariant(completion && completion.vendorTaskId === null && completion.outputs[0].sha256 === observation.output.sha256
        && completion.outputs[0].byteLength === observation.output.byteLength, "IMAGE_EXECUTION_CONFLICT", "Winning image output differs from the provider receipt");
      return completion;
    } catch { return unknown("Image completed; owned output storage needs recovery without resubmission"); }
  }

  private async prepare(attempt: Attempt, signal?: AbortSignal): Promise<OpenAIImageRequest> {
    const request = attempt.request;
    exact(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", "externalAllowanceId"]);
    exact(request.args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "prompt", "width", "height", "settings"]);
    const configuration = request.profile!.configuration;
    exact(configuration, ["model", "settings"]); exact(configuration.settings, ["width", "height", "quality"]);
    const settings = configuration.settings;
    invariant((configuration.model === OPENAI_IMAGE_MODEL || configuration.model === "gpt-image-2")
      && request.args.width === settings.width && request.args.height === settings.height
      && typeof request.args.prompt === "string" && ["low", "medium", "high"].includes(String(settings.quality)),
    "IMAGE_EXECUTION_INPUT_INVALID", "Image settings must exactly match the pinned provider profile");
    exact(request.args.settings, ["quality"]);
    invariant(request.args.settings.quality === undefined || request.args.settings.quality === settings.quality,
      "IMAGE_EXECUTION_INPUT_INVALID", "Shot settings cannot override pinned image quality");
    invariant(Array.isArray(request.inputs) && request.inputs.length <= 8, "IMAGE_EXECUTION_INPUT_INVALID", "At most eight exact PNG references are supported");
    const images: OpenAIImageInput[] = []; let total = 0;
    for (const input of request.inputs) {
      stopped(signal); exact(input, ["artifactId", "kind", "sha256"]);
      const record = this.#store.get<ArtifactRecord>("artifact", input.artifactId);
      invariant(record && record.projectId === attempt.projectId && record.id === input.artifactId && canonical(record.artifact) === canonical(input)
        && input.kind === "image" && record.mimeType === "image/png" && record.fixture === false && hash(record.validationDigest)
        && Number.isSafeInteger(record.byteLength) && record.byteLength! >= 33 && record.byteLength! <= 4 * 1024 * 1024,
      "IMAGE_EXECUTION_INPUT_INVALID", "Image edit requires a fully validated owned PNG within the input limit");
      total += record.byteLength!; invariant(total <= 24 * 1024 * 1024, "IMAGE_EXECUTION_INPUT_INVALID", "PNG references exceed the total input limit");
      invariant(isAbsolute(record.path), "IMAGE_EXECUTION_INPUT_INVALID", "Owned PNG has no managed path");
      const canonicalPath = await realpath(record.path), child = relative(this.#root, canonicalPath);
      invariant(canonicalPath === record.path && child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child),
        "IMAGE_EXECUTION_INPUT_INVALID", "Owned PNG must remain in the managed artifact root");
      stopped(signal); const file = await open(record.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try {
        const stat = await file.stat();
        invariant(stat.isFile() && stat.size === record.byteLength, "IMAGE_EXECUTION_INPUT_INVALID", "Owned PNG size changed");
        bytes = Buffer.alloc(stat.size + 1); let size = 0;
        while (size < bytes.length) { stopped(signal); const read = await file.read(bytes, size, bytes.length - size, null); if (!read.bytesRead) break; size += read.bytesRead; }
        invariant(size === stat.size && createHash("sha256").update(bytes.subarray(0, size)).digest("hex") === input.sha256,
          "IMAGE_EXECUTION_INPUT_INVALID", "Owned PNG bytes changed after review"); bytes = bytes.subarray(0, size);
      } finally { await file.close(); }
      stopped(signal); images.push({ artifactId: input.artifactId, sha256: input.sha256, mimeType: "image/png", bytes });
    }
    const parameters = { model: configuration.model as OpenAIImageModel, prompt: request.args.prompt, width: Number(settings.width), height: Number(settings.height), quality: settings.quality as OpenAIImageQuality };
    return images.length ? { ...parameters, mode: "edit", images } : { ...parameters, mode: "generate" };
  }
}
