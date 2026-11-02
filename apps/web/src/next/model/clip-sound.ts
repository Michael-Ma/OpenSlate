import { clipAudioDefaultFor, effectiveShotClipAudio, type ClipAudioDefault } from "@openslate/core/public";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * "Keep clip sound" for a shot (docs/ai/clip-audio/2026-10-28-clip-audio.md): a clip's own sound effects and ambience
 * in the film, at a level, ducked under narration. The rule (social or comedy keeps it, a music video mutes it) is
 * core's, shared with the server; this reads it from the project snapshot. Pure.
 */

export interface ClipSound {
  keep: boolean;
  /** Whole dB, -60..0. */
  gainDb: number;
  /** "default": the shot follows the film's default (which `reason` explains); "shot": set on this shot. */
  source: "shot" | "default";
  reason: ClipAudioDefault["reason"];
}

export const CLIP_SOUND_MIN_DB = -60;
export const CLIP_SOUND_MAX_DB = 0;

/** The film's default from its film kind, read defensively: anything that is not a record is "no kind" (muted). */
export function filmClipSoundDefault(snapshot: ProjectSnapshot | null): ClipAudioDefault {
  const filmKind = snapshot?.project.filmKind;
  return clipAudioDefaultFor(filmKind && typeof filmKind === "object" ? filmKind as { kind?: unknown; tones?: unknown } : undefined);
}

export function clipSoundOf(snapshot: ProjectSnapshot | null, shotId: string): ClipSound | null {
  const project = snapshot?.project;
  const shot = project?.shots.find((row) => row.id === shotId);
  if (!shot) return null;
  const fallback = filmClipSoundDefault(snapshot);
  const effective = effectiveShotClipAudio(shot, fallback);
  return { keep: effective.keep, gainDb: Math.round(effective.gainMilliDb / 1000), source: effective.source, reason: fallback.reason };
}

/** Shots whose clip sound is kept, for the timeline's small mark. */
export function keptClipSound(snapshot: ProjectSnapshot | null): ReadonlySet<string> {
  const project = snapshot?.project;
  const fallback = filmClipSoundDefault(snapshot);
  return new Set((project?.shots ?? []).filter((shot) => effectiveShotClipAudio(shot, fallback).keep).map((shot) => shot.id));
}

export type ClipSoundEdit = { kind: "shotClipAudio"; id: string; field: "keep" | "gainMilliDb"; value: string };

export const clipSoundKeepEdit = (shotId: string, keep: boolean): ClipSoundEdit => ({ kind: "shotClipAudio", id: shotId, field: "keep", value: keep ? "true" : "false" });
export const clipSoundGainEdit = (shotId: string, db: number): ClipSoundEdit =>
  ({ kind: "shotClipAudio", id: shotId, field: "gainMilliDb", value: String(Math.round(Math.min(CLIP_SOUND_MAX_DB, Math.max(CLIP_SOUND_MIN_DB, db))) * 1000) });

export function clipSoundToast(label: string, edit: ClipSoundEdit): Msg {
  if (edit.field === "keep") return msg(edit.value === "true" ? "film.toast.clip_sound_on" : "film.toast.clip_sound_off", { shot: label });
  return msg("film.toast.clip_sound_level", { shot: label, db: Number(edit.value) / 1000 });
}
