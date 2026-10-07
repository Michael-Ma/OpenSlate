import { invariant } from "@openslate/core";
/** The same source-local music placement is used by live audition and local rendering. */
export function soundtrackPlacement(
  track: { gainMilliDb: number; startFrame?: number; muted?: boolean },
  sourceSamples: number,
  totalFrames: number,
) {
  const start = track.startFrame ?? 0;
  invariant(
    Number.isSafeInteger(start) && start >= 0 && start <= 10800,
    "VALIDATION_ERROR",
    "Music start must be a whole frame within six minutes",
  );
  invariant(
    track.muted === undefined || typeof track.muted === "boolean",
    "VALIDATION_ERROR",
    "Music mute must be true or false",
  );
  invariant(
    Number.isSafeInteger(sourceSamples) &&
      sourceSamples > 0 &&
      Number.isSafeInteger(totalFrames) &&
      totalFrames > 0,
    "MEDIA_SOURCE_UNAVAILABLE",
    "Music and timeline durations must be measured",
  );
  if (track.muted || start >= totalFrames) return null;
  return {
    startSample: 0,
    durationSamples: Math.min(sourceSamples, (totalFrames - start) * 1600),
    atSample: start * 1600,
    gainMilliDb: track.gainMilliDb,
  };
}
