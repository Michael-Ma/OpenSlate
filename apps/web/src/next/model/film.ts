import type { DirectorNote, GenerationOverview, MediaSlot, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "./checks.ts";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * The Film view's timeline (SB-19): every shot in storyboard order on one clock, with the scene bands,
 * the narration lane and the one music track. Pure: positions, what plays at a time, length limits and
 * the free edits (length, order within a scene, music) as storyboard commands.
 */

/** The film's music (project.soundtrack in the snapshot; the next UI's snapshot type does not list it yet). */
export interface Soundtrack {
  audioId: string;
  gainMilliDb: number;
  startFrame?: number;
  muted?: boolean;
}

/** One recording from GET /api/projects/:projectId/audio-library?role=music. */
export interface MusicRecording {
  id: string;
  label: string;
  sha256: string;
  durationSeconds: number;
  role?: string;
}

export interface AudioLibraryView {
  recordings: MusicRecording[];
  /** The server pages by 40; nextOffset is null on the last page. */
  coverage?: { offset: number; total: number; nextOffset: number | null };
}

/** The whole music library from its first page and the pages after it, without repeats. */
export function libraryRecordings(first: AudioLibraryView, rest: readonly MusicRecording[]): MusicRecording[] {
  const more = first.coverage?.nextOffset != null ? rest : [];
  const seen = new Set<string>();
  return [...first.recordings, ...more].filter((recording) => !seen.has(recording.id) && !!seen.add(recording.id));
}

/** What the picture lane and the player show for a shot. */
export type PictureKind = "clip" | "keyframe" | "none";

export interface FilmLine {
  shotId: string;
  label: string;
  text: string;
  /** Film time the line starts (the shot's start). */
  start: number;
  /** Width on the narration lane, in seconds. */
  laneSeconds: number;
  /** The line's own length: measured, or the text estimate. */
  lineSeconds: number | null;
  /**
   * placed: settled and heard (it fits, or a fit was chosen); too_long: a measured line longer than its shot with
   * no fit chosen, so it is not placed; the rest have no voice to place yet.
   */
  state: "placed" | "too_long" | "no_voice" | "making" | "failed" | "no_answer";
  /** A placed line cut at the shot's end. */
  cut: boolean;
}

export interface FilmShot {
  shotId: string;
  sceneId: string;
  label: string;
  sceneOrdinal: number;
  /** 0-based position within its scene, and the scene's shot count. */
  index: number;
  sceneSize: number;
  start: number;
  seconds: number;
  framing: string;
  prompt: string;
  motion: string;
  picture: PictureKind;
  /** The keyframe to show: current, or the earlier one while a new one is made or after an edit. */
  keyframe: StudioArtifactRef | null;
  clip: StudioArtifactRef | null;
  /** What is missing, on the block ("no clip", "nothing yet", "failed", "no answer"). */
  lack: Msg | null;
  /** The letter of an open Director note on this shot (amber: the Director's content). */
  letter: string | null;
  line: FilmLine | null;
}

export interface FilmScene {
  sceneId: string;
  ordinal: number;
  title: string;
  start: number;
  seconds: number;
}

export interface FilmTimeline {
  fps: number;
  total: number;
  scenes: FilmScene[];
  shots: FilmShot[];
  clipsReady: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
export const shotSeconds = (shot: Pick<ShotOverview, "durationFrames">, fps: number) => round1(shot.durationFrames / fps);

function pictureOf(shot: ShotOverview): { picture: PictureKind; keyframe: StudioArtifactRef | null; clip: StudioArtifactRef | null } {
  const keyframe = shot.keyframe.artifact ?? shot.keyframe.previous ?? null;
  const clip = shot.video.state === "ready" && shot.video.artifact ? shot.video.artifact : null;
  return { picture: clip ? "clip" : keyframe ? "keyframe" : "none", keyframe, clip };
}

/** Running, or queued to be sent. A slot waiting for a person's confirm, or stopped, is not being made. */
export function making(slot: MediaSlot): boolean {
  return slot.state === "running" || (slot.state === "queued" && slot.waiting?.code !== "review" && slot.waiting?.code !== "stopped");
}

/** The neutral words on a picture block for what the shot still lacks. Failures are words, never a colour. */
export function lackOf(shot: ShotOverview): Msg | null {
  const video = shot.video.state;
  const keyframe = shot.keyframe.state;
  if (video === "ready" && shot.video.artifact) return null;
  if (video === "no_answer" || keyframe === "no_answer") return msg("film.lack.no_answer");
  if (video === "failed" || keyframe === "failed") return msg("film.lack.failed");
  if (making(shot.video)) return msg("film.lack.making_clip");
  if (making(shot.keyframe)) return msg("film.lack.making_keyframe");
  if (video === "outdated") return msg("film.lack.clip_outdated");
  if (keyframe === "ready" || keyframe === "outdated" || keyframe === "choose_take") return msg("film.lack.no_clip");
  return msg("film.lack.nothing");
}

function lineOf(shot: ShotOverview, start: number, seconds: number): FilmLine | null {
  const n = shot.narration;
  if (n.state === "none" || !n.text.trim()) return null;
  const base = { shotId: shot.shotId, label: shot.label, text: n.text, start };
  if (n.state === "ready" && n.measuredSeconds !== undefined) {
    const measured = round1(n.measuredSeconds);
    const settled = n.fits !== false || !!n.fit;
    if (!settled) return { ...base, laneSeconds: measured, lineSeconds: measured, state: "too_long", cut: false };
    const cut = measured > seconds + 1e-9;
    return { ...base, laneSeconds: Math.min(measured, seconds), lineSeconds: measured, state: "placed", cut };
  }
  const estimate = n.estimatedSeconds !== undefined ? round1(n.estimatedSeconds) : null;
  const state: FilmLine["state"] = n.state === "making" ? "making" : n.state === "failed" ? "failed" : n.state === "no_answer" ? "no_answer" : "no_voice";
  // An unplaced line is drawn at least 3 s wide so its label can be read.
  return { ...base, laneSeconds: Math.max(estimate ?? 0, 3), lineSeconds: estimate, state, cut: false };
}

/** Open Director notes anchored to one shot, by letter (the Director's amber on the picture block). */
function noteLetters(notes: readonly DirectorNote[] | undefined): Map<string, string> {
  const letters = new Map<string, string>();
  for (const note of notes ?? []) {
    if (note.state !== "open") continue;
    for (const shotId of note.anchor.shotIds ?? []) if (!letters.has(shotId)) letters.set(shotId, note.letter);
  }
  return letters;
}

/** Every shot in storyboard order: scenes by ordinal, shots in each scene's order. */
export function filmTimeline(overview: GenerationOverview, notes?: readonly DirectorNote[]): FilmTimeline {
  const fps = overview.fps;
  const letters = noteLetters(notes);
  const scenes: FilmScene[] = [];
  const shots: FilmShot[] = [];
  let at = 0;
  for (const scene of [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal)) {
    const sceneStart = at;
    const members = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
    members.forEach((shot, index) => {
      const seconds = shotSeconds(shot, fps);
      shots.push({
        shotId: shot.shotId,
        sceneId: scene.sceneId,
        label: shot.label,
        sceneOrdinal: scene.ordinal,
        index,
        sceneSize: members.length,
        start: round1(at),
        seconds,
        framing: shot.framing,
        prompt: shot.imagePrompt,
        motion: shot.motion,
        ...pictureOf(shot),
        lack: lackOf(shot),
        letter: letters.get(shot.shotId) ?? null,
        line: lineOf(shot, round1(at), seconds),
      });
      at += seconds;
    });
    scenes.push({ sceneId: scene.sceneId, ordinal: scene.ordinal, title: scene.title, start: round1(sceneStart), seconds: round1(at - sceneStart) });
  }
  return { fps, total: round1(at), scenes, shots, clipsReady: shots.filter((shot) => shot.picture === "clip").length };
}

// ---- what plays at a time -----------------------------------------------------------------

export interface PlayingAt {
  shot: FilmShot;
  index: number;
  /** Seconds into the shot. */
  local: number;
}

/** The shot on screen at film time t. At or after the end, the last shot at its end. */
export function shotAt(timeline: FilmTimeline, t: number): PlayingAt | null {
  const { shots } = timeline;
  if (!shots.length) return null;
  for (let index = 0; index < shots.length; index++) {
    const shot = shots[index]!;
    if (t < shot.start + shot.seconds - 1e-9) return { shot, index, local: Math.max(0, t - shot.start) };
  }
  const last = shots[shots.length - 1]!;
  return { shot: last, index: shots.length - 1, local: last.seconds };
}

/** The settled line being spoken at t, if any (a line too long for its shot is not placed, so it is never heard). */
export function lineAt(timeline: FilmTimeline, t: number): FilmLine | null {
  const at = shotAt(timeline, t);
  const line = at?.shot.line;
  if (!at || !line || line.state !== "placed" || line.lineSeconds === null) return null;
  return at.local < Math.min(line.lineSeconds, at.shot.seconds) - 1e-9 ? line : null;
}

/** "Previous": back to the start of this shot, or to the previous shot when already near its start. */
export function previousTime(timeline: FilmTimeline, t: number): number {
  const at = shotAt(timeline, t);
  if (!at) return 0;
  if (at.local > 1 || at.index === 0) return at.shot.start;
  return timeline.shots[at.index - 1]!.start;
}

export function nextTime(timeline: FilmTimeline, t: number): number {
  const at = shotAt(timeline, t);
  if (!at) return 0;
  const next = timeline.shots[at.index + 1];
  return next ? next.start : timeline.total;
}

export const clampTime = (timeline: FilmTimeline, t: number) => Math.min(timeline.total, Math.max(0, Number.isFinite(t) ? t : 0));

/** Ruler marks: every 5 s on a short film, sparser on a long one so labels never collide. */
export function rulerTicks(total: number, pixelsPerSecond: number | null): number[] {
  const step = pixelsPerSecond !== null ? 5 : total <= 75 ? 5 : total <= 150 ? 10 : total <= 300 ? 20 : 30;
  const ticks: number[] = [];
  for (let s = 0; s <= total + 1e-9; s += step) ticks.push(s);
  return ticks;
}

// ---- music ---------------------------------------------------------------------------

export interface FilmMusic {
  audioId: string;
  /** The recording's name, or null when it is not in the music library. */
  label: string | null;
  sha256: string | null;
  /** The recording's length, when known. */
  seconds: number | null;
  start: number;
  gainDb: number;
  muted: boolean;
}

export function soundtrackOf(snapshot: ProjectSnapshot | null): Soundtrack | null {
  const project = snapshot?.project as (ProjectSnapshot["project"] & { soundtrack?: Soundtrack | null }) | undefined;
  return project?.soundtrack ?? null;
}

export function filmMusic(soundtrack: Soundtrack | null, library: readonly MusicRecording[], fps: number): FilmMusic | null {
  if (!soundtrack) return null;
  const recording = library.find((r) => r.id === soundtrack.audioId) ?? null;
  return {
    audioId: soundtrack.audioId,
    label: recording?.label ?? null,
    sha256: recording?.sha256 ?? null,
    seconds: recording ? round1(recording.durationSeconds) : null,
    start: round1((soundtrack.startFrame ?? 0) / fps),
    gainDb: Math.round(soundtrack.gainMilliDb / 1000),
    muted: !!soundtrack.muted,
  };
}

/** Where the music lane's block sits: from its start to the end of the recording or of the film. */
export function musicSpan(music: FilmMusic, total: number): { start: number; seconds: number } {
  const start = Math.min(music.start, total);
  const end = music.seconds === null ? total : Math.min(total, music.start + music.seconds);
  return { start, seconds: Math.max(0, end - start) };
}

/** The music is heard at t: not muted and inside its span. */
export function musicOn(music: FilmMusic | null, t: number, total: number): boolean {
  if (!music || music.muted) return false;
  const span = musicSpan(music, total);
  return span.seconds > 0 && t >= span.start - 1e-9 && t < span.start + span.seconds - 1e-9;
}

// ---- free edits ------------------------------------------------------------------------

export interface LengthLimits {
  min: number;
  max: number;
  /** Why the floor is above 3 s: an accepted voice line (cut lines keep the length they were cut to). */
  voiceFloor: number | null;
}

/** Shot length is 3–15 s, never shorter than its accepted voice line (SB-8). */
export function lengthLimits(shot: ShotOverview, fps: number): LengthLimits {
  const seconds = shotSeconds(shot, fps);
  const n = shot.narration;
  let floor = MIN_SHOT_SECONDS;
  if (n.state === "ready" && n.measuredSeconds !== undefined && (n.fits !== false || n.fit)) {
    const heard = n.fit === "cut_to_shot" ? Math.min(n.measuredSeconds, seconds) : n.measuredSeconds;
    floor = Math.max(MIN_SHOT_SECONDS, Math.ceil(heard - 1e-9));
  }
  return { min: floor, max: MAX_SHOT_SECONDS, voiceFloor: floor > MIN_SHOT_SECONDS ? floor : null };
}

export type FilmEdit =
  | { kind: "shot"; id: string; field: "desiredFrames"; value: string }
  | { kind: "moveShot"; id: string; sceneId: string; beforeId?: string }
  | { kind: "soundtrack"; field: "audioId" | "startFrame" | "gainMilliDb" | "muted"; value: string };

/** A new length in whole seconds, within the limits; null when the step would leave them. */
export function lengthEdit(shot: ShotOverview, fps: number, step: number): { edit: FilmEdit; seconds: number } | null {
  const limits = lengthLimits(shot, fps);
  const now = shotSeconds(shot, fps);
  const seconds = Math.round(now + step);
  if (seconds < limits.min || seconds > limits.max || seconds === now) return null;
  return { edit: { kind: "shot", id: shot.shotId, field: "desiredFrames", value: String(seconds * fps) }, seconds };
}

/**
 * Move a shot one place within its scene (scenes reorder in Plan, lead decision 7). The server inserts the
 * shot before `beforeId`, or after the scene's last shot when it is left out.
 */
export function moveEdit(overview: GenerationOverview, shotId: string, direction: -1 | 1): { edit: FilmEdit; label: string } | null {
  const scene = overview.scenes.find((s) => s.shotIds.includes(shotId));
  if (!scene) return null;
  const index = scene.shotIds.indexOf(shotId);
  const target = index + direction;
  if (target < 0 || target >= scene.shotIds.length) return null;
  const beforeId = direction < 0 ? scene.shotIds[target] : scene.shotIds[index + 2];
  const edit: FilmEdit = { kind: "moveShot", id: shotId, sceneId: scene.sceneId, ...(beforeId ? { beforeId } : {}) };
  return { edit, label: `${scene.ordinal}.${target + 1}` };
}

export const musicStartEdit = (music: FilmMusic, fps: number, step: number, total: number): FilmEdit | null => {
  const start = Math.round(music.start + step);
  if (start < 0 || start > Math.max(0, Math.floor(total) - 1) || start === Math.round(music.start)) return null;
  return { kind: "soundtrack", field: "startFrame", value: String(start * fps) };
};

export const musicGainEdit = (db: number): FilmEdit => ({ kind: "soundtrack", field: "gainMilliDb", value: String(Math.round(Math.min(0, Math.max(-60, db))) * 1000) });
export const musicMuteEdit = (muted: boolean): FilmEdit => ({ kind: "soundtrack", field: "muted", value: muted ? "true" : "false" });
export const musicChoiceEdit = (audioId: string | null): FilmEdit => ({ kind: "soundtrack", field: "audioId", value: audioId ?? "" });

/** The press id and the toast for each edit, so a press is never sent twice and Undo names the change. */
export function editPressId(edit: FilmEdit): string {
  return edit.kind === "soundtrack" ? `edit:soundtrack:${edit.field}` : `edit:${edit.kind}:${edit.id}`;
}

/** "0:04" style start times and dB levels are formatted by the caller's clock; toasts take plain values. */
export function lengthToast(label: string, seconds: number, filmSeconds: number, outdatesClip: boolean): Msg {
  return msg(outdatesClip ? "film.toast.length_clip" : "film.toast.length", { shot: label, seconds, film: filmSeconds });
}
