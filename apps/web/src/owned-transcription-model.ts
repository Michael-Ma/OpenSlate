import type { NarrationSegment, NarrationView, Recording } from "./narration-model";
import type { PendingCommand } from "./pending-command";

export interface TranscriptionOptions {
  version: 1; profiles: Array<{ id: string; revision: string; provider: "OpenAI"; model: string; estimatedMicros: string; currency: "USD" }>;
  languages: string[]; timing: "word";
  capabilities: { implemented: boolean; configured: boolean; audioTools: boolean; providerReadiness: string; directorToolAvailable: boolean };
}
export type TranscriptionTarget = { kind: "recording" } | { kind: "section"; narrationRevisionId?: string; segmentId: string; segmentRevisionId: string; audioId: string };
export interface TranscriptionProposal {
  version: 1; id: string; proposalDigest: string;
  audio: { id: string; sha256: string; durationSeconds: number; origin: "uploaded" | "generated"; originEvidence: "human_declared" | "verified_generated_audio" };
  target: TranscriptionTarget; model: { profileId: string; provider: "OpenAI"; model: string; revision: string };
  language: string; timing: "word"; estimatedMicros: string; currency: "USD";
  plan: { preservedOperations: number; addedOperations: 1 }; baseProject: { headVersion: number; revisionId: string };
}
export interface TranscriptionApplyReceipt { proposalId: string; proposalDigest: string; candidateId: string; applicationId: string; reviewId: string; grantId: string; applied: { headVersion: number; activePlanId: string } }
export interface TranscriptionProposalDetail {
  proposal: TranscriptionProposal; eligibility: { current: boolean; code: string | null }; application: TranscriptionApplyReceipt | null;
  execution: { state: string; generationCandidateId: string | null; attemptId: string | null; code: string | null };
}
export interface TranscriptionProposalPage {
  proposals: Array<{ id: string; proposal: TranscriptionProposal | null; unavailableCode: string | null }>;
  coverage: { offset: number; scanned: number; total: number; nextOffset: number | null; dataDigest: string; readBytes: number };
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function transcriptionTarget(recording: Recording, row?: NarrationSegment): TranscriptionTarget {
  if (!row) return { kind: "recording" };
  if (row.audio?.id !== recording.id || row.entry.audioId !== recording.id) throw new Error("Choose a section with this exact recording attached.");
  return { kind: "section", segmentId: row.entry.segmentId, segmentRevisionId: row.script.id, audioId: recording.id };
}
export function transcriptionPrepareCommand(projectId: string, key: string, view: NarrationView, recording: Recording,
  options: TranscriptionOptions, profileId: string, language: string, row?: NarrationSegment): PendingCommand {
  if (view.session?.state !== "active") throw new Error("Open a current narration session first.");
  if (!hash(recording.sourceRecordDigest)) throw new Error("Attach this generated recording to a section before requesting its transcript.");
  if (!options.capabilities.implemented || !options.capabilities.configured || !options.capabilities.audioTools) throw new Error("Recording transcription needs local audio tools to be configured.");
  if (!options.profiles.some(profile => profile.id === profileId) || !options.languages.includes(language)) throw new Error("Choose a saved transcription model and a supported language.");
  return { path: `/api/projects/${encodeURIComponent(projectId)}/narration/transcription-proposals`, key,
    body: { sessionId: view.session.id, expectedHeadVersion: view.headVersion, audioId: recording.id, sourceRecordDigest: recording.sourceRecordDigest,
      profileId, language, target: transcriptionTarget(recording, row) },
    metadata: { label: "Transcription plan prepared. Review it before approval.", ownedTranscription: "prepare" } };
}
interface DetailVerification { checking: boolean; failed: boolean }
export function canReviewTranscription(detail: TranscriptionProposalDetail | null, view: NarrationView, verification?: DetailVerification): boolean {
  if (!detail || detail.application || !detail.eligibility.current || detail.eligibility.code !== null || verification?.checking || verification?.failed
    || detail.proposal.baseProject.headVersion !== view.headVersion || detail.proposal.baseProject.revisionId !== view.revisionId || view.session?.state !== "active") return false;
  const target = detail.proposal.target;
  return target.kind === "recording" || view.snapshot.segments.some(row => row.entry.segmentId === target.segmentId
    && row.script.id === target.segmentRevisionId && row.entry.audioId === target.audioId && row.audio?.id === target.audioId);
}
export function transcriptionReviewCommand(projectId: string, key: string, view: NarrationView, detail: TranscriptionProposalDetail, verification?: DetailVerification): PendingCommand {
  if (!canReviewTranscription(detail, view, verification) || !hash(detail.proposal.proposalDigest)) throw new Error("This plan needs a fresh review. Refresh it before approving.");
  return { path: `/api/projects/${encodeURIComponent(projectId)}/narration/transcription-reviews`, key,
    body: { sessionId: view.session!.id, proposalId: detail.proposal.id, proposalDigest: detail.proposal.proposalDigest },
    metadata: { label: "Transcription plan approved. Review its spending allowance separately.", ownedTranscription: "review" } };
}
export function appendTranscriptionProposals(current: TranscriptionProposalPage, next: TranscriptionProposalPage): TranscriptionProposalPage {
  if (current.coverage.dataDigest !== next.coverage.dataDigest || current.coverage.nextOffset !== next.coverage.offset) throw new Error("The transcription plans changed. Refresh before loading more.");
  return { proposals: [...current.proposals, ...next.proposals], coverage: { ...next.coverage, offset: current.coverage.offset,
    scanned: current.coverage.scanned + next.coverage.scanned, readBytes: current.coverage.readBytes + next.coverage.readBytes } };
}
export function transcriptionBlockReason(code: string | null): string {
  return ({ APPLIED: "This plan has already been approved.", RESTORED_AUTHORITY_REQUIRES_NEW: "This is restored history. Prepare a new transcription plan to start new work.",
    INSTALLATION_QUARANTINED: "Restored work is paused until recovery is reviewed.", REVISION_CONFLICT: "The project changed. Prepare a new transcription plan.",
    EXECUTION_PAUSED: "Project execution is paused. Resume it before this transcription can start.",
    EXECUTION_HELD: "An editing request is keeping this work on hold. Finish reviewing and applying that edit before transcription can start.",
    SUBMISSION_PREPARATION_OBSOLETE: "This transcription no longer matches the selected recording or current plan. Prepare a new transcription plan.",
    OWNED_TRANSCRIPTION_STALE: "The recording or selected section changed. Prepare a new transcription plan.", CAPABILITY_MISMATCH: "The saved model setup changed. Prepare a new transcription plan.",
    STAGE_BINDING_CONFLICT: "The project review changed. Prepare a new transcription plan.", PROPOSAL_UNAVAILABLE: "This saved plan is unavailable for review.",
    PROPOSAL_TOO_LARGE: "This saved plan is too large to show here." } as Record<string, string>)[code ?? ""] ?? "Refresh this plan to check whether it can be approved.";
}
export function transcriptionExecutionText(state: string): string {
  return ({ not_applied: "Awaiting plan approval", ready: "Plan approved · review spending before transcription can start", preparing: "Waiting for local audio preparation",
    submitting: "Requesting transcription", submission_unknown: "The response is uncertain · checking the existing request", remote_pending: "Transcription in progress",
    ingesting: "Saving the transcript", succeeded: "Transcript ready to review", failed: "Transcription did not complete", unavailable: "Saved execution details are unavailable" } as Record<string, string>)[state] ?? "Checking transcription progress";
}
/** The server reports current blockers only before dispatch; later results retain their observed outcome. */
export function transcriptionExecutionNotice(execution: TranscriptionProposalDetail["execution"]): { status: string; blocker: string | null } {
  return { status: transcriptionExecutionText(execution.state), blocker: execution.code ? transcriptionBlockReason(execution.code) : null };
}
