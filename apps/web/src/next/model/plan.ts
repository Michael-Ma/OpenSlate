import type { DirectorProposal, GenerationOverview, MediaSlot, SceneOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { narrationChecks } from "./checks.ts";
import { sceneStatus } from "./keyframes.ts";
import { noteViews, type NoteView } from "./notes.ts";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * The Plan view's outline (plan items SB-20, SB-13): brief and story, then each scene with its shots, in
 * storyboard order. Structure, labels and media states come from the generation overview; the brief, the
 * story and the narration choice come from the project snapshot. Pure: no sentences, only message ids.
 */

/** Six minutes at 30 fps: the server's film cap when the snapshot does not say. */
export const MAX_FILM_FRAMES = 10800;

const round1 = (value: number) => Math.round(value * 10) / 10;
export const secondsOf = (frames: number, fps: number) => round1(frames / fps);

/** "6:00" for a length in seconds. */
export function clockText(totalSeconds: number): string {
  const whole = Math.round(totalSeconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Values the server writes into a new shot (storyboard.ts addShot); the outline shows them as not written yet. */
const PLACEHOLDERS: Record<"purpose" | "framing" | "motion" | "imagePrompt", readonly string[]> = {
  purpose: ["New shot"],
  framing: ["Describe the visual direction"],
  motion: ["Describe the camera movement"],
  imagePrompt: ["Pending direction"],
};

/** The written value of a shot field, or "" when it is blank or still the server's placeholder. */
export function written(field: keyof typeof PLACEHOLDERS, value: string | undefined): string {
  const text = (value ?? "").trim();
  return PLACEHOLDERS[field].includes(text) ? "" : text;
}

const DIRECTION_HEADER = "OpenSlate current direction:\n";
const DIRECTION_SEPARATOR = "\nReference details (retain only where consistent):\n";

/**
 * The picture prompt as the person wrote it. A purpose or framing edit makes the server prepend its own
 * "current direction" header (storyboard.ts editedPrompt); the outline shows purpose and framing already.
 */
export function promptText(imagePrompt: string): string {
  if (imagePrompt.startsWith(DIRECTION_HEADER)) {
    const split = imagePrompt.indexOf(DIRECTION_SEPARATOR);
    if (split >= 0) return written("imagePrompt", imagePrompt.slice(split + DIRECTION_SEPARATOR.length));
  }
  return written("imagePrompt", imagePrompt);
}

// ---- status pills (neutral unless done; failures carry an icon and words) --------------------------

export type PillTone = "ok" | "plain" | "busy" | "fail";
export interface StatusPillView {
  text: Msg;
  tone: PillTone;
  /** ✓ for done, ! for a failure, ? for a job with no answer. */
  icon: "✓" | "!" | "?" | null;
}

const pill = (id: Parameters<typeof msg>[0], tone: PillTone = "plain", icon: StatusPillView["icon"] = null): StatusPillView => ({ text: msg(id), tone, icon });
const isWorking = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";

export function keyframePill(shot: ShotOverview): StatusPillView {
  const keyframe = shot.keyframe;
  switch (keyframe.state) {
    case "ready": return keyframe.opened ? pill("plan.pill.opened", "ok", "✓") : pill("plan.pill.not_opened");
    case "running": return pill("plan.pill.kf_making", "busy");
    case "queued": return pill("plan.pill.kf_queued", "busy");
    case "outdated": return pill("plan.pill.kf_outdated");
    case "failed": return pill(keyframe.failure?.charged ? "plan.pill.kf_failed_charged" : "plan.pill.kf_failed", "fail", "!");
    case "no_answer": return pill("plan.pill.no_answer", "fail", "?");
    case "choose_take": return pill("plan.pill.choose_take");
    case "direction_required": return pill("plan.pill.kf_direction");
    default: return pill("plan.pill.kf_none");
  }
}

/** The clip pill, shown once a keyframe exists or a clip was ever started. */
export function clipPill(shot: ShotOverview): StatusPillView | null {
  const video = shot.video;
  if (shot.keyframe.state !== "ready" && video.state === "none") return null;
  switch (video.state) {
    case "ready": return pill("plan.pill.clip", "ok", "✓");
    case "outdated": return pill("plan.pill.clip_outdated");
    case "running": return pill("plan.pill.clip_making", "busy");
    case "queued": return pill("plan.pill.clip_queued", "busy");
    case "failed": return pill(video.failure?.charged ? "plan.pill.clip_failed_charged" : "plan.pill.clip_failed", "fail", "!");
    case "no_answer": return pill("plan.pill.no_answer", "fail", "?");
    default: return pill("plan.pill.clip_none");
  }
}

// ---- narration ---------------------------------------------------------------------------------------

export type NarrationMode = "undecided" | "none" | "generated" | "uploaded";

export interface NarrationView {
  kind: "none" | "undecided" | "line";
  text: string;
  /** "2.1 s voice line", "no voice yet · about 1.2 s (estimate)", … */
  detail: Msg | null;
}

export function narrationView(shot: ShotOverview, mode: NarrationMode | undefined, fps: number): NarrationView {
  const line = shot.narration;
  if (line.state === "none" || !line.text.trim()) return { kind: mode === "undecided" ? "undecided" : "none", text: "", detail: null };
  const shotSeconds = secondsOf(shot.durationFrames, fps);
  let detail: Msg;
  if (line.state === "making") detail = msg("plan.narr.making");
  else if (line.state === "failed") detail = msg("plan.narr.failed");
  else if (line.state === "no_answer") detail = msg("plan.narr.no_answer");
  else if (line.measuredSeconds !== undefined)
    detail = line.fit === "cut_to_shot" ? msg("plan.narr.voice_cut", { seconds: round1(line.measuredSeconds), shot: shotSeconds }) : msg("plan.narr.voice", { seconds: round1(line.measuredSeconds) });
  else if (line.estimatedSeconds !== undefined) detail = msg("plan.narr.estimate", { seconds: round1(line.estimatedSeconds) });
  else detail = msg("plan.narr.no_voice");
  return { kind: "line", text: line.text, detail };
}

// ---- outline ---------------------------------------------------------------------------------------

/** A Director's note repeated on the row or scene it is anchored to (amber; app checks stay neutral). */
export interface NoteChip {
  noteId: string;
  letter: string;
  text: string;
  /** Settled notes turn grey. */
  done: boolean;
}

export interface ShotRowView {
  shotId: string;
  sceneId: string;
  label: string;
  /** Written values ("" when not written yet). */
  purpose: string;
  framing: string;
  motion: string;
  prompt: string;
  seconds: number;
  /** The current keyframe, or the earlier one (dimmed) while it is outdated or being remade. */
  picture: StudioArtifactRef | null;
  pictureDimmed: boolean;
  /** What an empty thumbnail says. */
  emptyThumb: Msg | null;
  narration: NarrationView;
  pills: StatusPillView[];
  /** App-computed fact (neutral): the line is longer than the shot. */
  check: Msg | null;
  notes: NoteChip[];
  /** Position inside its scene. */
  index: number;
  first: boolean;
  last: boolean;
}

export interface SceneView {
  sceneId: string;
  ordinal: number;
  title: string;
  direction: string;
  seconds: number;
  /** The scene's state for its meta line ("3 shots · 17 s · video saved"). */
  state: Msg;
  shots: ShotRowView[];
  notes: NoteChip[];
  first: boolean;
  last: boolean;
}

export interface PlanOutline {
  brief: string;
  story: string;
  scenes: SceneView[];
  counts: { scenes: number; shots: number; seconds: number; maxSeconds: number };
  /** "3 scenes · 8 shots · 48 s of a 6:00 maximum" */
  line: Msg;
}

type SnapshotShot = ProjectSnapshot["project"]["shots"][number];

const chip = (view: NoteView): NoteChip => ({ noteId: view.noteId, letter: view.letter, text: view.text, done: view.state === "resolved" });

function thumbOf(shot: ShotOverview): Pick<ShotRowView, "picture" | "pictureDimmed" | "emptyThumb"> {
  const keyframe = shot.keyframe;
  if (keyframe.state === "ready" && keyframe.artifact) return { picture: keyframe.artifact, pictureDimmed: false, emptyThumb: null };
  if (keyframe.previous) return { picture: keyframe.previous, pictureDimmed: true, emptyThumb: null };
  return { picture: null, pictureDimmed: false, emptyThumb: msg(keyframe.state === "direction_required" ? "plan.thumb.direction" : "plan.thumb.none") };
}

export function shotRow(shot: ShotOverview, snapshotShot: SnapshotShot | undefined, fps: number, notes: readonly NoteView[], index: number, count: number): ShotRowView {
  const [check] = narrationChecks([shot], fps);
  const clip = clipPill(shot);
  return {
    shotId: shot.shotId,
    sceneId: shot.sceneId,
    label: shot.label,
    purpose: written("purpose", shot.purpose),
    framing: written("framing", shot.framing),
    motion: written("motion", shot.motion),
    prompt: promptText(shot.imagePrompt),
    seconds: secondsOf(shot.durationFrames, fps),
    ...thumbOf(shot),
    narration: narrationView(shot, snapshotShot?.narration?.mode, fps),
    pills: clip ? [keyframePill(shot), clip] : [keyframePill(shot)],
    check: check ? msg(check.estimated ? "plan.check.narration_estimated" : "plan.check.narration", { line: check.lineSeconds, shot: check.shotSeconds }) : null,
    notes: notes.filter((view) => view.shotIds.includes(shot.shotId) && view.state !== "stale").map(chip),
    index,
    first: index === 0,
    last: index === count - 1,
  };
}

const sceneState = (scene: SceneOverview, shots: number): Msg => (shots ? sceneStatus(scene) : msg("plan.scene.no_shots_state"));

export function planOutline(snapshot: ProjectSnapshot, overview: GenerationOverview, proposals: readonly DirectorProposal[] = []): PlanOutline {
  const fps = overview.fps;
  const views = noteViews(snapshot.notes ?? [], overview, proposals);
  const byId = new Map(snapshot.project.shots.map((row) => [row.id, row]));
  const ordered = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal);
  const scenes = ordered.map((scene, position): SceneView => {
    const list = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
    const shots = list.map((shot, index) => shotRow(shot, byId.get(shot.shotId), fps, views, index, list.length));
    const seconds = round1(list.reduce((sum, shot) => sum + shot.durationFrames, 0) / fps);
    return {
      sceneId: scene.sceneId,
      ordinal: scene.ordinal,
      title: scene.title,
      direction: scene.purpose.trim(),
      seconds,
      state: sceneState(scene, list.length),
      shots,
      notes: views.filter((view) => view.sceneId === scene.sceneId && !view.shotIds.length && view.state !== "stale").map(chip),
      first: position === 0,
      last: position === ordered.length - 1,
    };
  });
  const frames = Object.values(overview.shots).reduce((sum, shot) => sum + shot.durationFrames, 0);
  const maxFrames = (snapshot.project as { maxFrames?: number }).maxFrames ?? MAX_FILM_FRAMES;
  const counts = { scenes: scenes.length, shots: Object.keys(overview.shots).length, seconds: round1(frames / fps), maxSeconds: round1(maxFrames / fps) };
  return {
    brief: snapshot.project.brief,
    story: snapshot.project.story,
    scenes,
    counts,
    line: msg("plan.line", { scenes: counts.scenes, shots: counts.shots, seconds: counts.seconds, max: clockText(counts.maxSeconds) }),
  };
}

/** Find a row's scene and position, for moves and labels. */
export function locate(outline: PlanOutline, shotId: string): { scene: SceneView; row: ShotRowView } | null {
  for (const scene of outline.scenes) {
    const row = scene.shots.find((shot) => shot.shotId === shotId);
    if (row) return { scene, row };
  }
  return null;
}

// ---- structure commands: delete, move, add -------------------------------------------------------------

export interface MediaCounts {
  keyframes: number;
  clips: number;
  voices: number;
}

/** Media ever made for these shots; it stays in Assets when they are deleted (D16). */
export function mediaCounts(shots: readonly ShotOverview[]): MediaCounts {
  return {
    keyframes: shots.reduce((sum, shot) => sum + shot.keyframe.takeCount, 0),
    clips: shots.reduce((sum, shot) => sum + shot.video.takeCount, 0),
    voices: shots.filter((shot) => shot.narration.state === "ready").length,
  };
}

/** "3 keyframes", "3 clips", "1 voice line": only the kinds that exist, for a list in the interface language. */
export function mediaCountMsgs(counts: MediaCounts): Msg[] {
  const out: Msg[] = [];
  if (counts.keyframes) out.push(msg("plan.count.keyframes", { count: counts.keyframes }));
  if (counts.clips) out.push(msg("plan.count.clips", { count: counts.clips }));
  if (counts.voices) out.push(msg("plan.count.voices", { count: counts.voices }));
  return out;
}

export interface DeleteFacts {
  /** What stays in Assets ([] when nothing was made). */
  media: Msg[];
  /** The film's length afterwards. */
  seconds: number;
  /** Later scenes (or shots) are renumbered. */
  renumbers: boolean;
  shots: number;
}

export function deleteSceneFacts(outline: PlanOutline, overview: GenerationOverview, sceneId: string): DeleteFacts | null {
  const scene = outline.scenes.find((s) => s.sceneId === sceneId);
  if (!scene) return null;
  const shots = scene.shots.map((row) => overview.shots[row.shotId]).filter((shot): shot is ShotOverview => !!shot);
  return { media: mediaCountMsgs(mediaCounts(shots)), seconds: round1(outline.counts.seconds - scene.seconds), renumbers: !scene.last, shots: shots.length };
}

export function deleteShotFacts(outline: PlanOutline, overview: GenerationOverview, shotId: string): DeleteFacts | null {
  const shot = overview.shots[shotId];
  const where = locate(outline, shotId);
  if (!shot || !where) return null;
  return { media: mediaCountMsgs(mediaCounts([shot])), seconds: round1(outline.counts.seconds - where.row.seconds), renumbers: !where.row.last, shots: 1 };
}

/** moveScene: the scene it goes before (none = the end) and its new number. */
export function sceneMove(outline: PlanOutline, sceneId: string, direction: -1 | 1): { beforeId: string | undefined; ordinal: number } | null {
  const index = outline.scenes.findIndex((scene) => scene.sceneId === sceneId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= outline.scenes.length) return null;
  return { beforeId: direction < 0 ? outline.scenes[target]!.sceneId : outline.scenes[index + 2]?.sceneId, ordinal: target + 1 };
}

/** moveShot within its scene: the shot it goes before (none = the end of the scene) and its new label. */
export function shotMove(outline: PlanOutline, shotId: string, direction: -1 | 1): { sceneId: string; beforeId: string | undefined; from: string; to: string } | null {
  const where = locate(outline, shotId);
  if (!where) return null;
  const { scene, row } = where;
  const target = row.index + direction;
  if (target < 0 || target >= scene.shots.length) return null;
  const beforeId = direction < 0 ? scene.shots[target]!.shotId : scene.shots[row.index + 2]?.shotId;
  return { sceneId: scene.sceneId, beforeId, from: row.label, to: `${scene.ordinal}.${target + 1}` };
}

/** The shot an addShot command created: in that scene now, not before. */
export function addedShot(before: GenerationOverview, after: GenerationOverview, sceneId: string): ShotOverview | null {
  const scene = after.scenes.find((s) => s.sceneId === sceneId);
  const id = scene?.shotIds.find((shotId) => !before.shots[shotId]);
  return id ? after.shots[id] ?? null : null;
}

/** The scene an addScene command created. */
export function addedScene(before: GenerationOverview, after: GenerationOverview): SceneOverview | null {
  const known = new Set(before.scenes.map((scene) => scene.sceneId));
  return after.scenes.find((scene) => !known.has(scene.sceneId)) ?? null;
}
