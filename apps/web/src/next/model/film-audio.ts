/**
 * Sound for the Film view's live preview (ideas from the classic timeline playback model, not its code):
 * narration and music placements from GET /api/projects/:projectId/narration/playback, each played on the
 * film clock. The clip video elements are always muted: a clip's own sound, when the shot keeps it, comes as a
 * placement of kind "clip" (the clip's derived audio, ducked under voice by `gainSteps`, the same steps the export
 * mixes; docs/ai/clip-audio/2026-10-28-clip-audio.md). Pure, apart from the media object a caller passes in.
 */

/** One placed recording, in 48 kHz samples. */
export interface AudioPlacement {
  id: string;
  audioId: string;
  sha256: string;
  startSample: number;
  durationSamples: number;
  atSample: number;
  gainMilliDb: number;
  fadeOutSamples?: number;
  shotIds: string[];
  /** "clip": a kept clip's own sound, loaded from the clip-audio route; absent: a recording (narration, music). */
  kind?: "clip";
  /** Gain from each film sample on (the first at atSample): kept clip sound drops under narration. Overrides gainMilliDb. */
  gainSteps?: Array<{ atSample: number; gainMilliDb: number }>;
}

export interface PlaybackView {
  projectId: string;
  headVersion: number;
  revisionId: string;
  placements: AudioPlacement[];
  soundtrack: AudioPlacement | null;
}

export const SAMPLE_RATE = 48000;

/** The placements to play, only when they describe the film as it is now (same head version). */
export function currentPlacements(view: PlaybackView | null, headVersion: number | undefined): AudioPlacement[] {
  if (!view || headVersion === undefined || view.headVersion !== headVersion) return [];
  return [...view.placements, ...(view.soundtrack ? [view.soundtrack] : [])];
}

/** Where a placement is at film time t: whether it sounds, the source position and the volume (0–1). */
export function audioAt(placement: AudioPlacement, t: number): { active: boolean; sourceSeconds: number; volume: number } {
  const sample = Math.round(t * SAMPLE_RATE);
  const offset = sample - placement.atSample;
  const active = offset >= 0 && offset < placement.durationSamples;
  const sourceSeconds = (placement.startSample + Math.max(0, Math.min(offset, placement.durationSamples))) / SAMPLE_RATE;
  let gain = placement.gainMilliDb;
  for (const step of placement.gainSteps ?? []) if (step.atSample <= sample) gain = step.gainMilliDb;
  let volume = Math.min(1, Math.max(0, 10 ** (gain / 20000)));
  const fade = placement.fadeOutSamples ?? 0;
  if (active && fade > 0) {
    const left = placement.durationSamples - offset;
    if (left < fade) volume *= Math.max(0, left / fade);
  }
  return { active, sourceSeconds, volume };
}

export interface PlayableMedia {
  currentTime: number;
  paused: boolean;
  volume: number;
  pause(): void;
  play(): Promise<void> | void;
}

/** Keep one media element in step with the clock: seek when it drifts, play or pause with the film. */
export function syncMedia(media: PlayableMedia, target: { active: boolean; sourceSeconds: number; volume: number }, playing: boolean, tolerance = 0.15): void {
  media.volume = target.volume;
  if (!target.active || !playing) {
    if (!media.paused) media.pause();
    if (target.active && Math.abs(media.currentTime - target.sourceSeconds) > tolerance) media.currentTime = target.sourceSeconds;
    return;
  }
  if (Math.abs(media.currentTime - target.sourceSeconds) > tolerance) media.currentTime = target.sourceSeconds;
  if (media.paused) void Promise.resolve(media.play()).catch(() => { /* autoplay refused: the picture still plays */ });
}

/** A clip's position for the shot on screen: it plays from its start for the shot's length. */
export const clipTarget = (local: number, active: boolean) => ({ active, sourceSeconds: Math.max(0, local), volume: 0 });
