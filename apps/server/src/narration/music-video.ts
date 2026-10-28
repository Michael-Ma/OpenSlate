import type { ProjectRecord } from "@openslate/core";

/**
 * Whether a film reads as a music video. The project has no explicit film kind yet (see
 * docs/ai/music-video/audio-and-lipsync.md, spec `filmKind`), so this reads the person's own words in the name,
 * brief and story. English and Chinese phrasings; "MV" only as a whole word.
 */
const MUSIC_VIDEO = /music[\s-]*video|lyric[\s-]*video|音乐视频|音樂視頻|音乐录影带|音樂錄影帶|歌曲(短片|视频|視頻)/i;
/** Upper case only, so a lower-case "mv" (a shell command, a unit) does not count. */
const MV = /\bMVs?\b/;
export function isMusicVideoProject(project: Pick<ProjectRecord, "name" | "brief" | "story">): boolean {
  return [project.name, project.brief, project.story].some((text) => typeof text === "string" && (MUSIC_VIDEO.test(text) || MV.test(text)));
}

/** In a music video the song is the soundtrack, not a bed under narration: it plays at full level. */
export const MUSIC_VIDEO_GAIN_MILLI_DB = 0;

/**
 * The default-soundtrack rule: a recording imported as the film's music becomes the soundtrack when the person has
 * never chosen one. `soundtrack === null` is an explicit "No music" and is respected; an existing choice is never
 * replaced. Returns the gain to set after selection, or null when the existing default (-18 dB bed) applies.
 */
export function defaultSoundtrackDecision(project: Pick<ProjectRecord, "soundtrack" | "name" | "brief" | "story">, role: string):
  { adopt: false; reason: "not_music" | "already_chosen" | "removed" } | { adopt: true; gainMilliDb: number | null } {
  if (role !== "music") return { adopt: false, reason: "not_music" };
  if (project.soundtrack === null) return { adopt: false, reason: "removed" };
  if (project.soundtrack !== undefined) return { adopt: false, reason: "already_chosen" };
  return { adopt: true, gainMilliDb: isMusicVideoProject(project) ? MUSIC_VIDEO_GAIN_MILLI_DB : null };
}
