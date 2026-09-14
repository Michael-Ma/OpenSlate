import { digest, DomainError, invariant } from '@openslate/core';
import { OPENAI_SPEECH_VOICES, OPENAI_SPEECH_BUDGET } from '@openslate/providers';
import type { ProviderProfile } from '@openslate/core';
import type { Store } from '../persistence/store.js';
import type { ProductionService } from '../application/service.js';
import type { Attempt } from '../execution/engine.js';
import { preflightAudioProfile } from '../execution/audio-preflight.js';
import { ProjectionReader } from './owned-transcription-projection.js';
import { assertNarrationSpeechProposal } from './narration-speech-records.js';
import { currentNarrationSpeechReview } from './narration-speech-review-state.js';
import { assertNarrationSpeechAttemptInput, resolveNarrationSpeechApplication } from './narration-speech-authorization.js';
import type { NarrationSpeechProposal, NarrationSpeechApplyReceipt } from './narration-speech-types.js';
import { assertNarrationSpeechCurrent } from '../execution/narration-speech-execution.js';
import type { SegmentRevision } from './types.js';

export interface NarrationSpeechSummary {
  version: 1; id: string; proposalDigest: string;
  segment: { segmentId: string; segmentRevisionId: string; text: string; language: string };
  model: { profileId: string; provider: 'OpenAI'; model: string; revision: string };
  voice: string; instructions: string; estimatedMicros: string; currency: 'USD';
  plan: { preservedOperations: number; addedOperations: 1 }; baseProject: { headVersion: number; revisionId: string };
}
export interface NarrationSpeechDetail {
  proposal: NarrationSpeechSummary; eligibility: { current: boolean; code: string | null }; application: NarrationSpeechApplyReceipt | null;
  execution: { state: string; candidateId: string | null; attemptId: string | null; code: string | null };
}
const validId = (value: unknown): value is string => typeof value === 'string' && Buffer.byteLength(value) >= 1 && Buffer.byteLength(value) <= 160;
const boundedIdSql = 'CASE WHEN length(CAST(id AS BLOB)) BETWEEN 1 AND 160 THEN id ELSE NULL END id';
const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };
const response = <T>(value: T): T => { invariant(Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024, 'PROPOSAL_TOO_LARGE', 'Speech review exceeds its display bound'); return freeze(value); };
const read = <T>(store: Store, work: () => T): T => store.db.inTransaction ? work() : store.db.transaction(work).deferred();
export function projectNarrationSpeechOptions(production: ProductionService, projectId: string) {
  return read(production.store, () => {
    const view = new ProjectionReader(production.store, projectId), project = view.project();
    const lock = view.get<{ profiles: ProviderProfile[] }>('capability_lock', project.capabilityLockId);
    invariant(lock && Array.isArray(lock.profiles) && lock.profiles.length <= 512, 'PROPOSAL_UNAVAILABLE', 'Speech profiles are unavailable');
    const profiles = lock.profiles.flatMap(profile => {
      if (profile.kind !== 'speech') return [];
      try { const checked = preflightAudioProfile(profile); return [{ id: profile.id, revision: profile.revision, provider: 'OpenAI', model: checked.model, estimatedMicros: profile.unitCostMicros, currency: 'USD' }]; }
      catch { return []; }
    });
    return response({ version: 1 as const, profiles, voices: [...OPENAI_SPEECH_VOICES], limits: { ...OPENAI_SPEECH_BUDGET } });
  });
}
function summary(view: ProjectionReader, proposalId: string): NarrationSpeechSummary {
  const proposal = view.get<NarrationSpeechProposal>('narration_speech_proposal', proposalId);
  invariant(proposal && proposal.id === proposalId && proposal.projectId === view.projectId, 'PROPOSAL_UNAVAILABLE', 'Saved speech proposal is unavailable');
  assertNarrationSpeechProposal(view.reader, view.projectId, proposal);
  const section = view.get<SegmentRevision>('narration_segment', proposal.section.segmentRevisionId)!;
  return { version: 1, id: proposal.id, proposalDigest: digest(proposal),
    segment: { segmentId: proposal.section.segmentId, segmentRevisionId: section.id, text: proposal.operation.text, language: section.language },
    model: { profileId: proposal.profile.id, provider: 'OpenAI', model: proposal.profile.configuration!.model, revision: proposal.profile.revision },
    voice: proposal.operation.voice, instructions: proposal.operation.instructions, estimatedMicros: proposal.profile.unitCostMicros, currency: 'USD',
    plan: { preservedOperations: proposal.compiled.nodes.length - 1, addedOperations: 1 },
    baseProject: { headVersion: proposal.baseProject.headVersion, revisionId: proposal.baseProject.revisionId } };
}
export function summarizeNarrationSpeechProposal(store: Store, projectId: string, proposalId: string): NarrationSpeechSummary {
  return read(store, () => { const view = new ProjectionReader(store, projectId); view.project(); return response(summary(view, proposalId)); });
}
export function projectNarrationSpeechProposals(store: Store, projectId: string, offset = 0, expectedDigest?: string) {
  return read(store, () => {
    invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1000000, 'VALIDATION_ERROR', 'Invalid speech history page');
    const view = new ProjectionReader(store, projectId); view.project();
    const inventory = store.db.prepare("SELECT count(*) total,coalesce(max(rowid),0) newest FROM entities WHERE kind='narration_speech_proposal' AND project_id=?").get(projectId) as { total: number; newest: number };
    const dataDigest = digest({ projectId, ...inventory });
    invariant(!expectedDigest || expectedDigest === dataDigest, 'REVISION_CONFLICT', 'Speech history changed; restart paging');
    invariant(offset <= inventory.total, 'VALIDATION_ERROR', 'Speech page is beyond saved history');
    const ids = store.db.prepare(`SELECT ${boundedIdSql},rowid,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='narration_speech_proposal' AND project_id=? ORDER BY rowid DESC LIMIT 20 OFFSET ?`).all(projectId, offset) as { id: string | null; rowid: number; bytes: number }[];
    const proposals: Array<{ id: string; proposal: NarrationSpeechSummary | null; unavailableCode: string | null }> = [];
    for (const row of ids) {
      const displayId = row.id ?? `unavailable-row-${row.rowid}`;
      let item: typeof proposals[number];
      try {
        invariant(validId(row.id), 'PROPOSAL_UNAVAILABLE', 'Saved speech identity is unavailable');
        invariant(row.bytes <= 16 * 1024 ** 2, 'PROPOSAL_TOO_LARGE', 'Saved speech proposal exceeds the display bound');
        item = { id: displayId, proposal: summary(view, row.id), unavailableCode: null };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        // A new page receives a fresh hydration budget. Never skip a valid later
        // proposal merely because earlier rows exhausted this page's budget.
        if (error.code === 'PROPOSAL_TOO_LARGE' && proposals.length) break;
        item = { id: displayId, proposal: null, unavailableCode: error.code === 'PROPOSAL_TOO_LARGE' ? error.code : 'PROPOSAL_UNAVAILABLE' };
      }
      if (Buffer.byteLength(JSON.stringify([...proposals, item])) > 128 * 1024 - 1024) {
        if (proposals.length) break;
        item = { id: displayId, proposal: null, unavailableCode: 'PROPOSAL_TOO_LARGE' };
      }
      proposals.push(item);
    }
    const scanned = proposals.length;
    return response({ proposals, coverage: { offset, scanned, total: inventory.total, nextOffset: offset + scanned < inventory.total ? offset + scanned : null, dataDigest, readBytes: view.readBytes } });
  });
}
function recoveryCode(view: ProjectionReader, proposalId: string): string | null {
  if (view.store.db.prepare('SELECT 1 FROM installation_recoveries WHERE release_receipt IS NULL LIMIT 1').get()) return 'INSTALLATION_QUARANTINED';
  return view.store.db.prepare("SELECT 1 FROM entities WHERE kind='installation_recovery_fence' AND project_id=? AND json_extract(body,'$.kind')='narration_speech_proposal' AND json_extract(body,'$.recordId')=? LIMIT 1").get(view.projectId, proposalId) ? 'RESTORED_AUTHORITY_REQUIRES_NEW' : null;
}
function executionBlocker(view: ProjectionReader, resolved: ReturnType<typeof resolveNarrationSpeechApplication>): string | null {
  const recovery = recoveryCode(view, resolved.proposal.id); if (recovery) return recovery;
  const project = view.project(), node = resolved.proposal.compiled.nodes.find(item => item.id === resolved.review.nodeId)!;
  try { assertNarrationSpeechCurrent(view.reader, project, node, resolved.application.id, resolved); }
  catch (error) { if (error instanceof DomainError && error.code === 'NARRATION_SPEECH_STALE') return error.code; throw error; }
  if (view.get<{ paused: boolean }>('execution_control', project.id)?.paused) return 'EXECUTION_PAUSED';
  if (view.store.db.prepare("SELECT 1 FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1").get(project.id, project.id)) return 'EXECUTION_HELD';
  return null;
}
export function projectNarrationSpeechProposal(store: Store, projectId: string, proposalId: string): NarrationSpeechDetail {
  return read(store, () => {
    const view = new ProjectionReader(store, projectId); view.project(); const proposal = summary(view, proposalId);
    const result: NarrationSpeechDetail = { proposal, eligibility: { current: false, code: null }, application: null,
      execution: { state: 'not_applied', candidateId: null, attemptId: null, code: null } };
    try {
      const reviews = store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='narration_speech_review' AND project_id=? AND json_extract(body,'$.proposal.id')=? LIMIT 2`).all(projectId, proposalId) as { id: string | null }[];
      invariant(reviews.length <= 1, 'PROPOSAL_UNAVAILABLE', 'Speech proposal has conflicting reviews');
      if (reviews.length) {
        invariant(validId(reviews[0]!.id), 'PROPOSAL_UNAVAILABLE', 'Speech review identity is unavailable');
        const candidates = store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='candidate' AND project_id=? AND json_extract(body,'$.grantId')=? LIMIT 2`).all(projectId, reviews[0]!.id) as { id: string | null }[];
        invariant(candidates.length === 1 && validId(candidates[0]!.id), 'PROPOSAL_UNAVAILABLE', 'Speech review lost its candidate');
        const resolved = resolveNarrationSpeechApplication(view.reader, projectId, candidates[0]!.id!);
        invariant(resolved.proposal.id === proposalId && digest(resolved.proposal) === proposal.proposalDigest, 'PROPOSAL_UNAVAILABLE', 'Speech application differs from the selected proposal');
        const application = resolved.application;
        result.application = { proposalId: proposal.id, proposalDigest: proposal.proposalDigest, reviewId: resolved.review.id,
          applicationId: application.id, grantId: resolved.review.id, candidateId: application.id, applied: application.receipt };
        result.execution = { state: 'ready', candidateId: application.id, attemptId: null, code: null };
        const row = store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='attempt' AND project_id=? AND json_extract(body,'$.candidateId')=? ORDER BY json_extract(body,'$.ordinal') DESC LIMIT 1`).get(projectId, application.id) as { id: string | null } | undefined;
        let beforeDispatch = !row;
        if (row) {
          invariant(validId(row.id), 'PROPOSAL_UNAVAILABLE', 'Speech attempt identity is unavailable');
          const attempt = view.get<Attempt>('attempt', row.id);
          const phases: Attempt['phase'][] = ['submitting', 'submission_unknown', 'remote_pending', 'ingesting', 'succeeded', 'failed'];
          invariant(attempt && attempt.id === row.id && attempt.projectId === projectId && phases.includes(attempt.phase)
            && assertNarrationSpeechAttemptInput(view.reader, attempt)?.application.id === application.id,
          'PROPOSAL_UNAVAILABLE', 'Speech attempt differs from its exact application');
          result.execution = { state: attempt.phase, candidateId: application.id, attemptId: attempt.id, code: attempt.phase === 'failed' ? 'EXECUTION_FAILED' : null };
          beforeDispatch = attempt.phase === 'submitting' && !view.get('speech_execution_dispatch', attempt.id) && !view.get('speech_execution_result', attempt.id);
        }
        if (beforeDispatch) {
          result.execution.code = executionBlocker(view, resolved);
          if (result.execution.code === 'NARRATION_SPEECH_STALE') result.execution.state = 'unavailable';
        }
      }
    } catch (error) {
      if (!(error instanceof DomainError) || error.code === 'PROPOSAL_TOO_LARGE') throw error;
      result.execution = { state: 'unavailable', candidateId: result.application?.candidateId ?? null, attemptId: null, code: 'PROPOSAL_UNAVAILABLE' };
    }
    const recovery = recoveryCode(view, proposalId);
    if (recovery) result.eligibility = { current: false, code: recovery };
    else if (result.application) result.eligibility = { current: false, code: 'APPLIED' };
    else if (result.execution.state === 'unavailable') result.eligibility = { current: false, code: 'PROPOSAL_UNAVAILABLE' };
    else {
      try { currentNarrationSpeechReview(view.reader as Store, projectId, { key: 'read-only-projection', proposalId, proposalDigest: proposal.proposalDigest }); result.eligibility = { current: true, code: null }; }
      catch (error) {
        if (!(error instanceof DomainError) || error.code === 'PROPOSAL_TOO_LARGE') throw error;
        result.eligibility.code = ['REVISION_CONFLICT', 'CAPABILITY_MISMATCH', 'NARRATION_SPEECH_STALE', 'STAGE_BINDING_CONFLICT'].includes(error.code) ? error.code : 'PROPOSAL_UNAVAILABLE';
      }
    }
    return response(result);
  });
}
