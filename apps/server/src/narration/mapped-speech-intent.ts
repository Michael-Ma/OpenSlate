import { canonical, digest, invariant } from '@openslate/core';
import type { ProjectRecord } from '@openslate/core';
import type { NarrationSpeechReader } from './narration-speech-records.js';
import type { NarrationSpeechProposal } from './narration-speech-types.js';

interface ShotDraft { id: string; projectId: string; shotId: string; segmentId: string; intentDigest?: string }
const fail = (condition: unknown) => invariant(condition, 'NARRATION_SPEECH_STALE', 'This shot’s narration choice or writing changed. Save and review its current speech plan before generation.');
function mappings(reader: NarrationSpeechReader, projectId: string, segmentId: string): ShotDraft[] {
  const rows = reader.db.prepare("SELECT id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='narration_shot_draft' AND project_id=? AND json_extract(body,'$.segmentId')=? LIMIT 65").all(projectId, segmentId) as { id: string; bytes: number }[];
  fail(rows.length <= 64);
  return rows.map(row => {
    fail(row.bytes <= 4096); const draft = reader.get<ShotDraft>('narration_shot_draft', row.id);
    fail(draft?.id === row.id && draft.projectId === projectId && draft.segmentId === segmentId && typeof draft.shotId === 'string'
      && row.id === digest({ projectId, shotId: draft.shotId }) && (draft.intentDigest === undefined || /^[a-f0-9]{64}$/.test(draft.intentDigest)));
    return draft!;
  });
}
function selectedIntent(project: ProjectRecord, mapping: ShotDraft, voice: string): void {
  const shot = project.shots.find(shot => shot.id === mapping.shotId); fail(shot);
  const intent = shot!.narration;
  invariant(intent?.voice !== 'personal' || /^openai-custom:voice_[A-Za-z0-9_-]{1,120}$/.test(voice),
    'PERSONAL_VOICE_REQUIRED', 'This shot requests your recorded voice. Choose an enrolled personal voice; a stock voice cannot replace it.');
  fail(intent?.mode !== 'none' && intent?.mode !== 'uploaded');
}

/** A compact shot draft saves the card-intent baseline. Later card edits cannot reuse its old writing. */
export function assertMappedSpeechPreparation(reader: NarrationSpeechReader, project: ProjectRecord, segmentId: string, voice: string): void {
  for (const mapping of mappings(reader, project.id, segmentId)) {
    selectedIntent(project, mapping, voice);
    const shot = project.shots.find(shot => shot.id === mapping.shotId)!;
    fail(mapping.intentDigest === undefined || mapping.intentDigest === digest(shot.narration ?? null));
  }
}

/** Bind only associated shot audio intent to the already retained immutable base-project revision. */
export function assertMappedSpeechCurrent(reader: NarrationSpeechReader, project: ProjectRecord, proposal: NarrationSpeechProposal): void {
  const linked = mappings(reader, project.id, proposal.section.segmentId);
  if (!linked.length) return; // Legacy project-wide narration keeps its original explicit section contract.
  const retained = reader.get<{ project: ProjectRecord }>('project_revision', proposal.baseProject.revisionId)?.project;
  fail(retained?.id === project.id && digest(retained) === proposal.baseProject.digest);
  for (const mapping of linked) {
    const current = project.shots.find(shot => shot.id === mapping.shotId), before = retained!.shots.find(shot => shot.id === mapping.shotId);
    fail(current && before && canonical(current.narration ?? null) === canonical(before.narration ?? null));
    selectedIntent(project, mapping, proposal.operation.voice);
  }
}
