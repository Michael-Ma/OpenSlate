import type { GenerationOverview, SceneOverview, ShotNarration, ShotOverview } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

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
  /** The server's extension target; absent for estimates or a line outside the model's duration range. */
  fitSeconds?: number;
  /** The shot's clip is saved: the line is settled before exporting the film, not before making video. */
  hasClip: boolean;
};

/**
 * The mark an app check carries in the banner and on its card: a neutral "!", as Plan's check chip. Never a letter,
 * so it cannot be read as the Director's lettered note (a, b…) shown on the same screen.
 */
export const CHECK_MARK = "!";

export const MIN_SHOT_SECONDS = 3;
export const MAX_SHOT_SECONDS = 15;
/** Default spoken pace: about 0.3 s per word, or per CJK character (matches the server's estimate). */
export const DEFAULT_SECONDS_PER_UNIT = 0.3;

const round1 = (value: number) => Math.round(value * 10) / 10;

export function narrationChecks(shots: readonly ShotOverview[], fps: number): AppCheck[] {
  const checks: AppCheck[] = [];
  for (const shot of shots) {
    const line = shot.narration;
    if (line.fits !== false || line.fit) continue;
    const lineSeconds = line.measuredSeconds ?? line.estimatedSeconds;
    if (lineSeconds === undefined) continue;
    const shotSeconds = round1(shot.durationFrames / fps);
    checks.push({
      kind: "narration_too_long",
      shotId: shot.shotId,
      label: shot.label,
      lineSeconds: round1(lineSeconds),
      estimated: line.measuredSeconds === undefined,
      shotSeconds,
      ...(line.fitSeconds !== undefined ? { fitSeconds: line.fitSeconds } : {}),
      hasClip: shot.video.state === "ready",
    });
  }
  return checks;
}

const CJK = /[㐀-鿿豈-﫿]/g;

/** Spoken units: words, plus one per CJK character. */
export function speechUnits(text: string): number {
  const cjk = (text.match(CJK) ?? []).length;
  const words = text.replace(CJK, " ").split(/\s+/).filter((word) => /\w/.test(word)).length;
  return cjk + words;
}

/** Rough spoken length: about 0.3 s per word, or per CJK character. The UI labels it as an estimate. */
export function estimateNarrationSeconds(text: string, secondsPerUnit = DEFAULT_SECONDS_PER_UNIT): number {
  return round1(speechUnits(text) * secondsPerUnit);
}

/**
 * The pace to estimate an edited line at. A line that already has a length (measured, or estimated earlier)
 * sets the pace, so the unchanged line estimates at exactly its known length; otherwise the default pace.
 */
export function narrationPace(line: Pick<ShotNarration, "text" | "measuredSeconds" | "estimatedSeconds">): { secondsPerUnit: number; calibrated: boolean } {
  const known = line.measuredSeconds ?? line.estimatedSeconds;
  const units = speechUnits(line.text);
  if (known !== undefined && known > 0 && units > 0) return { secondsPerUnit: known / units, calibrated: line.measuredSeconds !== undefined };
  return { secondsPerUnit: DEFAULT_SECONDS_PER_UNIT, calibrated: false };
}

export interface LineEstimate {
  seconds: number;
  /** At the recorded voice's pace rather than the default pace. */
  calibrated: boolean;
  fits: boolean;
  shotSeconds: number;
}

/** Live estimate for the inline narration editor. Always shown as an estimate (plan item SB-4). */
export function lineEstimate(text: string, shot: Pick<ShotOverview, "narration" | "durationFrames">, fps: number): LineEstimate {
  const pace = narrationPace(shot.narration);
  const seconds = estimateNarrationSeconds(text, pace.secondsPerUnit);
  const shotSeconds = round1(shot.durationFrames / fps);
  return { seconds, calibrated: pace.calibrated, fits: seconds <= shotSeconds + 1e-9, shotSeconds };
}

export function lineEstimateMsg(estimate: LineEstimate): Msg {
  const values = { seconds: estimate.seconds, shot: estimate.shotSeconds };
  if (estimate.calibrated) return msg(estimate.fits ? "check.estimate.recorded_fits" : "check.estimate.recorded_long", values);
  return msg(estimate.fits ? "check.estimate.fits" : "check.estimate.long", values);
}

// ---- Now / After timeline ---------------------------------------------------------

export interface TimelineSegment {
  /** A shot with its length, or the dashed tail (the next shot, the next scene, or the end of the film). */
  kind: "shot" | "tail";
  text: Msg;
  /** Drawn width follows the seconds for shots; tails have a fixed width. */
  seconds: number;
  /** The segment the change touches (drawn as the chosen option). */
  hot: boolean;
  /** A shot's own label ("2.3"): all a segment too narrow for its seconds shows (the seconds go to its tooltip). */
  label?: string;
}

export interface CheckTimeline {
  now: TimelineSegment[];
  after: TimelineSegment[];
}

const orderedScenes = (overview: GenerationOverview) => [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal);
const secondsOf = (shot: ShotOverview, fps: number) => round1(shot.durationFrames / fps);

function context(overview: GenerationOverview, shotId: string): { scene: SceneOverview; index: number; next: SceneOverview | null } | null {
  const scenes = orderedScenes(overview);
  for (const [position, scene] of scenes.entries()) {
    const index = scene.shotIds.indexOf(shotId);
    if (index >= 0) return { scene, index, next: scenes[position + 1] ?? null };
  }
  return null;
}

/** Where the film reaches the end of this shot, in seconds. */
function endOf(overview: GenerationOverview, shotId: string): number {
  let total = 0;
  for (const scene of orderedScenes(overview))
    for (const id of scene.shotIds) {
      const shot = overview.shots[id];
      if (shot) total += shot.durationFrames / overview.fps;
      if (id === shotId) return round1(total);
    }
  return round1(total);
}

type Tail = { kind: "shot"; label: string } | { kind: "scene"; ordinal: number } | { kind: "end" };

function tailOf(overview: GenerationOverview, shotId: string): Tail {
  const where = context(overview, shotId);
  const following = where?.scene.shotIds[where.index + 1];
  const nextShot = following ? overview.shots[following] : undefined;
  if (nextShot) return { kind: "shot", label: nextShot.label };
  if (where?.next) return { kind: "scene", ordinal: where.next.ordinal };
  return { kind: "end" };
}

function tailSegment(tail: Tail, mode: "now" | "later" | "from", value: number | string): TimelineSegment {
  const suffix = mode === "now" ? "" as const : mode === "later" ? "_later" as const : "_from" as const;
  const values = tail.kind === "shot" ? { label: tail.label } : tail.kind === "scene" ? { scene: tail.ordinal } : {};
  const extra = mode === "later" ? { seconds: value } : mode === "from" ? { time: value } : {};
  const text = msg(`check.tail.${tail.kind}${suffix}`, { ...values, ...extra });
  return { kind: "tail", text, seconds: 0, hot: false };
}

function shotSegment(shot: ShotOverview, secondsValue: number, hot: boolean): TimelineSegment {
  return { kind: "shot", text: msg("check.segment.shot", { label: shot.label, seconds: secondsValue }), seconds: secondsValue, hot, label: shot.label };
}

/**
 * The Now / After strip for a too-long line: the shot before it (if any), the shot itself, then what follows,
 * which starts later by the added seconds after the change.
 */
export function checkTimeline(check: AppCheck, overview: GenerationOverview): CheckTimeline {
  const shot = overview.shots[check.shotId];
  const where = context(overview, check.shotId);
  if (!shot || !where) return { now: [], after: [] };
  const beforeId = where.scene.shotIds[where.index - 1];
  const before = beforeId ? overview.shots[beforeId] : undefined;
  const lead = before ? [shotSegment(before, secondsOf(before, overview.fps), false)] : [];
  const tail = tailOf(overview, check.shotId);
  const added = check.fitSeconds === undefined ? 0 : round1(check.fitSeconds - check.shotSeconds);
  return {
    now: [...lead, shotSegment(shot, check.shotSeconds, false), tailSegment(tail, "now", 0)],
    after: check.fitSeconds === undefined ? [] : [...lead, shotSegment(shot, check.fitSeconds, true), tailSegment(tail, "later", added)],
  };
}

/** The strip after a change landed: the shot at its new length, then what follows and when it now starts. */
export function settledTimeline(shotId: string, overview: GenerationOverview, clockText: (seconds: number) => string): TimelineSegment[] {
  const shot = overview.shots[shotId];
  const where = context(overview, shotId);
  if (!shot || !where) return [];
  const beforeId = where.scene.shotIds[where.index - 1];
  const before = beforeId ? overview.shots[beforeId] : undefined;
  return [
    ...(before ? [shotSegment(before, secondsOf(before, overview.fps), false)] : []),
    shotSegment(shot, secondsOf(shot, overview.fps), true),
    tailSegment(tailOf(overview, shotId), "from", clockText(endOf(overview, shotId))),
  ];
}

/**
 * What the check offers, each settled by one free server command (SB-2, SB-3) or an edit:
 * lengthen the shot to fit the line, keep the shot and cut the line with a fade, or rewrite the line.
 */
export interface CheckActions {
  /** Lengthen the shot to fit the line. Absent when even 15 s is too short. */
  extend: { seconds: number; frames: number; label: Msg } | null;
  /** Keep the shot's length; the line is cut at its end. `cutSeconds` is what will not be heard. */
  keep: { seconds: number; cutSeconds: number; label: Msg } | null;
  edit: { label: Msg };
}

export function checkActions(check: AppCheck, fps: number): CheckActions {
  const target = check.fitSeconds;
  const extendFits = !check.estimated && target !== undefined && target + 1e-9 >= check.lineSeconds && target > check.shotSeconds;
  return {
    extend: extendFits ? { seconds: target, frames: Math.round(target * fps), label: msg("check.narration.extend", { label: check.label, seconds: target }) } : null,
    keep: check.estimated ? null : { seconds: check.shotSeconds, cutSeconds: round1(check.lineSeconds - check.shotSeconds), label: msg("check.narration.keep", { seconds: check.shotSeconds }) },
    edit: { label: msg("check.narration.edit") },
  };
}

/** The banner's line under the title: what the line does, and what settling it comes before. */
export function checkBody(check: AppCheck): Msg {
  return msg(check.estimated ? "check.narration.estimated_body" : check.hasClip ? "check.narration.body_clip" : "check.narration.body", { label: check.label });
}

export function checkTitle(check: AppCheck): Msg {
  return msg(check.estimated ? "check.narration.title_estimated" : "check.narration.title", { line: check.lineSeconds, shot: check.shotSeconds });
}

export function checkCallout(check: AppCheck): Msg {
  return msg(check.estimated ? "check.callout.narration_estimated" : "check.callout.narration", { line: check.lineSeconds, shot: check.shotSeconds });
}
