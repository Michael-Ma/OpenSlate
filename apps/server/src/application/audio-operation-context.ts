import { digest, DomainError, invariant } from '@openslate/core';
import type { ActorContext } from '@openslate/core';
import type { ProductionService } from './service.js';
import type { Store } from '../persistence/store.js';
import { projectNarrationSpeechOptions, projectNarrationSpeechProposals } from '../narration/narration-speech-projection.js';
import { projectOwnedTranscriptionOptions, projectOwnedTranscriptionProposals, ownedTranscriptionAudioSummary, ProjectionReader } from '../narration/owned-transcription-projection.js';
import type { NarrationAudio, NarrationState, SegmentRevision } from '../narration/types.js';

/** Model input cannot select a newer catalog. An unbound director remains legacy V1. */
export function contextToolVersion(store: Store, projectId: string, actor: ActorContext): string {
  const epoch = actor.kind === 'director' ? store.get<{ projectId: string; requestId: string; lockId: string }>('director_epoch_lock', actor.epochId) : undefined;
  if (actor.kind === 'director' && !epoch) return '1.0.0';
  invariant(!epoch || epoch.projectId === projectId && epoch.requestId === actor.requestId, 'CAPABILITY_MISMATCH', 'Context epoch lock differs');
  const id = epoch?.lockId ?? (store.db.prepare("SELECT id FROM entities WHERE kind='director_skill_lock' AND project_id=? ORDER BY rowid DESC LIMIT 1").get(projectId) as { id: string } | undefined)?.id;
  if (!id) return '3.0.0';
  const record = store.get<{ projectId: string; lock: { id: string; lockDigest: string; compatibility: { toolContract: string } } }>('director_skill_lock', id);
  invariant(record?.projectId === projectId && record.lock.id === id, 'CAPABILITY_MISMATCH', 'Context skill lock is missing');
  const { lockDigest, ...body } = record.lock;
  invariant(digest(body) === lockDigest, 'CAPABILITY_MISMATCH', 'Context skill lock changed'); return record.lock.compatibility.toolContract;
}
export interface AudioOperationsProjection {
  version: 1;
  sections: Array<{ segmentId: string; segmentRevisionId: string; text: string; textKind: SegmentRevision['textKind']; language: string;
    source: SegmentRevision['source']; audioId: string | null; generationNeedsReview: true }>;
  recordings: ReturnType<typeof ownedTranscriptionAudioSummary>[];
  speechProposals: ReturnType<typeof projectNarrationSpeechProposals>['proposals'];
  transcriptionProposals: ReturnType<typeof projectOwnedTranscriptionProposals>['proposals'];
  options: { speech: ReturnType<typeof projectNarrationSpeechOptions>; transcription: ReturnType<typeof projectOwnedTranscriptionOptions> };
  coverage: { offset: number; returned: number; total: number; nextOffset: number | null; sections: number; recordings: number;
    speechProposals: number; transcriptionProposals: number; pagination: string; hostReadiness: 'not_evaluated' };
  authority: string;
}
/** Each collection uses the same consumed window, including unavailable proposal rows.
 * The caller can include its outer envelope in the byte check. Bounded pages are
 * loaded once; shrinking a response never repeats hydration or skips a row.
 */
export function projectAudioOperations(service: ProductionService, projectId: string, offset: number,
  fits: (value: AudioOperationsProjection) => boolean = value => Buffer.byteLength(JSON.stringify(value)) <= 128 * 1024): AudioOperationsProjection {
  const store = service.store;
  const read = (): AudioOperationsProjection => {
    invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000, 'VALIDATION_ERROR', 'Invalid audio operations page');
    const view = new ProjectionReader(store, projectId); view.project();
    const state = view.get<NarrationState>('narration_state', projectId), entries = state?.entries ?? [];
    invariant(Array.isArray(entries) && entries.length <= 400, 'PROPOSAL_UNAVAILABLE', 'Narration section inventory is unavailable');
    const totalAudio = (store.db.prepare("SELECT count(*) total FROM entities WHERE kind='narration_audio' AND project_id=?").get(projectId) as { total: number }).total;
    const speechCount = (store.db.prepare("SELECT count(*) total FROM entities WHERE kind='narration_speech_proposal' AND project_id=?").get(projectId) as { total: number }).total;
    const transcriptCount = (store.db.prepare("SELECT count(*) total FROM entities WHERE kind='owned_transcription_proposal' AND project_id=?").get(projectId) as { total: number }).total;
    const total = Math.max(entries.length, totalAudio, speechCount, transcriptCount);
    invariant(offset <= total, 'VALIDATION_ERROR', 'Audio operations page is beyond saved history');
    const speech = projectNarrationSpeechProposals(store, projectId, Math.min(offset, speechCount));
    const transcription = projectOwnedTranscriptionProposals(store, projectId, Math.min(offset, transcriptCount));
    const maximum = Math.min(20, total - offset,
      offset < speechCount ? speech.coverage.scanned : 20, offset < transcriptCount ? transcription.coverage.scanned : 20);
    invariant(offset === total || maximum > 0, 'PROPOSAL_UNAVAILABLE', 'Audio proposal paging did not make progress');
    const audioIds = store.db.prepare("SELECT CASE WHEN length(CAST(id AS BLOB)) BETWEEN 1 AND 160 THEN id ELSE NULL END id FROM entities WHERE kind='narration_audio' AND project_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?").all(projectId, maximum, offset) as { id: string | null }[];
    const options = { speech: projectNarrationSpeechOptions(service, projectId), transcription: projectOwnedTranscriptionOptions(service, projectId) };
    const sections: AudioOperationsProjection['sections'] = [], recordings: AudioOperationsProjection['recordings'] = [];
    const build = (count: number): AudioOperationsProjection => ({ version: 1, sections: sections.slice(0, count), recordings: recordings.slice(0, count),
      speechProposals: speech.proposals.slice(0, count), transcriptionProposals: transcription.proposals.slice(0, count), options,
      coverage: { offset, returned: count, total, nextOffset: offset + count < total ? offset + count : null,
        sections: entries.length, recordings: totalAudio, speechProposals: speechCount, transcriptionProposals: transcriptCount,
        pagination: 'One adaptive shared window per collection; follow nextOffset. Compare the context guard across pages.', hostReadiness: 'not_evaluated' },
      authority: 'These are proposal choices and saved records, never generation permission. Prepare with exact saved IDs. The human reviews the proposal and spending separately. Results require independent listening/word/timing acceptance.' });
    let count = 0;
    for (; count < maximum; count++) {
      try {
        const entry = entries[offset + count];
        if (entry) {
          const segment = view.get<SegmentRevision>('narration_segment', entry.segmentRevisionId);
          invariant(segment?.id === entry.segmentRevisionId && segment.projectId === projectId && segment.segmentId === entry.segmentId,
            'PROPOSAL_UNAVAILABLE', 'Narration section is unavailable');
          sections.push({ segmentId: entry.segmentId, segmentRevisionId: segment.id, text: segment.text, textKind: segment.textKind,
            language: segment.language, source: segment.source, audioId: entry.audioId, generationNeedsReview: true });
        }
        const row = audioIds[count];
        if (row) {
          invariant(typeof row.id === 'string', 'PROPOSAL_UNAVAILABLE', 'Recording identity is unavailable');
          const audio = view.get<NarrationAudio>('narration_audio', row.id);
          invariant(audio?.id === row.id && audio.projectId === projectId, 'PROPOSAL_UNAVAILABLE', 'Recording belongs to different saved evidence');
          recordings.push(ownedTranscriptionAudioSummary(audio));
        }
      } catch (error) {
        if (count && error instanceof DomainError && error.code === 'PROPOSAL_TOO_LARGE') break;
        throw error;
      }
      if (!fits(build(count + 1))) break;
    }
    invariant((maximum === 0 || count > 0) && fits(build(count)), 'CONTEXT_ITEM_TOO_LARGE', 'Context metadata or one complete audio record exceeds this bounded view');
    return build(count);
  };
  return store.db.inTransaction ? read() : store.db.transaction(read).deferred();
}
