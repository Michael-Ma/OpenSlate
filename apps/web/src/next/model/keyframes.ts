import type { GenerationOverview, MediaSlot, PriceQuote, SceneBlocker, SceneOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { errorMsg } from "../i18n/translate.ts";
import { formatList } from "../i18n/typeset.ts";
import { msg, type Msg } from "./types.ts";
import { CHECK_MARK, narrationChecks, type AppCheck } from "./checks.ts";
import { formatMicros, priceMsg } from "./price.ts";
import { queuedToRun, waitingMsg } from "./media-state.ts";

export { waitingMsg } from "./media-state.ts";

export const seconds = (frames: number, fps: number) => Math.round((frames / fps) * 10) / 10;

export interface ScenePill {
  sceneId: string;
  ordinal: number;
  title: string;
  status: Msg | null;
  selected: boolean;
}

export type CardTone = "opened" | "not_opened" | "working" | "attention" | "quiet";

export interface ShotCard {
  shotId: string;
  label: string;
  framing: string;
  prompt: string;
  seconds: number;
  /** The picture to show: the current keyframe, or the previous one (dimmed) while it is outdated or remade. */
  picture: StudioArtifactRef | null;
  pictureDimmed: boolean;
  status: Msg;
  tone: CardTone;
  /** The status in full where the pill says it short (a shot held by an edit): for the card's tooltip. */
  statusReason: Msg | null;
  motion: string;
  /** Indeterminate progress while a keyframe or clip is being made. */
  working: boolean;
  /**
   * What is being made right now (queued work shows only its status): the keyframe (striped overlay), the clip (bar),
   * or the voice line that the scene's confirm is making, saving or fitting for this shot (bar).
   */
  workingOn: "keyframe" | "video" | "voice" | null;
  selected: boolean;
  /** App-computed checks attached to this card, each with the neutral check mark (never a Director's letter). */
  callouts: { letter: string; check: AppCheck }[];
}

export interface VideoPanel {
  sceneOrdinal: number;
  segments: { shotId: string; label: string; opened: boolean }[];
  openedCount: number;
  targetCount: number;
  /** null when nothing can be pressed (video or keyframes are being made, or nothing to make). */
  action: "confirm" | "make_keyframes" | "play" | null;
  enabled: boolean;
  label: Msg;
  /** The whole price with its breakdown ("about $1.50 · 3 at about $0.50"); null while blocked. */
  price: Msg | null;
  /** The total for the enabled button ("about $1.50"); null while blocked or free. */
  priceTotal: Msg | null;
  /** The breakdown under the enabled button ("3 clips at about $0.50"). */
  priceEach: Msg | null;
  /**
   * Why the button is disabled; shown under it. While a stopped confirm shows, the blockers its message already
   * explains (its too-long line, the stopped film, its job with no answer) are left out; any other one is said.
   */
  reason: Msg | null;
  note: Msg | null;
  eyebrow: Msg;
  /** The large figure ("1 of 3", "Video saved") and its unit ("frames opened"). */
  headline: { value: Msg; unit: Msg | null };
  /**
   * The scene's last confirm stopped partway: why, and what to do next. Shown in place of the note; the opened-frame
   * segments and the reason under a disabled button stay.
   */
  stopped: ConfirmationStop | null;
}

// ---- the scene confirm's steps and stops (SceneOverview.confirmation) -------------------------------------

export type ConfirmStep = "speech" | "attach" | "accept" | "video";

/** The step a running confirm is on, and for which shot (voice steps name their shot; the video step may not). */
export function confirmationStep(overview: GenerationOverview, scene: SceneOverview): { step: ConfirmStep; shotId: string | null; label: string | null } | null {
  const confirmation = scene.confirmation;
  if (confirmation?.state !== "running" || !confirmation.currentStep) return null;
  const shot = confirmation.currentShotId ? overview.shots[confirmation.currentShotId] : undefined;
  return { step: confirmation.currentStep, shotId: shot?.shotId ?? null, label: shot?.label ?? null };
}

export interface ConfirmationStop {
  /** The server's blocker code, e.g. NARRATION_CUE_OUT_OF_RANGE. */
  code: string;
  shotId: string | null;
  label: string | null;
  /** Why it stopped, in plain words. */
  reason: Msg;
  /** What to do so the scene can be confirmed again. */
  next: Msg;
  /** Where that is done, when it is another view: the shot's line in Plan, or the narrator voice in Settings. */
  action: "plan" | "settings" | null;
}

/** Blocker codes said in their own words (the voice line failed, ran too long, frames changed, the film stopped…). */
const STOP_CODES = ["NARRATION_SPEECH_FAILED", "SUBMISSION_UNKNOWN", "NARRATION_RECORDING_REQUIRED", "NARRATION_CUE_OUT_OF_RANGE", "SCENE_REVIEW_STALE", "EXECUTION_PAUSED", "NARRATION_SPEECH_UNAVAILABLE"] as const;
type StopCode = (typeof STOP_CODES)[number] | "NARRATION_IMPORT";
/**
 * Codes from saving a voice line that came back (the attach and accept steps): the recording import needs attention.
 * Classic said the same for its AUDIO_, MEDIA_ and OUTPUT_ codes (scene-confirmation-model.ts:279).
 */
const IMPORT_CODES = new Set(["GENERATED_NARRATION_CONFLICT", "NARRATION_GENERATED_IDENTITY_CHANGED", "NARRATION_STALE_ACCEPTANCE", "NARRATION_SESSION_STALE", "NARRATION_SPEECH_INVALID", "NARRATION_SOURCE_UNDECIDED", "NARRATION_INVALID_INPUT"]);
const PLAN_CODES = new Set<StopCode>(["NARRATION_SPEECH_FAILED", "NARRATION_RECORDING_REQUIRED", "NARRATION_IMPORT"]);

function stopCode(code: string): StopCode | null {
  if ((STOP_CODES as readonly string[]).includes(code)) return code as StopCode;
  if (code === "PERSONAL_VOICE_REQUIRED") return "NARRATION_SPEECH_UNAVAILABLE";
  if (IMPORT_CODES.has(code) || /^(AUDIO|MEDIA|OUTPUT)_/.test(code)) return "NARRATION_IMPORT";
  return null;
}

/**
 * Why the scene's last confirm stopped partway, with the next step (the server's "blocked" confirmation and its
 * blocker code and shot). It stays until the scene is confirmed again; nothing once its video is saved or clips are
 * being made again.
 */
export function confirmationStop(overview: GenerationOverview, scene: SceneOverview): ConfirmationStop | null {
  const confirmation = scene.confirmation;
  const blocker = confirmation?.state === "blocked" ? confirmation.blocker : undefined;
  if (!blocker || scene.state === "video_saved") return null;
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  if (shots.some((shot) => shot.video.state === "running")) return null;
  const shot = blocker.shotId ? overview.shots[blocker.shotId] : undefined;
  const label = shot?.label ?? null;
  const base = { code: blocker.code, shotId: shot?.shotId ?? null, label };
  const code = stopCode(blocker.code);
  if (!code) return { ...base, reason: errorMsg(blocker.code), next: msg("confirm.stopped.next.other"), action: null };
  const reason = code === "NARRATION_CUE_OUT_OF_RANGE" && shot?.narration.measuredSeconds !== undefined
    ? msg("confirm.stopped.NARRATION_CUE_OUT_OF_RANGE.measured", { shot: shot.label, line: Math.round(shot.narration.measuredSeconds * 10) / 10 })
    : msg(`confirm.stopped.${code}.${label ? "shot" : "scene"}`, label ? { shot: label } : undefined);
  // A too-long line settled since (the shot lengthened past its measured length, or the line cut at the shot's end)
  // only needs the confirm again; so does a film that was stopped and runs again.
  const line = shot?.narration;
  const settled = code === "NARRATION_CUE_OUT_OF_RANGE" && !!line && (!!line.fit || (line.measuredSeconds !== undefined && line.fits === true));
  const resumed = code === "EXECUTION_PAUSED" && !overview.stopped;
  return {
    ...base,
    reason,
    next: msg(settled ? "confirm.stopped.next.settled" : resumed ? "confirm.stopped.next.resumed" : `confirm.stopped.next.${code}`),
    action: code === "NARRATION_SPEECH_UNAVAILABLE" ? "settings" : PLAN_CODES.has(code) && shot ? "plan" : null,
  };
}

/**
 * Whether a stopped confirm's message already explains this blocker: its too-long line (NARRATION_CUE_OUT_OF_RANGE),
 * the stopped film (EXECUTION_PAUSED), or its voice job with no answer (SUBMISSION_UNKNOWN). Any other blocker keeps
 * the Confirm button off for a reason the stop does not say.
 */
export function stopExplains(stop: ConfirmationStop, blocker: SceneBlocker): boolean {
  const atStop = !stop.shotId || blocker.shotId === stop.shotId;
  switch (stop.code) {
    case "NARRATION_CUE_OUT_OF_RANGE": return blocker.code === "narration_too_long" && atStop;
    case "EXECUTION_PAUSED": return blocker.code === "stopped";
    case "SUBMISSION_UNKNOWN": return blocker.code === "no_answer_in_scene" && atStop;
    default: return false;
  }
}

export interface KeyframesView {
  scene: SceneOverview;
  header: { title: string; ordinal: number; status: Msg; shots: number };
  pills: ScenePill[];
  checks: { letter: string; check: AppCheck }[];
  /** Current unanswered paid work or failed narration, named instead of an all-clear check row. */
  attention: Msg | null;
  cards: ShotCard[];
  selected: ShotOverview | null;
  panel: VideoPanel;
}

/** The scene to show: the requested one if it exists, else the first scene that needs attention, else the first. */
export function currentScene(overview: GenerationOverview, sceneId: string | null): SceneOverview | null {
  return overview.scenes.find((scene) => scene.sceneId === sceneId)
    ?? overview.scenes.find((scene) => ["keyframes_back", "keyframes_partial", "needs_attention"].includes(sceneStateOf(overview, scene)))
    ?? overview.scenes[0]
    ?? null;
}

/**
 * A slot waiting for the person's confirm (waiting code "review"): for a clip, the scene's "Confirm frames & generate
 * video" in the video panel. Nothing is being made, and nothing is sent until that confirm.
 */
export const awaitsConfirm = (slot: MediaSlot) => slot.state === "queued" && slot.waiting?.code === "review";

/** A slot an unfinished Director edit holds (waiting code "edit_pending", card B13): it starts once the edit ends or is let go. */
export const heldByEdit = (slot: MediaSlot) => slot.state === "queued" && slot.waiting?.code === "edit_pending";

/**
 * A slot is busy while it is made or queued to be made, or while a replacement take is made behind the current one
 * (card B15). A slot waiting for the person's confirm is not: it waits for them, not for the studio.
 */
export const isWorking = (slot: MediaSlot) =>
  slot.state === "running" || queuedToRun(slot) || slot.replacement?.state === "running" || !!slot.replacement && queuedToRun(slot.replacement);

/** Unknown queues guard inputs; repairing a clip's required keyframe may bypass its passive input wait. */
export function unresolvedQueue(slot: MediaSlot, allowInputWait = false): Pick<MediaSlot, "state" | "waiting" | "failure"> | null {
  return [slot, ...(slot.replacement ? [slot.replacement] : [])]
    .find((pending) => pending.state === "queued" && !queuedToRun(pending) && pending.waiting?.code !== "review"
      && (!allowInputWait || pending.waiting?.code !== "input_pending")) ?? null;
}

export const shotHasNoAnswer = (shot: ShotOverview) => shot.keyframe.state === "no_answer" || shot.video.state === "no_answer"
  || shot.keyframe.replacement?.state === "no_answer" || shot.video.replacement?.state === "no_answer" || shot.narration.state === "no_answer";

/** The current slots are evidence even when an older scene aggregate has not caught up. */
function unansweredShots(overview: GenerationOverview, scene: SceneOverview): ShotOverview[] {
  return scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot)
    .filter((shot) => shotHasNoAnswer(shot) || scene.blockers.some((blocker) => blocker.code === "no_answer_in_scene" && blocker.shotId === shot.shotId));
}

/** No-answer work blocks new paid scene decisions until it answers or the person explicitly releases it. */
export function sceneUnknownOutcome(overview: GenerationOverview, scene: SceneOverview, locale: string): Msg | null {
  const shots = unansweredShots(overview, scene);
  if (shots.length) return msg("scene.unknown_outcome", { shots: listLabels(shots.map((shot) => shot.label), locale) });
  return scene.blockers.some((blocker) => blocker.code === "no_answer_in_scene") ? msg("scene.unknown_outcome_unassigned") : null;
}

const ATTENTION = new Set(["failed", "no_answer", "outdated", "choose_take", "direction_required"]);

/**
 * Keep older scene aggregates aligned with their current slots. A passive queue does not make video, and current
 * unanswered paid work needs attention even when counts or blockers have not caught up after a restart.
 */
export function sceneStateOf(overview: GenerationOverview, scene: SceneOverview): SceneOverview["state"] {
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  if (shots.some(shotHasNoAnswer) || scene.blockers.some((blocker) => blocker.code === "no_answer_in_scene")) return "needs_attention";
  if (scene.confirmation?.state === "running" || shots.some((shot) => isWorking(shot.video))) return scene.state;
  if (scene.state !== "making_video") return scene.state;
  const states = shots.flatMap((shot) => [shot.keyframe.state, shot.video.state, shot.keyframe.replacement?.state, shot.video.replacement?.state]);
  if (states.some((state) => state && ATTENTION.has(state))) return "needs_attention";
  const ready = shots.filter((shot) => shot.keyframe.state === "ready").length;
  return ready === shots.length ? "keyframes_back" : ready ? "keyframes_partial" : "not_started";
}

/**
 * The scene line, in the header and the pills. With the overview it follows what the shots show (sceneStateOf), and
 * a scene whose keyframes are back counts its clips once some are saved (after a Stop, say), never "no video yet".
 */
export function sceneStatus(scene: SceneOverview, overview?: GenerationOverview): Msg {
  const state = overview ? sceneStateOf(overview, scene) : scene.state;
  switch (state) {
    case "video_saved": return msg("scene.state.video_saved");
    case "making_video": return scene.confirmation?.state === "running" || !overview || !heldOnly(overview, scene) ? msg("scene.state.making_video") : msg("scene.state.held");
    case "keyframes_back": return scene.counts.videosReady > 0 ? msg("scene.state.clips_saved", { ready: scene.counts.videosReady, total: scene.counts.shots }) : msg("scene.state.keyframes_back");
    case "keyframes_partial": return msg("scene.state.keyframes_partial", { ready: scene.counts.keyframesReady, total: scene.counts.shots });
    case "needs_attention": return msg("scene.state.needs_attention");
    default: return msg("scene.state.not_started");
  }
}

function pillStatus(overview: GenerationOverview, scene: SceneOverview, selected: boolean): Msg | null {
  const state = sceneStateOf(overview, scene);
  // The current scene's pill drops its suffix unless the scene is finished or busy (DESIGN.md deviation 11).
  if (selected && state !== "video_saved" && state !== "making_video") return null;
  if (state === "keyframes_back" && !scene.counts.videosReady) return msg("scene.pill.keyframes_back");
  return sceneStatus(scene, overview);
}

/**
 * Everything waiting in this scene waits for an unfinished Director edit: nothing is being made, queued for the
 * studio, or running a confirm, and at least one keyframe or clip is held.
 */
export function heldOnly(overview: GenerationOverview, scene: SceneOverview): boolean {
  if (scene.confirmation?.state === "running") return false;
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const slots = shots.flatMap((shot) => [shot.keyframe, shot.video]);
  return slots.some(heldByEdit) && !slots.some((slot) => isWorking(slot) && !heldByEdit(slot));
}

/** The status of a replacement take while the current output stays shown, or null when none is in progress. */
export function replacementStatus(slot: MediaSlot): { status: Msg; tone: CardTone } | null {
  const replacement = slot.state === "ready" ? slot.replacement : undefined;
  if (!replacement) return null;
  switch (replacement.state) {
    case "running": return { status: msg("card.replacement.making"), tone: "working" };
    case "queued": return queuedToRun(replacement) ? { status: msg("card.replacement.making"), tone: "working" } : { status: waitingMsg(replacement), tone: "quiet" };
    case "failed": return { status: msg(replacement.failure?.charged ? "card.replacement.failed_charged" : "card.replacement.failed"), tone: "attention" };
    case "no_answer": return { status: msg("card.replacement.no_answer"), tone: "attention" };
  }
}

/** The voice step a running scene confirm is on for this shot (make, save, fit its line), else null. */
export function voiceStepOf(overview: GenerationOverview, scene: SceneOverview | undefined, shotId: string): "speech" | "attach" | "accept" | null {
  const step = scene ? confirmationStep(overview, scene) : null;
  return step && step.step !== "video" && step.shotId === shotId ? step.step : null;
}

/** A card status; `reason` says it in full where the status is short (a slot held by an edit). */
export interface ShotStatus {
  status: Msg;
  tone: CardTone;
  reason?: Msg;
}

/** A shot's status for its card, the preview and the inspector: the confirm's voice step for it, else its slots' state. */
export function shotStatus(overview: GenerationOverview, scene: SceneOverview | undefined, shot: ShotOverview): ShotStatus {
  const voice = voiceStepOf(overview, scene, shot.shotId);
  return voice ? { status: msg(`card.step.${voice}`), tone: "working" } : cardStatus(shot);
}

/** A queued slot's status: what it waits for (working only when it will run), with the full reason when held. */
function waiting(slot: MediaSlot): ShotStatus {
  const tone = queuedToRun(slot) ? "working" : "quiet";
  return heldByEdit(slot) ? { status: waitingMsg(slot), tone, reason: msg("media.held_reason") } : { status: waitingMsg(slot), tone };
}

export function cardStatus(shot: ShotOverview): ShotStatus {
  const { keyframe, video } = shot;
  if (keyframe.state === "running") return { status: msg("card.keyframe.making"), tone: "working" };
  // A clip waiting for the person's confirm is not being made: the card says what its keyframe needs (opened or not),
  // as before any confirm, and the video panel offers the confirm itself.
  if (video.state === "queued" && !awaitsConfirm(video)) return waiting(video);
  if (video.state === "running") return { status: msg("card.video.making"), tone: "working" };
  if (video.state === "ready" && keyframe.state === "ready") return { status: msg("card.video.saved"), tone: "opened" };
  if (video.state === "failed") return { status: msg(video.failure?.charged ? "card.video.failed_charged" : "card.video.failed"), tone: "attention" };
  if (video.state === "no_answer") return { status: msg("card.no_answer"), tone: "attention" };
  const newTake = replacementStatus(keyframe);
  if (newTake) return newTake;
  switch (keyframe.state) {
    case "ready": return keyframe.opened ? { status: msg("card.opened"), tone: "opened" } : { status: msg("card.not_opened"), tone: "not_opened" };
    case "queued": return waiting(keyframe);
    case "outdated": return { status: msg("card.outdated"), tone: "attention" };
    case "failed": return { status: msg(keyframe.failure?.charged ? "card.keyframe.failed_charged" : "card.keyframe.failed"), tone: "attention" };
    case "no_answer": return { status: msg("card.no_answer"), tone: "attention" };
    case "choose_take": return { status: msg("card.choose_take"), tone: "attention" };
    case "direction_required": return { status: msg("card.direction_required"), tone: "quiet" };
    default: return { status: msg("card.no_keyframe"), tone: "quiet" };
  }
}

/** "2.2 and 2.3", "2.2 和 2.3" in the interface language. */
export function listLabels(labels: readonly string[], locale: string): string {
  return formatList(labels, locale);
}

/** Shots named one by one up to this many; beyond it the panel counts them (it is 230 px wide). */
const NAMED = 3;

/** The first kind of blocker, naming every shot it applies to ("Open 2.2 and 2.3 first"). */
function blockerMsg(blockers: readonly SceneBlocker[], overview: GenerationOverview, locale: string): Msg | null {
  const first = blockers[0];
  if (!first) return null;
  const labels = (code: SceneBlocker["code"]) => blockers.filter((b) => b.code === code && b.shotId).map((b) => overview.shots[b.shotId!]?.label ?? "").filter(Boolean);
  const unopened = labels("frame_not_opened");
  // The usual pair, said in one sentence: frames to open and a line to settle.
  if (first.code === "frame_not_opened" && blockers.some((b) => b.code === "narration_too_long")) {
    const shot = listLabels(labels("narration_too_long"), locale);
    return unopened.length > NAMED
      ? msg("panel.blocker.open_many_and_settle", { count: unopened.length, shot })
      : msg("panel.blocker.open_and_settle", { shots: listLabels(unopened, locale), shot });
  }
  if (first.code === "frame_not_opened" && unopened.length > NAMED) return msg("panel.blocker.frame_not_opened_many", { count: unopened.length });
  return msg(`panel.blocker.${first.code}`, { shot: listLabels(labels(first.code), locale) });
}

type PriceKind = "clips" | "keyframes";

function prices(quote: PriceQuote | undefined, kind: PriceKind, locale: string): Pick<VideoPanel, "price" | "priceTotal" | "priceEach"> {
  if (!quote) return { price: null, priceTotal: null, priceEach: null };
  if (quote.priceUnknown || Number(quote.micros) === 0) return { price: priceMsg(quote, locale), priceTotal: msg("price.unknown"), priceEach: null };
  return {
    price: priceMsg(quote, locale),
    priceTotal: msg("price.about", { total: formatMicros(quote.micros, locale) }),
    // A mixed quote (clips plus voice lines) has no single unit price: the total alone.
    priceEach: quote.units > 1 && Number(quote.unitMicros) > 0 ? msg(`panel.each.${kind}`, { count: quote.units, each: formatMicros(quote.unitMicros, locale) }) : null,
  };
}

const noPrice = { price: null, priceTotal: null, priceEach: null };

export function videoPanel(overview: GenerationOverview, scene: SceneOverview, locale: string): VideoPanel {
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const targets = scene.videoTargets.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const segmentsOf = (list: ShotOverview[]) => list.map((shot) => ({ shotId: shot.shotId, label: shot.label, opened: shot.keyframe.opened }));
  const segments = segmentsOf(targets);
  const openedCount = segments.filter((segment) => segment.opened).length;
  const base = { sceneOrdinal: scene.ordinal, segments, openedCount, targetCount: targets.length, eyebrow: msg("panel.title", { scene: scene.ordinal }), stopped: null };
  const keyframeHeadline = { value: msg("panel.count", { value: scene.counts.keyframesReady, total: shots.length }), unit: msg("panel.unit.keyframes", { count: shots.length }) };

  const state = sceneStateOf(overview, scene);
  // An opened frame is not permission to resend its unanswered clip (or another unanswered paid job in the scene).
  // Inspect current slots as well as blockers: restart projections may still carry older counts, targets or state.
  const unknown = sceneUnknownOutcome(overview, scene, locale);
  if (unknown) return {
    ...base, ...noPrice,
    action: null, enabled: false, label: msg("panel.unknown_wait"), reason: msg("panel.unknown_reason"), note: unknown,
    headline: { value: msg("panel.unknown_headline"), unit: null },
  };
  // Missing/unknown wait reasons, timing decisions and paused queues are not proof that execution will happen.
  const waiting = shots.flatMap((shot) => [shot.keyframe, shot.video].flatMap((slot) => [slot, ...(slot.replacement ? [slot.replacement] : [])])
    .filter((slot) => slot.state === "queued" && !queuedToRun(slot) && slot.waiting?.code !== "review")
    .map((slot) => ({ shot, slot })));
  const waitCode = waiting[0]?.slot.waiting?.code;
  const sameWait = (code: string | undefined) => waitCode === "timing" || waitCode === "stopped" ? code === waitCode : code !== "timing" && code !== "stopped";
  const waitingLabels = listLabels([...new Set(waiting.filter(({ slot }) => sameWait(slot.waiting?.code)).map(({ shot }) => shot.label))], locale);
  if (waiting.length) return {
    ...base, ...noPrice,
    action: null, enabled: false, label: waitingMsg(waiting[0]!.slot),
    reason: msg(waitCode === "stopped" ? "panel.blocker.stopped" : waitCode === "timing" ? "panel.timing_reason" : "panel.waiting_reason"),
    note: waitCode === "stopped" ? null : msg(waitCode === "timing" ? "panel.timing_shots" : "panel.waiting_shots", { shots: waitingLabels }),
    headline: { value: waitingMsg(waiting[0]!.slot), unit: null },
  };
  if (state === "video_saved") {
    const total = shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
    return {
      ...base, ...noPrice, segments: segmentsOf(shots),
      action: "play", enabled: true, label: msg("panel.play_scene", { scene: scene.ordinal }), reason: null,
      note: msg("panel.video_saved_note", { count: shots.length, seconds: seconds(total, overview.fps) }),
      headline: { value: msg("panel.video_saved_headline"), unit: null },
    };
  }
  // A confirm that stopped partway says so, even while the studio still lists its clips as waiting.
  const stopped = confirmationStop(overview, scene);
  // Nothing moves until an unfinished Director edit ends: the panel says it waits for that edit, not that work runs.
  if (!stopped && heldOnly(overview, scene)) {
    const held = shots.filter((shot) => heldByEdit(shot.keyframe) || heldByEdit(shot.video));
    const clips = !held.some((shot) => heldByEdit(shot.keyframe));
    return {
      ...base, ...noPrice, segments: segmentsOf(clips && targets.length ? targets : shots),
      ...(clips ? {} : { eyebrow: msg("panel.title_keyframes", { scene: scene.ordinal }) }),
      action: null, enabled: false, label: msg("panel.held"), reason: msg("panel.held_reason"),
      note: msg("panel.held_note", { shots: listLabels(held.map((shot) => shot.label), locale) }),
      headline: clips ? { value: msg("panel.held_headline"), unit: null } : keyframeHeadline,
    };
  }
  if (!stopped && (scene.confirmation?.state === "running" || state === "making_video")) {
    const making = shots.filter((shot) => isWorking(shot.video));
    const current = (scene.confirmation?.currentShotId ? overview.shots[scene.confirmation.currentShotId] : undefined) ?? shots.find((shot) => shot.video.state === "running") ?? making[0];
    const run = targets.length ? targets : shots;
    const order = current ? run.findIndex((shot) => shot.shotId === current.shotId) + 1 : 0;
    // Before the clips, the confirm makes, saves and fits each missing voice line: it names the step and the shot.
    const step = confirmationStep(overview, scene);
    const voice = step && step.step !== "video" && step.label ? msg(`panel.step.${step.step}`, { shot: step.label }) : null;
    return {
      ...base, ...noPrice, segments: segmentsOf(run),
      action: null, enabled: false, label: msg("panel.making_video"), reason: msg("panel.keep_working"),
      note: voice ?? (current && order > 0 ? msg("panel.making_video_progress", { index: order, total: run.length, shot: current.label }) : msg("panel.making_video_note")),
      headline: { value: msg("panel.making_video_headline"), unit: null },
    };
  }
  const keyframesWorking = shots.some((shot) => isWorking(shot.keyframe));
  if (scene.keyframeTargets.length && !keyframesWorking)
    return makeKeyframes({ ...base, segments: segmentsOf(shots), headline: keyframeHeadline }, scene, locale);
  if (!targets.length) {
    if (keyframesWorking)
      return {
        ...base, ...noPrice, segments: segmentsOf(shots), eyebrow: msg("panel.title_keyframes", { scene: scene.ordinal }),
        action: null, enabled: false, label: msg("panel.making_keyframes"), reason: msg("panel.keep_working"), note: msg("panel.making_keyframes_note"),
        headline: keyframeHeadline,
      };
    if (scene.keyframeTargets.length) return makeKeyframes({ ...base, segments: segmentsOf(shots), headline: keyframeHeadline }, scene, locale);
    return { ...base, ...noPrice, action: null, enabled: false, label: msg("panel.confirm"), reason: msg("panel.nothing_to_make"), note: null, headline: keyframeHeadline };
  }
  const blockers = scene.blockers;
  const enabled = blockers.length === 0;
  // Under the disabled button: what keeps it off, less what the stop's own message already says.
  const unexplained = stopped ? blockers.filter((blocker) => !stopExplains(stopped, blocker)) : blockers;
  // Only frames that can be opened now; a keyframe still to make is named by the reason instead.
  const unopened = targets.filter((t) => t.keyframe.state === "ready" && !t.keyframe.opened).map((t) => t.label);
  // Clips already saved (a confirm stopped partway): the count and segments are of the frames still needing video,
  // and the note says so, so "2 of 2" in a scene of three shots reads true.
  const saved = shots.filter((shot) => shot.video.state === "ready" && !targets.includes(shot)).length;
  return {
    ...base,
    ...(enabled ? prices(scene.quotes.confirmVideo, "clips", locale) : noPrice),
    action: "confirm",
    enabled,
    label: msg("panel.confirm"),
    reason: blockerMsg(unexplained, overview, locale),
    note: unopened.length > NAMED ? msg("panel.open_to_confirm_many", { count: unopened.length })
      : unopened.length ? (saved ? msg("panel.rest_open_to_confirm", { saved, shots: listLabels(unopened, locale) }) : msg("panel.open_to_confirm", { shots: listLabels(unopened, locale) }))
      : saved ? msg("panel.rest_opened", { saved, count: targets.length }) : msg("panel.all_opened"),
    headline: stopped
      ? { value: msg("panel.stopped_headline"), unit: stopped.label ? msg("panel.stopped_at", { shot: stopped.label }) : null }
      : { value: msg("panel.count", { value: openedCount, total: targets.length }), unit: msg("panel.unit.frames_opened", { count: targets.length }) },
    stopped,
  };
}

function makeKeyframes(base: Omit<VideoPanel, "action" | "enabled" | "label" | "price" | "priceTotal" | "priceEach" | "reason" | "note">, scene: SceneOverview, locale: string): VideoPanel {
  const blocked = scene.blockers.find((b) => b.code === "direction_required" || b.code === "stopped" || b.code === "director_working" || b.code === "no_answer_in_scene" || b.code === "narration_making" || b.code === "confirmation_running");
  const enabled = !blocked && scene.keyframeTargets.length > 0;
  return {
    ...base,
    eyebrow: msg("panel.title_keyframes", { scene: scene.ordinal }),
    ...(enabled ? prices(scene.quotes.makeKeyframes, "keyframes", locale) : noPrice),
    action: "make_keyframes",
    enabled,
    label: msg("panel.make_keyframes", { count: scene.keyframeTargets.length }),
    reason: blocked ? msg(`panel.blocker.${blocked.code}`, { shot: "" }) : null,
    note: msg("panel.make_keyframes_note"),
  };
}

export function keyframesView(overview: GenerationOverview, sceneId: string | null, shotId: string | null, locale: string): KeyframesView | null {
  const scene = currentScene(overview, sceneId);
  if (!scene) return null;
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const checks = narrationChecks(shots, overview.fps).map((check) => ({ letter: CHECK_MARK, check }));
  const selected = shots.find((shot) => shot.shotId === shotId) ?? shots[0] ?? null;
  const cards = shots.map((shot): ShotCard => {
    const voiceStep = voiceStepOf(overview, scene, shot.shotId);
    const { status, tone, reason } = shotStatus(overview, scene, shot);
    const current = shot.keyframe.state === "ready" ? shot.keyframe.artifact ?? null : null;
    const previous = current ? null : shot.keyframe.previous ?? null;
    const remaking = shot.keyframe.replacement?.state === "running";
    const workingOn = shot.keyframe.state === "running" || remaking ? "keyframe" : shot.video.state === "running" ? "video" : voiceStep ? "voice" : null;
    return {
      shotId: shot.shotId,
      label: shot.label,
      framing: shot.framing,
      prompt: shot.imagePrompt,
      seconds: seconds(shot.durationFrames, overview.fps),
      picture: current ?? previous,
      pictureDimmed: !current && !!previous,
      status,
      tone,
      statusReason: reason ?? null,
      motion: shot.motion,
      working: isWorking(shot.keyframe) || isWorking(shot.video) || !!voiceStep,
      workingOn,
      selected: shot.shotId === selected?.shotId,
      callouts: checks.filter((entry) => entry.check.shotId === shot.shotId),
    };
  });
  return {
    scene,
    header: { title: scene.title, ordinal: scene.ordinal, status: sceneStatus(scene, overview), shots: shots.length },
    pills: [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ sceneId: s.sceneId, ordinal: s.ordinal, title: s.title, status: pillStatus(overview, s, s.sceneId === scene.sceneId), selected: s.sceneId === scene.sceneId })),
    checks,
    attention: sceneUnknownOutcome(overview, scene, locale)
      ?? (shots.some((shot) => shot.narration.state === "failed")
        ? msg("scene.narration_failed", { shots: listLabels(shots.filter((shot) => shot.narration.state === "failed").map((shot) => shot.label), locale) }) : null),
    cards,
    selected,
    panel: videoPanel(overview, scene, locale),
  };
}

/** Film length in seconds and counts for the top bar. */
export function filmMeta(overview: GenerationOverview): { seconds: number; scenes: number; shots: number; fps: number } {
  const frames = Object.values(overview.shots).reduce((sum, shot) => sum + shot.durationFrames, 0);
  return { seconds: seconds(frames, overview.fps), scenes: overview.scenes.length, shots: Object.keys(overview.shots).length, fps: overview.fps };
}
