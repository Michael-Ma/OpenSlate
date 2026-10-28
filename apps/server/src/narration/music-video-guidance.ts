import type { ProjectRecord } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { fitShotsToSong, SONG_TIMING_VERSION, type SongTiming } from "../media/song-timing.js";
import { storyboardAudioCuts } from "./audio-placement.js";
import { isMusicVideoProject } from "./music-video.js";

/**
 * Planning context for a music video whose song is the soundtrack: the song's length, tempo and sections and the
 * shot lengths that fit it. Host guidance only (no tool or skill contract); null for other films.
 */
export function musicVideoGuidance(store: Store, project: ProjectRecord) {
  if (!isMusicVideoProject(project) || !project.soundtrack) return null;
  const cached = store.get<{ projectId: string; timing: SongTiming }>("song_timing", project.soundtrack.audioId);
  const timing = cached?.projectId === project.id && cached.timing.version === SONG_TIMING_VERSION ? cached.timing : null;
  const shots = storyboardAudioCuts(project).map((cut) => project.shots.find((shot) => shot.id === cut.shotId)!);
  const fit = timing ? fitShotsToSong(shots.map(({ id, sceneId, desiredFrames }) => ({ id, sceneId, desiredFrames })), timing, project.soundtrack.startFrame ?? 0, Math.min(project.maxFrames, 10800)) : null;
  return {
    songAudioId: project.soundtrack.audioId,
    rule: "This film is a music video and its song is the soundtrack. Plan the film to the song's length: scenes follow its sections and shot lengths (desiredFrames, 90–450 frames at 30 fps) follow its beats. Add or remove shots when the fit reports a shortfall or overflow. On shots with media, length changes still use propose_change.",
    song: timing ? { seconds: Math.round(timing.durationFrames / 3) / 10, bpm: timing.bpm, sectionStartSeconds: timing.sectionStartFrames.map((frame) => Math.round(frame / 3) / 10) } : null,
    fit: fit ? { targetFrames: fit.targetFrames, totalFrames: fit.totalFrames, shortfallFrames: fit.shortfallFrames, overflowFrames: fit.overflowFrames, timings: fit.timings } : null,
  };
}
