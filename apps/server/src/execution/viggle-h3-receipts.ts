import { canonical, digest, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { JsonObject, ProviderProfile } from "@openslate/core";
import { describeViggleH3Request, VIGGLE_H3_ADAPTER_VERSION, VIGGLE_H3_LIMITS, viggleH3MetadataDigest } from "@openslate/providers";
import type { ViggleH3Description, ViggleH3Diagnostic, ViggleH3PollResult, ViggleH3SubmitResult } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import { assertOutputReceiptIdentity } from "./output-store.js";
import type { OutputReceipt } from "./output-store.js";

interface Identity { id: string; version: 1; projectId: string; attemptId: string; requestDigest: string }
export interface ViggleH3ExecutionMapping extends Identity {
  profileDigest: string; profileDefinitionDigest: string; profileDefinition: ProviderProfile;
  /** Retained matching evidence, not proof of the originating admission lock. */
  capabilityLockId: string; capabilityLockDigest: string;
  allowanceId: string; allowanceDigest: string; consumptionDigest: string; estimatedMicros: string;
  firstFrame: { artifactId: string; artifactDigest: string; approvalId: string; approvalDigest: string; snapshotId: string; snapshotDigest: string };
  transport: ViggleH3Description;
}
export interface ViggleH3ExecutionDispatch extends Identity { mappingDigest: string; bodySha256: string; allowanceId: string; createdAt: number }
export type ViggleH3SubmitObservation = ViggleH3SubmitResult | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" };
export interface ViggleH3ExecutionSubmit extends Identity {
  mappingDigest: string | null; dispatchDigest: string | null; observedAt: number; observation: ViggleH3SubmitObservation;
}
type Completed = Extract<ViggleH3PollResult, { kind: "completed" }>;
export type ViggleH3PollObservation = Exclude<ViggleH3PollResult, Completed> | (Omit<Completed, "output"> & { outputReceiptId: string });
export interface ViggleH3ExecutionObservation extends Identity {
  mappingDigest: string; dispatchDigest: string; observedAt: number; observation: ViggleH3PollObservation;
}
export interface ViggleH3PollPolicy { initialMs: number; maximumMs: number; retryAfterMaximumMs: number; claimMs: number }
export interface ViggleH3PollSchedule extends Identity {
  taskId: string; policy: ViggleH3PollPolicy; count: number; nextPollAt: number; claimId: string | null; lastObservationId: string | null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const viggleH3Hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const task = (value: unknown): value is string => typeof value === "string" && /^vid_[A-Za-z0-9_-]{1,156}$/.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export function viggleH3Fields(value: unknown, keys: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  invariant(object(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && keys.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => typeof key === "string" && [...keys, ...optional].includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")), "VIGGLE_H3_EXECUTION_CONFLICT", "Unsupported Viggle receipt fields");
}
function base(attempt: Attempt, value: Identity, extras: string[], observation = false): void {
  viggleH3Fields(value, ["id", "version", "projectId", "attemptId", "requestDigest", ...extras]);
  invariant(value.version === 1 && (observation ? viggleH3Hash(value.id) : value.id === attempt.id) && value.projectId === attempt.projectId
    && value.attemptId === attempt.id && value.requestDigest === digest(attempt.request) && attempt.request.kind === "video"
    && attempt.request.execution?.adapter === "viggle-h3" && attempt.request.execution.version === "1"
    && typeof attempt.request.externalAllowanceId === "string" && viggleH3Hash(attempt.request.profile?.digest)
    && Buffer.byteLength(canonical(value)) <= 32768, "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle receipt differs from its exact admitted request");
}
export function assertViggleH3ExecutionProfile(profile: ProviderProfile, attempt: Attempt): void {
  viggleH3Fields(profile, ["id", "revision", "kind", "adapter", "executionVersion", "configuration", "minFrames", "maxFrames", "maxConcurrency", "unitCostMicros", "maxRetries"]);
  const args = providerProfileArguments(profile), saved = attempt.request.profile;
  viggleH3Fields(saved, ["id", "revision", "configuration", "digest"]);
  invariant(profile.kind === "video" && profile.adapter === "viggle-h3" && profile.executionVersion === "1" && saved.id === profile.id
    && saved.revision === profile.revision && saved.digest === args.profileDigest && canonical(saved.configuration) === canonical(profile.configuration)
    && Object.entries(args).every(([key, value]) => canonical(attempt.request.args[key]) === canonical(value))
    && integer(profile.minFrames, 90, 450) && integer(profile.maxFrames, profile.minFrames!, 450) && profile.minFrames! % 30 === 0 && profile.maxFrames! % 30 === 0
    && integer(profile.maxConcurrency, 1, 64) && integer(profile.maxRetries, 0, 3) && typeof profile.unitCostMicros === "string",
  "VIGGLE_H3_EXECUTION_CONFLICT", "Viggle requires its exact full consumed profile definition");
  moneyMicros(profile.unitCostMicros);
}
/** Cheap pre-admission validation. PNG ownership and approval are checked separately by the bridge. */
export function assertViggleH3OperationOptions(profile: ProviderProfile, args: JsonObject): void {
  try {
    viggleH3Fields(args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "prompt", "durationFrames", "frameRate", "settings"]);
    viggleH3Fields(args.settings, []); viggleH3Fields(profile.configuration, ["model", "settings"]);
    viggleH3Fields(profile.configuration.settings, ["quality", "resolution", "aspectRatio"]);
    const expected = providerProfileArguments(profile), configuration = profile.configuration;
    invariant(profile.kind === "video" && profile.adapter === "viggle-h3" && profile.executionVersion === "1" && configuration.model === "MiniMax-H3"
      && Object.entries(expected).every(([key, value]) => canonical(args[key]) === canonical(value)) && integer(args.durationFrames, 90, 450)
      && Number(args.durationFrames) % 30 === 0 && Number(args.durationFrames) >= profile.minFrames! && Number(args.durationFrames) <= profile.maxFrames!
      && canonical(args.frameRate) === canonical({ numerator: 30, denominator: 1 }), "VIGGLE_H3_EXECUTION_CONFLICT", "Unsupported Viggle operation");
    describeViggleH3Request({ prompt: args.prompt as string, durationSeconds: Number(args.durationFrames) / 30,
      quality: configuration.settings!.quality as "low" | "high", resolution: configuration.settings!.resolution as "480p" | "768p" | "1080p",
      aspectRatio: configuration.settings!.aspectRatio as "16:9", watermark: false });
  } catch { invariant(false, "VIGGLE_H3_PREFLIGHT_INVALID", "Unsupported Viggle operation options"); }
}
export function assertViggleH3ExecutionMapping(attempt: Attempt, mapping: ViggleH3ExecutionMapping): void {
  base(attempt, mapping, ["profileDigest", "profileDefinitionDigest", "profileDefinition", "capabilityLockId", "capabilityLockDigest", "allowanceId", "allowanceDigest", "consumptionDigest", "estimatedMicros", "firstFrame", "transport"]);
  assertViggleH3ExecutionProfile(mapping.profileDefinition, attempt);
  assertViggleH3OperationOptions(mapping.profileDefinition, attempt.request.args);
  const request = attempt.request, config = request.profile!.configuration, description = mapping.transport;
  viggleH3Fields(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", "externalAllowanceId"]);
  viggleH3Fields(config, ["model", "settings"]); viggleH3Fields(config.settings, ["quality", "resolution", "aspectRatio"]);
  viggleH3Fields(request.args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "prompt", "durationFrames", "frameRate", "settings"]);
  viggleH3Fields(request.args.settings, []);
  viggleH3Fields(description, ["adapterVersion", "model", "mode", "quality", "durationSeconds", "resolution", "aspectRatio", "watermark", "firstFrame", "requestDigest", "bodySha256", "bodyByteLength"]);
  viggleH3Fields(mapping.firstFrame, ["artifactId", "artifactDigest", "approvalId", "approvalDigest", "snapshotId", "snapshotDigest"]);
  invariant(config.model === "MiniMax-H3" && description.mode === "first_frame" && description.watermark === false
    && description.model === config.model && description.adapterVersion === VIGGLE_H3_ADAPTER_VERSION
    && description.resolution === config.settings.resolution && description.quality === config.settings.quality && description.aspectRatio === config.settings.aspectRatio
    && integer(description.durationSeconds, 3, 15)
    && request.args.durationFrames === description.durationSeconds * 30
    && Number(request.args.durationFrames) >= mapping.profileDefinition.minFrames! && Number(request.args.durationFrames) <= mapping.profileDefinition.maxFrames!
    && canonical(request.args.frameRate) === canonical({ numerator: 30, denominator: 1 })
    && typeof request.args.prompt === "string" && request.args.prompt.trim().length > 0 && Buffer.byteLength(request.args.prompt) <= 32768
    && mapping.profileDigest === request.profile!.digest && mapping.profileDefinitionDigest === digest(mapping.profileDefinition)
    && id(mapping.capabilityLockId) && viggleH3Hash(mapping.capabilityLockDigest) && mapping.allowanceId === request.externalAllowanceId
    && viggleH3Hash(mapping.allowanceDigest) && viggleH3Hash(mapping.consumptionDigest) && mapping.estimatedMicros === mapping.profileDefinition.unitCostMicros
    && request.inputs.length === 1 && request.inputs[0]!.kind === "image" && mapping.firstFrame.artifactId === request.inputs[0]!.artifactId
    && id(mapping.firstFrame.approvalId) && id(mapping.firstFrame.snapshotId) && [mapping.firstFrame.artifactDigest, mapping.firstFrame.approvalDigest, mapping.firstFrame.snapshotDigest].every(viggleH3Hash),
  "VIGGLE_H3_EXECUTION_CONFLICT", "H3 mapping must preserve the pinned model, exact duration and reviewed first frame");
  const image = description.firstFrame!; viggleH3Fields(image, ["sha256", "width", "height", "byteLength", "mediaType"]);
  const { requestDigest, bodySha256, bodyByteLength, ...metadata } = description;
  invariant(image.sha256 === request.inputs[0]!.sha256 && viggleH3Hash(image.sha256) && image.mediaType === "image/png"
    && integer(bodyByteLength, image.byteLength, VIGGLE_H3_LIMITS.requestBytes) && viggleH3Hash(bodySha256)
    && requestDigest === viggleH3MetadataDigest(request.args.prompt, metadata),
  "VIGGLE_H3_EXECUTION_CONFLICT", "H3 transport metadata differs from its exact owned PNG");
  // The body hash includes encoded bytes: Store cannot reconstruct it from an artifact hash alone.
}
export function assertViggleH3ExecutionDispatch(attempt: Attempt, mapping: ViggleH3ExecutionMapping, dispatch: ViggleH3ExecutionDispatch): void {
  base(attempt, dispatch, ["mappingDigest", "bodySha256", "allowanceId", "createdAt"]); assertViggleH3ExecutionMapping(attempt, mapping);
  invariant(dispatch.mappingDigest === digest(mapping) && dispatch.bodySha256 === mapping.transport.bodySha256
    && dispatch.allowanceId === mapping.allowanceId && integer(dispatch.createdAt, 0, Number.MAX_SAFE_INTEGER),
  "VIGGLE_H3_EXECUTION_CONFLICT", "H3 dispatch marker differs from its prepared mapping");
}
function diagnostic(value: ViggleH3Diagnostic): void {
  viggleH3Fields(value, ["code", "category"], ["retryAfterMs"]);
  invariant(typeof value.code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.code)
    && ["invalid_input", "auth", "quota", "policy", "throttled", "transport", "protocol", "aborted", "provider_failure"].includes(value.category)
    && (value.retryAfterMs === undefined || integer(value.retryAfterMs, 0, 600000)), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid redacted Viggle diagnostic");
}
function receipt(value: { requestId: string | null; httpStatus: number | null }): void {
  viggleH3Fields(value, ["requestId", "httpStatus"]);
  invariant((value.requestId === null || typeof value.requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.requestId))
    && (value.httpStatus === null || integer(value.httpStatus, 100, 599)), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid Viggle HTTP receipt");
}
export function assertViggleH3ExecutionSubmit(attempt: Attempt, mapping: ViggleH3ExecutionMapping | undefined, dispatch: ViggleH3ExecutionDispatch | undefined, value: ViggleH3ExecutionSubmit): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"]);
  if (mapping) assertViggleH3ExecutionMapping(attempt, mapping);
  if (dispatch) { invariant(mapping, "VIGGLE_H3_EXECUTION_CONFLICT", "Dispatch lacks its mapping"); assertViggleH3ExecutionDispatch(attempt, mapping, dispatch); }
  invariant(value.mappingDigest === (mapping ? digest(mapping) : null) && value.dispatchDigest === (dispatch ? digest(dispatch) : null)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER), "VIGGLE_H3_EXECUTION_CONFLICT", "H3 submission observation lost its dispatch identity");
  const observation = value.observation; invariant(object(observation), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid H3 submission observation");
  if (observation.kind === "not_dispatched") {
    viggleH3Fields(observation, ["kind", "code"]);
    invariant(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED"].includes(observation.code),
      "VIGGLE_H3_EXECUTION_CONFLICT", "Only a pre-dispatch failure can prove no submission"); return;
  }
  invariant(mapping && dispatch, "VIGGLE_H3_EXECUTION_CONFLICT", "Provider observation requires a persisted dispatch");
  if (observation.kind === "accepted") {
    viggleH3Fields(observation, ["kind", "taskId", "requestedModel", "receipt"]);
    invariant(task(observation.taskId) && observation.requestedModel === mapping.transport.model && (!attempt.taskId || attempt.taskId === observation.taskId), "VIGGLE_H3_EXECUTION_CONFLICT", "Accepted task belongs to another model");
  } else {
    viggleH3Fields(observation, observation.kind === "rejected" ? ["kind", "certainty", "source", "error", "receipt"] : ["kind", "error", "receipt"]);
    invariant(observation.kind === "unknown" || (observation.kind === "rejected" && observation.certainty === "not_accepted" && ["local", "provider"].includes(observation.source)), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid H3 submit state");
    diagnostic(observation.error);
  }
  receipt(observation.receipt);
}
export function viggleH3CompletedObservationId(attemptId: string, outputReceiptId: string): string { return digest({ attemptId, outputReceiptId }); }
export function viggleH3ObservationId(attemptId: string, observation: ViggleH3PollObservation): string {
  return observation.kind === "completed" ? viggleH3CompletedObservationId(attemptId, observation.outputReceiptId) : digest({ attemptId, observation });
}
export function assertViggleH3ExecutionObservation(attempt: Attempt, mapping: ViggleH3ExecutionMapping, dispatch: ViggleH3ExecutionDispatch,
  submit: ViggleH3ExecutionSubmit, value: ViggleH3ExecutionObservation, output?: OutputReceipt): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"], true);
  assertViggleH3ExecutionSubmit(attempt, mapping, dispatch, submit);
  const observation = value.observation;
  invariant(submit.observation.kind === "accepted" && value.mappingDigest === digest(mapping) && value.dispatchDigest === digest(dispatch)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER) && value.id === viggleH3ObservationId(attempt.id, observation)
    && observation.taskId === submit.observation.taskId && (!attempt.taskId || attempt.taskId === observation.taskId),
  "VIGGLE_H3_EXECUTION_CONFLICT", "Polling observation must match the one accepted task");
  if (observation.kind === "pending") {
    viggleH3Fields(observation, ["kind", "taskId", "status", "receipt"]); invariant(["queued", "processing"].includes(observation.status), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid pending task status");
  } else if (observation.kind === "failed" || observation.kind === "unknown") {
    viggleH3Fields(observation, ["kind", "taskId", "error", "receipt"]); diagnostic(observation.error);
  } else if (observation.kind === "cancelled") viggleH3Fields(observation, ["kind", "taskId", "receipt"]);
  else {
    viggleH3Fields(observation, ["kind", "taskId", "requestedModel", "reportedModel", "reported", "outputReceiptId", "receipt"]);
    invariant(observation.kind === "completed" && observation.requestedModel === mapping.transport.model && observation.reportedModel === null
      && output && output.id === observation.outputReceiptId && output.projectId === attempt.projectId && output.attemptId === attempt.id
      && output.requestDigest === value.requestDigest && output.vendorTaskId === observation.taskId && output.kind === "video"
      && output.port === "video" && output.mimeType === "video/mp4" && output.source.kind === "protected_locator" && output.source.expiresAt === null
      && output.diagnosticRequestId === observation.receipt.requestId,
    "VIGGLE_H3_EXECUTION_CONFLICT", "Completed H3 observation must bind its protected output receipt");
    assertOutputReceiptIdentity(output, attempt);
    viggleH3Fields(observation.reported, ["seed"]);
    invariant(observation.reported.seed === null || integer(observation.reported.seed, 0, Number.MAX_SAFE_INTEGER), "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid Viggle reported seed");
  }
  receipt(observation.receipt);
}
export function assertViggleH3PollPolicy(value: ViggleH3PollPolicy): void {
  viggleH3Fields(value, ["initialMs", "maximumMs", "retryAfterMaximumMs", "claimMs"]);
  invariant(integer(value.initialMs, 1000, 15000) && integer(value.maximumMs, value.initialMs, 60000)
    && integer(value.retryAfterMaximumMs, value.maximumMs, 86400000) && integer(value.claimMs, 301001, 421000),
  "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid trusted H3 polling policy");
}
export function assertViggleH3PollSchedule(attempt: Attempt, submit: ViggleH3ExecutionSubmit, value: ViggleH3PollSchedule): void {
  base(attempt, value, ["taskId", "policy", "count", "nextPollAt", "claimId", "lastObservationId"]);
  assertViggleH3PollPolicy(value.policy);
  invariant(submit.observation.kind === "accepted" && submit.observation.taskId === value.taskId
    && integer(value.count, 0, Number.MAX_SAFE_INTEGER) && integer(value.nextPollAt, 0, Number.MAX_SAFE_INTEGER)
    && (value.claimId === null || id(value.claimId)) && (value.lastObservationId === null || viggleH3Hash(value.lastObservationId)),
  "VIGGLE_H3_EXECUTION_CONFLICT", "Poll schedule must retain its exact accepted task");
}
