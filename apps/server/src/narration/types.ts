import type { CueRecord } from "@openslate/core";
import type { SuppliedMedia } from "../media/index.js";

export type SourceChoice = { kind: "undecided" } | { kind: "uploaded" } | { kind: "generated"; voice: string | null; profileRevisionId: string | null };
export interface SegmentDraft {
  text: string;
  textKind: "notes" | "outline" | "draft";
  language: string;
  meaning: string;
  source: SourceChoice;
}
export interface SegmentRevision extends SegmentDraft {
  id: string; segmentId: string; projectId: string;
  /** Present only on the exact successor authored by a human transcript selection. */
  transcriptSelectionId?: string;
}
export interface SuppliedNarrationAudio {
  id: string; projectId: string; media: SuppliedMedia;
  /** A human-declared origin for an already supplied recording; not provider evidence. */
  declaredOrigin: "uploaded" | "generated";
  requestId: string;
}
/** Exact historical provider/normalization evidence; no current binding or mutable lease is hashed. */
export interface GeneratedNarrationEvidence {
  version: 1; adapter: "openai-speech"; executionVersion: "1";
  model: string; voice: string;
  artifactId: string; artifactDigest: string; artifactRecordDigest: string;
  attemptId: string; requestDigest: string; reservationId: string; reservationDigest: string;
  mappingDigest: string; dispatchDigest: string; resultDigest: string;
  outputReceiptId: string; outputReceiptDigest: string; outputSpoolId: string; outputSpoolDigest: string;
  derivationId: string; derivationIntentDigest: string; derivationReceiptDigest: string;
  sourceDescriptorId: string; sourceDigest: string; normalizedSamples: number;
}
/** An existing OpenSlate output, not an upload or a human-declared external recording. */
export interface VerifiedGeneratedNarrationAudio {
  id: string; projectId: string; media: SuppliedMedia;
  originEvidence: "verified_generated_audio"; generation: GeneratedNarrationEvidence;
}
export type NarrationAudio = SuppliedNarrationAudio | VerifiedGeneratedNarrationAudio;
export interface GeneratedNarrationSummary {
  id: string; media: SuppliedMedia; originEvidence: "verified_generated_audio";
  selection: { artifactDigest: string; generationEvidenceDigest: string };
  generation: { adapter: "openai-speech"; version: "1"; model: string; voice: string };
}
export interface HumanNarrationCue {
  id: string; projectId: string; segmentRevisionId: string; audioId: string;
  /** Both endpoints are local to the normalized audio artifact. */
  startSample: number; endSample: number;
  method: "human"; confidence: null;
}
export interface TranscriptNarrationCue extends Omit<HumanNarrationCue, "method"> {
  method: "transcript_selection"; transcriptSelectionId: string;
}
export type NarrationCue = HumanNarrationCue | TranscriptNarrationCue;
export interface TranscriptCanonicalProvenance {
  writing?: { selectionId: string; selectionDigest: string };
  timing?: { selectionId: string; selectionDigest: string };
}
export interface NarrationEntry {
  segmentId: string; segmentRevisionId: string; audioId: string | null; cueId: string | null;
  /** Project position of this selected cue's start; never added to source coordinates. */
  atSample: number;
  scriptAcceptanceId: string | null; audioAcceptanceId: string | null; timingAcceptanceId: string | null;
}
export interface NarrationState { id: string; projectId: string; version: number; revisionId: string | null; entries: NarrationEntry[] }
export interface NarrationAcceptance {
  id: string; projectId: string; kind: "script" | "audio" | "timing";
  subjectDigest: string; requestId: string; principalId: string;
}
export interface NarrationGap { key: string; segmentId: string | null; category: string; blocks: "writing" | "synthesis" | "timing" | "export" }
export interface NarrationReadiness {
  text: "none" | "notes" | "outline" | "draft" | "approved";
  audio: "none" | "partial" | "complete" | "accepted";
  timing: "absent" | "partial" | "measured" | "accepted";
  gaps: NarrationGap[];
}
export interface NarrationSegmentView {
  entry: NarrationEntry; script: SegmentRevision; audio: NarrationAudio | null; cue: NarrationCue | null;
  accepted: { script: boolean; audio: boolean; timing: boolean };
}
export interface NarrationSnapshot { state: NarrationState; segments: NarrationSegmentView[]; readiness: NarrationReadiness; canonicalApplied: false }
export interface ReviseSegments {
  add?: SegmentDraft[];
  update?: Array<{ segmentId: string; draft: SegmentDraft }>;
  remove?: string[];
  /** Existing IDs only. Add first, then reorder using returned service-issued IDs. */
  order?: string[];
}
export interface NarrationProjection {
  projectId: string; version: number; revisionId: string | null; readyForCanonicalCommit: boolean; canonicalApplied: false;
  segments: Array<{
    segmentId: string; segmentRevisionId: string; cue: CueRecord;
    /** Placement-dependent coverage is separate from the cue's relative visual duration. */
    frameCoverage: { startFrame: number; endFrame: number };
    audioPlacement: { source: SuppliedMedia; startSample: number; durationSamples: number; atSample: number; gainMilliDb: 0 };
  }>;
  gaps: NarrationGap[];
}
export interface NarrationImpact {
  segmentId: string;
  visual: "reuse" | "replan";
  render: "reuse" | "replace";
  reason: "added_or_removed" | "meaning_or_duration" | "audio_or_placement" | "unchanged";
  readinessChanged: boolean;
}
