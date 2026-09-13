import { createHash } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";
import { digestOpenAITranscriptionProjection, isSpoolOutput } from "@openslate/providers";
import type { IngestibleExecutionOutput, OpenAITranscriptionProjection, OpenAITranscriptionResult, ParsedOpenAITranscriptionResponse, TranscriptionTimingIssue } from "@openslate/providers";
import type { ArtifactRecord, Attempt } from "./engine.js";
import type { OutputReceipt, OutputSpool } from "./output-store.js";
import { assertTranscriptionMappingAdmission, resolveTranscriptionAdmission, resolveTranscriptionPreparation } from "./transcription-execution-authority.js";
import type { TranscriptionAuthorityStore } from "./transcription-execution-authority.js";
import { assertTranscriptionExecutionResult, compactTranscriptionExecutionResult } from "./transcription-execution-receipts.js";
import type { TranscriptionExecutionDispatch, TranscriptionExecutionMapping, TranscriptionExecutionPreparation, TranscriptionExecutionResult } from "./transcription-execution-receipts.js";
import { mapTranscriptWordSamples, TRANSCRIPT_SAMPLE_MAPPING_POLICY } from "../narration/transcript-sample-mapping.js";
import type { TranscriptMappedWord, TranscriptSampleIssue } from "../narration/transcript-sample-mapping.js";

export const TRANSCRIPT_CANDIDATE_LIMITS = Object.freeze({ canonicalBytes: 12 * 1024 ** 2, words: 8192, textBytes: 256 * 1024,
  wordBytes: 1024, rawBytes: 4 * 1024 ** 2, objectNodes: 400000 });
interface TranscriptionOutputSlot {
  id: string; projectId: string; version: 1; storageId: string; attemptId: string; port: "cues";
  spoolId: string; sha256: string; byteLength: number;
}
export interface TranscriptionSpoolLineage {
  attempt: Attempt; mapping: TranscriptionExecutionMapping; dispatch: TranscriptionExecutionDispatch;
  result: TranscriptionExecutionResult & { observation: Extract<TranscriptionExecutionResult["observation"], { kind: "completed" }> };
  preparation: TranscriptionExecutionPreparation; receipt: OutputReceipt; spool: OutputSpool; slot: TranscriptionOutputSlot;
}
export interface TranscriptCandidate {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string; artifactId: string;
  mappingDigest: string; dispatchDigest: string; resultRecordDigest: string;
  raw: { receiptId: string; spoolId: string; sha256: string; byteLength: number };
  preparation: TranscriptionExecutionMapping["preparation"];
  source: TranscriptionExecutionMapping["source"];
  parser: TranscriptionExecutionMapping["parser"];
  resultDigest: string; status: "unreviewed";
  projection: {
    text: string; reportedModel: string | null; reportedLanguage: string; reportedDurationSeconds: number;
    usage: OpenAITranscriptionResult["usage"]; words: TranscriptMappedWord[];
    parserIssues: TranscriptionTimingIssue[]; sampleIssues: TranscriptSampleIssue[];
    samplePolicy: typeof TRANSCRIPT_SAMPLE_MAPPING_POLICY;
  };
}
export interface TranscriptCandidateIngestion {
  type: "transcript_candidate";
  artifact: Omit<ArtifactRecord, "origin"> & { origin: "transcription_response"; transcriptCandidateId: string };
  candidate: TranscriptCandidate;
}
const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPT_CANDIDATE_CONFLICT", message);
const lineageFail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPTION_EXECUTION_CONFLICT", message);
export const transcriptCandidateId = (projectId: string, attemptId: string, spoolId: string): string => digest({ version: 1, kind: "transcript_candidate", projectId, attemptId, spoolId });
export const transcriptArtifactId = (projectId: string, attemptId: string, spoolId: string): string => digest({ version: 1, projectId, attemptId, port: "cues", spoolId });
function fields(value: unknown, names: string[]): asserts value is Record<string, unknown> {
  fail(value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && names.every(name => Object.hasOwn(value, name)) && Reflect.ownKeys(value).length === names.length
    && Reflect.ownKeys(value).every(name => typeof name === "string" && names.includes(name)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name)!, "value")), "Unsupported transcript candidate fields");
}
/** Bound traversal before serialization and reject accessors without calling user code. */
function snapshot(value: unknown): unknown {
  let nodes = 0, stringBytes = 0;
  const ancestors = new Set<object>();
  function copy(input: unknown, depth: number): unknown {
    fail(++nodes <= TRANSCRIPT_CANDIDATE_LIMITS.objectNodes && depth <= 32, "Transcript candidate exceeds its structural bound");
    if (typeof input === "string") { stringBytes += Buffer.byteLength(input); fail(stringBytes <= TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes, "Transcript candidate text exceeds its bound"); return input; }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") { fail(Number.isFinite(input), "Transcript candidate has a nonfinite number"); return input; }
    fail(input !== null && typeof input === "object" && !ancestors.has(input as object), "Transcript candidate is not plain acyclic data");
    const object = input as object, array = Array.isArray(input);
    fail(array ? Object.getPrototypeOf(input) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(input)), "Transcript candidate requires plain data");
    if (array) fail((input as unknown[]).length <= 65536, "Transcript candidate array exceeds its bound");
    ancestors.add(object);
    const output: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(object);
    fail(keys.length <= 65537, "Transcript candidate collection exceeds its bound");
    for (const key of keys) {
      if (array && key === "length") continue;
      fail(typeof key === "string" && (!array || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (input as unknown[]).length)), "Invalid transcript collection key");
      const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value"), "Transcript candidate accessors are not supported");
      stringBytes += Buffer.byteLength(String(key)); fail(stringBytes <= TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes, "Transcript candidate exceeds its key bound");
      Object.defineProperty(output, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array) fail(keys.length === (input as unknown[]).length + 1, "Transcript arrays cannot contain holes");
    ancestors.delete(object); return output;
  }
  const result = copy(value, 0);
  fail(Buffer.byteLength(canonical(result)) <= TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes, "Transcript candidate exceeds twelve MiB");
  return result;
}

/** Read-only historical proof. No lease, filesystem, parser, credential or provider side effects. */
export function resolveTranscriptionSpoolLineage(store: TranscriptionAuthorityStore, input: Readonly<Attempt>, spoolId: string): TranscriptionSpoolLineage {
  const attempt = structuredClone(input);
  lineageFail(attempt.request.kind === "transcription" && attempt.request.execution?.adapter === "openai-transcription"
    && attempt.request.execution.version === "1", "Transcript candidates require exact OpenAI transcription-v1 execution");
  const mapping = store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
  const dispatch = store.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attempt.id);
  const savedResult = store.get<TranscriptionExecutionResult>("transcription_execution_result", attempt.id);
  lineageFail(mapping && dispatch && savedResult?.observation.kind === "completed", "Transcript candidate requires its exact dispatch and completed observation");
  const result = savedResult as TranscriptionSpoolLineage["result"];
  const admission = resolveTranscriptionAdmission(store, attempt.request, mapping);
  lineageFail(admission.attempt.id === attempt.id && admission.attempt.projectId === attempt.projectId
    && digest(admission.attempt.request) === digest(attempt.request), "Transcript output belongs to a different admitted attempt");
  const preparation = resolveTranscriptionPreparation(store, admission.attempt, mapping);
  assertTranscriptionMappingAdmission(admission, mapping!, preparation);
  const spool = store.get<OutputSpool>("execution_output_spool", spoolId);
  const receipt = spool ? store.get<OutputReceipt>("execution_output_receipt", spool.receiptId) : undefined;
  assertTranscriptionExecutionResult(admission.attempt, mapping, dispatch, result, preparation, receipt);
  const raw = result.observation.result, observed = result.observation.outputReceiptId;
  lineageFail(spool && spoolId === observed && spool.id === observed && spool.receiptId === observed
    && typeof spool.storageId === "string" && spool.storageId.length > 0 && spool.storageId.length <= 160
    && canonical(spool) === canonical({ id: observed, projectId: attempt.projectId, version: 1, storageId: spool.storageId,
      receiptId: observed, attemptId: attempt.id, requestDigest: digest(attempt.request), port: "cues",
      sha256: raw.rawResponseSha256, byteLength: raw.rawResponseByteLength, blobKey: `${raw.rawResponseSha256}.blob` }),
  "Transcript candidate cannot substitute a different raw response receipt or spool");
  const slotId = digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "cues" });
  const slot = store.get<TranscriptionOutputSlot>("execution_output_slot", slotId);
  lineageFail(slot && canonical(slot) === canonical({ id: slotId, projectId: attempt.projectId, version: 1, storageId: spool!.storageId,
    attemptId: attempt.id, port: "cues", spoolId, sha256: raw.rawResponseSha256, byteLength: raw.rawResponseByteLength }),
  "Transcript candidate requires the exact observed winning output slot");
  return structuredClone({ attempt: admission.attempt, mapping: mapping!, dispatch: dispatch!, result, preparation, receipt: receipt!, spool: spool!, slot: slot! });
}
function identity(lineage: TranscriptionSpoolLineage): Omit<TranscriptCandidate, "projection"> {
  const { attempt, mapping, dispatch, result, spool } = lineage;
  return { id: transcriptCandidateId(attempt.projectId, attempt.id, spool.id), version: 1, projectId: attempt.projectId, attemptId: attempt.id,
    requestDigest: digest(attempt.request), artifactId: transcriptArtifactId(attempt.projectId, attempt.id, spool.id),
    mappingDigest: digest(mapping), dispatchDigest: digest(dispatch), resultRecordDigest: digest(result),
    raw: { receiptId: spool.receiptId, spoolId: spool.id, sha256: spool.sha256, byteLength: spool.byteLength },
    preparation: structuredClone(mapping.preparation), source: structuredClone(mapping.source), parser: structuredClone(mapping.parser),
    resultDigest: result.observation.result.resultDigest, status: "unreviewed" };
}
function providerProjection(value: TranscriptCandidate["projection"]): OpenAITranscriptionProjection {
  return { text: value.text, reportedLanguage: value.reportedLanguage, reportedDurationSeconds: value.reportedDurationSeconds,
    words: value.words.map(({ word, startSeconds, endSeconds }) => ({ word, startSeconds, endSeconds })), timingIssues: value.parserIssues, usage: value.usage };
}
/** Candidate content is deterministic. Creation never accepts narration or changes a recording. */
export function createTranscriptCandidate(lineage: TranscriptionSpoolLineage, parsed: ParsedOpenAITranscriptionResponse): TranscriptCandidate {
  fields(parsed, ["reportedModel", "result"]);
  fields(parsed.result, ["rawResponseBytes", "rawResponseSha256", "text", "reportedLanguage", "reportedDurationSeconds", "words", "timingIssues", "usage", "resultDigest"]);
  const { result } = parsed;
  const projection: OpenAITranscriptionProjection = { text: result.text, reportedLanguage: result.reportedLanguage,
    reportedDurationSeconds: result.reportedDurationSeconds, words: result.words, timingIssues: result.timingIssues, usage: result.usage };
  fail(digestOpenAITranscriptionProjection(projection) === result.resultDigest, "Parsed transcript has a forged semantic digest");
  let bytes: Buffer;
  try {
    fail(result.rawResponseBytes instanceof Uint8Array, "Transcript raw response must be bytes");
    const proto = Object.getPrototypeOf(Uint8Array.prototype), buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(result.rawResponseBytes);
    const length = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(result.rawResponseBytes);
    const offset = Object.getOwnPropertyDescriptor(proto, "byteOffset")!.get!.call(result.rawResponseBytes);
    fail(buffer instanceof ArrayBuffer && length > 0 && length <= TRANSCRIPT_CANDIDATE_LIMITS.rawBytes, "Transcript raw bytes exceed their bound");
    bytes = Buffer.from(new Uint8Array(buffer, offset, length));
  } catch { invariant(false, "TRANSCRIPT_CANDIDATE_CONFLICT", "Transcript raw bytes must be an actual bounded byte view"); }
  const observed = lineage.result.observation;
  fail(createHash("sha256").update(bytes!).digest("hex") === result.rawResponseSha256 && parsed.reportedModel === observed.reportedModel
    && canonical(compactTranscriptionExecutionResult({ ...result, rawResponseBytes: bytes! })) === canonical(observed.result),
  "Parsed transcript differs from its saved raw response and semantic observation");
  const mapped = mapTranscriptWordSamples(result.words, lineage.preparation.intent.sourceEndSample);
  const candidate: TranscriptCandidate = { ...identity(lineage), projection: { text: result.text, reportedModel: parsed.reportedModel,
    reportedLanguage: result.reportedLanguage, reportedDurationSeconds: result.reportedDurationSeconds, usage: structuredClone(result.usage),
    words: mapped.words, parserIssues: structuredClone(result.timingIssues), sampleIssues: mapped.issues, samplePolicy: mapped.policy } };
  assertTranscriptCandidate(lineage, candidate); return candidate;
}
/** Pure metadata/projection validation; the ingester and backup also verify physical source, derivative and raw bytes. */
export function assertTranscriptCandidate(lineage: TranscriptionSpoolLineage, input: unknown): asserts input is TranscriptCandidate {
  const candidate = snapshot(input) as TranscriptCandidate;
  fields(candidate, ["id", "version", "projectId", "attemptId", "requestDigest", "artifactId", "mappingDigest", "dispatchDigest", "resultRecordDigest",
    "raw", "preparation", "source", "parser", "resultDigest", "status", "projection"]);
  const { projection, ...savedIdentity } = candidate;
  fail(canonical(savedIdentity) === canonical(identity(lineage)), "Candidate lost its exact immutable source or execution identity");
  fields(projection, ["text", "reportedModel", "reportedLanguage", "reportedDurationSeconds", "usage", "words", "parserIssues", "sampleIssues", "samplePolicy"]);
  fail(Array.isArray(projection.words) && projection.words.length <= TRANSCRIPT_CANDIDATE_LIMITS.words, "Transcript word count exceeds its bound");
  for (const word of projection.words) fields(word, ["word", "startSeconds", "endSeconds", "startSample", "endSample"]);
  const rawProjection = providerProjection(projection);
  fail(digestOpenAITranscriptionProjection(rawProjection) === candidate.resultDigest, "Candidate projection differs from its observed semantic digest");
  const observed = lineage.result.observation;
  fail(projection.reportedModel === observed.reportedModel && canonical(observed.result) === canonical({ rawResponseSha256: lineage.spool.sha256,
    rawResponseByteLength: lineage.spool.byteLength, resultDigest: candidate.resultDigest, textBytes: Buffer.byteLength(projection.text),
    wordCount: projection.words.length, timingIssueCount: projection.parserIssues.length, reportedLanguage: projection.reportedLanguage,
    reportedDurationSeconds: projection.reportedDurationSeconds, usage: projection.usage }),
  "Candidate reported metadata differs from its exact saved observation");
  const mapped = mapTranscriptWordSamples(rawProjection.words, lineage.preparation.intent.sourceEndSample);
  fail(projection.samplePolicy === mapped.policy && canonical(projection.words) === canonical(mapped.words)
    && canonical(projection.sampleIssues) === canonical(mapped.issues), "Candidate source-sample mapping changed or repaired provider timings");
}
/** Synchronous validation before file checks and inside the Engine's atomic publication transaction. */
export function assertTranscriptCandidateIngestion(lineage: TranscriptionSpoolLineage, output: IngestibleExecutionOutput, input: unknown): asserts input is TranscriptCandidateIngestion {
  const result = snapshot(input) as TranscriptCandidateIngestion;
  output = snapshot(output) as IngestibleExecutionOutput;
  fields(result, ["type", "artifact", "candidate"]);
  fail(result.type === "transcript_candidate", "Unsupported transcript ingestion result");
  assertTranscriptCandidate(lineage, result.candidate);
  const { attempt, spool } = lineage, artifact = result.artifact, candidate = result.candidate;
  fail(isSpoolOutput(output) && canonical(output) === canonical({ port: "cues", kind: "data", mimeType: "application/json", extension: "json",
    sha256: spool.sha256, byteLength: spool.byteLength, fixture: false, storage: { type: "spool", spoolId: spool.id } }), "Transcript output differs from its exact raw spool");
  fields(artifact, ["id", "projectId", "artifact", "path", "mimeType", "fixture", "attemptId", "physicalDurationSeconds", "origin", "outputReceiptId", "outputSpoolId", "byteLength", "transcriptCandidateId"]);
  fail(typeof artifact.path === "string" && artifact.path.length > 0 && artifact.path.length <= 4096
    && canonical(artifact) === canonical({ id: candidate.artifactId, projectId: attempt.projectId, attemptId: attempt.id,
      artifact: { artifactId: candidate.artifactId, kind: "data", sha256: spool.sha256 }, path: artifact.path,
      mimeType: "application/json", fixture: false, origin: "transcription_response", physicalDurationSeconds: null,
      byteLength: spool.byteLength, outputReceiptId: spool.receiptId, outputSpoolId: spool.id, transcriptCandidateId: candidate.id }),
  "Transcript artifact lost its raw-byte and unreviewed-candidate identity");
}
