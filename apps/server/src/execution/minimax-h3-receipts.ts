import { canonical, digest, invariant } from "@openslate/core";
import { MINIMAX_H3_ADAPTER_VERSION, miniMaxH3MetadataDigest } from "@openslate/providers";
import type { MiniMaxH3Description, MiniMaxH3Diagnostic, MiniMaxH3PollResult, MiniMaxH3SubmitResult } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import type { OutputReceipt } from "./output-store.js";

interface Identity { id: string; version: 1; projectId: string; attemptId: string; requestDigest: string }
export interface H3ExecutionMapping extends Identity {
  profileDigest: string; externalAllowanceId: string; firstFrameArtifactId: string; transport: MiniMaxH3Description;
}
export interface H3ExecutionDispatch extends Identity { mappingDigest: string; bodySha256: string; externalAllowanceId: string; createdAt: number }
export type H3SubmitObservation = MiniMaxH3SubmitResult | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" };
export interface H3ExecutionSubmit extends Identity {
  mappingDigest: string | null; dispatchDigest: string | null; observedAt: number; observation: H3SubmitObservation;
}
type Completed = Extract<MiniMaxH3PollResult, { kind: "completed" }>;
export type H3PollObservation = Exclude<MiniMaxH3PollResult, Completed> | (Omit<Completed, "output"> & { outputReceiptId: string });
export interface H3ExecutionObservation extends Identity {
  mappingDigest: string; dispatchDigest: string; observedAt: number; observation: H3PollObservation;
}
export interface H3PollPolicy { initialMs: number; maximumMs: number; retryAfterMaximumMs: number; claimMs: number }
export interface H3PollSchedule extends Identity {
  taskId: string; policy: H3PollPolicy; count: number; nextPollAt: number; claimId: string | null; lastObservationId: string | null;
}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const h3Hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export function h3Fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  invariant(object(value) && Object.keys(value).every(key => keys.includes(key)), "H3_EXECUTION_CONFLICT", "Unsupported H3 receipt fields");
}
function base(attempt: Attempt, value: Identity, extras: string[], observation = false): void {
  h3Fields(value, ["id", "version", "projectId", "attemptId", "requestDigest", ...extras]);
  invariant(value.version === 1 && (observation ? h3Hash(value.id) : value.id === attempt.id) && value.projectId === attempt.projectId
    && value.attemptId === attempt.id && value.requestDigest === digest(attempt.request) && attempt.request.kind === "video"
    && attempt.request.execution?.adapter === "minimax-h3" && attempt.request.execution.version === "1"
    && typeof attempt.request.externalAllowanceId === "string" && h3Hash(attempt.request.profile?.digest)
    && Buffer.byteLength(canonical(value)) <= 16384, "H3_EXECUTION_CONFLICT", "H3 receipt differs from its exact admitted request");
}
export function assertH3ExecutionMapping(attempt: Attempt, mapping: H3ExecutionMapping): void {
  base(attempt, mapping, ["profileDigest", "externalAllowanceId", "firstFrameArtifactId", "transport"]);
  const request = attempt.request, config = request.profile!.configuration, description = mapping.transport;
  h3Fields(config, ["model", "settings"]); h3Fields(config.settings, ["resolution"]);
  h3Fields(request.args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "prompt", "durationFrames", "frameRate", "settings"]);
  h3Fields(request.args.settings, []);
  h3Fields(description, ["adapterVersion", "model", "durationSeconds", "resolution", "firstFrame", "requestDigest", "bodySha256"]);
  invariant(["MiniMax-H3", "MiniMax-H3-Max"].includes(config.model)
    && description.model === config.model && description.adapterVersion === MINIMAX_H3_ADAPTER_VERSION
    && description.resolution === config.settings.resolution
    && (config.model === "MiniMax-H3" ? ["768P", "2K"] : ["480P", "768P"]).includes(description.resolution)
    && integer(description.durationSeconds, config.model === "MiniMax-H3" ? 4 : 5, 15)
    && request.args.durationFrames === description.durationSeconds * 30
    && canonical(request.args.frameRate) === canonical({ numerator: 30, denominator: 1 })
    && typeof request.args.prompt === "string" && request.args.prompt.trim().length > 0 && Buffer.byteLength(request.args.prompt) <= 32768
    && mapping.profileDigest === request.profile!.digest && mapping.externalAllowanceId === request.externalAllowanceId
    && request.inputs.length === 1 && request.inputs[0]!.kind === "image" && mapping.firstFrameArtifactId === request.inputs[0]!.artifactId,
  "H3_EXECUTION_CONFLICT", "H3 mapping must preserve the pinned model, exact duration and reviewed first frame");
  const image = description.firstFrame; h3Fields(image, ["sha256", "width", "height", "byteLength", "mediaType", "transport"]);
  invariant(image.sha256 === request.inputs[0]!.sha256 && h3Hash(image.sha256) && image.mediaType === "image/png" && image.transport === "data_url"
    && integer(image.width, 256, 5760) && integer(image.height, 256, 5760) && image.width / image.height >= 0.4 && image.width / image.height <= 2.5
    && integer(image.byteLength, 33, 30_000_000) && h3Hash(description.bodySha256)
    && description.requestDigest === miniMaxH3MetadataDigest(request.args.prompt, description),
  "H3_EXECUTION_CONFLICT", "H3 transport metadata differs from its exact owned PNG");
  // The body hash includes encoded bytes: Store cannot reconstruct it from an artifact hash alone.
}
export function assertH3ExecutionDispatch(attempt: Attempt, mapping: H3ExecutionMapping, dispatch: H3ExecutionDispatch): void {
  base(attempt, dispatch, ["mappingDigest", "bodySha256", "externalAllowanceId", "createdAt"]); assertH3ExecutionMapping(attempt, mapping);
  invariant(dispatch.mappingDigest === digest(mapping) && dispatch.bodySha256 === mapping.transport.bodySha256
    && dispatch.externalAllowanceId === mapping.externalAllowanceId && integer(dispatch.createdAt, 0, Number.MAX_SAFE_INTEGER),
  "H3_EXECUTION_CONFLICT", "H3 dispatch marker differs from its prepared mapping");
}
function diagnostic(value: MiniMaxH3Diagnostic): void {
  h3Fields(value, ["code", "category", "httpStatus", "requestId", "retryAfterSeconds"]);
  invariant(typeof value.code === "string" && /^H3_[A-Z0-9_]{1,95}$/.test(value.code)
    && ["invalid_input", "auth", "quota", "policy", "throttled", "transport", "protocol", "aborted", "provider_failure"].includes(value.category)
    && (value.httpStatus === undefined || integer(value.httpStatus, 100, 599)) && (value.requestId === undefined || id(value.requestId))
    && (value.retryAfterSeconds === undefined || integer(value.retryAfterSeconds, 0, 86400)), "H3_EXECUTION_CONFLICT", "Invalid redacted H3 diagnostic");
}
export function assertH3ExecutionSubmit(attempt: Attempt, mapping: H3ExecutionMapping | undefined, dispatch: H3ExecutionDispatch | undefined, value: H3ExecutionSubmit): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"]);
  if (mapping) assertH3ExecutionMapping(attempt, mapping);
  if (dispatch) { invariant(mapping, "H3_EXECUTION_CONFLICT", "Dispatch lacks its mapping"); assertH3ExecutionDispatch(attempt, mapping, dispatch); }
  invariant(value.mappingDigest === (mapping ? digest(mapping) : null) && value.dispatchDigest === (dispatch ? digest(dispatch) : null)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER), "H3_EXECUTION_CONFLICT", "H3 submission observation lost its dispatch identity");
  const observation = value.observation; invariant(object(observation), "H3_EXECUTION_CONFLICT", "Invalid H3 submission observation");
  if (observation.kind === "not_dispatched") {
    h3Fields(observation, ["kind", "code"]);
    invariant(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED"].includes(observation.code),
      "H3_EXECUTION_CONFLICT", "Only a pre-dispatch failure can prove no submission"); return;
  }
  invariant(mapping && dispatch, "H3_EXECUTION_CONFLICT", "Provider observation requires a persisted dispatch");
  if (observation.kind === "accepted") {
    h3Fields(observation, ["kind", "taskId", "requestedModel"]);
    invariant(id(observation.taskId) && observation.requestedModel === mapping.transport.model, "H3_EXECUTION_CONFLICT", "Accepted task belongs to another model");
  } else {
    h3Fields(observation, observation.kind === "rejected" ? ["kind", "certainty", "error"] : ["kind", "error"]);
    invariant(observation.kind === "unknown" || (observation.kind === "rejected" && observation.certainty === "not_accepted"), "H3_EXECUTION_CONFLICT", "Invalid H3 submit state");
    diagnostic(observation.error);
  }
}
export function h3ObservationId(attemptId: string, observation: H3PollObservation): string { return digest({ attemptId, observation }); }
export function assertH3ExecutionObservation(attempt: Attempt, mapping: H3ExecutionMapping, dispatch: H3ExecutionDispatch,
  submit: H3ExecutionSubmit, value: H3ExecutionObservation, output?: OutputReceipt): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"], true);
  assertH3ExecutionSubmit(attempt, mapping, dispatch, submit);
  const observation = value.observation;
  invariant(submit.observation.kind === "accepted" && value.mappingDigest === digest(mapping) && value.dispatchDigest === digest(dispatch)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER) && value.id === h3ObservationId(attempt.id, observation)
    && observation.taskId === submit.observation.taskId && (!attempt.taskId || attempt.taskId === observation.taskId),
  "H3_EXECUTION_CONFLICT", "Polling observation must match the one accepted task");
  if (observation.kind === "pending") {
    h3Fields(observation, ["kind", "taskId", "status"]); invariant(["queued", "running"].includes(observation.status), "H3_EXECUTION_CONFLICT", "Invalid pending task status");
  } else if (observation.kind === "failed" || observation.kind === "unknown") {
    h3Fields(observation, ["kind", "taskId", "error"]); diagnostic(observation.error);
  } else if (observation.kind === "cancelled") h3Fields(observation, ["kind", "taskId"]);
  else {
    h3Fields(observation, ["kind", "taskId", "requestedModel", "reportedModel", "reported", "outputReceiptId"]);
    invariant(observation.kind === "completed" && observation.requestedModel === mapping.transport.model && observation.reportedModel === mapping.transport.model
      && output && output.id === observation.outputReceiptId && output.projectId === attempt.projectId && output.attemptId === attempt.id
      && output.requestDigest === value.requestDigest && output.vendorTaskId === observation.taskId && output.kind === "video"
      && output.port === "video" && output.mimeType === "video/mp4" && output.source.kind === "protected_locator",
    "H3_EXECUTION_CONFLICT", "Completed H3 observation must bind its protected output receipt");
    h3Fields(observation.reported, ["durationSeconds", "resolution", "ratio", "usage"]);
    const reported = observation.reported;
    invariant((reported.durationSeconds === null || (Number.isFinite(reported.durationSeconds) && reported.durationSeconds > 0))
      && (reported.resolution === null || ["480P", "768P", "2K"].includes(reported.resolution))
      && (reported.ratio === null || ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(reported.ratio)), "H3_EXECUTION_CONFLICT", "Invalid reported H3 measurements");
    if (reported.usage !== null) {
      h3Fields(reported.usage, ["total_seconds", "input_seconds", "output_seconds", "input_image_count", "input_audio_seconds", "total_tokens", "prompt_tokens", "completion_tokens"]);
      invariant(Object.values(reported.usage).every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER),
        "H3_EXECUTION_CONFLICT", "Invalid H3 reported usage");
    }
  }
}
export function assertH3PollPolicy(value: H3PollPolicy): void {
  h3Fields(value, ["initialMs", "maximumMs", "retryAfterMaximumMs", "claimMs"]);
  invariant(integer(value.initialMs, 1000, 15000) && integer(value.maximumMs, value.initialMs, 60000)
    && integer(value.retryAfterMaximumMs, value.maximumMs, 86400000) && integer(value.claimMs, 301001, 421000),
  "H3_EXECUTION_CONFLICT", "Invalid trusted H3 polling policy");
}
export function assertH3PollSchedule(attempt: Attempt, submit: H3ExecutionSubmit, value: H3PollSchedule): void {
  base(attempt, value, ["taskId", "policy", "count", "nextPollAt", "claimId", "lastObservationId"]);
  assertH3PollPolicy(value.policy);
  invariant(submit.observation.kind === "accepted" && submit.observation.taskId === value.taskId
    && integer(value.count, 0, Number.MAX_SAFE_INTEGER) && integer(value.nextPollAt, 0, Number.MAX_SAFE_INTEGER)
    && (value.claimId === null || id(value.claimId)) && (value.lastObservationId === null || h3Hash(value.lastObservationId)),
  "H3_EXECUTION_CONFLICT", "Poll schedule must retain its exact accepted task");
}
