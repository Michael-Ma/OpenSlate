import { canonical, digest, DomainError, invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { TRANSCRIPT_CANDIDATE_LIMITS } from "../execution/transcript-candidate.js";
import { previewTranscriptRange, resolvePublishedTranscriptCandidate } from "./transcript-selection.js";
import type { NarrationAudio } from "./types.js";

export const TRANSCRIPT_REVIEW_LIMITS = Object.freeze({ candidateIds: 20, candidateBytes: 16 * 1024 ** 2, words: 64, pageBytes: 64 * 1024, audioBytes: 128 * 1024, maximumOffset: 1_000_000 });
const check = (value: unknown, message: string) => invariant(value, "TRANSCRIPT_REVIEW_CONFLICT", message);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function offsetValue(offset: number, max: number = TRANSCRIPT_REVIEW_LIMITS.maximumOffset): void {
  invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= max, "VALIDATION_ERROR", "Invalid transcript page offset");
}
function recording(store: Store, projectId: string, audioId: string): NarrationAudio {
  store.getProject(projectId);
  const meta = store.db.prepare("SELECT project_id, length(CAST(body AS BLOB)) AS bytes FROM entities WHERE kind='narration_audio' AND id=?").get(audioId) as { project_id: string; bytes: number } | undefined;
  check(meta?.project_id === projectId && meta.bytes > 0 && meta.bytes <= TRANSCRIPT_REVIEW_LIMITS.audioBytes, "Attach an owned recording before reviewing its transcript");
  const audio = store.get<NarrationAudio>("narration_audio", audioId);
  check(audio?.projectId === projectId && audio.id === audioId && audio.media?.kind === "audio" && audio.media.artifactId === audioId, "Transcript recording identity is invalid");
  return audio!;
}
function resolved(store: Store, projectId: string, audio: NarrationAudio, candidateId: string, expectedDigest?: string) {
  const value = resolvePublishedTranscriptCandidate(store, projectId, candidateId);
  check(expectedDigest === undefined || hash(expectedDigest) && value.candidateDigest === expectedDigest, "The reviewed transcript changed");
  check(canonical(value.candidate.source.descriptor) === canonical(audio.media)
    && value.candidate.source.startSample === 0 && value.candidate.source.endSample === audio.media.probe.audio?.samples,
  "This transcript describes a different recording");
  return value;
}
function summary(value: ReturnType<typeof resolvePublishedTranscriptCandidate>, audioId: string) {
  const candidate = value.candidate;
  return { id: candidate.id, candidateDigest: value.candidateDigest, audioId, sourceDescriptorDigest: digest(candidate.source.descriptor),
    wordCount: candidate.projection.words.length, reportedLanguage: candidate.projection.reportedLanguage,
    parserIssueCount: candidate.projection.parserIssues.length, sampleIssueCount: candidate.projection.sampleIssues.length,
    sourceSampleCount: candidate.source.endSample };
}
function bounded<T>(value: T): T {
  invariant(Buffer.byteLength(canonical(value)) <= TRANSCRIPT_REVIEW_LIMITS.pageBytes, "TRANSCRIPT_REVIEW_TOO_LARGE", "Transcript page exceeds its bounded size"); return value;
}

/** Scan coverage concerns candidate records, including other takes and invalid retained history. No read creates authority or a selection. */
export function projectTranscriptCandidates(store: Store, projectId: string, audioId: string, offset = 0, expectedDigest?: string) {
  offsetValue(offset);
  return store.transaction(() => {
    const audio = recording(store, projectId, audioId);
    const inventory = store.db.prepare("SELECT COUNT(*) AS total, COALESCE(MAX(rowid),0) AS newest FROM entities WHERE kind='transcript_candidate' AND project_id=?").get(projectId) as { total: number; newest: number };
    const dataDigest = digest({ projectId, audioId, source: digest(audio.media), ...inventory });
    check(expectedDigest === undefined || expectedDigest === dataDigest, "Transcript library changed; refresh before loading more");
    offsetValue(offset, inventory.total);
    const metadata = store.db.prepare("SELECT id, length(CAST(body AS BLOB)) AS bytes FROM entities WHERE kind='transcript_candidate' AND project_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?")
      .all(projectId, TRANSCRIPT_REVIEW_LIMITS.candidateIds, offset) as Array<{ id: string; bytes: number }>;
    const candidates: ReturnType<typeof summary>[] = []; let scanned = 0, candidateBytes = 0;
    for (const row of metadata) {
      if (row.bytes <= 0 || row.bytes > TRANSCRIPT_CANDIDATE_LIMITS.canonicalBytes) { scanned++; continue; }
      if (candidateBytes + row.bytes > TRANSCRIPT_REVIEW_LIMITS.candidateBytes) break;
      candidateBytes += row.bytes; scanned++;
      try { candidates.push(summary(resolved(store, projectId, audio, row.id), audioId)); }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    return bounded({ audioId, candidates, coverage: { offset, scanned, candidateBytes, total: inventory.total,
      nextOffset: offset + scanned < inventory.total ? offset + scanned : null, dataDigest } });
  });
}

export function projectTranscriptWords(store: Store, projectId: string, input: { audioId: string; candidateId: string; candidateDigest: string; offset: number }) {
  offsetValue(input.offset, TRANSCRIPT_CANDIDATE_LIMITS.words);
  return store.transaction(() => {
    const audio = recording(store, projectId, input.audioId), value = resolved(store, projectId, audio, input.candidateId, input.candidateDigest), candidate = value.candidate;
    offsetValue(input.offset, candidate.projection.words.length);
    const parser = new Map<number, string[]>(), samples = new Map<number, string[]>();
    for (const [issues, target] of [[candidate.projection.parserIssues, parser], [candidate.projection.sampleIssues, samples]] as const) {
      for (const issue of issues) if (issue.wordIndex !== null && issue.wordIndex >= input.offset && issue.wordIndex < input.offset + TRANSCRIPT_REVIEW_LIMITS.words) {
        const codes = target.get(issue.wordIndex) ?? []; codes.push(issue.code); target.set(issue.wordIndex, codes);
      }
    }
    const build = (count: number) => ({ candidate: summary(value, audio.id),
      words: candidate.projection.words.slice(input.offset, input.offset + count).map((word, relative) => {
        const index = input.offset + relative;
        return { index, ...word, parserIssues: parser.get(index) ?? [], sampleIssues: samples.get(index) ?? [] };
      }), globalIssues: candidate.projection.parserIssues.filter(issue => issue.wordIndex === null).map(issue => issue.code),
      page: { offset: input.offset, returned: count, total: candidate.projection.words.length, nextOffset: input.offset + count < candidate.projection.words.length ? input.offset + count : null } });
    let count = Math.min(TRANSCRIPT_REVIEW_LIMITS.words, candidate.projection.words.length - input.offset);
    while (count > 1) { const result = build(count); if (Buffer.byteLength(canonical(result)) <= TRANSCRIPT_REVIEW_LIMITS.pageBytes) return result; count--; }
    return bounded(build(count));
  });
}

export function projectTranscriptSelection(store: Store, projectId: string, input: { audioId: string; candidateId: string; candidateDigest: string; startWordIndex: number; endWordIndex: number }) {
  return store.transaction(() => {
    const audio = recording(store, projectId, input.audioId), value = resolved(store, projectId, audio, input.candidateId, input.candidateDigest);
    const preview = previewTranscriptRange(value.candidate, { startWordIndex: input.startWordIndex, endWordIndex: input.endWordIndex });
    return bounded({ candidateId: value.candidate.id, candidateDigest: value.candidateDigest, audioId: audio.id,
      startWordIndex: input.startWordIndex, endWordIndex: input.endWordIndex, ...preview,
      timing: { ...preview.timing, issues: preview.timing.issues.slice(0, 40), issueCoverage: { returned: Math.min(40, preview.timing.issues.length), total: preview.timing.issues.length, details: "indexed_word_pages" } } });
  });
}
