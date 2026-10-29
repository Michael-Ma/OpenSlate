import { clipAudioDefaultFor, effectiveShotClipAudio, type ClipAudioDefault, type ShotClipAudio } from "./clip-audio-mix.js";
import { normalizeFilmKind } from "./film-kind.js";

/**
 * The one place the server reads `project.filmKind` for clip audio. It goes through film-kind's own normalizer,
 * so a stored pre-structure string or an unknown value reads as "no kind" (muted) instead of failing.
 */
export function clipAudioFilmKind(value: unknown): { kind?: string; tones?: readonly string[] } | undefined {
  try {
    const film = normalizeFilmKind(value);
    return film ? { kind: film.kind, ...(Array.isArray(film.tones) ? { tones: film.tones } : {}) } : undefined;
  } catch { return undefined; }
}

/** The project's clip-audio default (`clipAudioDefault`): keep for social films and comedies, mute music videos and the rest. */
export function clipAudioDefault(project: { filmKind?: unknown }): ClipAudioDefault {
  return clipAudioDefaultFor(clipAudioFilmKind(project.filmKind));
}

/** A shot's effective clip audio in its project. */
export function projectShotClipAudio(project: { filmKind?: unknown }, shot: { clipAudio?: ShotClipAudio }) {
  return effectiveShotClipAudio(shot, clipAudioDefault(project));
}
