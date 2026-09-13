import type { NarrationSegment } from "./narration-model";

export interface TranscriptSummary { id: string; candidateDigest: string; audioId: string; sourceDescriptorDigest: string; wordCount: number; reportedLanguage: string; parserIssueCount: number; sampleIssueCount: number; sourceSampleCount: number }
export interface TranscriptList { audioId: string; candidates: TranscriptSummary[]; coverage: { offset: number; scanned: number; total: number; nextOffset: number | null; dataDigest: string } }
export interface TranscriptWord { index: number; word: string; startSeconds: number; endSeconds: number; startSample: number | null; endSample: number | null; parserIssues: string[]; sampleIssues: string[] }
export interface TranscriptWords { candidate: TranscriptSummary; words: TranscriptWord[]; globalIssues: string[]; page: { offset: number; returned: number; total: number; nextOffset: number | null } }
export interface TranscriptPreview {
  candidateId: string; candidateDigest: string; audioId: string; startWordIndex: number; endWordIndex: number;
  policy: "trim-join-ascii-space-v1"; text: string | null; selectedTextDigest: string;
  writing: { allowed: boolean; code: string | null };
  timing: { allowed: boolean; startSample: number | null; endSample: number | null; issues: Array<{ source: string; code: string; wordIndex: number | null }>; issueCoverage: { returned: number; total: number } };
  warnings: Array<{ source: string; code: string; wordIndex: number | null }>;
}
export function appendTranscriptCandidates(current: TranscriptList, next: TranscriptList): TranscriptList {
  if (current.audioId !== next.audioId || current.coverage.dataDigest !== next.coverage.dataDigest || current.coverage.nextOffset !== next.coverage.offset) throw new Error("The transcript list changed. Refresh before loading more.");
  return { ...next, candidates: [...current.candidates, ...next.candidates], coverage: { ...next.coverage, offset: current.coverage.offset, scanned: current.coverage.scanned + next.coverage.scanned } };
}
export function transcriptSelectionFields(row: NarrationSegment, preview: TranscriptPreview, action: "words" | "timing"): Record<string, unknown> {
  if (!row.audio || row.audio.id !== preview.audioId || (action === "words" ? !preview.writing.allowed : !preview.timing.allowed)) throw new Error("Review a valid selection for the attached recording first.");
  return { segmentId: row.entry.segmentId, segmentRevisionId: row.script.id, audioId: row.audio.id,
    candidateId: preview.candidateId, candidateDigest: preview.candidateDigest, startWordIndex: preview.startWordIndex,
    endWordIndex: preview.endWordIndex, selectedTextDigest: preview.selectedTextDigest };
}
export function transcriptPreviewMatches(preview: TranscriptPreview | null, candidate: TranscriptSummary | undefined, audioId: string, start: number, end: number): preview is TranscriptPreview {
  return !!preview && !!candidate && preview.audioId === audioId && preview.candidateId === candidate.id && preview.candidateDigest === candidate.candidateDigest && preview.startWordIndex === start && preview.endWordIndex === end;
}
export function transcriptActionNotice(action: "words" | "timing", expectedVersion: number, returnedVersion: number): string {
  if (expectedVersion === returnedVersion) return "The saved section already matches. Its review decisions were kept.";
  return action === "words" ? "Recognized words saved as a draft. Review the script, recording and timing separately." : "Suggested recording range saved. Review and accept its timing separately.";
}
export function transcriptIssueText(code: string): string {
  return ({ word_outside_source: "A word extends beyond the recording.", source_range_exceeded: "A word extends beyond the recording.",
    word_overlap: "Word timings overlap.", mapped_word_overlap: "Word timings overlap.", word_nonmonotone: "Word timings are out of order.", mapped_word_nonmonotone: "Word timings are out of order.",
    unsafe_sample_coordinate: "A word has unusable timing.", empty_sample_interval: "A word has no usable duration.",
    reported_duration_outside_source: "The transcript reports a duration beyond this recording.", text_word_mismatch: "The transcript's full text differs from its word list. Review the words shown here.",
    TEXT_TOO_LONG: "Choose fewer words to fit this section.", invalid_range: "Choose a positive range inside the recording." } as Record<string, string>)[code] ?? "This selection has a timing issue. Choose another range or enter timing manually.";
}
