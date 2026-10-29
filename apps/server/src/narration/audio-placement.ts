import { invariant } from '@openslate/core';
import type { CueRecord, ProjectRecord } from '@openslate/core';
import type { SuppliedMedia } from '../media/types.js';
export interface AudioSegmentPlacement {
  cue: CueRecord; placementMode?: 'shot'; timingMode?: 'within_shot';
  audioPlacement: { source: SuppliedMedia; startSample: number; durationSamples: number; atSample: number; gainMilliDb: number; fadeOutSamples?: number };
}
export interface ShotAudioCut { shotId: string | null; cueId: string | null; startFrame: number; durationFrames: number; timingMode?: 'within_shot'; narrationFit?: 'cut_to_shot' | 'extend_shot' }
export function storyboardAudioCuts(project: Pick<ProjectRecord, 'scenes' | 'shots'>): ShotAudioCut[] {
  let at = 0; return project.scenes.flatMap(scene => project.shots.filter(shot => shot.sceneId === scene.id)).map(shot => {
    const startFrame = at; at += shot.desiredFrames; return { shotId: shot.id, cueId: shot.cueId, startFrame, durationFrames: shot.desiredFrames, ...(shot.narrationTimingMode ? { timingMode: shot.narrationTimingMode } : {}), ...(shot.narrationFit ? { narrationFit: shot.narrationFit } : {}) };
  });
}
/** Shared browser/export placement projection. The accepted source range stays immutable; compact narration travels with its shot. */
export function projectAudioPlacements(segment: AudioSegmentPlacement, cuts: ShotAudioCut[], options: { requireAbsoluteCutStart?: boolean } = {}): AudioSegmentPlacement['audioPlacement'][] {
  const mapped = cuts.filter(cut => cut.cueId === segment.cue.id);
  // Storyboard narration must align with its mapped cut. Legacy DSL asset timelines may have no cue mapping.
  if (segment.placementMode !== 'shot')
    return !options.requireAbsoluteCutStart || mapped.some(cut => segment.audioPlacement.atSample === cut.startFrame * 1600) ? [segment.audioPlacement] : [];
  return mapped.map(cut => {
    const withinShot = segment.timingMode === 'within_shot' && cut.timingMode === 'within_shot';
    invariant((withinShot ? cut.durationFrames >= segment.cue.durationFrames : cut.durationFrames === segment.cue.durationFrames) && segment.audioPlacement.durationSamples <= cut.durationFrames * 1600,
      'MEDIA_NARRATION_REQUIRED', 'Accepted shot audio no longer fits its shot timing');
    return { ...segment.audioPlacement, atSample: cut.startFrame * 1600,
      ...(cut.narrationFit === "cut_to_shot" && segment.audioPlacement.startSample + segment.audioPlacement.durationSamples < (segment.audioPlacement.source.probe.audio?.samples ?? 0)
        ? { fadeOutSamples: Math.min(3840, segment.audioPlacement.durationSamples) } : {}) };
  });
}
