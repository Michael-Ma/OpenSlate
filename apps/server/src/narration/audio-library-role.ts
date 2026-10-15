import type { ProjectRecord } from "@openslate/core";
import type { NarrationAudio } from "./types.js";
export type AudioRole = "music" | "voice" | "upload";
export interface AudioLabel { id: string; projectId: string; label: string; role?: AudioRole }
export function audioLibraryRole(project: ProjectRecord, audio: Pick<NarrationAudio, "id" | "role"> & { originEvidence?: string }, label?: AudioLabel): AudioRole {
  if (project.soundtrack?.audioId === audio.id) return "music";
  return label?.role ?? audio.role ?? ("originEvidence" in audio ? "voice" : "upload");
}
