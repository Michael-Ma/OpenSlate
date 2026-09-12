import { invariant } from "@openslate/core";
import type { ArtifactRef, JsonObject, OperationKind, ProviderProfile } from "@openslate/core";

/** Application execution contract, independent of any vendor's HTTP protocol. */
export interface ExecutionIdentity { adapter: string; version: string }
export interface ExecutionRequest {
  attemptId: string; nodeId: string; kind: OperationKind; fingerprint: string;
  args: JsonObject; inputs: ArtifactRef[];
  /** Absent only on historical requests, which used the fake/v1 contract. */
  execution?: ExecutionIdentity;
}
export interface ExecutionOutput {
  port: string; kind: ArtifactRef["kind"]; mimeType: string; extension: string;
  bytesBase64: string; sha256: string; fixture: boolean;
}
export type ExecutionOutcome =
  | { type: "accepted"; taskId: string }
  | { type: "completed"; taskId: string; outputs: ExecutionOutput[] }
  | { type: "failed"; taskId: string; failureId: string; technical: boolean; retryAllowed?: boolean }
  | { type: "rejected"; certainty: "not_accepted"; failureId: string; technical: boolean; retryAllowed?: boolean }
  | { type: "unknown"; diagnostic: string; taskId?: string };
export interface ExecutionProvider {
  submit(request: ExecutionRequest): Promise<ExecutionOutcome>;
  poll(taskId: string): Promise<ExecutionOutcome>;
  /** A missing receipt must remain unknown; this operation must never submit. */
  lookup(attemptId: string): Promise<ExecutionOutcome>;
}

const LEGACY_IDENTITY = Object.freeze({ adapter: "fake", version: "1" });
const registrations = new WeakMap<ExecutionProvider, Readonly<ExecutionIdentity>>();
const generated = new Set<OperationKind>(["image", "video", "speech", "transcription"]);

/** Trusted host registration. V0 admits only the existing fake contract; transports are not registrations. */
export function registerExecutionProvider<T extends ExecutionProvider>(provider: T, identity: ExecutionIdentity): T {
  invariant(identity?.adapter === LEGACY_IDENTITY.adapter && identity.version === LEGACY_IDENTITY.version,
    "PROVIDER_NOT_REGISTERED", "This execution contract is not enabled");
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
  const identity = executionIdentity(provider);
  invariant(profile.adapter === identity.adapter && profile.revision === identity.version && generated.has(profile.kind),
    "CAPABILITY_LOCK_UNSUPPORTED", "Pinned profile does not match the registered execution contract");
}
export function assertExecutionRequest(provider: ExecutionProvider, request: ExecutionRequest): void {
  const registered = executionIdentity(provider), saved = request.execution ?? LEGACY_IDENTITY;
  invariant(saved.adapter === registered.adapter && saved.version === registered.version,
    "PROVIDER_NOT_REGISTERED", "Attempt belongs to a different execution contract");
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

/** Validate and copy normalized adapter observations before saving immutable evidence. */
export function normalizeExecutionOutcome(value: unknown, request?: ExecutionRequest): ExecutionOutcome {
  const invalid = (): ExecutionOutcome => ({ type: "unknown", diagnostic: "Invalid execution provider observation",
    ...(object(value) && ["accepted", "completed", "failed", "unknown"].includes(String(value.type)) && id(value.taskId) ? { taskId: value.taskId } : {}) });
  if (!object(value)) return invalid();
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
