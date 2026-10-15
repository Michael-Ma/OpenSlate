import type { ShotOverview } from "@openslate/core/public";

/**
 * Checks the app computes itself (plan decision D4). They are shown in a neutral style,
 * never as the Director's amber recommendations.
 */
export type AppCheck = {
  kind: "narration_too_long";
  shotId: string;
  label: string;
  /** Measured voice length, or the text estimate when no voice exists yet. */
  lineSeconds: number;
  estimated: boolean;
  shotSeconds: number;
  /** The whole-second length that would fit the line (within the 3–15 s shot range). */
  fitSeconds: number;
};

export const MIN_SHOT_SECONDS = 3;
export const MAX_SHOT_SECONDS = 15;

export function narrationChecks(shots: readonly ShotOverview[], fps: number): AppCheck[] {
  const checks: AppCheck[] = [];
  for (const shot of shots) {
    const line = shot.narration;
    if (line.fits !== false || line.fit) continue;
    const lineSeconds = line.measuredSeconds ?? line.estimatedSeconds;
    if (lineSeconds === undefined) continue;
    const shotSeconds = Math.round((shot.durationFrames / fps) * 10) / 10;
    checks.push({
      kind: "narration_too_long",
      shotId: shot.shotId,
      label: shot.label,
      lineSeconds: Math.round(lineSeconds * 10) / 10,
      estimated: line.measuredSeconds === undefined,
      shotSeconds,
      fitSeconds: Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, Math.ceil(lineSeconds + 0.3))),
    });
  }
  return checks;
}

/** Rough spoken length: about 0.3 s per word, or per CJK character. The UI labels it as an estimate. */
export function estimateNarrationSeconds(text: string): number {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  const words = text.replace(/[㐀-鿿豈-﫿]/g, " ").split(/\s+/).filter((word) => /\w/.test(word)).length;
  return Math.round((cjk + words) * 0.3 * 10) / 10;
}
