import { externalAllowanceMatches, providerAdmissionRequest } from "./provider-use.js";
import { canonical, digest, invariant } from "@openslate/core";
import { FAL_H3_LIPSYNC_ADAPTER_VERSION, FAL_H3_LIPSYNC_MODEL, FAL_H3_LIPSYNC_RESOLUTIONS, falH3LipSyncMetadataDigest } from "@openslate/providers";
import type { FalDiagnostic, FalH3LipSyncDescription, FalH3LipSyncPollResult, FalH3LipSyncSubmitResult, FalReceipt } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import type { OutputReceipt } from "./output-store.js";
import { assertLipSyncSettings, lipSyncAudioSamples } from "./lip-sync.js";
import type { LipSyncSettings } from "./lip-sync.js";

/** Durable fal lip-sync receipts, one family per attempt, modeled on the MiniMax and Viggle H3 receipts. */
export const FAL_LIPSYNC_KINDS = Object.freeze(["fal_lipsync_execution_mapping", "fal_lipsync_execution_dispatch", "fal_lipsync_execution_submit",
  "fal_lipsync_execution_observation", "fal_lipsync_poll_schedule"] as const);
interface Identity { id: string; version: 1; projectId: string; attemptId: string; requestDigest: string }
export interface FalLipSyncMapping extends Identity {
  profileDigest: string; externalAllowanceId: string | null; firstFrameArtifactId: string; lipSync: LipSyncSettings; transport: FalH3LipSyncDescription;
}
/** Written before the queue POST. Its presence means the POST may have reached fal. */
export interface FalLipSyncDispatch extends Identity { mappingDigest: string; bodySha256: string; externalAllowanceId: string | null; createdAt: number }
export type FalLipSyncSubmitObservation = FalH3LipSyncSubmitResult
  | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" | "LOCAL_UPLOAD_FAILED"; error?: FalDiagnostic };
export interface FalLipSyncSubmit extends Identity {
  mappingDigest: string | null; dispatchDigest: string | null; observedAt: number; observation: FalLipSyncSubmitObservation;
}
type Completed = Extract<FalH3LipSyncPollResult, { kind: "completed" }>;
export type FalLipSyncPollObservation = Exclude<FalH3LipSyncPollResult, Completed> | (Omit<Completed, "output"> & { outputReceiptId: string });
export interface FalLipSyncObservation extends Identity {
  mappingDigest: string; dispatchDigest: string; observedAt: number; observation: FalLipSyncPollObservation;
}
export interface FalLipSyncPollPolicy { initialMs: number; maximumMs: number; retryAfterMaximumMs: number; claimMs: number }
export interface FalLipSyncPollSchedule extends Identity {
  taskId: string; policy: FalLipSyncPollPolicy; count: number; nextPollAt: number; claimId: string | null; lastObservationId: string | null;
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export const falHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const FAL_TASK = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const fail = (condition: unknown, message: string): void => invariant(condition, "FAL_LIPSYNC_EXECUTION_CONFLICT", message);
export function falFields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  invariant(object(value) && Object.keys(value).every(key => keys.includes(key)), "FAL_LIPSYNC_EXECUTION_CONFLICT", "Unsupported fal receipt fields");
}

/** Pure admission-time policy for one lip-sync video node. */
export function assertFalLipSyncOperationOptions(profile: { kind: string; adapter: string; minFrames?: number; maxFrames?: number; configuration?: { model: string; settings?: Record<string, unknown> } }, args: Record<string, unknown>): void {
  const config = profile.configuration;
  falFields(config, ["model", "settings"]); falFields(config.settings, ["resolution"]);
  fail(profile.kind === "video" && profile.adapter === "fal-h3-lipsync" && config.model === FAL_H3_LIPSYNC_MODEL
    && FAL_H3_LIPSYNC_RESOLUTIONS.includes(config.settings!.resolution as never)
    && integer(args.durationFrames, Math.max(150, profile.minFrames ?? 150), Math.min(450, profile.maxFrames ?? 450)) && Number(args.durationFrames) % 30 === 0
    && canonical(args.frameRate) === canonical({ numerator: 30, denominator: 1 }), "Lip sync needs the pinned H3 Max model and whole seconds from 5 to 15");
  assertLipSyncSettings(args.settings);
  fail(args.settings.lipSync.clipSamples === lipSyncAudioSamples(Number(args.durationFrames)), "Lip-sync audio must cover the exact clip");
}

function base(attempt: Attempt, value: Identity, extras: string[], observation = false): void {
  falFields(value, ["id", "version", "projectId", "attemptId", "requestDigest", ...extras]);
  fail(value.version === 1 && (observation ? falHash(value.id) : value.id === attempt.id) && value.projectId === attempt.projectId
    && value.attemptId === attempt.id && value.requestDigest === digest(attempt.request) && attempt.request.kind === "video"
    && attempt.request.execution?.adapter === "fal-h3-lipsync" && attempt.request.execution.version === "1"
    && providerAdmissionRequest(attempt.request) && falHash(attempt.request.profile?.digest)
    && Buffer.byteLength(canonical(value)) <= 16384, "fal receipt differs from its exact admitted request");
}
export function assertFalLipSyncMapping(attempt: Attempt, mapping: FalLipSyncMapping): void {
  base(attempt, mapping, ["profileDigest", "externalAllowanceId", "firstFrameArtifactId", "lipSync", "transport"]);
  const request = attempt.request, config = request.profile!.configuration, description = mapping.transport;
  falFields(request.args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "prompt", "durationFrames", "frameRate", "settings"]);
  assertLipSyncSettings(request.args.settings);
  falFields(description, ["adapterVersion", "model", "resolution", "enableTranscription", "image", "audio", "audioSeconds", "requestDigest"]);
  fail(description.adapterVersion === FAL_H3_LIPSYNC_ADAPTER_VERSION && description.model === FAL_H3_LIPSYNC_MODEL && config.model === FAL_H3_LIPSYNC_MODEL
    && description.resolution === (config.settings as Record<string, unknown>).resolution && description.enableTranscription === false
    && canonical(mapping.lipSync) === canonical(request.args.settings.lipSync) && description.audio.samples === mapping.lipSync.clipSamples
    && description.audioSeconds === mapping.lipSync.clipSamples / 48000
    && mapping.profileDigest === request.profile!.digest && externalAllowanceMatches(request, mapping.externalAllowanceId)
    && request.inputs.length === 1 && request.inputs[0]!.kind === "image" && mapping.firstFrameArtifactId === request.inputs[0]!.artifactId
    && description.image.sha256 === request.inputs[0]!.sha256 && description.requestDigest === falH3LipSyncMetadataDigest(description),
  "fal mapping must preserve the pinned model, the reviewed keyframe and the exact song window");
}
export function assertFalLipSyncDispatch(attempt: Attempt, mapping: FalLipSyncMapping, dispatch: FalLipSyncDispatch): void {
  base(attempt, dispatch, ["mappingDigest", "bodySha256", "externalAllowanceId", "createdAt"]); assertFalLipSyncMapping(attempt, mapping);
  fail(dispatch.mappingDigest === digest(mapping) && falHash(dispatch.bodySha256) && dispatch.externalAllowanceId === mapping.externalAllowanceId
    && integer(dispatch.createdAt, 0, Number.MAX_SAFE_INTEGER), "fal dispatch marker differs from its prepared mapping");
}
function diagnostic(value: FalDiagnostic): void {
  falFields(value, ["code", "category", "errorType", "retryAfterMs"]);
  fail(typeof value.code === "string" && /^FAL_[A-Z0-9_]{1,95}$/.test(value.code)
    && ["invalid_input", "auth", "quota", "policy", "throttled", "transport", "protocol", "aborted", "provider_failure"].includes(value.category)
    && (value.errorType === undefined || typeof value.errorType === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value.errorType))
    && (value.retryAfterMs === undefined || integer(value.retryAfterMs, 0, 86_400_000)), "Invalid redacted fal diagnostic");
}
function receipt(value: FalReceipt): void {
  falFields(value, ["requestId", "httpStatus"]);
  fail((value.requestId === null || typeof value.requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.requestId))
    && (value.httpStatus === null || integer(value.httpStatus, 100, 599)), "Invalid fal HTTP receipt");
}
export function assertFalLipSyncSubmit(attempt: Attempt, mapping: FalLipSyncMapping | undefined, dispatch: FalLipSyncDispatch | undefined, value: FalLipSyncSubmit): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"]);
  if (mapping) assertFalLipSyncMapping(attempt, mapping);
  if (dispatch) { fail(mapping, "Dispatch lacks its mapping"); assertFalLipSyncDispatch(attempt, mapping!, dispatch); }
  fail(value.mappingDigest === (mapping ? digest(mapping) : null) && value.dispatchDigest === (dispatch ? digest(dispatch) : null)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER), "fal submission observation lost its dispatch identity");
  const observation = value.observation; fail(object(observation), "Invalid fal submission observation");
  if (observation.kind === "not_dispatched") {
    falFields(observation, ["kind", "code", "error"]);
    fail(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED", "LOCAL_UPLOAD_FAILED"].includes(observation.code),
      "Only a pre-dispatch failure can prove no submission");
    if (observation.error) diagnostic(observation.error); return;
  }
  fail(mapping && dispatch, "Provider observation requires a persisted dispatch");
  receipt(observation.receipt);
  if (observation.kind === "accepted") { falFields(observation, ["kind", "taskId", "receipt"]); fail(FAL_TASK.test(observation.taskId), "Invalid fal request id"); }
  else {
    falFields(observation, observation.kind === "rejected" ? ["kind", "certainty", "error", "receipt"] : ["kind", "error", "receipt"]);
    fail(observation.kind === "unknown" || observation.kind === "rejected" && observation.certainty === "not_accepted", "Invalid fal submit state");
    diagnostic(observation.error);
  }
}
export function falObservationId(attemptId: string, observation: FalLipSyncPollObservation): string {
  // HTTP trace ids are not task state: the same answer seen twice is one observation.
  const { receipt: _receipt, ...state } = observation as FalLipSyncPollObservation & { receipt?: unknown };
  return digest({ attemptId, observation: state });
}
export function assertFalLipSyncObservation(attempt: Attempt, mapping: FalLipSyncMapping, dispatch: FalLipSyncDispatch,
  submit: FalLipSyncSubmit, value: FalLipSyncObservation, output?: OutputReceipt): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observedAt", "observation"], true);
  assertFalLipSyncSubmit(attempt, mapping, dispatch, submit);
  const observation = value.observation;
  fail(submit.observation.kind === "accepted" && value.mappingDigest === digest(mapping) && value.dispatchDigest === digest(dispatch)
    && integer(value.observedAt, 0, Number.MAX_SAFE_INTEGER) && value.id === falObservationId(attempt.id, observation)
    && observation.taskId === submit.observation.taskId && (!attempt.taskId || attempt.taskId === observation.taskId),
  "Polling observation must match the one accepted request");
  receipt(observation.receipt);
  if (observation.kind === "pending") {
    falFields(observation, ["kind", "taskId", "status", "receipt"]); fail(["queued", "running"].includes(observation.status), "Invalid pending status");
  } else if (observation.kind === "failed" || observation.kind === "unknown") {
    falFields(observation, ["kind", "taskId", "error", "receipt"]); diagnostic(observation.error);
  } else {
    falFields(observation, ["kind", "taskId", "reported", "outputReceiptId", "receipt"]);
    falFields(observation.reported, ["durationSeconds", "seed"]);
    fail(output && output.id === observation.outputReceiptId && output.projectId === attempt.projectId && output.attemptId === attempt.id
      && output.requestDigest === value.requestDigest && output.vendorTaskId === observation.taskId && output.kind === "video"
      && output.port === "video" && output.mimeType === "video/mp4" && output.source.kind === "protected_locator"
      && (observation.reported.durationSeconds === null || Number.isFinite(observation.reported.durationSeconds) && observation.reported.durationSeconds > 0)
      && (observation.reported.seed === null || Number.isSafeInteger(observation.reported.seed)),
    "Completed fal observation must bind its protected output receipt");
  }
}
export function assertFalLipSyncPollPolicy(value: FalLipSyncPollPolicy): void {
  falFields(value, ["initialMs", "maximumMs", "retryAfterMaximumMs", "claimMs"]);
  fail(integer(value.initialMs, 1000, 15000) && integer(value.maximumMs, value.initialMs, 60000)
    && integer(value.retryAfterMaximumMs, value.maximumMs, 86400000) && integer(value.claimMs, 301001, 421000), "Invalid trusted fal polling policy");
}
export function assertFalLipSyncPollSchedule(attempt: Attempt, submit: FalLipSyncSubmit, value: FalLipSyncPollSchedule): void {
  base(attempt, value, ["taskId", "policy", "count", "nextPollAt", "claimId", "lastObservationId"]);
  assertFalLipSyncPollPolicy(value.policy);
  fail(submit.observation.kind === "accepted" && submit.observation.taskId === value.taskId
    && integer(value.count, 0, Number.MAX_SAFE_INTEGER) && integer(value.nextPollAt, 0, Number.MAX_SAFE_INTEGER)
    && (value.claimId === null || id(value.claimId)) && (value.lastObservationId === null || falHash(value.lastObservationId)),
  "Poll schedule must retain its exact accepted request");
}
