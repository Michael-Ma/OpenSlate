import type { NarrationView } from './narration-model';
import type { PendingCommand } from './pending-command';

export interface SpeechOptions {
  version: 1; profiles: Array<{ id: string; revision: string; model: string; estimatedMicros: string }>;
  voices: string[]; limits: { maxTotalBytes: number; maxInstructionBytes: number };
  capabilities: { configured: boolean; providerReadiness: string };
}
export interface SpeechProposal {
  version: 1; id: string; proposalDigest: string;
  segment: { segmentId: string; segmentRevisionId: string; text: string; language: string };
  model: { profileId: string; provider: string; model: string; revision: string };
  voice: string; instructions: string; estimatedMicros: string; currency: 'USD';
  plan: { preservedOperations: number; addedOperations: 1 }; baseProject: { headVersion: number; revisionId: string };
}
export interface SpeechDetail {
  proposal: SpeechProposal; eligibility: { current: boolean; code: string | null };
  application: { candidateId: string } | null;
  execution: { state: string; candidateId: string | null; attemptId: string | null; code: string | null };
}
export interface SpeechPage { proposals: Array<{ id: string; proposal: SpeechProposal | null; unavailableCode: string | null }>;
  coverage: { offset: number; scanned: number; total: number; nextOffset: number | null; dataDigest: string } }
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
export function canReviewSpeech(detail: SpeechDetail | null, view: NarrationView, checking = false): boolean {
  if (!detail || checking || detail.application || !detail.eligibility.current || detail.eligibility.code !== null
    || view.session?.state !== 'active' || detail.proposal.baseProject.headVersion !== view.headVersion
    || detail.proposal.baseProject.revisionId !== view.revisionId) return false;
  return view.snapshot.segments.some(row => row.entry.segmentId === detail.proposal.segment.segmentId
    && row.script.id === detail.proposal.segment.segmentRevisionId && row.script.text === detail.proposal.segment.text
    && row.script.source.kind === 'generated' && row.script.textKind === 'draft');
}
export function speechReviewCommand(projectId: string, key: string, view: NarrationView, detail: SpeechDetail, checking = false): PendingCommand {
  if (!canReviewSpeech(detail, view, checking) || !hash(detail.proposal.proposalDigest)) throw Error('Refresh this exact speech plan before approving.');
  return { path: `/api/projects/${encodeURIComponent(projectId)}/narration/speech-reviews`, key,
    body: { sessionId: view.session!.id, proposalId: detail.proposal.id, proposalDigest: detail.proposal.proposalDigest },
    metadata: { label: 'Narration generation plan approved. Review spending separately.', narrationSpeech: 'review' } };
}
export function speechPrepareCommand(projectId: string, key: string, view: NarrationView, segmentId: string,
  options: SpeechOptions, profileId: string, voice: string, instructions: string): PendingCommand {
  const row = view.snapshot.segments.find(row => row.entry.segmentId === segmentId);
  if (view.session?.state !== 'active' || !row || row.script.source.kind !== 'generated' || row.script.textKind !== 'draft'
    || !row.script.text.trim() || !options.capabilities.configured || !options.profiles.some(profile => profile.id === profileId)
    || !options.voices.includes(voice)) throw Error('Choose a saved finished section, speech model and voice.');
  return { path: `/api/projects/${encodeURIComponent(projectId)}/narration/speech-proposals`, key,
    body: { sessionId: view.session.id, expectedHeadVersion: view.headVersion, segmentId, segmentRevisionId: row.script.id, profileId, voice, instructions },
    metadata: { label: 'Speech plan prepared for your review. No audio has been generated.', narrationSpeech: 'prepare' } };
}
export function speechStatus(state: string): string {
  return ({ not_applied: 'Awaiting plan approval', ready: 'Plan approved · spending and provider setup are separate', submitting: 'Requesting narration',
    submission_unknown: 'Response uncertain · the request will not be repeated automatically', remote_pending: 'Narration in progress',
    ingesting: 'Saving the recording', succeeded: 'Recording ready · listen and attach it to a section', failed: 'Narration did not complete',
    unavailable: 'Saved execution details are unavailable' } as Record<string, string>)[state] ?? 'Checking progress';
}
export function speechBlockReason(code: string | null): string {
  if (!code) return '';
  return ({ APPLIED: 'This plan has already been approved.', REVISION_CONFLICT: 'The project changed. Prepare a fresh speech plan.',
    NARRATION_SPEECH_STALE: 'This section or its speech choices changed. Prepare a fresh plan.',
    RESTORED_AUTHORITY_REQUIRES_NEW: 'This is restored history. Prepare a new plan for new generation.',
    INSTALLATION_QUARANTINED: 'Finish the installation recovery review first.', EXECUTION_PAUSED: 'Project execution is paused.',
    EXECUTION_HELD: 'An editing request is holding this work. Finish or explicitly continue that edit.',
    CAPABILITY_MISMATCH: 'The saved model setup changed.', PROPOSAL_UNAVAILABLE: 'This saved plan is unavailable for review.' } as Record<string, string>)[code]
    ?? 'This plan needs a fresh check before it can run.';
}
