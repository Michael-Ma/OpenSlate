import type { CueRecord, ProjectRecord, ShotRecord } from './contracts.js';

/** Writing intent never substitutes for accepted audio. An explicit silent shot uses its planned frames. */
export function shotVideoTiming(project: Pick<ProjectRecord, 'cues'>, shot: ShotRecord):
  { ready: true; source: 'planned_duration' | 'accepted_audio'; frames: number; cue?: CueRecord } |
  { ready: false; reason: 'narration_undecided' | 'audio_pending' | 'silent_cue_conflict' | 'duration_invalid' } {
  if (!Number.isSafeInteger(shot.desiredFrames) || shot.desiredFrames <= 0) return { ready: false, reason: 'duration_invalid' };
  if (shot.narration?.mode === 'none') return shot.cueId === null
    ? { ready: true, source: 'planned_duration', frames: shot.desiredFrames }
    : { ready: false, reason: 'silent_cue_conflict' };
  if (shot.narrationPending) return { ready: false, reason: 'audio_pending' };
  const cue = shot.cueId ? project.cues.find(item => item.id === shot.cueId) : undefined;
  if (cue?.accepted && cue.measured && Number.isSafeInteger(cue.durationFrames) && cue.durationFrames > 0
    && (shot.narrationTimingMode === 'within_shot' ? cue.durationFrames <= shot.desiredFrames : cue.durationFrames === shot.desiredFrames))
    return { ready: true, source: 'accepted_audio', frames: shot.desiredFrames, cue };
  return { ready: false, reason: shot.narration?.mode === 'generated' || shot.narration?.mode === 'uploaded' || shot.cueId ? 'audio_pending' : 'narration_undecided' };
}
