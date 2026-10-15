import type { GenerationOverview, MediaSlot, PriceQuote, SceneBlocker, SceneOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";
import { narrationChecks, type AppCheck } from "./checks.ts";
import { formatMicros, priceMsg } from "./price.ts";

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
  motion: string;
  /** Indeterminate progress while a keyframe or clip is being made. */
  working: boolean;
  /** What is being made right now (queued work shows only its status): the keyframe (striped overlay) or the clip (bar). */
  workingOn: "keyframe" | "video" | null;
  selected: boolean;
  /** App-computed checks attached to this card (letters come from the banner order). */
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
  /** Why the button is disabled; shown under it. */
  reason: Msg | null;
  note: Msg | null;
  eyebrow: Msg;
  /** The large figure ("1 of 3", "Video saved") and its unit ("frames opened"). */
  headline: { value: Msg; unit: Msg | null };
}

export interface KeyframesView {
  scene: SceneOverview;
  header: { title: string; ordinal: number; status: Msg; shots: number };
  pills: ScenePill[];
  checks: { letter: string; check: AppCheck }[];
  cards: ShotCard[];
  selected: ShotOverview | null;
  panel: VideoPanel;
}

/** The scene to show: the requested one if it exists, else the first scene that needs attention, else the first. */
export function currentScene(overview: GenerationOverview, sceneId: string | null): SceneOverview | null {
  return overview.scenes.find((scene) => scene.sceneId === sceneId)
    ?? overview.scenes.find((scene) => scene.state === "keyframes_back" || scene.state === "keyframes_partial" || scene.state === "needs_attention")
    ?? overview.scenes[0]
    ?? null;
}

export function sceneStatus(scene: SceneOverview): Msg {
  switch (scene.state) {
    case "video_saved": return msg("scene.state.video_saved");
    case "making_video": return msg("scene.state.making_video");
    case "keyframes_back": return msg("scene.state.keyframes_back");
    case "keyframes_partial": return msg("scene.state.keyframes_partial", { ready: scene.counts.keyframesReady, total: scene.counts.shots });
    case "needs_attention": return msg("scene.state.needs_attention");
    default: return msg("scene.state.not_started");
  }
}

function pillStatus(scene: SceneOverview, selected: boolean): Msg | null {
  // The current scene's pill drops its suffix unless the scene is finished or busy (DESIGN.md deviation 11).
  if (selected && scene.state !== "video_saved" && scene.state !== "making_video") return null;
  if (scene.state === "keyframes_back") return msg("scene.pill.keyframes_back");
  return sceneStatus(scene);
}

export const isWorking = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";

export function waitingMsg(slot: MediaSlot): Msg {
  const code = slot.waiting?.code;
  if (code === "capacity") return msg("media.waiting.capacity", { ahead: slot.waiting?.ahead ?? 0 });
  if (code) return msg(`media.waiting.${code}`);
  return msg("media.waiting.queued");
}

export function cardStatus(shot: ShotOverview): { status: Msg; tone: CardTone } {
  const { keyframe, video } = shot;
  if (keyframe.state === "running") return { status: msg("card.keyframe.making"), tone: "working" };
  if (video.state === "running" || video.state === "queued") return { status: video.state === "queued" ? waitingMsg(video) : msg("card.video.making"), tone: "working" };
  if (video.state === "ready" && keyframe.state === "ready") return { status: msg("card.video.saved"), tone: "opened" };
  if (video.state === "failed") return { status: msg(video.failure?.charged ? "card.video.failed_charged" : "card.video.failed"), tone: "attention" };
  if (video.state === "no_answer") return { status: msg("card.no_answer"), tone: "attention" };
  switch (keyframe.state) {
    case "ready": return keyframe.opened ? { status: msg("card.opened"), tone: "opened" } : { status: msg("card.not_opened"), tone: "not_opened" };
    case "queued": return { status: waitingMsg(keyframe), tone: "working" };
    case "outdated": return { status: msg("card.outdated"), tone: "attention" };
    case "failed": return { status: msg(keyframe.failure?.charged ? "card.keyframe.failed_charged" : "card.keyframe.failed"), tone: "attention" };
    case "no_answer": return { status: msg("card.no_answer"), tone: "attention" };
    case "choose_take": return { status: msg("card.choose_take"), tone: "attention" };
    case "direction_required": return { status: msg("card.direction_required"), tone: "quiet" };
    default: return { status: msg("card.no_keyframe"), tone: "quiet" };
  }
}

/** "2.2 and 2.3" in the interface language. */
export function listLabels(labels: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(labels);
  } catch {
    return labels.join(", ");
  }
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
    priceEach: quote.units > 1 ? msg(`panel.each.${kind}`, { count: quote.units, each: formatMicros(quote.unitMicros, locale) }) : null,
  };
}

const noPrice = { price: null, priceTotal: null, priceEach: null };

export function videoPanel(overview: GenerationOverview, scene: SceneOverview, locale: string): VideoPanel {
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const targets = scene.videoTargets.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const segmentsOf = (list: ShotOverview[]) => list.map((shot) => ({ shotId: shot.shotId, label: shot.label, opened: shot.keyframe.opened }));
  const segments = segmentsOf(targets);
  const openedCount = segments.filter((segment) => segment.opened).length;
  const base = { sceneOrdinal: scene.ordinal, segments, openedCount, targetCount: targets.length, eyebrow: msg("panel.title", { scene: scene.ordinal }) };
  const keyframeHeadline = { value: msg("panel.count", { value: scene.counts.keyframesReady, total: shots.length }), unit: msg("panel.unit.keyframes", { count: shots.length }) };

  if (scene.state === "video_saved") {
    const total = shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
    return {
      ...base, ...noPrice, segments: segmentsOf(shots),
      action: "play", enabled: true, label: msg("panel.play_scene", { scene: scene.ordinal }), reason: null,
      note: msg("panel.video_saved_note", { count: shots.length, seconds: seconds(total, overview.fps) }),
      headline: { value: msg("panel.video_saved_headline"), unit: null },
    };
  }
  if (scene.confirmation?.state === "running" || scene.state === "making_video") {
    const making = shots.filter((shot) => isWorking(shot.video));
    const current = (scene.confirmation?.currentShotId ? overview.shots[scene.confirmation.currentShotId] : undefined) ?? shots.find((shot) => shot.video.state === "running") ?? making[0];
    const run = targets.length ? targets : shots;
    const order = current ? run.findIndex((shot) => shot.shotId === current.shotId) + 1 : 0;
    return {
      ...base, ...noPrice, segments: segmentsOf(run),
      action: null, enabled: false, label: msg("panel.making_video"), reason: msg("panel.keep_working"),
      note: current && order > 0 ? msg("panel.making_video_progress", { index: order, total: run.length, shot: current.label }) : msg("panel.making_video_note"),
      headline: { value: msg("panel.making_video_headline"), unit: null },
    };
  }
  const keyframesWorking = shots.some((shot) => isWorking(shot.keyframe));
  if (scene.keyframeTargets.length && !scene.counts.keyframesReady && !keyframesWorking)
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
  // Only frames that can be opened now; a keyframe still to make is named by the reason instead.
  const unopened = targets.filter((t) => t.keyframe.state === "ready" && !t.keyframe.opened).map((t) => t.label);
  return {
    ...base,
    ...(enabled ? prices(scene.quotes.confirmVideo, "clips", locale) : noPrice),
    action: "confirm",
    enabled,
    label: msg("panel.confirm"),
    reason: blockerMsg(blockers, overview, locale),
    note: unopened.length > NAMED ? msg("panel.open_to_confirm_many", { count: unopened.length })
      : unopened.length ? msg("panel.open_to_confirm", { shots: listLabels(unopened, locale) }) : msg("panel.all_opened"),
    headline: { value: msg("panel.count", { value: openedCount, total: targets.length }), unit: msg("panel.unit.frames_opened", { count: targets.length }) },
  };
}

function makeKeyframes(base: Omit<VideoPanel, "action" | "enabled" | "label" | "price" | "priceTotal" | "priceEach" | "reason" | "note">, scene: SceneOverview, locale: string): VideoPanel {
  const blocked = scene.blockers.find((b) => b.code === "direction_required" || b.code === "stopped" || b.code === "director_working");
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
  const checks = narrationChecks(shots, overview.fps).map((check, index) => ({ letter: String.fromCharCode(97 + index), check }));
  const selected = shots.find((shot) => shot.shotId === shotId) ?? shots[0] ?? null;
  const cards = shots.map((shot): ShotCard => {
    const { status, tone } = cardStatus(shot);
    const current = shot.keyframe.state === "ready" ? shot.keyframe.artifact ?? null : null;
    const previous = current ? null : shot.keyframe.previous ?? null;
    const workingOn = shot.keyframe.state === "running" ? "keyframe" : shot.video.state === "running" ? "video" : null;
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
      motion: shot.motion,
      working: isWorking(shot.keyframe) || isWorking(shot.video),
      workingOn,
      selected: shot.shotId === selected?.shotId,
      callouts: checks.filter((entry) => entry.check.shotId === shot.shotId),
    };
  });
  return {
    scene,
    header: { title: scene.title, ordinal: scene.ordinal, status: sceneStatus(scene), shots: shots.length },
    pills: [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).map((s) => ({ sceneId: s.sceneId, ordinal: s.ordinal, title: s.title, status: pillStatus(s, s.sceneId === scene.sceneId), selected: s.sceneId === scene.sceneId })),
    checks,
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
