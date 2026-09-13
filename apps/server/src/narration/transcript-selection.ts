import { createHash } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";
import type { ArtifactRecord, Attempt } from "../execution/engine.js";
import { assertTranscriptCandidateIngestion, resolveTranscriptionSpoolLineage, TRANSCRIPT_CANDIDATE_LIMITS } from "../execution/transcript-candidate.js";
import type { TranscriptCandidate, TranscriptionSpoolLineage } from "../execution/transcript-candidate.js";
import { resolveTranscriptionAdmission } from "../execution/transcription-execution-authority.js";
import type { TranscriptionAuthorityStore } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionAudioSource } from "../execution/transcription-audio.js";
import type { NarrationAudio, NarrationCue, NarrationEntry, NarrationState, SegmentDraft, SegmentRevision,
  TranscriptCanonicalProvenance, TranscriptNarrationCue, NarrationAcceptance } from "./types.js";

export const TRANSCRIPT_SELECTION_POLICY = "trim-join-ascii-space-v1" as const;
export const TRANSCRIPT_SELECTION_LIMITS = Object.freeze({ recordBytes: 16384, contextBytes: 1024 * 1024, textCodeUnits: 16000, rawBytes: 4 * 1024 * 1024 });
export interface TranscriptWordRange { startWordIndex: number; endWordIndex: number }
export interface TranscriptSelectionIssue { source: "parser" | "sample" | "range"; code: string; wordIndex: number | null }
export interface TranscriptRangePreview {
  policy: typeof TRANSCRIPT_SELECTION_POLICY; text: string | null; selectedTextDigest: string;
  writing: { allowed: boolean; code: "TEXT_TOO_LONG" | null };
  timing: { allowed: boolean; startSample: number | null; endSample: number | null; issues: TranscriptSelectionIssue[] };
  warnings: Array<{ source: "parser"; code: "text_word_mismatch"; wordIndex: null }>;
}
export interface ResolvedPublishedTranscriptCandidate {
  candidate: TranscriptCandidate; candidateDigest: string; lineage: TranscriptionSpoolLineage; artifact: ArtifactRecord; reservationDigest: string;
}
export interface TranscriptSelection {
  id: string; projectId: string; version: 1; requestId: string; principalId: string;
  action: "writing" | "timing"; policy: typeof TRANSCRIPT_SELECTION_POLICY;
  candidateId: string; candidateDigest: string; attemptId: string; executionRequestDigest: string;
  rawArtifactId: string; rawArtifactDigest: string; reservationDigest: string;
  source: { record: TranscriptCandidate["source"]["record"]; descriptorId: string; descriptorDigest: string; startSample: 0; endSample: number };
  input: { narrationRevisionId: string; narrationVersion: number; segmentId: string; segmentRevisionId: string; scriptDigest: string;
    audioId: string; audioDigest: string; cueId: string | null; cueDigest: string | null; entryDigest: string };
  startWordIndex: number; endWordIndex: number; selectedTextDigest: string;
  output: { kind: "narration_segment" | "narration_cue"; id: string; digest: string };
}
export interface CreateTranscriptSelection {
  id: string; outputId: string; projectId: string; requestId: string; principalId: string; action: "writing" | "timing";
  state: NarrationState; entry: NarrationEntry; script: SegmentRevision; audio: NarrationAudio; cue: NarrationCue | null;
  published: ResolvedPublishedTranscriptCandidate; range: TranscriptWordRange; selectedTextDigest: string;
}
export type TranscriptSelectionOutput = { kind: "narration_segment"; record: SegmentRevision } | { kind: "narration_cue"; record: TranscriptNarrationCue };
export type TranscriptSelectionCreation = { changed: false; preview: TranscriptRangePreview }
  | { changed: true; preview: TranscriptRangePreview; selection: TranscriptSelection; output: TranscriptSelectionOutput };

const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPT_SELECTION_CONFLICT", message);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/.test(value);
const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;

/** Plain copied data only. This module never imports physical/media or generated-audio validators. */
export function snapshotTranscriptSelectionData<T>(input: T, maxBytes = TRANSCRIPT_SELECTION_LIMITS.contextBytes): T {
  let nodes = 0, bytes = 0; const ancestors = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    fail(++nodes <= 400000 && depth <= 32, "Transcript selection exceeds its structural bound");
    if (typeof value === "string") { bytes += Buffer.byteLength(value); fail(bytes <= maxBytes, "Transcript selection exceeds its text bound"); return value; }
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { fail(Number.isFinite(value), "Transcript selection contains a nonfinite value"); return value; }
    fail(value !== null && typeof value === "object" && !ancestors.has(value as object), "Transcript selection requires plain acyclic data");
    const array = Array.isArray(value), object = value as object;
    fail(array ? Object.getPrototypeOf(value) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(value)), "Transcript selection requires plain data");
    const keys = Reflect.ownKeys(object); fail(keys.length <= 65537, "Transcript selection has too many fields");
    if (array) fail((value as unknown[]).length <= 65536 && keys.length === (value as unknown[]).length + 1, "Transcript selection arrays must be bounded and dense");
    ancestors.add(object); const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      fail(typeof key === "string" && (!array || /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < (value as unknown[]).length), "Invalid transcript selection field");
      const property = Object.getOwnPropertyDescriptor(object, key)!;
      fail(Object.hasOwn(property, "value") && property.enumerable, "Transcript selection accessors and hidden fields are unsupported");
      bytes += Buffer.byteLength(key as string); fail(bytes <= maxBytes, "Transcript selection exceeds its key bound");
      Object.defineProperty(result, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    ancestors.delete(object); return result;
  };
  const result = copy(input, 0); fail(Buffer.byteLength(canonical(result)) <= maxBytes, "Transcript selection exceeds its byte bound"); return result as T;
}
function exact(input: unknown, fields: string[]): asserts input is Record<string, unknown> {
  fail(input !== null && typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === fields.length
    && fields.every(field => Object.hasOwn(input, field)), "Unsupported transcript selection fields");
}
export function transcriptSelectionRecord<T>(store: TranscriptionAuthorityStore, kind: string, recordId: string, projectId: string,
  maxBytes = TRANSCRIPT_SELECTION_LIMITS.contextBytes): T {
  fail(id(recordId) && id(projectId), "Invalid saved transcript selection identity");
  const row = store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=? AND project_id=? AND length(CAST(body AS BLOB)) BETWEEN 1 AND ?")
    .get(kind, recordId, projectId, maxBytes) as { body: string } | undefined;
  fail(row, "Transcript selection reference is missing, foreign, or oversized");
  let result: unknown; try { result = JSON.parse(row!.body); } catch { fail(false, "Malformed transcript selection reference"); }
  fail(result !== null && typeof result === "object" && (result as { id?: unknown }).id === recordId && (result as { projectId?: unknown }).projectId === projectId,
    "Saved transcript selection identity differs"); return result as T;
}
function validatePublished(value: ResolvedPublishedTranscriptCandidate): void {
  fail(value && value.candidate && value.lineage?.attempt && value.lineage.spool && value.artifact, "Missing completed transcript evidence");
  const { candidate, lineage, artifact } = value, { attempt, spool } = lineage;
  fail(candidate.projectId === attempt.projectId && value.candidateDigest === digest(candidate) && hash(value.reservationDigest)
    && attempt.phase === "succeeded" && canonical(attempt.outputs.cues) === canonical(artifact.artifact), "Transcript candidate is not its exact completed output");
  assertTranscriptCandidateIngestion(lineage, { port: "cues", kind: "data", mimeType: "application/json", extension: "json", fixture: false,
    sha256: spool.sha256, byteLength: spool.byteLength, storage: { type: "spool", spoolId: spool.id } }, { type: "transcript_candidate", candidate, artifact });
}
/** Historical metadata only. A current node binding, active lease, or current provider is unnecessary. */
export function resolvePublishedTranscriptCandidate(store: TranscriptionAuthorityStore, projectId: string, candidateId: string): ResolvedPublishedTranscriptCandidate {
  store.getProject(projectId);
  const candidate = transcriptSelectionRecord<TranscriptCandidate>(store, "transcript_candidate", candidateId, projectId, TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes);
  const attempt = transcriptSelectionRecord<Attempt>(store, "attempt", candidate.attemptId, projectId);
  const lineage = resolveTranscriptionSpoolLineage(store, attempt, candidate.raw.spoolId);
  const artifact = transcriptSelectionRecord<ArtifactRecord>(store, "artifact", candidate.artifactId, projectId);
  const admission = resolveTranscriptionAdmission(store, attempt.request, lineage.mapping);
  fail(admission.reservation.state === "charged", "Select a transcript whose completed output has settled its reservation");
  const resolved = { candidate, candidateDigest: digest(candidate), lineage, artifact, reservationDigest: digest(admission.reservation) };
  validatePublished(resolved); return resolved;
}

/** Exact preview policy. Timing issues never prevent using the recognized text as a draft. */
export function previewTranscriptRange(input: TranscriptCandidate, rangeInput: TranscriptWordRange): TranscriptRangePreview {
  const candidate = snapshotTranscriptSelectionData(input, TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes), range = snapshotTranscriptSelectionData(rangeInput);
  exact(range, ["startWordIndex", "endWordIndex"]);
  fail(candidate?.version === 1 && candidate.projection?.samplePolicy === "seconds-to-48k-half-up-v1" && Array.isArray(candidate.projection.words)
    && candidate.projection.words.length <= 8192 && Array.isArray(candidate.projection.parserIssues) && Array.isArray(candidate.projection.sampleIssues)
    && candidate.source?.startSample === 0 && integer(candidate.source.endSample, 1, 48000 * 360), "Unsupported transcript projection");
  const { startWordIndex: start, endWordIndex: end } = range, words = candidate.projection.words;
  fail(integer(start, 0, words.length - 1) && integer(end, start + 1, words.length), "Choose one nonempty contiguous word range");
  const selected = words.slice(start, end); const text = selected.map(word => {
    fail(word && typeof word.word === "string" && Buffer.byteLength(word.word) <= 1024 && word.word.trim().length > 0, "Invalid selected transcript word"); return word.word.trim();
  }).join(" ");
  const selectedTextDigest = digest({ policy: TRANSCRIPT_SELECTION_POLICY, text }), issues: TranscriptSelectionIssue[] = [];
  const warnings: TranscriptRangePreview["warnings"] = [];
  for (const issue of candidate.projection.parserIssues) {
    fail(issue && ["word_outside_source", "word_overlap", "word_nonmonotone", "text_word_mismatch", "reported_duration_outside_source"].includes(issue.code), "Unknown parser timing issue");
    fail(issue.code === "text_word_mismatch" || issue.code === "reported_duration_outside_source" ? issue.wordIndex === null : integer(issue.wordIndex, 0, words.length - 1), "Invalid parser issue index");
    if (issue.code === "text_word_mismatch") { warnings.push({ source: "parser", code: "text_word_mismatch", wordIndex: null }); continue; }
    if (issue.code === "reported_duration_outside_source" || issue.wordIndex !== null && issue.wordIndex >= start && issue.wordIndex < end)
      issues.push({ source: "parser", code: issue.code, wordIndex: issue.wordIndex });
  }
  for (const issue of candidate.projection.sampleIssues) {
    fail(issue && ["source_range_exceeded", "unsafe_sample_coordinate", "empty_sample_interval", "mapped_word_overlap", "mapped_word_nonmonotone"].includes(issue.code), "Unknown source-sample timing issue");
    fail(integer(issue.wordIndex, 0, words.length - 1), "Invalid source-sample issue index");
    if (issue.wordIndex >= start && issue.wordIndex < end) issues.push({ source: "sample", code: issue.code, wordIndex: issue.wordIndex });
  }
  let priorEnd = -1, priorStart = -1;
  for (const [offset, word] of selected.entries()) {
    const index = start + offset;
    if (!integer(word.startSample, 0, candidate.source.endSample) || !integer(word.endSample, 1, candidate.source.endSample) || word.endSample <= word.startSample)
      issues.push({ source: "range", code: "INVALID_SOURCE_INTERVAL", wordIndex: index });
    else {
      if (word.startSample < priorEnd || word.startSample < priorStart) issues.push({ source: "range", code: "NONMONOTONE_OR_OVERLAPPING_RANGE", wordIndex: index });
      priorStart = word.startSample; priorEnd = Math.max(priorEnd, word.endSample);
    }
  }
  const first = selected[0]!, last = selected.at(-1)!;
  const allowed = issues.length === 0, writingAllowed = text.length <= TRANSCRIPT_SELECTION_LIMITS.textCodeUnits;
  return { policy: TRANSCRIPT_SELECTION_POLICY, text: writingAllowed ? text : null, selectedTextDigest,
    writing: { allowed: writingAllowed, code: writingAllowed ? null : "TEXT_TOO_LONG" },
    timing: { allowed, startSample: allowed ? first.startSample : null, endSample: allowed ? last.endSample : null, issues }, warnings };
}

function draft(script: SegmentRevision): SegmentDraft { return { text: script.text, textKind: script.textKind, meaning: script.meaning, language: script.language, source: script.source }; }
function context(input: CreateTranscriptSelection): Omit<CreateTranscriptSelection, "published"> {
  const { published: _published, ...rest } = input; return snapshotTranscriptSelectionData(rest);
}
export function createTranscriptSelection(inputValue: CreateTranscriptSelection): TranscriptSelectionCreation {
  const input = snapshotTranscriptSelectionData(inputValue, TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes + 4 * TRANSCRIPT_SELECTION_LIMITS.contextBytes);
  exact(input, ["id", "outputId", "projectId", "requestId", "principalId", "action", "state", "entry", "script", "audio", "cue", "published", "range", "selectedTextDigest"]);
  const value = context(input), published = input.published; validatePublished(published);
  const { state, entry, script, audio, cue } = value;
  fail(state && entry && script && audio, "Missing transcript selection section context");
  fail(id(value.id) && id(value.outputId) && id(value.projectId) && id(value.requestId) && id(value.principalId)
    && ["writing", "timing"].includes(value.action) && state.projectId === value.projectId && state.id === value.projectId && id(state.revisionId)
    && integer(state.version, 1, Number.MAX_SAFE_INTEGER) && Array.isArray(state.entries) && state.entries.length <= 400
    && canonical(state.entries.find(item => item.segmentId === entry.segmentId)) === canonical(entry)
    && script.id === entry.segmentRevisionId && script.segmentId === entry.segmentId && script.projectId === value.projectId
    && audio.id === entry.audioId && audio.projectId === value.projectId
    && (cue ? cue.id === entry.cueId && cue.projectId === value.projectId && cue.segmentRevisionId === script.id && cue.audioId === audio.id : entry.cueId === null),
  "Transcript selection must target the exact saved section and attached recording");
  assertTranscriptionAudioSource(audio.media);
  fail(published.candidate.projectId === value.projectId && canonical(audio.media) === canonical(published.candidate.source.descriptor)
    && audio.id === audio.media.artifactId && published.candidate.source.startSample === 0 && published.candidate.source.endSample === audio.media.probe.audio!.samples,
  "Transcript belongs to another recording");
  const preview = previewTranscriptRange(published.candidate, value.range);
  fail(hash(value.selectedTextDigest) && value.selectedTextDigest === preview.selectedTextDigest, "Selected words changed since preview");
  let output: TranscriptSelectionOutput;
  if (value.action === "writing") {
    invariant(preview.writing.allowed && preview.text !== null, "TRANSCRIPT_SELECTION_TEXT_TOO_LONG", "Selected words exceed the section text limit");
    const next: SegmentDraft = { ...draft(script), text: preview.text, textKind: "draft" };
    if (canonical(next) === canonical(draft(script))) return { changed: false, preview };
    output = { kind: "narration_segment", record: { ...next, id: value.outputId, projectId: value.projectId, segmentId: entry.segmentId, transcriptSelectionId: value.id } };
  } else {
    invariant(preview.timing.allowed && preview.timing.startSample !== null && preview.timing.endSample !== null,
      "TRANSCRIPT_SELECTION_TIMING_UNSAFE", "Selected words do not have a usable suggested source range");
    if (cue && cue.startSample === preview.timing.startSample && cue.endSample === preview.timing.endSample) return { changed: false, preview };
    output = { kind: "narration_cue", record: { id: value.outputId, projectId: value.projectId, segmentRevisionId: script.id, audioId: audio.id,
      startSample: preview.timing.startSample, endSample: preview.timing.endSample, method: "transcript_selection", confidence: null, transcriptSelectionId: value.id } };
  }
  fail(value.outputId !== script.id && value.outputId !== cue?.id && value.outputId === value.id, "Transcript selection and its fresh output must share one allocated identity");
  const candidate = published.candidate;
  const selection: TranscriptSelection = { id: value.id, projectId: value.projectId, version: 1, requestId: value.requestId, principalId: value.principalId,
    action: value.action, policy: TRANSCRIPT_SELECTION_POLICY, candidateId: candidate.id, candidateDigest: published.candidateDigest,
    attemptId: candidate.attemptId, executionRequestDigest: candidate.requestDigest, rawArtifactId: published.artifact.id, rawArtifactDigest: digest(published.artifact), reservationDigest: published.reservationDigest,
    source: { record: snapshotTranscriptSelectionData(candidate.source.record), descriptorId: audio.media.id, descriptorDigest: digest(audio.media), startSample: 0, endSample: candidate.source.endSample },
    input: { narrationRevisionId: state.revisionId!, narrationVersion: state.version, segmentId: entry.segmentId, segmentRevisionId: script.id, scriptDigest: digest(script),
      audioId: audio.id, audioDigest: digest(audio), cueId: cue?.id ?? null, cueDigest: cue ? digest(cue) : null, entryDigest: digest(entry) },
    ...value.range, selectedTextDigest: preview.selectedTextDigest, output: { kind: output.kind, id: value.outputId, digest: digest(output.record) } };
  fail(Buffer.byteLength(canonical(selection)) <= TRANSCRIPT_SELECTION_LIMITS.recordBytes, "Transcript selection evidence exceeds its bound");
  return { changed: true, preview, selection, output };
}

function selectedContext(store: TranscriptionAuthorityStore, projectId: string, selection: TranscriptSelection): Pick<CreateTranscriptSelection, "state" | "entry" | "script" | "audio" | "cue"> {
  const revision = transcriptSelectionRecord<{ id: string; projectId: string; state: NarrationState }>(store, "narration_revision", selection.input.narrationRevisionId, projectId);
  const state = revision.state;
  fail(state?.revisionId === revision.id && state.version === selection.input.narrationVersion && Array.isArray(state.entries) && state.entries.length <= 400, "Transcript selection lost its input narration revision");
  const entry = state.entries.find(item => item.segmentId === selection.input.segmentId); fail(entry, "Transcript selection section is missing");
  const script = transcriptSelectionRecord<SegmentRevision>(store, "narration_segment", selection.input.segmentRevisionId, projectId);
  const audio = transcriptSelectionRecord<NarrationAudio>(store, "narration_audio", selection.input.audioId, projectId);
  const cue = selection.input.cueId ? transcriptSelectionRecord<NarrationCue>(store, "narration_cue", selection.input.cueId, projectId) : null;
  return { state, entry: entry!, script, audio, cue };
}
function reconstructSelection(store: TranscriptionAuthorityStore, projectId: string, input: unknown): Extract<TranscriptSelectionCreation, { changed: true }> {
  const selection = snapshotTranscriptSelectionData(input, TRANSCRIPT_SELECTION_LIMITS.recordBytes) as TranscriptSelection;
  fail(selection?.version === 1 && selection.policy === TRANSCRIPT_SELECTION_POLICY && selection.projectId === projectId && selection.input && selection.output,
    "Unknown transcript selection evidence");
  const published = resolvePublishedTranscriptCandidate(store, projectId, selection.candidateId);
  const request = transcriptSelectionRecord<{ id: string; principalId: string; editing: boolean; scopeIds: string[] }>(store, "message", selection.requestId, projectId);
  fail(request.principalId === selection.principalId && request.editing === true && Array.isArray(request.scopeIds) && request.scopeIds.includes(projectId), "Transcript selection lost its human project request");
  const result = createTranscriptSelection({ id: selection.id, outputId: selection.output.id, projectId, requestId: selection.requestId, principalId: selection.principalId,
    action: selection.action, ...selectedContext(store, projectId, selection), published,
    range: { startWordIndex: selection.startWordIndex, endWordIndex: selection.endWordIndex }, selectedTextDigest: selection.selectedTextDigest });
  fail(result.changed && canonical(result.selection) === canonical(selection), "Transcript selection differs from its exact deterministic editorial change");
  return result as Extract<TranscriptSelectionCreation, { changed: true }>;
}
/** Validate the predicted output before insertion; no cyclic requirement that it already exist. */
export function assertTranscriptSelection(store: TranscriptionAuthorityStore, projectId: string, input: unknown): asserts input is TranscriptSelection {
  reconstructSelection(store, projectId, input);
}
export function assertTranscriptSelectionOutput(store: TranscriptionAuthorityStore, projectId: string, kind: "narration_segment" | "narration_cue", input: unknown): void {
  const output = snapshotTranscriptSelectionData(input) as SegmentRevision | TranscriptNarrationCue;
  fail(output && id(output.id), "Invalid narration output identity");
  const exists = store.db.prepare("SELECT 1 FROM entities WHERE kind='narration_transcript_selection' AND id=?").get(output.id);
  if (!exists && !Object.hasOwn(output, "transcriptSelectionId") && !("method" in output && output.method === "transcript_selection")) return;
  fail(output.transcriptSelectionId === output.id, "Transcript output lacks its exact keyed selection backlink");
  const selection = transcriptSelectionRecord<TranscriptSelection>(store, "narration_transcript_selection", output.id, projectId, TRANSCRIPT_SELECTION_LIMITS.recordBytes);
  const expected = reconstructSelection(store, projectId, selection);
  fail(expected.output.kind === kind && canonical(expected.output.record) === canonical(output), "Transcript-derived output differs from its immutable selection");
}
export function transcriptCanonicalProvenance(store: TranscriptionAuthorityStore, projectId: string, script: SegmentRevision, cue: NarrationCue | null): TranscriptCanonicalProvenance | undefined {
  script = snapshotTranscriptSelectionData(script); cue = snapshotTranscriptSelectionData(cue);
  const links: TranscriptCanonicalProvenance = {};
  assertTranscriptSelectionOutput(store, projectId, "narration_segment", script);
  if (Object.hasOwn(script, "transcriptSelectionId")) {
    links.writing = { selectionId: script.transcriptSelectionId!, selectionDigest: digest(transcriptSelectionRecord(store, "narration_transcript_selection", script.transcriptSelectionId!, projectId, TRANSCRIPT_SELECTION_LIMITS.recordBytes)) };
  }
  if (cue) assertTranscriptSelectionOutput(store, projectId, "narration_cue", cue);
  if (cue && (cue.method === "transcript_selection" || Object.hasOwn(cue, "transcriptSelectionId"))) {
    links.timing = { selectionId: (cue as TranscriptNarrationCue).transcriptSelectionId,
      selectionDigest: digest(transcriptSelectionRecord(store, "narration_transcript_selection", (cue as TranscriptNarrationCue).transcriptSelectionId, projectId, TRANSCRIPT_SELECTION_LIMITS.recordBytes)) };
  }
  return Object.keys(links).length ? links : undefined;
}

/** Canonical links are derived from immutable selected outputs, never just an incoming tag. */
export function assertTranscriptCanonicalSegment(store: TranscriptionAuthorityStore, projectId: string, input: unknown,
  selection: { narrationRevisionId: string | null; narrationVersion: number }): void {
  const segment = snapshotTranscriptSelectionData(input) as Record<string, any>;
  // Older canonical records were not required to retain narration workspace rows.
  // Only the new incoming/saved/keyed evidence activates this additional contract.
  const linked = (kind: string, outputId: unknown): boolean => {
    if (!id(outputId)) return false;
    if (store.db.prepare("SELECT 1 FROM entities WHERE kind='narration_transcript_selection' AND id=?").get(outputId)) return true;
    const row = store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=? AND project_id=? AND length(CAST(body AS BLOB)) BETWEEN 1 AND ?")
      .get(kind, outputId, projectId, TRANSCRIPT_SELECTION_LIMITS.contextBytes) as { body: string } | undefined;
    if (!row) return false;
    let value: unknown; try { value = JSON.parse(row.body); } catch { return false; }
    return value !== null && typeof value === "object" && (Object.hasOwn(value, "transcriptSelectionId") || (value as { method?: unknown }).method === "transcript_selection");
  };
  if (!Object.hasOwn(segment ?? {}, "transcriptProvenance") && !linked("narration_segment", segment?.segmentRevisionId) && !linked("narration_cue", segment?.cue?.id)) return;
  fail(segment && id(segment.segmentRevisionId) && id(segment.cue?.id), "Invalid canonical transcript section");
  const script = transcriptSelectionRecord<SegmentRevision>(store, "narration_segment", segment.segmentRevisionId, projectId);
  const cue = transcriptSelectionRecord<NarrationCue>(store, "narration_cue", segment.cue.id, projectId);
  const provenance = transcriptCanonicalProvenance(store, projectId, script, cue);
  if (!provenance) { fail(!Object.hasOwn(segment, "transcriptProvenance"), "Canonical transcript provenance has no saved output backlink"); return; }
  fail(canonical(segment.transcriptProvenance) === canonical(provenance) && id(selection.narrationRevisionId), "Canonical transcript provenance differs from its selected outputs");
  const revision = transcriptSelectionRecord<{ state: NarrationState }>(store, "narration_revision", selection.narrationRevisionId!, projectId), state = revision.state;
  fail(state?.revisionId === selection.narrationRevisionId && state.version === selection.narrationVersion && state.projectId === projectId
    && Array.isArray(state.entries) && state.entries.length <= 400, "Canonical transcript lost its narration revision");
  const entry = state.entries.find(item => item.segmentId === segment.segmentId);
  fail(entry && entry.segmentRevisionId === script.id && script.segmentId === entry.segmentId && entry.cueId === cue.id && entry.audioId === cue.audioId
    && cue.segmentRevisionId === script.id, "Canonical transcript differs from its selected script or recording");
  const audio = transcriptSelectionRecord<NarrationAudio>(store, "narration_audio", cue.audioId, projectId); assertTranscriptionAudioSource(audio.media);
  fail(segment.provenance?.audioId === audio.id, "Canonical transcript provenance names another recording");
  if (!(Object.hasOwn(audio, "originEvidence") || Object.hasOwn(audio, "generation"))) {
    const supplied = audio as Extract<NarrationAudio, { declaredOrigin: string }>;
    fail(canonical(segment.provenance) === canonical({ audioId: supplied.id, declaredOrigin: supplied.declaredOrigin, originEvidence: "human_declared_supplied_recording",
      scriptAcceptanceId: entry!.scriptAcceptanceId, audioAcceptanceId: entry!.audioAcceptanceId, timingAcceptanceId: entry!.timingAcceptanceId,
      originalSha256: supplied.media.originalSha256, toolchainDigest: supplied.media.toolchainDigest }), "Canonical transcript supplied-recording provenance differs");
  }
  fail(integer(cue.startSample, 0, audio.media.probe.audio!.samples!) && integer(cue.endSample, cue.startSample + 1, audio.media.probe.audio!.samples!)
    && integer(entry!.atSample, 0, 48000 * 360), "Canonical transcript source range is invalid");
  for (const kind of ["script", "audio", "timing"] as const) {
    const acceptanceId = entry![`${kind}AcceptanceId`]; fail(id(acceptanceId), "Canonical transcript requires explicit acceptance");
    const accepted = transcriptSelectionRecord<NarrationAcceptance>(store, "narration_acceptance", acceptanceId!, projectId);
    fail(accepted.kind === kind && accepted.subjectDigest === digest({ kind, segmentRevisionId: script.id, ...(kind !== "script" ? { audioId: audio.id } : {}), ...(kind === "timing" ? { cueId: cue.id } : {}) })
      && segment.provenance?.[`${kind}AcceptanceId`] === acceptanceId, "Canonical transcript acceptance subject differs");
    const request = transcriptSelectionRecord<{ principalId: string; editing: boolean; scopeIds: string[] }>(store, "message", accepted.requestId, projectId);
    fail(request.principalId === accepted.principalId && request.editing === true && Array.isArray(request.scopeIds) && request.scopeIds.includes(projectId), "Canonical transcript acceptance lost its human request");
  }
  const samples = cue.endSample - cue.startSample, at = entry!.atSample, frame = (value: number): number => Number((BigInt(value) + 800n) / 1600n);
  fail(at + samples <= 48000 * 360 && frame(samples) > 0 && canonical(segment.cue) === canonical({ id: cue.id, meaning: script.meaning, placementFrames: frame(at), durationFrames: frame(samples),
    audio: { artifactId: audio.id, kind: "audio", sha256: audio.media.sha256 }, accepted: true, measured: true })
    && canonical(segment.audioPlacement) === canonical({ source: audio.media, startSample: cue.startSample, durationSamples: samples, atSample: at, gainMilliDb: 0 })
    && canonical(segment.frameCoverage) === canonical({ startFrame: frame(at), endFrame: frame(at + samples) }), "Canonical transcript geometry differs from accepted source coverage");
}

/** Exact byte hash helper for the separate read-only physical verifier. */
export function transcriptSelectionByteHash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
