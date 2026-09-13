import { canonical, digest, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ExecutionRequest, OpenAISpeechDescription, OpenAISpeechOutcome, OpenAISpeechRequest } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import { assertOutputReceiptIdentity } from "./output-store.js";
import type { OutputReceipt } from "./output-store.js";
import { prepareSpeechOperationOptions } from "./audio-preflight.js";

interface Identity { id: string; projectId: string; version: 1; attemptId: string; requestDigest: string }
export interface SpeechExecutionMapping extends Identity {
  profileDigest: string; profileDefinitionDigest: string; profileDefinition: ProviderProfile;
  /** A retained matching definition, not proof of the originating admission lock. */
  capabilityLockId: string; capabilityLockDigest: string;
  allowanceId: string; allowanceDigest: string; consumptionDigest: string; estimatedMicros: string;
  transport: OpenAISpeechDescription; bodyByteLength: number;
}
export interface SpeechExecutionDispatch extends Identity {
  mappingDigest: string; transportDigest: string; bodySha256: string; allowanceId: string; createdAt: string;
}
type Completed = Extract<OpenAISpeechOutcome, { kind: "completed" }>;
export type SpeechExecutionObservation = Exclude<OpenAISpeechOutcome, Completed>
  | { kind: "completed"; receipt: Completed["receipt"]; reportedModel: null; result: Omit<Completed["result"], "bytes">; outputReceiptId: string }
  | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" };
export interface SpeechExecutionResult extends Identity { mappingDigest: string | null; dispatchDigest: string | null; observation: SpeechExecutionObservation }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
export function speechFields(value: unknown, fields: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && fields.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => typeof key === "string" && [...fields, ...optional].includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")),
  "SPEECH_EXECUTION_CONFLICT", "Unsupported speech execution fields");
}
function base(attempt: Attempt, value: Identity, extras: string[]): void {
  speechFields(value, ["id", "projectId", "version", "attemptId", "requestDigest", ...extras]);
  invariant(value.version === 1 && value.id === attempt.id && value.projectId === attempt.projectId && value.attemptId === attempt.id
    && value.requestDigest === digest(attempt.request) && attempt.request.kind === "speech" && attempt.request.execution?.adapter === "openai-speech"
    && attempt.request.execution.version === "1" && id(attempt.request.externalAllowanceId) && hash(attempt.request.profile?.digest)
    && Buffer.byteLength(canonical(value)) <= 32768, "SPEECH_EXECUTION_CONFLICT", "Speech record differs from its exact admitted request");
}

/** Speech-only operation validation is separate from admission so owned local input failures can be recorded. */
export function prepareSpeechExecutionRequest(input: ExecutionRequest): { request: OpenAISpeechRequest; description: OpenAISpeechDescription; bodyByteLength: number } {
  const request = structuredClone(input);
  speechFields(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", "externalAllowanceId"]);
  invariant(request.kind === "speech" && request.execution?.adapter === "openai-speech" && request.execution.version === "1"
    && request.inputs.length === 0, "SPEECH_EXECUTION_CONFLICT", "Speech has no media inputs or custom transport overrides");
  return prepareSpeechOperationOptions(request.profile!.configuration, request.args);
}

export function assertSpeechExecutionProfile(profile: ProviderProfile, attempt: Attempt): void {
  speechFields(profile, ["id", "revision", "kind", "adapter", "executionVersion", "configuration", "maxConcurrency", "unitCostMicros", "maxRetries"]);
  const args = providerProfileArguments(profile), saved = attempt.request.profile;
  speechFields(saved, ["id", "revision", "configuration", "digest"]);
  invariant(profile.kind === "speech" && profile.adapter === "openai-speech" && profile.executionVersion === "1"
    && saved && saved.id === profile.id && saved.revision === profile.revision && saved.digest === args.profileDigest
    && canonical(saved.configuration) === canonical(profile.configuration)
    && Object.entries(args).every(([key, value]) => canonical(attempt.request.args[key]) === canonical(value))
    && integer(profile.maxConcurrency, 1, 64) && integer(profile.maxRetries, 0, 3) && typeof profile.unitCostMicros === "string",
  "SPEECH_EXECUTION_CONFLICT", "Speech requires the exact full approved profile definition");
  moneyMicros(profile.unitCostMicros);
}
export function assertSpeechExecutionMapping(attempt: Attempt, mapping: SpeechExecutionMapping): void {
  base(attempt, mapping, ["profileDigest", "profileDefinitionDigest", "profileDefinition", "capabilityLockId", "capabilityLockDigest",
    "allowanceId", "allowanceDigest", "consumptionDigest", "estimatedMicros", "transport", "bodyByteLength"]);
  assertSpeechExecutionProfile(mapping.profileDefinition, attempt);
  const prepared = prepareSpeechExecutionRequest(attempt.request);
  invariant(mapping.profileDigest === attempt.request.profile!.digest && mapping.profileDefinitionDigest === digest(mapping.profileDefinition)
    && id(mapping.capabilityLockId) && hash(mapping.capabilityLockDigest) && mapping.allowanceId === attempt.request.externalAllowanceId
    && hash(mapping.allowanceDigest) && hash(mapping.consumptionDigest) && mapping.estimatedMicros === mapping.profileDefinition.unitCostMicros
    && canonical(mapping.transport) === canonical(prepared.description) && mapping.bodyByteLength === prepared.bodyByteLength,
  "SPEECH_EXECUTION_CONFLICT", "Speech mapping differs from its approved profile or exact wire payload");
}
export function assertSpeechExecutionDispatch(attempt: Attempt, mapping: SpeechExecutionMapping, dispatch: SpeechExecutionDispatch): void {
  base(attempt, dispatch, ["mappingDigest", "transportDigest", "bodySha256", "allowanceId", "createdAt"]);
  assertSpeechExecutionMapping(attempt, mapping);
  invariant(dispatch.mappingDigest === digest(mapping) && dispatch.transportDigest === mapping.transport.requestDigest
    && dispatch.bodySha256 === mapping.transport.bodySha256 && dispatch.allowanceId === mapping.allowanceId
    && typeof dispatch.createdAt === "string" && dispatch.createdAt.length === 24 && Number.isFinite(Date.parse(dispatch.createdAt))
    && new Date(dispatch.createdAt).toISOString() === dispatch.createdAt, "SPEECH_EXECUTION_CONFLICT", "Speech dispatch differs from its exact mapping");
}
export function assertSpeechExecutionResult(attempt: Attempt, mapping: SpeechExecutionMapping | undefined, dispatch: SpeechExecutionDispatch | undefined,
  result: SpeechExecutionResult, output?: OutputReceipt): void {
  base(attempt, result, ["mappingDigest", "dispatchDigest", "observation"]);
  if (mapping) assertSpeechExecutionMapping(attempt, mapping);
  if (dispatch) { invariant(mapping, "SPEECH_EXECUTION_CONFLICT", "Dispatch requires its mapping"); assertSpeechExecutionDispatch(attempt, mapping, dispatch); }
  invariant(result.mappingDigest === (mapping ? digest(mapping) : null) && result.dispatchDigest === (dispatch ? digest(dispatch) : null),
    "SPEECH_EXECUTION_CONFLICT", "Speech outcome lost its immutable mapping or dispatch");
  const value = result.observation;
  if (value?.kind === "not_dispatched") {
    speechFields(value, ["kind", "code"]);
    invariant(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED"].includes(value.code),
      "SPEECH_EXECUTION_CONFLICT", "Only a pre-dispatch local failure proves no submission"); return;
  }
  invariant(mapping && dispatch && value && ["completed", "rejected", "unknown"].includes(value.kind), "SPEECH_EXECUTION_CONFLICT", "Provider observations require a durable dispatch");
  const receipt = value.receipt;
  speechFields(receipt, ["adapter", "attemptId", "requestDigest", "bodySha256", "requestedModel", "requestId", "httpStatus"]);
  invariant(receipt.adapter === "openai-speech-v1" && receipt.attemptId === attempt.id && receipt.requestDigest === mapping.transport.requestDigest
    && receipt.bodySha256 === mapping.transport.bodySha256 && receipt.requestedModel === mapping.transport.model
    && (receipt.requestId === null || id(receipt.requestId)) && (receipt.httpStatus === null || integer(receipt.httpStatus, 100, 599)),
  "SPEECH_EXECUTION_CONFLICT", "Speech provider receipt differs from its exact wire identity");
  if (value.kind !== "completed") {
    speechFields(value, value.kind === "unknown" ? ["kind", "code", "receipt", "retryAfterMs"] : ["kind", "certainty", "source", "code", "receipt", "retryAfterMs"]);
    invariant(typeof value.code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.code)
      && (value.retryAfterMs === null || integer(value.retryAfterMs, 0, 600000))
      && (value.kind === "unknown" || (value.certainty === "not_accepted" && ["local", "provider"].includes(value.source))),
    "SPEECH_EXECUTION_CONFLICT", "Invalid redacted speech observation"); return;
  }
  speechFields(value, ["kind", "receipt", "reportedModel", "result", "outputReceiptId"]);
  speechFields(value.result, ["sha256", "byteLength", "mimeType", "extension", "fixture", "usage"]);
  invariant(value.reportedModel === null && value.result.usage === null && hash(value.result.sha256) && integer(value.result.byteLength, 12, 32 * 1024 ** 2)
    && value.result.mimeType === "audio/wav" && value.result.extension === "wav" && value.result.fixture === false,
  "SPEECH_EXECUTION_CONFLICT", "Invalid exact raw speech result metadata");
  invariant(output, "SPEECH_EXECUTION_CONFLICT", "Completed speech requires its raw returned-byte receipt"); assertOutputReceiptIdentity(output, attempt);
  invariant(output.id === value.outputReceiptId && output.port === "audio" && output.kind === "audio" && output.mimeType === "audio/wav"
    && output.vendorTaskId === null && output.diagnosticRequestId === receipt.requestId && output.source.kind === "returned_bytes"
    && output.source.sha256 === value.result.sha256 && output.source.byteLength === value.result.byteLength,
  "SPEECH_EXECUTION_CONFLICT", "Speech result differs from its exact raw output receipt");
}
