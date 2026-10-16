import { DomainError } from '@openslate/core';
import type { ProjectRecord } from '@openslate/core';

/** Accepted voiceover must fit its picture slot, regardless of which command publishes it. */
export function assertAcceptedNarrationDurationFloor(project: ProjectRecord): void {
  for (const shot of project.shots) {
    const cue = project.cues.find(cue => cue.id === shot.cueId);
    if (shot.narrationTimingMode === 'within_shot' && cue?.accepted && cue.durationFrames > shot.desiredFrames)
      throw new DomainError('SHOT_SHORTER_THAN_NARRATION', 'Make the shot longer or cut the accepted narration before shortening it.', {
        shotId: shot.id, narrationFrames: cue.durationFrames, requestedFrames: shot.desiredFrames,
      });
  }
}
