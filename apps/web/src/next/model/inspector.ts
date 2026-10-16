import type { GenerationOverview, MediaSlot, PriceQuote, SceneOverview, ShotOverview } from "@openslate/core/public";
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "./checks.ts";
import { confirmationStop, isWorking, seconds, shotStatus, type CardTone } from "./keyframes.ts";
import { narrationRow, type NarrationMode, type TakeOrigin } from "./narration.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/** The shot fields the inspector edits. */
export type EditableField = "imagePrompt" | "motion" | "desiredFrames" | "narration";

/**
 * Which media a saved change outdates (plan item SB-10). Mirrors the server's storyboard edit:
 * the picture prompt detaches the keyframe and its clip; motion and duration keep the keyframe and
 * detach only the clip; narration text changes nothing visual (the voice line is made again).
 */
export function outdatedBy(field: EditableField): { keyframe: boolean; video: boolean } {
  switch (field) {
    case "imagePrompt": return { keyframe: true, video: true };
    case "motion":
    case "desiredFrames": return { keyframe: false, video: true };
    case "narration": return { keyframe: false, video: false };
  }
}

/** Said before saving: what the change will outdate for this shot as it stands. */
export function editImpact(shot: ShotOverview, fields: readonly EditableField[]): Msg {
  const touchesKeyframe = fields.some((field) => outdatedBy(field).keyframe);
  const touchesVideo = fields.some((field) => outdatedBy(field).video);
  const keyframe = touchesKeyframe && shot.keyframe.state === "ready";
  const clip = touchesVideo && shot.video.state === "ready";
  if (touchesKeyframe && isWorking(shot.keyframe)) return msg("inspector.outdates.running");
  if (keyframe && clip) return msg("inspector.outdates.keyframe_and_clip");
  if (keyframe) return msg("inspector.outdates.keyframe");
  if (clip) return msg("inspector.outdates.video");
  if (!touchesKeyframe && touchesVideo && shot.keyframe.state === "ready") return msg("inspector.outdates.none_keyframe_stays");
  if (!touchesKeyframe && !touchesVideo) return msg(shot.narration.state === "ready" ? "inspector.outdates.voice" : "inspector.outdates.nothing_visual");
  return msg("inspector.outdates.none");
}

/** Whole seconds in the 3–15 s range the server accepts, or null. */
export function parseSeconds(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= MIN_SHOT_SECONDS && value <= MAX_SHOT_SECONDS ? value : null;
}

/** A refusal (the value cannot be saved) or a warning (it can, with a consequence). */
export function durationIssue(text: string, shot: ShotOverview): { kind: "refusal" | "warning"; message: Msg } | null {
  const value = parseSeconds(text);
  if (value === null) return { kind: "refusal", message: msg("inspector.duration_range", { min: MIN_SHOT_SECONDS, max: MAX_SHOT_SECONDS }) };
  const line = shot.narration.measuredSeconds;
  if (line !== undefined && value < line) return { kind: "warning", message: msg("inspector.duration_short_line", { seconds: Math.round(line * 10) / 10 }) };
  return null;
}

export interface InspectorRow {
  key: "motion" | "duration" | "narration" | "takes";
  label: Msg;
  /** Plain text from the film (shown as is), or a message. */
  value: string | Msg;
  quoted: boolean;
  notes: { message: Msg; tone: "plain" | "warn" }[];
}

export interface RegenerateAction {
  /** make: no take exists yet (or the last one failed); regenerate: a new take next to the current one. */
  kind: "make" | "regenerate";
  label: Msg;
  /** "A new take costs about $0.04"; said under the button, so the label stays short in the 250 px column. */
  cost: Msg | null;
  /** White when this is the thing to do next (missing, outdated or failed keyframe). */
  primary: boolean;
  enabled: boolean;
  working: boolean;
  /** Said under the button when a finished clip depends on this keyframe. */
  clipNote: Msg | null;
  /** Why the button is disabled, or why it is the thing to do (an outdated keyframe). */
  reason: Msg | null;
}

export interface InspectorView {
  shotId: string;
  sceneId: string;
  label: string;
  title: Msg;
  framing: string;
  status: Msg;
  tone: CardTone;
  rows: InspectorRow[];
  regenerate: RegenerateAction;
  /** A failed keyframe or clip, with what was charged. */
  failure: { slot: "keyframe" | "video"; message: Msg; retryVideo: { enabled: boolean; price: Msg | null } | null } | null;
  /** A job the service never confirmed: offer to give up on it (plan decision D7). */
  noAnswer: { slot: "keyframe" | "video"; attemptId: string } | null;
  /** An outdated keyframe or clip, and why. */
  notes: Msg[];
  /** The scene's last confirm stopped at this shot: why, and what to do next. */
  stopped: { reason: Msg; next: Msg } | null;
  /** The full prompts as stored: the picture prompt and the video prompt sent to the paid models (read-only here). */
  prompts: { image: string; video: string | null };
}

const priceFrom = (unitMicros: string | undefined, unknown: boolean, locale: string): Msg | null => {
  if (unitMicros === undefined) return null;
  if (unknown || Number(unitMicros) === 0) return msg("price.unknown");
  return msg("price.about", { total: formatMicros(unitMicros, locale) });
};

/** The cost line under the keyframe button: "A new take costs about $0.04", or "About $0.04" for a first make. */
function costFrom(unit: { unitMicros: string; unknown: boolean } | null, kind: "make" | "regenerate", locale: string): Msg | null {
  if (!unit) return null;
  if (unit.unknown || Number(unit.unitMicros) === 0) return msg("price.unknown");
  return msg(kind === "regenerate" ? "inspector.cost.take" : "inspector.cost.make", { price: formatMicros(unit.unitMicros, locale) });
}

const quoteUnit = (quote: PriceQuote | undefined): { unitMicros: string; unknown: boolean } | null => quote ? { unitMicros: quote.unitMicros, unknown: quote.priceUnknown } : null;

/** One clip's price: from this scene's video quote, else any scene's (the video model is film-wide). */
export function clipUnit(overview: GenerationOverview, scene: SceneOverview | undefined): { unitMicros: string; unknown: boolean } | null {
  return quoteUnit(scene?.quotes.confirmVideo) ?? quoteUnit(overview.scenes.find((s) => s.quotes.confirmVideo)?.quotes.confirmVideo);
}

/**
 * One keyframe's price for this shot. The shot's own quote is exact (it includes a voice line still to make,
 * so it is a total, not a unit); the scene's quotes are the fallback.
 */
function keyframePrice(shot: ShotOverview, scene: SceneOverview | undefined): { unitMicros: string; unknown: boolean } | null {
  const own = shot.quotes?.regenerateKeyframe;
  if (own) return { unitMicros: own.micros, unknown: own.priceUnknown };
  return quoteUnit(scene?.quotes.regenerateKeyframe) ?? quoteUnit(scene?.quotes.makeKeyframes);
}

function failureMessage(slot: MediaSlot, kind: "keyframe" | "video"): Msg {
  const failure = slot.failure;
  if (failure && failure.technical && failure.autoRetriesLeft > 0) return msg("inspector.failed.retrying", { count: failure.autoRetriesLeft });
  if (failure && !failure.retryAllowed) return msg(failure.charged ? "inspector.failed.refused_charged" : "inspector.failed.refused");
  return msg(`card.${kind}.${failure?.charged ? "failed_charged" : "failed"}`);
}

const canRetry = (slot: MediaSlot) => !slot.failure || (slot.failure.retryAllowed && !(slot.failure.technical && slot.failure.autoRetriesLeft > 0));

function regenerateAction(overview: GenerationOverview, shot: ShotOverview, scene: SceneOverview | undefined, locale: string): RegenerateAction {
  const unit = keyframePrice(shot, scene);
  const clip = clipUnit(overview, scene);
  const clipPrice = clip && !clip.unknown && Number(clip.unitMicros) > 0 ? formatMicros(clip.unitMicros, locale) : null;
  const clipNote = shot.video.state === "ready" ? (clipPrice ? msg("inspector.clip_will_redo", { price: clipPrice }) : msg("inspector.clip_will_redo_unpriced")) : null;
  const keyframe = shot.keyframe;
  const take = costFrom(unit, "regenerate", locale);
  const first = costFrom(unit, "make", locale);
  const base = { clipNote: null, reason: null, working: false };
  if (isWorking(keyframe)) return { ...base, kind: "regenerate", label: msg("card.keyframe.making"), cost: null, primary: false, enabled: false, working: true };
  if (isWorking(shot.video)) return { ...base, kind: "regenerate", label: msg("inspector.regenerate"), cost: null, primary: false, enabled: false, reason: msg("inspector.wait_for_clip") };
  switch (keyframe.state) {
    case "ready": return { ...base, kind: "regenerate", label: msg("inspector.regenerate"), cost: take, primary: false, enabled: true, clipNote };
    case "outdated": return { ...base, kind: "make", label: msg("inspector.regenerate"), cost: take, primary: true, enabled: true, reason: msg("inspector.keyframe_outdated") };
    case "failed": return { ...base, kind: "make", label: msg("inspector.make_again"), cost: canRetry(keyframe) ? (keyframe.previous ? take : first) : null, primary: canRetry(keyframe), enabled: canRetry(keyframe) };
    case "direction_required": return { ...base, kind: "make", label: msg("inspector.make_keyframe"), cost: null, primary: false, enabled: false, reason: msg("card.direction_required") };
    case "no_answer":
    case "choose_take": return { ...base, kind: "regenerate", label: msg("inspector.regenerate"), cost: null, primary: false, enabled: false };
    default: return { ...base, kind: "make", label: msg("inspector.make_keyframe"), cost: first, primary: true, enabled: true };
  }
}

/**
 * `narrationMode` is the shot's stored narration mode (the project snapshot), so a recording reads as one;
 * `narrationOrigin` is its current take's (takeOrigin), so a voice line is never called the person's recording.
 * `videoPrompt` also comes from the project snapshot (the overview does not carry it); null while it is not read.
 */
export function inspectorView(overview: GenerationOverview, shot: ShotOverview, locale: string, narrationMode?: NarrationMode, narrationOrigin: TakeOrigin | null = null, videoPrompt: string | null = null): InspectorView {
  const scene = overview.scenes.find((s) => s.sceneId === shot.sceneId);
  const { status, tone } = shotStatus(overview, scene, shot);
  const rows: InspectorRow[] = [
    { key: "motion", label: msg("inspector.motion"), value: shot.motion, quoted: false, notes: [] },
    { key: "duration", label: msg("inspector.duration"), value: msg("inspector.duration_value", { seconds: seconds(shot.durationFrames, overview.fps) }), quoted: false, notes: [] },
    narrationRow(shot, overview.fps, narrationMode, narrationOrigin),
  ];
  const takes = shot.keyframe.takeCount;
  if (takes > 1)
    rows.push({ key: "takes", label: msg("inspector.takes"), value: String(takes), quoted: false, notes: [{ message: msg(shot.keyframe.state === "ready" ? "inspector.takes_shown" : "inspector.takes_kept", { count: takes }), tone: "plain" }] });

  let failure: InspectorView["failure"] = null;
  if (shot.keyframe.state === "failed") failure = { slot: "keyframe", message: failureMessage(shot.keyframe, "keyframe"), retryVideo: null };
  else if (shot.video.state === "failed") {
    const clip = clipUnit(overview, scene);
    failure = {
      slot: "video",
      message: failureMessage(shot.video, "video"),
      retryVideo: canRetry(shot.video) ? { enabled: !!scene && scene.blockers.length === 0, price: priceFrom(clip?.unitMicros, clip?.unknown ?? false, locale) } : null,
    };
  }
  const noAnswerSlot = shot.keyframe.state === "no_answer" && shot.keyframe.attemptId ? { slot: "keyframe" as const, attemptId: shot.keyframe.attemptId }
    : shot.video.state === "no_answer" && shot.video.attemptId ? { slot: "video" as const, attemptId: shot.video.attemptId } : null;

  // An outdated keyframe is explained next to its Regenerate button; an outdated clip here.
  const notes: Msg[] = [];
  if (shot.video.state === "outdated" && shot.keyframe.state === "ready") notes.push(msg("inspector.clip_outdated"));
  const stop = scene ? confirmationStop(overview, scene) : null;

  return {
    shotId: shot.shotId,
    sceneId: shot.sceneId,
    label: shot.label,
    title: msg("inspector.shot", { shot: shot.label }),
    framing: shot.framing,
    status,
    tone,
    rows,
    regenerate: regenerateAction(overview, shot, scene, locale),
    failure,
    noAnswer: noAnswerSlot,
    notes,
    stopped: stop && stop.shotId === shot.shotId ? { reason: stop.reason, next: stop.next } : null,
    prompts: { image: shot.imagePrompt, video: videoPrompt },
  };
}
