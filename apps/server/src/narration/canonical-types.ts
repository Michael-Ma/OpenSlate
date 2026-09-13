import type { ArtifactRef, CueRecord, ProjectRecord, StageRequirement } from "@openslate/core";
import type { GeneratedNarrationEvidence, NarrationProjection, NarrationSnapshot } from "./types.js";

export interface NarrationShotMapping { shotId: string; segmentId: string | null }
export interface PrepareNarrationCommit {
  expectedHeadVersion: number;
  expectedNarrationVersion: number;
  /** Omitted shot mappings retain their previous canonical segment. Null explicitly detaches. */
  shotMappings: NarrationShotMapping[];
  key: string;
}
export interface NarrationShotImpact {
  shotId: string;
  cueId: string | null;
  visual: "reuse" | "replan";
  reason: "unchanged" | "cue_rebound" | "meaning_or_duration";
}
export interface PreparedNarrationCommit {
  id: string; projectId: string; requestId: string; principalId: string; epochId: string | null;
  expectedHeadVersion: number; expectedNarrationVersion: number;
  projectDigest: string; snapshotDigest: string; capabilityDigest: string;
  previousCanonicalId: string | null;
  projection: NarrationProjection;
  snapshot: NarrationSnapshot;
  shotMappings: NarrationShotMapping[];
  shotImpact: NarrationShotImpact[];
  next: ProjectRecord;
  stages: StageRequirement[];
  stageVersions: Record<string, number>;
}
export interface SuppliedNarrationProvenance {
    audioId: string;
    declaredOrigin: "uploaded" | "generated";
    /** Uploaded files declared generated are not provider-generation evidence. */
    originEvidence: "human_declared_supplied_recording";
    scriptAcceptanceId: string; audioAcceptanceId: string; timingAcceptanceId: string;
    originalSha256: string; toolchainDigest: string;
}
export interface GeneratedNarrationProvenance {
  audioId: string; originEvidence: "verified_generated_audio"; generation: GeneratedNarrationEvidence;
  scriptAcceptanceId: string; audioAcceptanceId: string; timingAcceptanceId: string;
  originalSha256: string; toolchainDigest: string;
}
export interface CanonicalNarrationSegment {
  segmentId: string; segmentRevisionId: string; cue: CueRecord;
  frameCoverage: NarrationProjection["segments"][number]["frameCoverage"];
  audioPlacement: NarrationProjection["segments"][number]["audioPlacement"];
  provenance: SuppliedNarrationProvenance | GeneratedNarrationProvenance;
}
export interface CanonicalNarration {
  id: string; projectId: string; projectRevisionId: string; headVersion: number;
  requestId: string; epochId: string | null; preparedId: string;
  narrationVersion: number; narrationRevisionId: string | null; projectionDigest: string;
  script: string; source: ProjectRecord["narration"]["source"];
  segments: CanonicalNarrationSegment[];
  shotMappings: NarrationShotMapping[];
}
export interface NarrationCommitReceipt {
  id: string;
  canonicalId: string; preparedId: string; projectId: string; revisionId: string; headVersion: number;
  activePlanId: string | null; narrationVersion: number; cursor: number;
  shotImpact: NarrationShotImpact[];
  /** This adapter never installs a plan or releases an edit hold. */
  requiresMatchingPlan: boolean;
}
export interface CanonicalNarrationArtifact {
  id: string; projectId: string; artifact: ArtifactRef; path: string; mimeType: "audio/wav";
  fixture: false; attemptId: null; origin: "narration_audio";
  physicalDurationSeconds: number; byteLength: number; sourceDescriptorId: string;
}
