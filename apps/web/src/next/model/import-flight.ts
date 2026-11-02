import { ApiError } from "../api/client.ts";
import { CommandRefused } from "./commands.ts";
import { refusalMsg, uploadPath, type AudioUse, type ImportKind } from "./assets-import.ts";
import type { Msg, ProjectSnapshot } from "./types.ts";

export const projectUploadPath = (projectId: string, relative: string): string => `/api/projects/${encodeURIComponent(projectId)}${relative}`;

/** A definite stale replay can start afresh only against the film that owned the original import. */
export async function refreshedUploadPath(read: <T>(path: string) => Promise<T>, projectId: string, kind: ImportKind, use: AudioUse, name: string): Promise<string> {
  const snapshot = await read<ProjectSnapshot>(projectUploadPath(projectId, ""));
  if (snapshot.project.id !== projectId) throw new CommandRefused("REVISION_CONFLICT");
  return projectUploadPath(projectId, uploadPath(kind, snapshot.project.headVersion, use, name));
}

/** A failed baseline read ends reconciliation in a visible retry state; it never escapes an event handler. */
export async function refreshUploadRequest(read: <T>(path: string) => Promise<T>, projectId: string, kind: ImportKind, use: AudioUse, name: string): Promise<{ ok: true; path: string } | { ok: false; refusal: Msg; retry: true }> {
  try { return { ok: true, path: await refreshedUploadPath(read, projectId, kind, use, name) }; }
  catch (error) {
    const code = error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR";
    return { ok: false, refusal: refusalMsg(code, kind), retry: true };
  }
}
