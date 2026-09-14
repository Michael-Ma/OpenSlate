import type { CompiledPlan, NodeImpact, ProviderProfile, StageRequirement } from "@openslate/core";
import type { ApplyReceipt } from "../application/service.js";

export interface PrepareNarrationSpeech {
  key: string; expectedHeadVersion: number; segmentId: string; segmentRevisionId: string;
  profileId: string; voice: string; instructions: string;
}
export interface NarrationSpeechSection { narrationRevisionId: string; segmentId: string; segmentRevisionId: string; segmentDigest: string }
export interface NarrationSpeechOperation { alias: string; profileId: string; text: string; voice: string; instructions: string }
/** Saved writing only, never a generic Prepared change or generation permission. */
export interface NarrationSpeechProposal {
  id: string; version: 1; state: "ungranted"; projectId: string;
  requestId: string; principalId: string; epochId: string | null; inputDigest: string;
  baseProject: { revisionId: string; headVersion: number; digest: string };
  basePlan: { id: string; digest: string } | null;
  capabilityLock: { id: string; digest: string };
  section: NarrationSpeechSection; profile: ProviderProfile; operation: NarrationSpeechOperation;
  compiled: CompiledPlan; logicalIds: Record<string, string>; impact: NodeImpact[];
  stages: StageRequirement[]; stageVersions: Record<string, number>;
}
export interface ReviewNarrationSpeech { key: string; proposalId: string; proposalDigest: string }
/** Review and grant share an ID; no forward reference to its later candidate. */
export interface NarrationSpeechReview {
  id: string; version: 1; projectId: string; requestId: string; principalId: string;
  proposal: { id: string; digest: string }; grantDigest: string; section: NarrationSpeechSection;
  nodeId: string; specDigest: string; compiledDigest: string;
}
/** Application and candidate share an ID; inserted after complete plan publication. */
export interface NarrationSpeechApplication {
  id: string; version: 1; projectId: string; review: { id: string; digest: string }; candidateDigest: string;
  prepared: { id: string; digest: string }; plan: { id: string; digest: string }; projectRevision: { id: string; digest: string }; receipt: ApplyReceipt;
}
export interface NarrationSpeechApplyReceipt {
  proposalId: string; proposalDigest: string; reviewId: string; applicationId: string;
  grantId: string; candidateId: string; applied: ApplyReceipt;
}
/** Immutable attempt field outside provider arguments, omitted on all legacy speech. */
export interface NarrationSpeechAttemptInput { version: 1; application: { id: string; digest: string } }
