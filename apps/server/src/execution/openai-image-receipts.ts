import { createHash } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";
import { OPENAI_IMAGE_MODEL } from "@openslate/providers";
import type { OpenAIImageDescription, OpenAIImageOutcome } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import type { OutputReceipt } from "./output-store.js";

interface Identity { id: string; projectId: string; version: 1; attemptId: string; requestDigest: string }
export interface ImageExecutionMapping extends Identity {
  profileDigest: string; externalAllowanceId: string; transport: OpenAIImageDescription;
}
export interface ImageExecutionDispatch extends Identity {
  mappingDigest: string; transportDigest: string; externalAllowanceId: string; createdAt: string;
}
type Completed = Extract<OpenAIImageOutcome, { kind: "completed" }>;
export type ImageExecutionObservation = Exclude<OpenAIImageOutcome, Completed>
  | (Omit<Completed, "output"> & { output: Omit<Completed["output"], "bytes"> & { byteLength: number }; outputReceiptId: string })
  | { kind: "not_dispatched"; code: "LOCAL_INPUT_INVALID" | "LOCAL_CREDENTIAL_UNAVAILABLE" | "LOCAL_CANCELLED" };
export interface ImageExecutionResult extends Identity {
  mappingDigest: string | null; dispatchDigest: string | null; observation: ImageExecutionObservation;
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const allowance = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function fields(value: unknown, keys: string[]): void {
  invariant(object(value) && Object.keys(value).every(key => keys.includes(key)), "IMAGE_EXECUTION_CONFLICT", "Unsupported image execution receipt fields");
}
function base(attempt: Attempt, value: Identity, extra: string[]): void {
  fields(value, ["id", "projectId", "version", "attemptId", "requestDigest", ...extra]);
  invariant(value.version === 1 && value.id === attempt.id && value.attemptId === attempt.id && value.projectId === attempt.projectId
    && value.requestDigest === digest(attempt.request) && attempt.request.kind === "image"
    && attempt.request.execution?.adapter === "openai-image" && attempt.request.execution.version === "1"
    && allowance(attempt.request.externalAllowanceId) && hash(attempt.request.profile?.digest)
    && Buffer.byteLength(canonical(value)) <= 16384,
  "IMAGE_EXECUTION_CONFLICT", "Image receipt must bind the exact admitted application request");
}

/** V1 transport envelope is pinned here as well as in the transport; conformance is tested. */
export function assertImageExecutionMapping(attempt: Attempt, value: ImageExecutionMapping): void {
  base(attempt, value, ["profileDigest", "externalAllowanceId", "transport"]);
  const description = value.transport, request = attempt.request, settings = request.profile!.configuration.settings;
  fields(description, ["adapter", "requestDigest", "model", "mode", "width", "height", "quality", "inputs"]);
  invariant(value.profileDigest === request.profile!.digest && value.externalAllowanceId === request.externalAllowanceId
    && description.adapter === "openai-image-v1" && description.model === request.profile!.configuration.model
    && (description.model === OPENAI_IMAGE_MODEL || description.model === "gpt-image-2")
    && description.width === settings?.width && description.height === settings?.height && description.quality === settings?.quality
    && description.width === request.args.width && description.height === request.args.height
    && description.mode === (request.inputs.length ? "edit" : "generate") && Array.isArray(description.inputs)
    && description.inputs.length === request.inputs.length && description.inputs.length <= 8,
  "IMAGE_EXECUTION_CONFLICT", "Prepared transport differs from the pinned model, dimensions, or ordered image references");
  let total = 0;
  description.inputs.forEach((input, index) => {
    fields(input, ["artifactId", "sha256", "mimeType", "byteLength"]);
    invariant(input.artifactId === request.inputs[index]!.artifactId && input.sha256 === request.inputs[index]!.sha256
      && input.mimeType === "image/png" && integer(input.byteLength, 33, 4 * 1024 * 1024),
    "IMAGE_EXECUTION_CONFLICT", "Prepared input identity or byte limit differs"); total += input.byteLength;
  });
  const expected = createHash("sha256").update(JSON.stringify({ adapter: description.adapter, mode: description.mode,
    model: description.model, prompt: request.args.prompt, width: description.width, height: description.height, quality: description.quality,
    n: 1, outputFormat: "png", background: "opaque", moderation: "auto", stream: false,
    inputs: description.inputs.map(input => ({ artifactId: input.artifactId, sha256: input.sha256, mimeType: input.mimeType, byteLength: input.byteLength })) })).digest("hex");
  invariant(total <= 24 * 1024 * 1024 && description.requestDigest === expected, "IMAGE_EXECUTION_CONFLICT", "Prepared transport payload digest differs");
}

export function assertImageExecutionDispatch(attempt: Attempt, mapping: ImageExecutionMapping, value: ImageExecutionDispatch): void {
  base(attempt, value, ["mappingDigest", "transportDigest", "externalAllowanceId", "createdAt"]);
  assertImageExecutionMapping(attempt, mapping);
  invariant(value.mappingDigest === digest(mapping) && value.transportDigest === mapping.transport.requestDigest
    && value.externalAllowanceId === mapping.externalAllowanceId && typeof value.createdAt === "string"
    && value.createdAt.length <= 40 && Number.isFinite(Date.parse(value.createdAt)),
  "IMAGE_EXECUTION_CONFLICT", "Dispatch intent must bind the exact prepared transport");
}

export function assertImageExecutionResult(attempt: Attempt, mapping: ImageExecutionMapping | undefined,
  dispatch: ImageExecutionDispatch | undefined, value: ImageExecutionResult, output?: OutputReceipt): void {
  base(attempt, value, ["mappingDigest", "dispatchDigest", "observation"]);
  if (mapping) assertImageExecutionMapping(attempt, mapping);
  if (dispatch) { invariant(mapping, "IMAGE_EXECUTION_CONFLICT", "Dispatch requires a prepared mapping"); assertImageExecutionDispatch(attempt, mapping, dispatch); }
  invariant(value.mappingDigest === (mapping ? digest(mapping) : null) && value.dispatchDigest === (dispatch ? digest(dispatch) : null),
    "IMAGE_EXECUTION_CONFLICT", "Outcome must retain its exact mapping and dispatch state");
  const observation = value.observation;
  invariant(object(observation), "IMAGE_EXECUTION_CONFLICT", "Invalid image execution outcome");
  if (observation.kind === "not_dispatched") {
    fields(observation, ["kind", "code"]);
    invariant(!dispatch && ["LOCAL_INPUT_INVALID", "LOCAL_CREDENTIAL_UNAVAILABLE", "LOCAL_CANCELLED"].includes(observation.code),
      "IMAGE_EXECUTION_CONFLICT", "Only a pre-dispatch local failure can prove no submission"); return;
  }
  invariant(mapping && dispatch, "IMAGE_EXECUTION_CONFLICT", "Provider observations require a persisted dispatch");
  const receipt = observation.receipt;
  fields(receipt, ["attemptId", "requestDigest", "requestedModel", "requestId", "httpStatus"]);
  invariant(receipt.attemptId === attempt.id && receipt.requestDigest === mapping.transport.requestDigest
    && receipt.requestedModel === mapping.transport.model && (receipt.requestId === null || id(receipt.requestId))
    && (receipt.httpStatus === null || integer(receipt.httpStatus, 100, 599)), "IMAGE_EXECUTION_CONFLICT", "Provider receipt identity differs");
  if (observation.kind !== "completed") {
    fields(observation, observation.kind === "unknown" ? ["kind", "receipt", "code"] : ["kind", "certainty", "source", "receipt", "code"]);
    invariant(typeof observation.code === "string" && /^[A-Z][A-Z0-9_]{0,95}$/.test(observation.code)
      && (observation.kind === "unknown" || (observation.kind === "rejected" && observation.certainty === "not_accepted"
        && ["local", "provider"].includes(observation.source))), "IMAGE_EXECUTION_CONFLICT", "Invalid redacted image observation"); return;
  }
  fields(observation, ["kind", "receipt", "created", "reportedModel", "usage", "output", "outputReceiptId"]);
  fields(observation.output, ["port", "kind", "mimeType", "extension", "sha256", "width", "height", "fixture", "byteLength"]);
  const image = observation.output;
  invariant(integer(observation.created, 0, Number.MAX_SAFE_INTEGER) && (observation.reportedModel === null
    || observation.reportedModel === "gpt-image-2" || observation.reportedModel === OPENAI_IMAGE_MODEL)
    && image.port === "image" && image.kind === "image" && image.mimeType === "image/png" && image.extension === "png"
    && image.fixture === false && hash(image.sha256) && integer(image.byteLength, 33, 32 * 1024 * 1024)
    && image.width === mapping.transport.width && image.height === mapping.transport.height,
  "IMAGE_EXECUTION_CONFLICT", "Invalid completed image metadata");
  if (observation.usage !== null) {
    fields(observation.usage, ["inputTokens", "outputTokens", "totalTokens", "inputImageTokens", "inputTextTokens"]);
    invariant([observation.usage.inputTokens, observation.usage.outputTokens, observation.usage.totalTokens].every(value => integer(value, 0, Number.MAX_SAFE_INTEGER))
      && [observation.usage.inputImageTokens, observation.usage.inputTextTokens].every(value => value === null || integer(value, 0, Number.MAX_SAFE_INTEGER)),
    "IMAGE_EXECUTION_CONFLICT", "Invalid redacted image usage");
  }
  invariant(output && output.id === observation.outputReceiptId && output.projectId === attempt.projectId && output.attemptId === attempt.id
    && output.requestDigest === value.requestDigest && output.vendorTaskId === null && output.diagnosticRequestId === receipt.requestId
    && output.kind === "image" && output.port === "image" && output.mimeType === "image/png" && output.source.kind === "returned_bytes"
    && output.source.sha256 === image.sha256 && output.source.byteLength === image.byteLength,
  "IMAGE_EXECUTION_CONFLICT", "Image result must bind its durable owned-byte receipt");
}
