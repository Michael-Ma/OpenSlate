import type { ArtifactRef, CompiledPlan, NodeImpact, ProviderProfile, StageRequirement } from "@openslate/core";
import type { SuppliedMedia } from "../media/types.js";

/** A section is selected explicitly; identical audio bytes never infer a section. */
export type OwnedTranscriptionTarget = { kind: "recording" } | {
  kind: "section"; narrationRevisionId: string; segmentId: string; segmentRevisionId: string; audioId: string;
};
export interface OwnedTranscriptionSource {
  id: string; version: 1; projectId: string; requestId: string; principalId: string; epochId: string | null;
  consumerAlias: string;
  sourceRecord: { kind: "narration_audio"; id: string; digest: string };
  source: SuppliedMedia; sourceStartSample: 0; sourceEndSample: number;
  artifact: ArtifactRef; artifactRecordDigest: string;
  target: OwnedTranscriptionTarget;
}
export interface OwnedTranscriptionOperation { alias: string; profileId: string; inputBindingId: string; language: string }
/** Not a generic Prepared change and never authority to create a candidate. */
export interface OwnedTranscriptionProposal {
  id: string; version: 1; state: "ungranted"; projectId: string;
  requestId: string; principalId: string; epochId: string | null; inputDigest: string;
  baseProject: { revisionId: string; headVersion: number; digest: string };
  basePlan: { id: string; digest: string } | null;
  capabilityLock: { id: string; digest: string };
  sourceBinding: { id: string; digest: string };
  profile: ProviderProfile; operation: OwnedTranscriptionOperation;
  compiled: CompiledPlan; logicalIds: Record<string, string>; impact: NodeImpact[];
  stages: StageRequirement[]; stageVersions: Record<string, number>;
}
export interface PrepareOwnedTranscription {
  key: string; expectedHeadVersion: number; audioId: string; sourceRecordDigest: string;
  profileId: string; language: string;
  target: { kind: "recording" } | { kind: "section"; segmentId: string; segmentRevisionId: string; audioId: string };
}
