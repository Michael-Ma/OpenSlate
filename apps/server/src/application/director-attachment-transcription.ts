import { canonical, digest, DomainError, invariant, moneyMicros } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { DirectorGenerationEffect } from '@openslate/core/public';
import type { ProductionService, RequestRecord } from './service.js';
import type { OwnedTranscriptionService } from '../narration/owned-transcription-service.js';
import type { OwnedTranscriptionApplyReceipt, OwnedTranscriptionProposal, PrepareOwnedTranscription } from '../narration/owned-transcription-types.js';
import type { NarrationAudio } from '../narration/types.js';
import type { Attempt } from '../execution/engine.js';
import { attemptMediaFailure } from '../media-failure.js';
import { resolveOwnedTranscriptionApplication } from '../narration/owned-transcription-authorization.js';
import { snapshotOwnedTranscriptionData } from '../narration/owned-transcription-records.js';
import { requestHoldCutoff } from '../narration/request-holds.js';
import { assertDirectorGenerationAuthority } from './director-generation-authority.js';
import { recordDirectorGenerationEffect } from './director-generation-effects.js';
import type { DirectorGenerationEffectRecord } from './director-generation-effects.js';

export interface DirectorAttachmentTranscriptionRecord {
  id: string; projectId: string; requestId: string; epochId: string; key: string; inputDigest: string;
  audioId: string; operationDigest: string;
  state: 'started' | 'succeeded' | 'failed';
  receipt?: OwnedTranscriptionApplyReceipt;
  effect?: DirectorGenerationEffect;
  error?: { code: string; message: string };
}
export interface DirectorAttachmentTranscriptionResult {
  proposal: OwnedTranscriptionProposal;
  receipt: OwnedTranscriptionApplyReceipt;
  effect: DirectorGenerationEffect;
}

/** Only the exact audio identity carried by this human request qualifies for conversational paid transcription. */
export function hasDirectorAudioAttachment(service: ProductionService, projectId: string, actor: ActorContext, audioId: string): boolean {
  const request = service.store.get<RequestRecord>('message', actor.requestId);
  const audio = service.store.get<NarrationAudio>('narration_audio', audioId);
  const refs = request?.attachments;
  return request?.projectId === projectId && request.principalId === actor.principalId
    && audio?.projectId === projectId && audio.id === audioId && audio.media.kind === 'audio'
    && audio.media.artifactId === audio.id && Array.isArray(refs) && refs.length > 0 && refs.length <= 8
    && refs.every(ref => ref !== null && typeof ref === 'object'
      && Object.keys(ref).sort().join('\0') === ['artifactId', 'sha256'].join('\0')
      && typeof ref.artifactId === 'string' && ref.artifactId.length > 0 && ref.artifactId.length <= 160
      && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256))
    && refs.some(ref => ref.artifactId === audioId && ref.sha256 === audio.media.sha256);
}

/** Reads immutable publication evidence only. It never prepares, dispatches, attaches or adopts anything. */
export function readDirectorAttachmentTranscription(service: ProductionService, projectId: string,
  record: DirectorAttachmentTranscriptionRecord): DirectorAttachmentTranscriptionResult {
  invariant(record.projectId === projectId && record.state === 'succeeded' && record.receipt && record.effect,
    'TOOL_CALL_UNRESOLVED', 'The original attachment transcription needs reconciliation');
  const resolved = resolveOwnedTranscriptionApplication(service.store, projectId, record.receipt.candidateId);
  invariant(resolved.review.requestId === record.requestId && resolved.proposal.id === record.receipt.proposalId
    && digest(resolved.proposal) === record.receipt.proposalDigest
    && canonical(resolved.application.receipt) === canonical(record.receipt.applied),
  'TOOL_CALL_UNRESOLVED', 'The original attachment transcription differs from its retained evidence');
  return { proposal: resolved.proposal, receipt: structuredClone(record.receipt), effect: structuredClone(record.effect) };
}

/** A turn read observes the exact published candidate, never the frozen tool reply or a later recording request. */
export function directorAttachmentTranscriptionOutcome(service: ProductionService, projectId: string,
  effect: DirectorGenerationEffectRecord): NonNullable<DirectorGenerationEffect['transcription']> {
  const id = digest({ purpose: 'director_attachment_transcription', projectId,
    requestId: effect.requestId, epochId: effect.epochId, key: effect.key });
  const publication = service.store.get<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', id);
  // Missing or inconsistent historical linkage is an unknown outcome, never
  // evidence that this work completed or permission to submit something else.
  if (!publication || publication.id !== id || publication.projectId !== projectId || publication.requestId !== effect.requestId
    || publication.epochId !== effect.epochId || publication.key !== effect.key || publication.state !== 'succeeded') return { state: 'no_answer' };
  try {
    const { receipt, proposal } = readDirectorAttachmentTranscription(service, projectId, publication);
    invariant(canonical(publication.effect) === canonical(effect.effect), 'TOOL_CALL_UNRESOLVED',
      'The transcription effect differs from its original publication');
    const node = proposal.compiled.nodes.find(item => item.alias === proposal.operation.alias && item.kind === 'transcription');
    invariant(node, 'TOOL_CALL_UNRESOLVED', 'The original transcription operation is unavailable');
    const attempts = service.store.list<Attempt>('attempt', projectId)
      .filter(attempt => attempt.projectId === projectId && attempt.candidateId === receipt.candidateId);
    const attempt = attempts.sort((a, b) => a.ordinal - b.ordinal).at(-1);
    if (!attempt) return { state: 'running' };
    invariant(attempt.nodeId === node.id && attempt.request.kind === 'transcription'
      && attempt.request.attemptId === attempt.id, 'TOOL_CALL_UNRESOLVED', 'The transcription attempt differs from its original operation');
    if (attempt.phase === 'failed') return { state: 'failed', attemptId: attempt.id,
      failure: attemptMediaFailure(service.store, attempt, proposal.profile.maxRetries) };
    if (attempt.phase === 'succeeded') return { state: 'ready', attemptId: attempt.id };
    // A released job stays polled for a late result, but it is no longer the person's to give up again.
    if (attempt.phase === 'submission_unknown' && attempt.released) return { state: 'no_answer' };
    return { state: attempt.phase === 'submission_unknown' ? 'no_answer' : 'running', attemptId: attempt.id };
  } catch (error) {
    if (error instanceof DomainError) return { state: 'no_answer' };
    throw error;
  }
}

/** Trusted host adapter: the old owned-transcription path retains pricing, grants and admission checks. */
export async function startDirectorAttachmentTranscription(options: {
  service: ProductionService; transcriptions: OwnedTranscriptionService; projectId: string; actor: ActorContext;
  key: string; input: PrepareOwnedTranscription; signal?: AbortSignal;
}): Promise<DirectorAttachmentTranscriptionResult> {
  const { service, transcriptions, projectId, key, signal } = options;
  const actor = snapshotOwnedTranscriptionData(options.actor, 16384), input = snapshotOwnedTranscriptionData(options.input, 16384);
  invariant(transcriptions.narration.production === service, 'TOOL_CONFIGURATION_INVALID', 'Attachment transcription requires this application');
  const current = (): Extract<ActorContext, { kind: 'human' }> => {
    invariant(!signal?.aborted, 'OWNED_TRANSCRIPTION_CANCELLED', 'Attachment transcription was cancelled');
    const human = assertDirectorGenerationAuthority(service, projectId, actor);
    invariant(hasDirectorAudioAttachment(service, projectId, actor, input.audioId),
      'ORIGIN_NOT_AUTHORIZED', 'Transcribe only an exact audio file attached to this human conversation');
    return human;
  };
  const human = current();
  invariant(actor.kind === 'director' && typeof key === 'string' && key.length > 0 && key.length <= 320 && input.key === key,
    'VALIDATION_ERROR', 'Attachment transcription requires its exact tool command identity');
  const id = digest({ purpose: 'director_attachment_transcription', projectId, requestId: actor.requestId, epochId: actor.epochId, key });
  const inputDigest = digest(input), store = service.store;
  // A different native tool-call identity is not permission to resend an
  // unresolved recording. Head movement is unrelated to this exact operation.
  const { key: _inputKey, expectedHeadVersion: _headVersion, ...operation } = input;
  const operationDigest = digest(operation);
  const prior = store.get<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', id);
  if (prior) {
    invariant(prior.projectId === projectId && prior.requestId === actor.requestId && prior.epochId === actor.epochId
      && prior.key === key && prior.inputDigest === inputDigest, 'IDEMPOTENCY_CONFLICT', 'This attachment transcription already names different work');
    if (prior.state === 'failed') throw new DomainError(prior.error!.code, prior.error!.message);
    return readDirectorAttachmentTranscription(service, projectId, prior);
  }
  const record: DirectorAttachmentTranscriptionRecord = { id, projectId, requestId: actor.requestId, epochId: actor.epochId,
    key, inputDigest, audioId: input.audioId, operationDigest, state: 'started' };
  const recovered = store.transaction(() => {
    current();
    const previous = store.list<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', projectId)
      .filter(row => row.requestId === actor.requestId && row.epochId === actor.epochId && row.audioId === input.audioId);
    invariant(!previous.some(row => row.state === 'started'), 'TOOL_CALL_UNRESOLVED',
      'The earlier transcription of this attached recording needs reconciliation before another request');
    const published = previous.find(row => row.state === 'succeeded' && row.operationDigest === operationDigest);
    if (published) {
      const result = readDirectorAttachmentTranscription(service, projectId, published);
      // Keep an exact-key receipt too, so reconciliation of this call can find
      // the original publication even if its reply is lost again.
      store.insert('director_attachment_transcription', id, projectId,
        { ...record, state: 'succeeded', receipt: result.receipt, effect: result.effect });
      return result;
    }
    store.insert('director_attachment_transcription', id, projectId, record);
    return undefined;
  });
  if (recovered) return recovered;
  try {
    await transcriptions.request(projectId, human, input, { ...(signal ? { signal } : {}),
      requestedAtCursor: requestHoldCutoff(store, projectId, actor), retainHolds: true, onPublished: receipt => {
      current();
      const resolved = resolveOwnedTranscriptionApplication(store, projectId, receipt.candidateId), proposal = resolved.proposal;
      invariant(proposal.requestId === actor.requestId && proposal.principalId === actor.principalId
        && proposal.inputDigest === inputDigest && resolved.source.sourceRecord.id === input.audioId,
      'TOOL_CALL_UNRESOLVED', 'Attachment transcription publication differs from the exact human request');
      const micros = moneyMicros(proposal.profile.unitCostMicros).toString();
      const effect = recordDirectorGenerationEffect(service, projectId, actor, key, {
        kind: 'transcription', sceneIds: [], shotIds: [], keyframes: 0, voiceLines: 0,
        quote: { micros, units: 1, unitMicros: micros, priceUnknown: micros === '0' }, at: new Date().toISOString(),
      });
      store.put('director_attachment_transcription', id, projectId, { ...record, state: 'succeeded', receipt, effect });
    } });
    return readDirectorAttachmentTranscription(service, projectId, store.get<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', id)!);
  } catch (error) {
    // A saved publication survives a lost reply. Without it, an unexpected outcome stays blocked for reconciliation.
    const saved = store.get<DirectorAttachmentTranscriptionRecord>('director_attachment_transcription', id);
    if (saved?.state === 'started' && error instanceof DomainError && !error.code.endsWith('CANCELLED') && error.code !== 'TOOL_CALL_UNRESOLVED')
      store.put('director_attachment_transcription', id, projectId, { ...record, state: 'failed', error: { code: error.code, message: error.message } });
    throw error;
  }
}
