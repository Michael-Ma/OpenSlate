import type { ProjectRecord, ProviderProfile, ShotRecord } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { NarrationAudio } from "../narration/types.js";
import { isLipSyncProfile, lipSyncRequested, lipSyncSettings } from "./lip-sync.js";
import type { LipSyncSettings } from "./lip-sync.js";

/** The film's current song as measured on import: its normalized identity and length. Null when there is none. */
export function soundtrackSong(store: Pick<Store, "get">, project: Pick<ProjectRecord, "id" | "soundtrack">): { audioId: string; sha256: string; samples: number } | null {
  const soundtrack = project.soundtrack;
  if (!soundtrack || soundtrack.muted) return null;
  const audio = store.get<NarrationAudio>("narration_audio", soundtrack.audioId), measured = audio?.media.probe.audio;
  if (!audio || audio.projectId !== project.id || audio.media.kind !== "audio" || !measured?.samples || measured.sampleRate !== 48000 || measured.channels !== 2) return null;
  return { audioId: audio.id, sha256: audio.media.sha256, samples: measured.samples };
}

export type LipSyncRoute =
  | { state: "planned"; profile: ProviderProfile; settings: (clipFrames: number) => LipSyncSettings | null }
  | { state: "unavailable"; reason: "no_profile" | "no_song" };

/**
 * How a shot is generated. Null: an ordinary shot on the project's video profile. A singing shot uses the project's
 * pinned lip-sync profile with its song window, or says why it cannot (the shot then stays on the normal profile).
 */
export function lipSyncRoute(store: Pick<Store, "get">, project: Pick<ProjectRecord, "id" | "soundtrack" | "scenes" | "shots">,
  lock: { profiles: ProviderProfile[] }, shot: Pick<ShotRecord, "id" | "performance">): LipSyncRoute | null {
  if (!lipSyncRequested(shot)) return null;
  const profile = lock.profiles.find(row => row.kind === "video" && isLipSyncProfile(row));
  if (!profile) return { state: "unavailable", reason: "no_profile" };
  const song = soundtrackSong(store, project);
  if (!song || !lipSyncSettings(project, shot.id, song, profile.minFrames ?? 150)) return { state: "unavailable", reason: "no_song" };
  return { state: "planned", profile, settings: clipFrames => lipSyncSettings(project, shot.id, song, clipFrames) };
}
