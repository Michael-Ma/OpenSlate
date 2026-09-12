import { canonical, invariant, providerProfileArguments } from "@openslate/core";
import type { ArtifactRef, JsonObject, OperationKind, ProviderConfiguration, ProviderProfile } from "@openslate/core";

/** Application execution contract, independent of any vendor's HTTP protocol. */
export interface ExecutionIdentity { adapter: string; version: string }
export interface ExecutionProfileSnapshot { id: string; revision: string; configuration: ProviderConfiguration; digest: string }
export interface ExecutionRequest {
  attemptId: string; nodeId: string; kind: OperationKind; fingerprint: string;
  args: JsonObject; inputs: ArtifactRef[];
  /** Absent only on historical requests, which used the fake/v1 contract. */
  execution?: ExecutionIdentity;
  /** Pinned only on new explicit profiles; never backfilled into historical requests. */
  profile?: ExecutionProfileSnapshot;
  /** Application-issued spending correlation, never a credential. */
  externalAllowanceId?: string;
}
export interface ExecutionOutput {
  port: string; kind: ArtifactRef["kind"]; mimeType: string; extension: string;
  bytesBase64: string; sha256: string; fixture: boolean;
}
/** Small owned-byte descriptor. Raw bytes and protected vendor locators stay outside execution evidence. */
export interface ExecutionSpoolOutput {
  port: "image" | "video"; kind: "image" | "video"; mimeType: "image/png" | "video/mp4";
  extension: "png" | "mp4"; sha256: string; byteLength: number; fixture: false;
  storage: { type: "spool"; spoolId: string };
}
export interface ExecutionSpoolCompletion {
  type: "completed"; version: 2; receiptId: string; vendorTaskId: string | null;
  outputs: [ExecutionSpoolOutput];
}
export type IngestibleExecutionOutput = ExecutionOutput | ExecutionSpoolOutput;
export type ExecutionOutcome =
  | { type: "accepted"; taskId: string }
  | { type: "completed"; taskId: string; outputs: ExecutionOutput[] }
  | ExecutionSpoolCompletion
  | { type: "failed"; taskId: string; failureId: string; technical: boolean; retryAllowed?: boolean }
  | { type: "rejected"; certainty: "not_accepted"; failureId: string; technical: boolean; retryAllowed?: boolean }
  | { type: "unknown"; diagnostic: string; taskId?: string };
export interface ExecutionProvider {
  submit(request: ExecutionRequest, options?: ExecutionCallOptions): Promise<ExecutionOutcome>;
  poll(taskId: string, request?: Readonly<ExecutionRequest>, options?: ExecutionCallOptions): Promise<ExecutionOutcome>;
  /** A missing receipt must remain unknown; this operation must never submit. */
  lookup(attemptId: string, request?: Readonly<ExecutionRequest>, options?: ExecutionCallOptions): Promise<ExecutionOutcome>;
}
export interface ExecutionCallOptions {
  signal?: AbortSignal;
  /** Ephemeral caller authority for first dispatch; never part of a saved request or receipt. */
  expectedLease?: Readonly<{ owner: string; epoch: number }>;
}

const LEGACY_IDENTITY = Object.freeze({ adapter: "fake", version: "1" });
const registrations = new WeakMap<ExecutionProvider, Readonly<ExecutionIdentity>>();
const generated = new Set<OperationKind>(["image", "video", "speech", "transcription"]);

const contractId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const identityKey = (identity: ExecutionIdentity) => JSON.stringify([identity.adapter, identity.version]);
export function isLegacyExecution(identity: ExecutionIdentity): boolean { return identity.adapter === "fake" && identity.version === "1"; }
export function requestExecutionIdentity(request: ExecutionRequest): Readonly<ExecutionIdentity> {
  const identity = request.execution ?? LEGACY_IDENTITY;
  invariant(identity && contractId(identity.adapter) && contractId(identity.version)
    && Object.keys(identity).every(key => ["adapter", "version"].includes(key)), "PROVIDER_NOT_REGISTERED", "Invalid saved execution identity");
  return Object.freeze({ adapter: identity.adapter, version: identity.version });
}
export function profileExecutionIdentity(profile: ProviderProfile): Readonly<ExecutionIdentity> {
  providerProfileArguments(profile);
  invariant(generated.has(profile.kind), "CAPABILITY_LOCK_UNSUPPORTED", "Profile is not a generated operation");
  return Object.freeze({ adapter: profile.adapter, version: profile.executionVersion ?? "1" });
}
export function executionProfileSnapshot(profile: ProviderProfile): ExecutionProfileSnapshot | undefined {
  const args = providerProfileArguments(profile);
  if (args.profileDigest === undefined) return undefined;
  return { id: profile.id, revision: profile.revision, configuration: structuredClone(profile.configuration!), digest: String(args.profileDigest) };
}

/** Trusted host registration establishes availability only, never spending permission. */
export function registerExecutionProvider<T extends ExecutionProvider>(provider: T, identity: ExecutionIdentity): T {
  invariant(identity && contractId(identity.adapter) && contractId(identity.version)
    && Object.keys(identity).every(key => ["adapter", "version"].includes(key)), "PROVIDER_NOT_REGISTERED", "Invalid execution contract identity");
  invariant(provider && typeof provider.submit === "function" && typeof provider.poll === "function"
    && typeof provider.lookup === "function", "PROVIDER_NOT_REGISTERED", "Incomplete execution provider");
  const old = registrations.get(provider);
  invariant(!old || (old.adapter === identity.adapter && old.version === identity.version),
    "PROVIDER_NOT_REGISTERED", "Provider registration cannot change identity");
  registrations.set(provider, Object.freeze({ adapter: identity.adapter, version: identity.version }));
  return provider;
}
export function executionIdentity(provider: ExecutionProvider): Readonly<ExecutionIdentity> {
  const identity = registrations.get(provider);
  invariant(identity, "PROVIDER_NOT_REGISTERED", "Execution requires trusted host registration");
  return identity;
}
export function assertExecutionProfile(provider: ExecutionProvider, profile: ProviderProfile): void {
  const identity = executionIdentity(provider), pinned = profileExecutionIdentity(profile);
  invariant(pinned.adapter === identity.adapter && pinned.version === identity.version,
    "CAPABILITY_LOCK_UNSUPPORTED", "Pinned profile does not match the registered execution contract");
}
export function assertExecutionRequest(provider: ExecutionProvider, request: ExecutionRequest): void {
  const registered = executionIdentity(provider), saved = requestExecutionIdentity(request);
  invariant(saved.adapter === registered.adapter && saved.version === registered.version,
    "PROVIDER_NOT_REGISTERED", "Attempt belongs to a different execution contract");
  if (!isLegacyExecution(saved) || request.profile !== undefined || request.args.executionVersion !== undefined || request.args.profileConfiguration !== undefined) {
    const profile = request.profile;
    invariant(profile && Object.keys(profile).every(key => ["id", "revision", "configuration", "digest"].includes(key)), "PROFILE_INCOMPATIBLE", "Attempt has no exact frozen profile");
    const args = providerProfileArguments({ id: profile.id, revision: profile.revision, kind: request.kind, adapter: saved.adapter,
      executionVersion: saved.version, configuration: profile.configuration, maxConcurrency: 1, unitCostMicros: "0", maxRetries: 0 });
    invariant(profile.digest === args.profileDigest && Object.entries(args).every(([key, value]) => Object.hasOwn(request.args, key) && canonical(request.args[key]) === canonical(value)),
      "PROFILE_INCOMPATIBLE", "Attempt profile differs from its frozen execution inputs");
  }
}
/** An immutable installation catalog. Missing routes never fall back to another adapter. */
export class ExecutionRegistry {
  readonly #providers = new Map<string, ExecutionProvider>();
  constructor(providers: readonly ExecutionProvider[]) {
    invariant(Array.isArray(providers) && providers.length > 0 && providers.length <= 64, "PROVIDER_NOT_REGISTERED", "Use a bounded provider catalog");
    for (const provider of providers) {
      const key = identityKey(executionIdentity(provider));
      invariant(!this.#providers.has(key), "PROVIDER_REGISTRATION_CONFLICT", "One execution identity can have only one registered implementation");
      this.#providers.set(key, provider);
    }
  }
  resolve(identity: ExecutionIdentity): ExecutionProvider {
    const provider = this.#providers.get(identityKey(identity));
    invariant(provider, "PROVIDER_NOT_REGISTERED", "The pinned execution adapter is unavailable"); return provider;
  }
  forProfile(profile: ProviderProfile): ExecutionProvider {
    const provider = this.resolve(profileExecutionIdentity(profile)); assertExecutionProfile(provider, profile); return provider;
  }
  forRequest(request: ExecutionRequest): ExecutionProvider {
    const provider = this.resolve(requestExecutionIdentity(request)); assertExecutionRequest(provider, request); return provider;
  }
}
/** Preserve the historical source label without making Engine depend on FakeProvider. */
export function executionFailureSource(provider: ExecutionProvider): string {
  return `${executionIdentity(provider).adapter}_provider`;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/.test(value);
const exact = (value: Record<string, unknown>, fields: string[]): boolean => Object.keys(value).every(key => fields.includes(key));
export const MAX_EXECUTION_OUTPUT_BYTES = 64 * 1024 * 1024;
export const EXECUTION_SPOOL_LIMITS = Object.freeze({ image: 32 * 1024 * 1024, video: 256 * 1024 * 1024 });
export function isSpoolCompletion(value: ExecutionOutcome): value is ExecutionSpoolCompletion {
  return value.type === "completed" && "version" in value && value.version === 2;
}
export function isSpoolOutput(value: IngestibleExecutionOutput): value is ExecutionSpoolOutput { return "storage" in value; }
/** Diagnostic request IDs are never returned here. */
export function executionTaskId(value: ExecutionOutcome): string | null {
  return isSpoolCompletion(value) ? value.vendorTaskId : "taskId" in value ? value.taskId ?? null : null;
}

function normalizeSpoolCompletion(value: Record<string, unknown>, request?: ExecutionRequest): ExecutionSpoolCompletion | null {
  const hash = (item: unknown): item is string => typeof item === "string" && /^[a-f0-9]{64}$/.test(item);
  if (!exact(value, ["type", "version", "receiptId", "vendorTaskId", "outputs"]) || value.version !== 2
    || !hash(value.receiptId) || !(value.vendorTaskId === null || id(value.vendorTaskId))
    || !Array.isArray(value.outputs) || value.outputs.length !== 1) return null;
  const output = value.outputs[0];
  if (!object(output) || !exact(output, ["port", "kind", "mimeType", "extension", "sha256", "byteLength", "fixture", "storage"])
    || !((output.port === "image" && output.kind === "image" && output.mimeType === "image/png" && output.extension === "png")
      || (output.port === "video" && output.kind === "video" && output.mimeType === "video/mp4" && output.extension === "mp4"))
    || !hash(output.sha256) || !Number.isSafeInteger(output.byteLength) || Number(output.byteLength) <= 0
    || Number(output.byteLength) > EXECUTION_SPOOL_LIMITS[output.kind as "image" | "video"] || output.fixture !== false
    || !object(output.storage) || !exact(output.storage, ["type", "spoolId"]) || output.storage.type !== "spool"
    || output.storage.spoolId !== value.receiptId || (request && request.kind !== output.kind)) return null;
  return structuredClone(value) as unknown as ExecutionSpoolCompletion;
}

/** Validate and copy normalized adapter observations before saving immutable evidence. */
export function normalizeExecutionOutcome(value: unknown, request?: ExecutionRequest): ExecutionOutcome {
  const invalid = (): ExecutionOutcome => ({ type: "unknown", diagnostic: "Invalid execution provider observation",
    ...(object(value) && value.type === "completed" && "version" in value
      ? value.version === 2 && !("taskId" in value) && id(value.vendorTaskId) ? { taskId: value.vendorTaskId } : {}
      : object(value) && ["accepted", "completed", "failed", "unknown"].includes(String(value.type)) && id(value.taskId) ? { taskId: value.taskId } : {}) });
  if (!object(value)) return invalid();
  if (value.type === "completed" && "version" in value) return normalizeSpoolCompletion(value, request) ?? invalid();
  if (value.type === "unknown") return exact(value, ["type", "diagnostic", "taskId"]) && typeof value.diagnostic === "string"
    && value.diagnostic.length <= 512 && (value.taskId === undefined || id(value.taskId))
    ? { type: "unknown", diagnostic: value.diagnostic, ...(id(value.taskId) ? { taskId: value.taskId } : {}) } : invalid();
  if (value.type === "accepted") return exact(value, ["type", "taskId"]) && id(value.taskId)
    ? { type: "accepted", taskId: value.taskId } : invalid();
  if (value.type === "failed" || value.type === "rejected") {
    const fields = value.type === "failed" ? ["type", "taskId", "failureId", "technical", "retryAllowed"]
      : ["type", "certainty", "failureId", "technical", "retryAllowed"];
    if (!exact(value, fields) || !id(value.failureId) || typeof value.technical !== "boolean"
      || (value.retryAllowed !== undefined && typeof value.retryAllowed !== "boolean")
      || (value.type === "failed" ? !id(value.taskId) : value.certainty !== "not_accepted")) return invalid();
    // Missing retryAllowed remains missing for historical evidence; the engine requires explicit true.
    return structuredClone(value) as unknown as ExecutionOutcome;
  }
  if (value.type !== "completed" || !exact(value, ["type", "taskId", "outputs"]) || !id(value.taskId)
    || !Array.isArray(value.outputs) || value.outputs.length < 1 || value.outputs.length > 16) return invalid();
  const ports = new Set<string>(); let encodedBytes = 0;
  for (const output of value.outputs) {
    if (!object(output) || !exact(output, ["port", "kind", "mimeType", "extension", "bytesBase64", "sha256", "fixture"])
      || typeof output.port !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(output.port) || ports.has(output.port)
      || !["image", "video", "audio", "data"].includes(String(output.kind))
      || typeof output.mimeType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(output.mimeType) || output.mimeType.length > 128
      || typeof output.extension !== "string" || !/^[a-z0-9]{1,12}$/.test(output.extension)
      || typeof output.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(output.sha256)
      || typeof output.fixture !== "boolean" || typeof output.bytesBase64 !== "string" || output.bytesBase64.length === 0) return invalid();
    encodedBytes += output.bytesBase64.length;
    if (encodedBytes > Math.ceil(MAX_EXECUTION_OUTPUT_BYTES / 3) * 4) return invalid();
    ports.add(output.port);
  }
  if (request) {
    const roles: Record<OperationKind, [string, ArtifactRef["kind"]]> = {
      image: ["image", "image"], video: ["video", "video"], speech: ["audio", "audio"],
      transcription: ["cues", "data"], timeline: ["timeline", "data"], render: ["video", "video"],
    };
    const expected = roles[request.kind];
    if (!expected || value.outputs.length !== 1 || value.outputs[0].port !== expected[0] || value.outputs[0].kind !== expected[1]) return invalid();
  }
  return structuredClone(value) as unknown as ExecutionOutcome;
}
