import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { OPENAI_SPEECH_MODEL, OPENAI_SPEECH_VOICES } from "@openslate/providers";
import type { ExecutionSpoolOutput } from "@openslate/providers";
import type { ArtifactRecord, Attempt } from "../execution/engine.js";
import { assertSpeechSpoolLineage } from "../execution/audio-execution-lineage.js";
import { resolveSpeechAdmission } from "../execution/audio-execution-authority.js";
import type { SpeechAuthorityStore, SpeechReservation } from "../execution/audio-execution-authority.js";
import type { SpeechExecutionDispatch, SpeechExecutionMapping, SpeechExecutionResult } from "../execution/audio-execution-receipts.js";
import type { OutputReceipt, OutputSpool } from "../execution/output-store.js";
import { assertNormalizedAudioIngestion, AUDIO_DERIVATION_LIMITS } from "../execution/audio-derivation.js";
import type { AudioDerivationIntent, AudioDerivationReceipt } from "../execution/audio-derivation.js";
import type { GeneratedAudioMediaSource } from "../media/application-types.js";
import type { LocalMediaService, SuppliedMedia } from "../media/index.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import type { GeneratedNarrationEvidence, GeneratedNarrationSummary, NarrationAcceptance, NarrationAudio, NarrationCue, NarrationEntry, SegmentRevision, VerifiedGeneratedNarrationAudio } from "./types.js";
import type { CanonicalNarration, GeneratedNarrationProvenance } from "./canonical-types.js";
import { assertTranscriptCanonicalSegment, transcriptCanonicalProvenance } from "./transcript-selection.js";

export const GENERATED_NARRATION_LIMITS = Object.freeze({ recordBytes: 128 * 1024, sourceBytes: 32768, evidenceBytes: 8192, objectNodes: 8192 });
export interface ResolvedGeneratedNarrationAudio {
  audio: VerifiedGeneratedNarrationAudio; artifact: ArtifactRecord; attempt: Attempt; reservation: SpeechReservation;
  mapping: SpeechExecutionMapping; dispatch: SpeechExecutionDispatch; result: SpeechExecutionResult;
  outputReceipt: OutputReceipt; spool: OutputSpool; output: ExecutionSpoolOutput;
  derivationIntent: AudioDerivationIntent; derivationReceipt: AudioDerivationReceipt; mediaSource: GeneratedAudioMediaSource;
  artifactDigest: string; generationEvidenceDigest: string;
}
export type GeneratedNarrationAcceptances = Pick<GeneratedNarrationProvenance, "scriptAcceptanceId" | "audioAcceptanceId" | "timingAcceptanceId">;
const fail = (condition: unknown, message: string): void => invariant(condition, "GENERATED_NARRATION_CONFLICT", message);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/.test(value);
const cancelled = (signal?: AbortSignal): void => invariant(!signal?.aborted, "MEDIA_CANCELLED", "Generated recording verification cancelled");

/** Snapshot only plain own data, with no getter invocation or caller-owned aliases. */
function snapshot<T>(value: T): T {
  let nodes = 0, bytes = 0;
  const ancestors = new Set<object>();
  const copy = (input: unknown, depth: number): unknown => {
    fail(++nodes <= GENERATED_NARRATION_LIMITS.objectNodes && depth <= 24, "Generated recording exceeds its structural bound");
    if (typeof input === "string") { bytes += Buffer.byteLength(input); fail(bytes <= GENERATED_NARRATION_LIMITS.recordBytes, "Generated recording exceeds its text bound"); return input; }
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number") { fail(Number.isFinite(input), "Generated recording contains a nonfinite number"); return input; }
    fail(input !== null && typeof input === "object" && !ancestors.has(input as object), "Generated recording requires acyclic plain data");
    const object = input as object, array = Array.isArray(input);
    fail(array ? Object.getPrototypeOf(input) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(input)), "Generated recording requires plain data");
    const keys = Reflect.ownKeys(object); fail(keys.length <= GENERATED_NARRATION_LIMITS.objectNodes, "Generated recording has too many fields");
    if (array) fail((input as unknown[]).length <= GENERATED_NARRATION_LIMITS.objectNodes && keys.length === (input as unknown[]).length + 1, "Generated recording arrays must be bounded and dense");
    ancestors.add(object);
    const result = array ? [] : {} as Record<string, unknown>;
    for (const key of keys) {
      if (array && key === "length") continue;
      fail(typeof key === "string" && (!array || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (input as unknown[]).length), "Unsupported generated recording key");
      const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value") && property.enumerable, "Generated recording accessors and hidden fields are unsupported");
      bytes += Buffer.byteLength(key as string); fail(bytes <= GENERATED_NARRATION_LIMITS.recordBytes, "Generated recording exceeds its key bound");
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(object); return result;
  };
  const result = copy(value, 0); fail(Buffer.byteLength(canonical(result)) <= GENERATED_NARRATION_LIMITS.recordBytes, "Generated recording exceeds its byte bound");
  return result as T;
}
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  fail(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)), "Unsupported generated recording fields");
}
function record<T>(store: SpeechAuthorityStore, kind: string, recordId: string, projectId: string): T {
  const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, recordId) as { project_id: string; bytes: number } | undefined;
  fail(meta?.project_id === projectId && meta.bytes > 0 && meta.bytes <= GENERATED_NARRATION_LIMITS.recordBytes, "Generated recording evidence is absent, foreign, or oversized");
  const value = store.get<T>(kind, recordId); fail(value, "Generated recording evidence is missing"); return snapshot(value!);
}
function generatedShape(input: unknown): VerifiedGeneratedNarrationAudio {
  const audio = snapshot(input); exact(audio, ["id", "projectId", "media", "originEvidence", "generation"]);
  fail(audio.originEvidence === "verified_generated_audio" && id(audio.id) && id(audio.projectId), "Unknown generated recording variant");
  const evidence = audio.generation;
  exact(evidence, ["version", "adapter", "executionVersion", "model", "voice", "artifactId", "artifactDigest", "artifactRecordDigest",
    "attemptId", "requestDigest", "reservationId", "reservationDigest", "mappingDigest", "dispatchDigest", "resultDigest",
    "outputReceiptId", "outputReceiptDigest", "outputSpoolId", "outputSpoolDigest", "derivationId", "derivationIntentDigest",
    "derivationReceiptDigest", "sourceDescriptorId", "sourceDigest", "normalizedSamples"]);
  fail(evidence.version === 1 && evidence.adapter === "openai-speech" && evidence.executionVersion === "1"
    && [OPENAI_SPEECH_MODEL, "gpt-4o-mini-tts"].includes(evidence.model as string)
    && typeof evidence.voice === "string" && (OPENAI_SPEECH_VOICES as readonly string[]).includes(evidence.voice)
    && id(evidence.attemptId) && id(evidence.reservationId) && evidence.artifactId === audio.id
    && ["artifactDigest", "artifactRecordDigest", "requestDigest", "reservationDigest", "mappingDigest", "dispatchDigest", "resultDigest",
      "outputReceiptId", "outputReceiptDigest", "outputSpoolId", "outputSpoolDigest", "derivationId", "derivationIntentDigest", "derivationReceiptDigest",
      "sourceDescriptorId", "sourceDigest"].every(key => hash(evidence[key]))
    && Number.isSafeInteger(evidence.normalizedSamples) && Number(evidence.normalizedSamples) > 0 && Number(evidence.normalizedSamples) <= 48000 * 360
    && Buffer.byteLength(canonical(evidence)) <= GENERATED_NARRATION_LIMITS.evidenceBytes, "Invalid versioned generation evidence");
  const source = audio.media as unknown as SuppliedMedia;
  // Exact known fields keep summaries safe even when used directly with a stored variant.
  exact(source, ["id", "artifactId", "kind", "originalSha256", "originalByteLength", "sha256", "byteLength", "probe", "toolchainDigest"]);
  exact(source.probe, ["durationSeconds", "audio"]);
  exact(source.probe.audio, ["streamIndex", "sampleRate", "channels", "samples", "durationSeconds", "codec"]);
  const { id: sourceId, ...body } = source;
  fail(source.kind === "audio" && source.artifactId === audio.id && sourceId === evidence.sourceDescriptorId && sourceId === digest(body)
    && digest(source) === evidence.sourceDigest && hash(source.sha256) && hash(source.originalSha256) && hash(source.toolchainDigest)
    && Number.isSafeInteger(source.originalByteLength) && source.originalByteLength >= 44 && source.originalByteLength <= AUDIO_DERIVATION_LIMITS.inputBytes
    && Number.isSafeInteger(source.byteLength) && source.byteLength >= 44 && source.byteLength <= AUDIO_DERIVATION_LIMITS.outputBytes
    && source.probe.audio?.codec === "pcm_s16le" && source.probe.audio.streamIndex === 0 && source.probe.audio.sampleRate === 48000
    && source.probe.audio.channels === 2 && source.probe.audio.samples === evidence.normalizedSamples
    && Math.abs(source.probe.durationSeconds - Number(evidence.normalizedSamples) / 48000) <= 1 / 48000 + 0.000001
    && Math.abs(source.probe.audio.durationSeconds - Number(evidence.normalizedSamples) / 48000) <= 1 / 48000 + 0.000001,
  "Generated recording descriptor differs from its evidence");
  return audio as unknown as VerifiedGeneratedNarrationAudio;
}

/** Discriminator only; full trust requires the keyed lineage resolver or assertion below. */
export function isVerifiedGeneratedNarrationAudio(input: unknown): input is VerifiedGeneratedNarrationAudio {
  if (input === null || typeof input !== "object") return false;
  const property = Object.getOwnPropertyDescriptor(input, "originEvidence");
  return !!property && Object.hasOwn(property, "value") && property.value === "verified_generated_audio";
}
export function narrationAudioOrigin(input: NarrationAudio): "uploaded" | "generated" {
  const audio = snapshot(input);
  if (isVerifiedGeneratedNarrationAudio(audio)) { generatedShape(audio); return "generated"; }
  fail("declaredOrigin" in audio && (audio.declaredOrigin === "uploaded" || audio.declaredOrigin === "generated"), "Unknown supplied recording origin");
  return (audio as Exclude<NarrationAudio, VerifiedGeneratedNarrationAudio>).declaredOrigin;
}

/** Read-only historical proof. Never depends on the active node binding or grants fresh generation authority. */
export function resolveGeneratedNarrationAudio(store: SpeechAuthorityStore, projectId: string, artifactId: string): ResolvedGeneratedNarrationAudio {
  fail(id(projectId) && hash(artifactId), "Invalid generated recording identity"); store.getProject(projectId);
  const artifact = record<ArtifactRecord>(store, "artifact", artifactId, projectId);
  fail(artifact.id === artifactId && artifact.origin === "generated_audio" && artifact.fixture === false && id(artifact.attemptId)
    && hash(artifact.derivationId) && hash(artifact.outputSpoolId) && hash(artifact.outputReceiptId) && typeof artifact.path === "string", "Artifact lacks verified speech provenance");
  const attempt = record<Attempt>(store, "attempt", artifact.attemptId!, projectId);
  fail(attempt.phase === "succeeded" && attempt.projectId === projectId && attempt.request.kind === "speech"
    && attempt.request.execution?.adapter === "openai-speech" && attempt.request.execution.version === "1"
    && canonical(attempt.outputs.audio) === canonical(artifact.artifact), "Select an exact completed speech output");
  const mapping = record<SpeechExecutionMapping>(store, "speech_execution_mapping", attempt.id, projectId);
  const admission = resolveSpeechAdmission(store, attempt.request, mapping);
  fail(admission.reservation.state === "charged", "Generated narration requires a charged completed attempt");
  assertSpeechSpoolLineage(store, attempt, artifact.outputSpoolId!);
  const dispatch = record<SpeechExecutionDispatch>(store, "speech_execution_dispatch", attempt.id, projectId);
  const result = record<SpeechExecutionResult>(store, "speech_execution_result", attempt.id, projectId);
  const spool = record<OutputSpool>(store, "execution_output_spool", artifact.outputSpoolId!, projectId);
  const outputReceipt = record<OutputReceipt>(store, "execution_output_receipt", artifact.outputReceiptId!, projectId);
  const derivationIntent = record<AudioDerivationIntent>(store, "audio_derivation_intent", artifact.derivationId!, projectId);
  const derivationReceipt = record<AudioDerivationReceipt>(store, "audio_derivation_receipt", artifact.derivationId!, projectId);
  const mediaSource = record<GeneratedAudioMediaSource>(store, "media_source", artifactId, projectId);
  const output: ExecutionSpoolOutput = { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav", fixture: false,
    sha256: spool.sha256, byteLength: spool.byteLength, storage: { type: "spool", spoolId: spool.id } };
  assertNormalizedAudioIngestion(derivationIntent, attempt, output, { type: "normalized_audio", artifact, derivation: derivationReceipt, mediaSource });
  const source = derivationReceipt.source, artifactDigest = digest(artifact.artifact);
  const generation: GeneratedNarrationEvidence = { version: 1, adapter: "openai-speech", executionVersion: "1", model: mapping.transport.model, voice: mapping.transport.voice,
    artifactId, artifactDigest, artifactRecordDigest: digest(artifact), attemptId: attempt.id, requestDigest: digest(attempt.request),
    reservationId: admission.reservation.id, reservationDigest: digest(admission.reservation), mappingDigest: digest(mapping), dispatchDigest: digest(dispatch), resultDigest: digest(result),
    outputReceiptId: outputReceipt.id, outputReceiptDigest: digest(outputReceipt), outputSpoolId: spool.id, outputSpoolDigest: digest(spool),
    derivationId: derivationIntent.id, derivationIntentDigest: digest(derivationIntent), derivationReceiptDigest: digest(derivationReceipt),
    sourceDescriptorId: source.id, sourceDigest: digest(source), normalizedSamples: derivationReceipt.normalizedSamples };
  const audio = generatedShape({ id: artifactId, projectId, media: source, originEvidence: "verified_generated_audio", generation });
  return { audio, artifact, attempt, reservation: snapshot(admission.reservation), mapping, dispatch, result, outputReceipt, spool, output,
    derivationIntent, derivationReceipt, mediaSource, artifactDigest, generationEvidenceDigest: digest(generation) };
}
export function assertGeneratedNarrationAudio(store: SpeechAuthorityStore, projectId: string, input: unknown): asserts input is VerifiedGeneratedNarrationAudio {
  const audio = generatedShape(input), resolved = resolveGeneratedNarrationAudio(store, projectId, audio.id);
  fail(audio.projectId === projectId && canonical(audio) === canonical(resolved.audio), "Generated recording differs from its retained provenance");
}
export function createGeneratedNarrationProvenance(input: VerifiedGeneratedNarrationAudio, acceptances: GeneratedNarrationAcceptances): GeneratedNarrationProvenance {
  const audio = generatedShape(input), selected = snapshot(acceptances);
  exact(selected, ["scriptAcceptanceId", "audioAcceptanceId", "timingAcceptanceId"]);
  fail(Object.values(selected).every(id), "Canonical generated audio requires exact independent acceptance identities");
  return { audioId: audio.id, originEvidence: "verified_generated_audio", generation: audio.generation, ...selected,
    originalSha256: audio.media.originalSha256, toolchainDigest: audio.media.toolchainDigest };
}
export function assertGeneratedNarrationProvenance(store: SpeechAuthorityStore, projectId: string, input: unknown): asserts input is GeneratedNarrationProvenance {
  const value = snapshot(input);
  exact(value, ["audioId", "originEvidence", "generation", "scriptAcceptanceId", "audioAcceptanceId", "timingAcceptanceId", "originalSha256", "toolchainDigest"]);
  fail(id(value.audioId), "Invalid canonical generated recording identity");
  const resolved = resolveGeneratedNarrationAudio(store, projectId, value.audioId as string);
  const expected = createGeneratedNarrationProvenance(resolved.audio, { scriptAcceptanceId: value.scriptAcceptanceId as string,
    audioAcceptanceId: value.audioAcceptanceId as string, timingAcceptanceId: value.timingAcceptanceId as string });
  fail(canonical(value) === canonical(expected), "Canonical generated provenance differs from its recording");
}

/** Historical canonical proof, independent of mutable narration state or active request authority.
 * A selected acceptance ID alone does not prove the saved cue geometry or project placement.
 * Resolve the exact immutable revision entry, then reconstruct the entire canonical segment.
 */
export function assertGeneratedCanonicalNarrationSegment(store: SpeechAuthorityStore, projectId: string, input: unknown,
  selection: Pick<CanonicalNarration, "narrationRevisionId" | "narrationVersion">): void {
  const segment = snapshot(input), selected = snapshot(selection);
  exact(segment, ["segmentId", "segmentRevisionId", "cue", "frameCoverage", "audioPlacement", "provenance", ...(segment !== null && typeof segment === "object" && Object.hasOwn(segment, "transcriptProvenance") ? ["transcriptProvenance"] : [])]);
  exact(selected, ["narrationRevisionId", "narrationVersion"]);
  fail(id(segment.segmentId) && id(segment.segmentRevisionId) && id(selected.narrationRevisionId)
    && Number.isSafeInteger(selected.narrationVersion) && selected.narrationVersion > 0, "Canonical narration requires an exact saved revision");
  assertGeneratedNarrationProvenance(store, projectId, segment.provenance);
  const provenance = segment.provenance, audio = record<VerifiedGeneratedNarrationAudio>(store, "narration_audio", provenance.audioId, projectId);
  assertGeneratedNarrationAudio(store, projectId, audio);

  // Bound the whole revision before allocating its JSON. A 400-entry revision can exceed
  // the small generated-evidence record bound; only the selected entry needs a deep snapshot.
  const row = store.db.prepare("SELECT body FROM entities WHERE kind='narration_revision' AND id=? AND project_id=? AND length(CAST(body AS BLOB)) BETWEEN 1 AND ?")
    .get(selected.narrationRevisionId as string, projectId, 1024 * 1024) as { body: string } | undefined;
  fail(row, "Canonical narration revision is missing, foreign, or oversized");
  let revision: unknown;
  try { revision = JSON.parse(row!.body); } catch { fail(false, "Malformed canonical narration revision"); }
  exact(revision, ["id", "projectId", "state", "requestId"]);
  exact(revision.state, ["id", "projectId", "version", "revisionId", "entries"]);
  const state = revision.state;
  fail(revision.id === selected.narrationRevisionId && revision.projectId === projectId && state.id === projectId && state.projectId === projectId
    && state.revisionId === revision.id && state.version === selected.narrationVersion
    && Array.isArray(state.entries) && state.entries.length > 0 && state.entries.length <= 400, "Canonical narration revision identity differs");
  const entries = state.entries as unknown[];
  fail(entries.every(entry => entry !== null && typeof entry === "object" && !Array.isArray(entry) && id((entry as NarrationEntry).segmentId))
    && new Set(entries.map(entry => (entry as NarrationEntry).segmentId)).size === entries.length, "Canonical narration revision has invalid or repeated sections");
  const entry = snapshot(entries.find(entry => (entry as NarrationEntry).segmentId === segment.segmentId));
  exact(entry, ["segmentId", "segmentRevisionId", "audioId", "cueId", "atSample", "scriptAcceptanceId", "audioAcceptanceId", "timingAcceptanceId"]);
  fail(entry.segmentRevisionId === segment.segmentRevisionId && entry.audioId === audio.id && id(entry.cueId)
    && Number.isSafeInteger(entry.atSample) && Number(entry.atSample) >= 0, "Canonical narration differs from its selected revision entry");
  const script = record<SegmentRevision>(store, "narration_segment", segment.segmentRevisionId as string, projectId);
  fail(script.id === entry.segmentRevisionId && script.segmentId === entry.segmentId && script.projectId === projectId
    && script.textKind === "draft" && typeof script.text === "string" && script.text.trim().length > 0
    && typeof script.meaning === "string" && script.meaning.trim().length > 0 && script.source?.kind === "generated", "Canonical generated script differs from its accepted section");
  const cue = record<NarrationCue>(store, "narration_cue", entry.cueId as string, projectId);
  const transcriptProvenance = transcriptCanonicalProvenance(store, projectId, script, cue);
  assertTranscriptCanonicalSegment(store, projectId, segment, selection);
  fail(cue.id === entry.cueId && cue.projectId === projectId && cue.segmentRevisionId === script.id && cue.audioId === audio.id
    && (cue.method === "human" || cue.method === "transcript_selection" && transcriptProvenance?.timing) && cue.confidence === null && Number.isSafeInteger(cue.startSample) && cue.startSample >= 0
    && Number.isSafeInteger(cue.endSample) && cue.endSample > cue.startSample && cue.endSample <= audio.generation.normalizedSamples,
  "Canonical generated cue differs from its measured recording");
  for (const kind of ["script", "audio", "timing"] as const) {
    const acceptanceId = provenance[`${kind}AcceptanceId`];
    fail(entry[`${kind}AcceptanceId`] === acceptanceId, "Canonical acceptance was not selected by its exact narration revision");
    const accepted = record<NarrationAcceptance>(store, "narration_acceptance", acceptanceId, projectId);
    fail(accepted.id === acceptanceId && accepted.projectId === projectId && accepted.kind === kind && id(accepted.requestId)
      && typeof accepted.principalId === "string" && accepted.principalId.length > 0
      && accepted.subjectDigest === digest({ kind, segmentRevisionId: script.id,
        ...(kind !== "script" ? { audioId: audio.id } : {}), ...(kind === "timing" ? { cueId: cue.id } : {}) }), "Canonical generated acceptance differs from its exact subject");
    const request = record<{ id: string; projectId: string; principalId: string; editing: boolean; scopeIds: unknown }>(store, "message", accepted.requestId, projectId);
    // The authenticated human channel issued this request. Superseded/restored history
    // remains evidence; it does not become fresh mutation authority through this assertion.
    fail(request.id === accepted.requestId && request.projectId === projectId && request.principalId === accepted.principalId
      && request.editing === true && Array.isArray(request.scopeIds) && request.scopeIds.length <= 400 && request.scopeIds.includes(projectId),
    "Canonical generated acceptance lacks its human project request evidence");
  }
  const durationSamples = cue.endSample - cue.startSample, atSample = Number(entry.atSample);
  const frame = (sample: number): number => Number((BigInt(sample) + 800n) / 1600n);
  fail(atSample + durationSamples <= 48000 * 360 && frame(durationSamples) >= 1, "Canonical narration exceeds its accepted timeline bounds");
  const expected = { segmentId: entry.segmentId, segmentRevisionId: script.id,
    cue: { id: cue.id, meaning: script.meaning, placementFrames: frame(atSample), durationFrames: frame(durationSamples),
      audio: { artifactId: audio.id, sha256: audio.media.sha256, kind: "audio" }, accepted: true, measured: true },
    frameCoverage: { startFrame: frame(atSample), endFrame: frame(atSample + durationSamples) },
    audioPlacement: { source: audio.media, startSample: cue.startSample, durationSamples, atSample, gainMilliDb: 0 }, provenance,
    ...(transcriptProvenance ? { transcriptProvenance } : {}) };
  fail(canonical(segment) === canonical(expected), "Canonical generated section differs from its accepted script, cue, or placement");
}
/** A bounded saved-record projection, not a claim of fresh byte verification or narration acceptance. */
export function summarizeGeneratedNarrationAudio(input: ResolvedGeneratedNarrationAudio | VerifiedGeneratedNarrationAudio): GeneratedNarrationSummary {
  const value = snapshot(input), audio = generatedShape(isVerifiedGeneratedNarrationAudio(value) ? value : (value as ResolvedGeneratedNarrationAudio).audio);
  return { id: audio.id, media: audio.media, originEvidence: "verified_generated_audio",
    selection: { artifactDigest: audio.generation.artifactDigest, generationEvidenceDigest: digest(audio.generation) },
    generation: { adapter: "openai-speech", version: "1", model: audio.generation.model, voice: audio.generation.voice } };
}
export function assertGeneratedNarrationSummary(audio: VerifiedGeneratedNarrationAudio, input: unknown): asserts input is GeneratedNarrationSummary {
  fail(canonical(snapshot(input)) === canonical(summarizeGeneratedNarrationAudio(audio)), "Generated recording summary differs from its saved evidence");
}

async function sourceRecord(path: string, signal?: AbortSignal): Promise<unknown> {
  cancelled(signal); const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let value: unknown;
  try {
    const stat = await file.stat(); fail(stat.isFile() && stat.size > 0 && stat.size <= GENERATED_NARRATION_LIMITS.sourceBytes, "Invalid normalized source record");
    const bytes = Buffer.alloc(stat.size); let offset = 0;
    while (offset < bytes.length) { cancelled(signal); const read = await file.read(bytes, offset, bytes.length - offset, offset); cancelled(signal);
      fail(read.bytesRead > 0, "Normalized source record was truncated"); offset += read.bytesRead; }
    fail((await file.read(Buffer.alloc(1), 0, 1, offset)).bytesRead === 0, "Normalized source record grew");
    const after = await file.stat(); fail(after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs, "Normalized source record changed");
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(false, "Malformed normalized source record"); }
  } finally { await file.close(); cancelled(signal); }
  return value;
}
/** Verify existing owned bytes only. Raw .source is the exact paid WAV copy; backup additionally checks the execution-spool filesystem closure. */
export async function verifyGeneratedNarrationAudio(store: SpeechAuthorityStore, media: Pick<LocalMediaService, "rootDir">,
  configuration: { artifactDir: string }, input: ResolvedGeneratedNarrationAudio, options: { signal?: AbortSignal } = {}): Promise<ResolvedGeneratedNarrationAudio> {
  const signal = options.signal, captured = snapshot(input), artifactDir = configuration.artifactDir, mediaRoot = media.rootDir;
  const selected = generatedShape(captured && typeof captured === "object" ? captured.audio : undefined);
  cancelled(signal);
  fail(typeof artifactDir === "string" && isAbsolute(artifactDir) && artifactDir !== "/" && typeof mediaRoot === "string" && isAbsolute(mediaRoot) && mediaRoot !== "/", "Configure exact owned audio directories");
  const initial = resolveGeneratedNarrationAudio(store, selected.projectId, selected.id);
  fail(canonical(initial.audio) === canonical(selected), "Selected generated recording changed before verification");
  const root = await realpath(artifactDir); cancelled(signal);
  const directory = join(root, selected.projectId), blobs = join(mediaRoot, "blobs"), sources = join(mediaRoot, "sources");
  const paths = async (): Promise<void> => {
    for (const path of [root, directory, mediaRoot, blobs, sources]) { cancelled(signal); fail(await realpath(path) === path, "Owned generated audio directories cannot be replaced by links"); cancelled(signal); }
  };
  fail(/^[A-Za-z0-9_-]{1,128}$/.test(selected.projectId), "Invalid owned artifact project directory");
  await paths();
  const source = initial.audio.media, installedPath = join(directory, `${source.sha256}.wav`);
  fail(initial.artifact.path === installedPath, "Generated artifact is outside its exact managed location");
  const storedSource = await sourceRecord(join(sources, `${source.id}.json`), signal); cancelled(signal);
  fail(canonical(storedSource) === canonical(source), "Normalized descriptor differs from the exact stored source");
  const original = await inspectPcmWave(join(blobs, `${source.originalSha256}.source`), AUDIO_DERIVATION_LIMITS.inputBytes, signal); cancelled(signal);
  fail(original.sha256 === source.originalSha256 && original.byteLength === source.originalByteLength
    && canonical(original.pcm) === canonical(initial.derivationIntent.rawPcm), "Original generated PCM differs from its paid raw output");
  const verifyNormalized = async (path: string): Promise<void> => {
    const observed = await inspectPcmWave(path, initial.derivationIntent.normalization.maxOutputBytes, signal); cancelled(signal);
    fail(observed.sha256 === source.sha256 && observed.byteLength === source.byteLength && observed.pcm.sampleRate === 48000
      && observed.pcm.channels === 2 && observed.pcm.bitsPerSample === 16 && observed.pcm.sampleCount === initial.derivationReceipt.normalizedSamples,
    "Installed generated audio differs from its complete normalized PCM");
  };
  await verifyNormalized(join(blobs, `${source.sha256}.wav`)); await verifyNormalized(installedPath); await paths(); cancelled(signal);
  const current = resolveGeneratedNarrationAudio(store, selected.projectId, selected.id);
  fail(canonical(current.audio) === canonical(initial.audio), "Selected generated recording changed during verification");
  cancelled(signal); return current;
}
