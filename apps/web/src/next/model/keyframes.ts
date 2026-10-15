import type { GenerationOverview, MediaSlot, PriceQuote, SceneBlocker, SceneOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";
import { narrationChecks, type AppCheck } from "./checks.ts";
import { priceMsg } from "./price.ts";

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
  selected: boolean;
  /** App-computed checks attached to this card (letters come from the banner order). */
  callouts: { letter: string; check: AppCheck }[];
}

export interface VideoPanel {
  sceneOrdinal: number;
  segments: { shotId: string; label: string; opened: boolean }[];
  openedCount: number;
  targetCount: number;
  /** null when no video is to be made (all saved, or no keyframes yet). */
  action: "confirm" | "make_keyframes" | "play" | null;
  enabled: boolean;
  label: Msg;
  price: Msg | null;
  reason: Msg | null;
  note: Msg | null;
}

export interface KeyframesView {
  scene: SceneOverview;
  header: { title: string; ordinal: number; status: Msg };
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
  return sceneStatus(scene);
}

const working = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";

export function waitingMsg(slot: MediaSlot): Msg {
  const code = slot.waiting?.code;
  if (code === "capacity") return msg("media.waiting.capacity", { ahead: slot.waiting?.ahead ?? 0 });
  if (code) return msg(`media.waiting.${code}`);
  return msg("media.waiting.queued");
}

export function cardStatus(shot: ShotOverview): { status: Msg; tone: CardTone } {
  const { keyframe, video } = shot;
  if (video.state === "running" || video.state === "queued") return { status: video.state === "queued" ? waitingMsg(video) : msg("card.video.making"), tone: "working" };
  if (video.state === "ready" && keyframe.state === "ready") return { status: msg("card.video.saved"), tone: "opened" };
  if (video.state === "failed") return { status: msg(video.failure?.charged ? "card.video.failed_charged" : "card.video.failed"), tone: "attention" };
  if (video.state === "no_answer") return { status: msg("card.no_answer"), tone: "attention" };
  switch (keyframe.state) {
    case "ready": return keyframe.opened ? { status: msg("card.opened"), tone: "opened" } : { status: msg("card.not_opened"), tone: "not_opened" };
    case "running": return { status: msg("card.keyframe.making"), tone: "working" };
    case "queued": return { status: waitingMsg(keyframe), tone: "working" };
    case "outdated": return { status: msg("card.outdated"), tone: "attention" };
    case "failed": return { status: msg(keyframe.failure?.charged ? "card.keyframe.failed_charged" : "card.keyframe.failed"), tone: "attention" };
    case "no_answer": return { status: msg("card.no_answer"), tone: "attention" };
    case "choose_take": return { status: msg("card.choose_take"), tone: "attention" };
    case "direction_required": return { status: msg("card.direction_required"), tone: "quiet" };
    default: return { status: msg("card.no_keyframe"), tone: "quiet" };
  }
}

function blockerMsg(blocker: SceneBlocker, overview: GenerationOverview): Msg {
  const label = blocker.shotId ? overview.shots[blocker.shotId]?.label ?? "" : "";
  return msg(`panel.blocker.${blocker.code}`, { shot: label });
}

export function videoPanel(overview: GenerationOverview, scene: SceneOverview, locale: string): VideoPanel {
  const targets = scene.videoTargets.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const segments = targets.map((shot) => ({ shotId: shot.shotId, label: shot.label, opened: shot.keyframe.opened }));
  const openedCount = segments.filter((segment) => segment.opened).length;
  const base = { sceneOrdinal: scene.ordinal, segments, openedCount, targetCount: targets.length };
  if (scene.state === "video_saved")
    return { ...base, action: "play", enabled: true, label: msg("panel.play_scene", { scene: scene.ordinal }), price: null, reason: null, note: msg("panel.video_saved") };
  if (scene.confirmation?.state === "running" || scene.state === "making_video")
    return { ...base, action: null, enabled: false, label: msg("panel.making_video"), price: null, reason: null, note: msg("panel.making_video_note") };
  if (scene.keyframeTargets.length && !scene.counts.keyframesReady)
    return makeKeyframes(base, scene, locale);
  if (!targets.length) {
    if (scene.keyframeTargets.length) return makeKeyframes(base, scene, locale);
    return { ...base, action: null, enabled: false, label: msg("panel.confirm"), price: null, reason: msg("panel.nothing_to_make"), note: null };
  }
  const blockers = scene.blockers;
  const price = scene.quotes.confirmVideo ? priceMsg(scene.quotes.confirmVideo, locale) : null;
  return {
    ...base,
    action: "confirm",
    enabled: blockers.length === 0,
    label: msg("panel.confirm"),
    price: blockers.length === 0 ? price : null,
    reason: blockers[0] ? blockerMsg(blockers[0], overview) : null,
    note: openedCount < targets.length ? msg("panel.open_to_confirm", { shots: targets.filter((t) => !t.keyframe.opened).map((t) => t.label).join(", ") }) : msg("panel.earlier_kept"),
  };
}

function makeKeyframes(base: Pick<VideoPanel, "sceneOrdinal" | "segments" | "openedCount" | "targetCount">, scene: SceneOverview, locale: string): VideoPanel {
  const quote: PriceQuote | undefined = scene.quotes.makeKeyframes;
  const blocked = scene.blockers.find((b) => b.code === "direction_required" || b.code === "stopped" || b.code === "director_working");
  return {
    ...base,
    action: "make_keyframes",
    enabled: !blocked && scene.keyframeTargets.length > 0,
    label: msg("panel.make_keyframes", { count: scene.keyframeTargets.length }),
    price: quote ? priceMsg(quote, locale) : null,
    reason: blocked ? msg(`panel.blocker.${blocked.code}`, { shot: "" }) : null,
    note: null,
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
      working: working(shot.keyframe) || working(shot.video),
      selected: shot.shotId === selected?.shotId,
      callouts: checks.filter((entry) => entry.check.shotId === shot.shotId),
    };
  });
  return {
    scene,
    header: { title: scene.title, ordinal: scene.ordinal, status: sceneStatus(scene) },
    pills: overview.scenes.map((s) => ({ sceneId: s.sceneId, ordinal: s.ordinal, title: s.title, status: pillStatus(s, s.sceneId === scene.sceneId), selected: s.sceneId === scene.sceneId })),
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
