import { createHash } from "node:crypto";
import { canonical, digest, invariant, moneyMicros, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { describeOpenAITranscriptionRequest, validateOpenAITranscriptionOptions } from "@openslate/providers";
import type { ExecutionRequest, OpenAITranscriptionDescription, OpenAITranscriptionOutcome, OpenAITranscriptionRequest, OpenAITranscriptionResult } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import { assertOutputReceiptIdentity } from "./output-store.js";
import type { OutputReceipt } from "./output-store.js";
import { assertTranscriptionAudioReceipt, assertTranscriptionAudioSource, transcriptionAudioId, transcriptionAudioInput } from "./transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt } from "./transcription-audio.js";

export const TRANSCRIPTION_EXECUTION_PARSER = Object.freeze({ adapter: "openai-transcription-v1", version: 1,
  maxResponseBytes: 4 * 1024 ** 2, maxTextBytes: 256 * 1024, maxWords: 8192, maxWordBytes: 1024 } as const);
export interface TranscriptionExecutionPreparation { intent: TranscriptionAudioIntent; receipt: TranscriptionAudioReceipt }
interface Identity { id: string; projectId: string; version: 1; attemptId: string; requestDigest: string }
export interface TranscriptionExecutionMapping extends Identity {
  profileDigest: string; profileDefinitionDigest: string; profileDefinition: ProviderProfile;
  /** Retained matching evidence; consumption does not pin the original admission lock ID. */
  capabilityLockId: string; capabilityLockDigest: string;
  allowanceId: string; allowanceDigest: string; consumptionDigest: string; estimatedMicros: string;
  preparation: { intentId: string; intentDigest: string; receiptId: string; receiptDigest: string };
  source: { record: TranscriptionAudioIntent["sourceRecord"]; descriptor: TranscriptionAudioIntent["source"]; startSample: 0; endSample: number };
  derivative: TranscriptionAudioReceipt["audio"];
  parser: typeof TRANSCRIPTION_EXECUTION_PARSER;
  transport: OpenAITranscriptionDescription;
}
export interface TranscriptionExecutionDispatch extends Identity {
  mappingDigest: string; transportDigest: string; bodySha256: string; allowanceId: string; createdAt: string;
}
export interface CompactTranscriptionResult {
  rawResponseSha256: string; rawResponseByteLength: number; resultDigest: string;
  textBytes: number; wordCount: number; timingIssueCount: number;
  reportedLanguage: string; reportedDurationSeconds: number; usage: OpenAITranscriptionResult["usage"];
}
type Completed = Extract<OpenAITranscriptionOutcome, { kind: "completed" }>;
export type TranscriptionExecutionObservation = Exclude<OpenAITranscriptionOutcome, Completed>
  | { kind: "completed"; receipt: Completed["receipt"]; reportedModel: string | null; result: CompactTranscriptionResult; outputReceiptId: string }
  | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" | "LOCAL_PREPARATION_BUSY" };
export interface TranscriptionExecutionResult extends Identity { mappingDigest: string | null; dispatchDigest: string | null; observation: TranscriptionExecutionObservation }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const text = (value: unknown, max: number): boolean => typeof value === "string" && value.length > 0 && value.length <= max && Buffer.byteLength(value) <= max;
const seconds = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0;
const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPTION_EXECUTION_CONFLICT", message);
export function transcriptionFields(value: unknown, fields: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  fail(value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && fields.every(key => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).every(key => typeof key === "string" && [...fields, ...optional].includes(key)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")), "Unsupported transcription execution fields");
}
function base(attempt: Attempt, value: Identity, extras: string[]): void {
  transcriptionFields(value, ["id", "projectId", "version", "attemptId", "requestDigest", ...extras]);
  fail(value.version === 1 && value.id === attempt.id && value.projectId === attempt.projectId && value.attemptId === attempt.id
    && value.requestDigest === digest(attempt.request) && attempt.request.kind === "transcription"
    && attempt.request.execution?.adapter === "openai-transcription" && attempt.request.execution.version === "1"
    && id(attempt.request.externalAllowanceId) && hash(attempt.request.profile?.digest) && Buffer.byteLength(canonical(value)) <= 32768,
  "Transcription record differs from its exact admitted request");
}

/** No source lookup or conversion. Invalid operation options remain a definite pre-dispatch error. */
export function transcriptionExecutionOptions(input: ExecutionRequest): Pick<OpenAITranscriptionRequest, "model" | "language" | "timing"> {
  const request = structuredClone(input);
  transcriptionFields(request, ["attemptId", "nodeId", "kind", "fingerprint", "args", "inputs", "execution", "profile", "externalAllowanceId"]);
  transcriptionFields(request.args, ["profileIdentity", "profileRevision", "adapter", "executionVersion", "profileConfiguration", "profileDigest", "language", "timing", "settings"]);
  transcriptionFields(request.profile!.configuration, ["model", "settings"]);
  transcriptionFields(request.profile!.configuration.settings, []); transcriptionFields(request.args.settings, []);
  fail(request.kind === "transcription" && request.execution?.adapter === "openai-transcription" && request.execution.version === "1"
    && request.inputs.length === 1 && request.inputs[0]?.kind === "audio" && typeof request.args.language === "string",
  "Transcription requires exactly one audio input, explicit language choice and no custom settings");
  const options = { model: request.profile!.configuration.model, language: request.args.language === "auto" ? null : request.args.language,
    timing: request.args.timing } as Pick<OpenAITranscriptionRequest, "model" | "language" | "timing">;
  validateOpenAITranscriptionOptions(options); return options;
}
export function prepareTranscriptionExecutionRequest(input: ExecutionRequest, preparation: TranscriptionExecutionPreparation, bytes: Uint8Array): {
  request: OpenAITranscriptionRequest; description: OpenAITranscriptionDescription;
} {
  const options = transcriptionExecutionOptions(input), receipt = structuredClone(preparation.receipt);
  assertTranscriptionAudioReceipt(preparation.intent, receipt);
  const request: OpenAITranscriptionRequest = { ...options, input: { artifactId: receipt.id, sha256: receipt.audio.sha256, mimeType: "audio/wav", bytes } };
  const description = describeOpenAITranscriptionRequest(request);
  fail(description.input.byteLength === receipt.audio.byteLength && description.input.waveform.sampleCount === receipt.audio.sampleCount,
    "Transcription upload differs from its measured derivative");
  return { request, description };
}
export function assertTranscriptionExecutionProfile(profile: ProviderProfile, attempt: Attempt): void {
  transcriptionFields(profile, ["id", "revision", "kind", "adapter", "executionVersion", "configuration", "maxConcurrency", "unitCostMicros", "maxRetries"]);
  const args = providerProfileArguments(profile), saved = attempt.request.profile;
  transcriptionFields(saved, ["id", "revision", "configuration", "digest"]);
  fail(profile.kind === "transcription" && profile.adapter === "openai-transcription" && profile.executionVersion === "1"
    && saved && saved.id === profile.id && saved.revision === profile.revision && saved.digest === args.profileDigest
    && canonical(saved.configuration) === canonical(profile.configuration)
    && Object.entries(args).every(([key, value]) => canonical(attempt.request.args[key]) === canonical(value))
    && integer(profile.maxConcurrency, 1, 64) && integer(profile.maxRetries, 0, 3) && typeof profile.unitCostMicros === "string",
  "Transcription requires the exact full approved profile definition"); moneyMicros(profile.unitCostMicros);
}
/** Structural/semantic verification only: recomputing the multipart body hash requires the actual derivative bytes. */
export function assertTranscriptionExecutionMapping(attempt: Attempt, mapping: TranscriptionExecutionMapping, preparation: TranscriptionExecutionPreparation): void {
  base(attempt, mapping, ["profileDigest", "profileDefinitionDigest", "profileDefinition", "capabilityLockId", "capabilityLockDigest",
    "allowanceId", "allowanceDigest", "consumptionDigest", "estimatedMicros", "preparation", "source", "derivative", "parser", "transport"]);
  assertTranscriptionExecutionProfile(mapping.profileDefinition, attempt);
  const options = transcriptionExecutionOptions(attempt.request), { intent, receipt } = preparation, input = transcriptionAudioInput(attempt);
  assertTranscriptionAudioSource(intent.source); assertTranscriptionAudioReceipt(intent, receipt);
  fail(intent.id === transcriptionAudioId(attempt.projectId, attempt.id) && intent.attemptId === attempt.id && intent.projectId === attempt.projectId
    && intent.requestDigest === digest(attempt.request) && input.artifactId === intent.source.artifactId && input.sha256 === intent.source.sha256
    && intent.sourceStartSample === 0 && intent.sourceEndSample === intent.source.probe.audio!.samples
    && canonical(mapping.preparation) === canonical({ intentId: intent.id, intentDigest: digest(intent), receiptId: receipt.id, receiptDigest: digest(receipt) })
    && canonical(mapping.source) === canonical({ record: intent.sourceRecord, descriptor: intent.source, startSample: 0, endSample: intent.sourceEndSample })
    && canonical(mapping.derivative) === canonical(receipt.audio) && canonical(mapping.parser) === canonical(TRANSCRIPTION_EXECUTION_PARSER),
  "Transcription mapping lost its exact full source, preparation or parser identity");
  const waveform = { format: "pcm-s16le", sampleRate: 16000, channels: 1, bitsPerSample: 16,
    sampleCount: receipt.audio.sampleCount, dataByteLength: receipt.audio.sampleCount * 2, durationSeconds: receipt.audio.sampleCount / 16000 };
  const semantic = { adapter: "openai-transcription-v1", ...options, responseFormat: "verbose_json",
    input: { artifactId: receipt.id, sha256: receipt.audio.sha256, mimeType: "audio/wav", byteLength: receipt.audio.byteLength, waveform } };
  const semanticDigest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const transport = mapping.transport;
  transcriptionFields(transport, ["adapter", "model", "language", "timing", "responseFormat", "input", "requestDigest", "bodySha256", "bodyByteLength", "contentType"]);
  const { requestDigest, bodySha256, bodyByteLength, contentType, ...savedSemantic } = transport;
  fail(mapping.profileDigest === attempt.request.profile!.digest && mapping.profileDefinitionDigest === digest(mapping.profileDefinition)
    && id(mapping.capabilityLockId) && hash(mapping.capabilityLockDigest) && mapping.allowanceId === attempt.request.externalAllowanceId
    && hash(mapping.allowanceDigest) && hash(mapping.consumptionDigest) && mapping.estimatedMicros === mapping.profileDefinition.unitCostMicros
    && canonical(savedSemantic) === canonical(semantic) && requestDigest === semanticDigest && hash(bodySha256)
    && integer(bodyByteLength, receipt.audio.byteLength + 64, receipt.audio.byteLength + 16384)
    && typeof contentType === "string" && new RegExp(`^multipart/form-data; boundary=openslate-${semanticDigest.slice(0, 48)}-(?:[0-9]|1[0-5])$`).test(contentType),
  "Transcription mapping differs from its exact approved profile or multipart semantics");
}
export function assertTranscriptionExecutionDispatch(attempt: Attempt, mapping: TranscriptionExecutionMapping, dispatch: TranscriptionExecutionDispatch,
  preparation: TranscriptionExecutionPreparation): void {
  base(attempt, dispatch, ["mappingDigest", "transportDigest", "bodySha256", "allowanceId", "createdAt"]);
  assertTranscriptionExecutionMapping(attempt, mapping, preparation);
  fail(dispatch.mappingDigest === digest(mapping) && dispatch.transportDigest === mapping.transport.requestDigest
    && dispatch.bodySha256 === mapping.transport.bodySha256 && dispatch.allowanceId === mapping.allowanceId
    && typeof dispatch.createdAt === "string" && dispatch.createdAt.length === 24 && Number.isFinite(Date.parse(dispatch.createdAt))
    && new Date(dispatch.createdAt).toISOString() === dispatch.createdAt, "Transcription dispatch differs from its exact mapping");
}
export function compactTranscriptionExecutionResult(result: OpenAITranscriptionResult): CompactTranscriptionResult {
  return { rawResponseSha256: result.rawResponseSha256, rawResponseByteLength: result.rawResponseBytes.byteLength, resultDigest: result.resultDigest,
    textBytes: Buffer.byteLength(result.text), wordCount: result.words.length, timingIssueCount: result.timingIssues.length,
    reportedLanguage: result.reportedLanguage, reportedDurationSeconds: result.reportedDurationSeconds, usage: structuredClone(result.usage) };
}
export function assertTranscriptionExecutionResult(attempt: Attempt, mapping: TranscriptionExecutionMapping | undefined, dispatch: TranscriptionExecutionDispatch | undefined,
  result: TranscriptionExecutionResult, preparation?: TranscriptionExecutionPreparation, output?: OutputReceipt): void {
  base(attempt, result, ["mappingDigest", "dispatchDigest", "observation"]);
  if (mapping) { fail(preparation, "Transcription mapping requires its saved preparation"); assertTranscriptionExecutionMapping(attempt, mapping, preparation!); }
  if (dispatch) { fail(mapping && preparation, "Transcription dispatch requires its mapping"); assertTranscriptionExecutionDispatch(attempt, mapping!, dispatch, preparation!); }
  fail(result.mappingDigest === (mapping ? digest(mapping) : null) && result.dispatchDigest === (dispatch ? digest(dispatch) : null),
    "Transcription outcome lost its immutable mapping or dispatch");
  const value = result.observation;
  if (value?.kind === "not_dispatched") {
    transcriptionFields(value, ["kind", "code"]);
    fail(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED", "LOCAL_PREPARATION_BUSY"].includes(value.code),
      "Only a pre-dispatch local transcription failure proves no submission"); return;
  }
  fail(mapping && dispatch && value && ["completed", "rejected", "unknown"].includes(value.kind), "Transcription observations require a durable dispatch");
  const receipt = value.receipt;
  transcriptionFields(receipt, ["adapter", "attemptId", "requestDigest", "bodySha256", "requestedModel", "requestId", "httpStatus"]);
  fail(receipt.adapter === "openai-transcription-v1" && receipt.attemptId === attempt.id && receipt.requestDigest === mapping!.transport.requestDigest
    && receipt.bodySha256 === mapping!.transport.bodySha256 && receipt.requestedModel === mapping!.transport.model
    && (receipt.requestId === null || id(receipt.requestId)) && (receipt.httpStatus === null || integer(receipt.httpStatus, 100, 599)),
  "Transcription provider receipt differs from its exact wire identity");
  if (value.kind !== "completed") {
    transcriptionFields(value, value.kind === "unknown" ? ["kind", "code", "receipt", "retryAfterMs"] : ["kind", "certainty", "source", "code", "receipt", "retryAfterMs"]);
    fail(typeof value.code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.code)
      && (value.retryAfterMs === null || integer(value.retryAfterMs, 0, 600000))
      && (value.kind === "unknown" || (value.certainty === "not_accepted" && ["local", "provider"].includes(value.source))), "Invalid redacted transcription observation"); return;
  }
  transcriptionFields(value, ["kind", "receipt", "reportedModel", "result", "outputReceiptId"]);
  const raw = value.result;
  transcriptionFields(raw, ["rawResponseSha256", "rawResponseByteLength", "resultDigest", "textBytes", "wordCount", "timingIssueCount", "reportedLanguage", "reportedDurationSeconds", "usage"]);
  fail((value.reportedModel === null || text(value.reportedModel, 256)) && hash(raw.rawResponseSha256) && hash(raw.resultDigest)
    && integer(raw.rawResponseByteLength, 1, TRANSCRIPTION_EXECUTION_PARSER.maxResponseBytes) && integer(raw.textBytes, 0, TRANSCRIPTION_EXECUTION_PARSER.maxTextBytes)
    && integer(raw.wordCount, 0, TRANSCRIPTION_EXECUTION_PARSER.maxWords) && integer(raw.timingIssueCount, 0, raw.wordCount * 3 + 2)
    && text(raw.reportedLanguage, 128) && seconds(raw.reportedDurationSeconds), "Invalid compact transcription result metadata");
  if (raw.usage !== null) { transcriptionFields(raw.usage, ["type", "seconds"]); fail(raw.usage.type === "duration" && seconds(raw.usage.seconds) && raw.usage.seconds <= 86400, "Invalid reported transcription usage"); }
  fail(output, "Completed transcription requires its exact raw JSON receipt"); assertOutputReceiptIdentity(output!, attempt);
  fail(output!.id === value.outputReceiptId && output!.port === "cues" && output!.kind === "data" && output!.mimeType === "application/json"
    && output!.vendorTaskId === null && output!.diagnosticRequestId === receipt.requestId && output!.source.kind === "returned_bytes"
    && output!.source.sha256 === raw.rawResponseSha256 && output!.source.byteLength === raw.rawResponseByteLength,
  "Transcription result differs from its exact raw JSON receipt");
}
