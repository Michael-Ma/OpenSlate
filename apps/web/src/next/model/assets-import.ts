import { msg, type Msg } from "./types.ts";

/**
 * Importing a file into the film's assets through the existing upload routes:
 *   image  POST /images/uploads?expectedHeadVersion=N        (PNG only, up to 32 MiB)
 *   video  POST /media/uploads?expectedHeadVersion=N         (up to 128 MiB)
 *   audio  POST /audio-library/uploads?role=music|upload&name= (up to 128 MiB and 6 minutes)
 * Each takes the raw bytes as application/octet-stream with an Idempotency-Key. Imports are free and
 * are not put on a shot. Voice lines are made or uploaded on a shot, in Keyframes.
 */

export type ImportKind = "image" | "video" | "audio";
/** How imported audio is tagged: the film's music, or other audio. */
export type AudioUse = "music" | "upload";

const MIB = 1024 * 1024;
export const IMPORT_LIMITS: Readonly<Record<ImportKind, number>> = { image: 32 * MIB, video: 128 * MIB, audio: 128 * MIB };

export interface ChosenFile {
  name: string;
  type: string;
  size: number;
}

export type FileCheck = { ok: true; kind: ImportKind } | { ok: false; refusal: Msg };

/** What this studio can import, from GET /images and GET /audio-library (video has no capability read). */
export interface ImportCapabilities {
  available: Record<ImportKind, boolean>;
  limits: Record<ImportKind, number>;
}

export const DEFAULT_CAPABILITIES: ImportCapabilities = { available: { image: true, video: true, audio: true }, limits: { ...IMPORT_LIMITS } };

interface CapabilityRead {
  capabilities?: { import?: boolean; maxBytes?: number };
}

export function capabilitiesFrom(images: CapabilityRead | null, audio: CapabilityRead | null): ImportCapabilities {
  const limit = (read: CapabilityRead | null, kind: ImportKind) => {
    const max = read?.capabilities?.maxBytes;
    return typeof max === "number" && max > 0 ? Math.min(max, IMPORT_LIMITS[kind]) : IMPORT_LIMITS[kind];
  };
  return {
    available: { image: images?.capabilities?.import !== false, video: true, audio: audio?.capabilities?.import !== false },
    limits: { image: limit(images, "image"), video: IMPORT_LIMITS.video, audio: limit(audio, "audio") },
  };
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi"]);
const AUDIO_EXT = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "aif", "aiff", "weba"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff", "avif", "svg"]);

/** Which route a file goes to, from its type or (when the browser gives none) its extension. */
export function importKind(file: Pick<ChosenFile, "name" | "type">): ImportKind | "other_image" | null {
  const type = file.type.toLowerCase();
  const extension = ext(file.name);
  if (type === "image/png" || (!type && extension === "png")) return "image";
  if (type.startsWith("image/") || (!type && IMAGE_EXT.has(extension))) return "other_image";
  if (type.startsWith("video/") || (!type && VIDEO_EXT.has(extension))) return "video";
  if (type.startsWith("audio/") || (!type && AUDIO_EXT.has(extension))) return "audio";
  // Some systems label audio and video files with a generic type; trust a known extension then.
  if (type === "application/octet-stream" || type === "") return VIDEO_EXT.has(extension) ? "video" : AUDIO_EXT.has(extension) ? "audio" : null;
  return null;
}

/** "820 KB", "1.2 MB", "32 MB". Binary units, the way the limits are set. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MIB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / MIB;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Refused before anything is sent: wrong kind, empty, too large, or not importable on this computer. */
export function checkFile(file: ChosenFile, capabilities: ImportCapabilities = DEFAULT_CAPABILITIES): FileCheck {
  const kind = importKind(file);
  if (kind === "other_image") return { ok: false, refusal: msg("assets.refusal.png_only") };
  if (!kind) return { ok: false, refusal: msg("assets.refusal.type") };
  if (!capabilities.available[kind]) return { ok: false, refusal: msg("assets.refusal.unavailable") };
  if (file.size <= 0) return { ok: false, refusal: msg("assets.refusal.empty") };
  if (file.size > capabilities.limits[kind]) return { ok: false, refusal: msg("assets.refusal.too_large", { size: formatBytes(file.size), limit: formatBytes(capabilities.limits[kind]) }) };
  return { ok: true, kind };
}

export const fileKindMsg = (kind: ImportKind, size: number): Msg => msg(`assets.import.kind.${kind}` as const, { size: formatBytes(size) });

/** The server takes a name of 1–120 characters without control characters or slashes. */
export function cleanName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 120).trim();
}

/** The project-relative upload path, query included. */
export function uploadPath(kind: ImportKind, headVersion: number, use: AudioUse, name: string): string {
  if (kind === "audio") {
    const query = new URLSearchParams({ role: use });
    const clean = cleanName(name);
    if (clean) query.set("name", clean);
    return `/audio-library/uploads?${query.toString()}`;
  }
  return `/${kind === "image" ? "images" : "media"}/uploads?expectedHeadVersion=${headVersion}`;
}

/** The new file's artifact id from the route's receipt, so the view can select it. */
export function importedArtifactId(kind: ImportKind, receipt: unknown): string | null {
  const value = receipt as { artifact?: { artifactId?: unknown }; recording?: { id?: unknown } } | null;
  const id = kind === "audio" ? value?.recording?.id : value?.artifact?.artifactId;
  return typeof id === "string" && id ? id : null;
}

/**
 * A lost reply is resent with the same key, so the server finds the same import instead of making a
 * second one. A refusal is final for that key; the next try is a new import.
 */
export const resendsSameKey = (code: string): boolean => code === "NETWORK_ERROR";

/** Server and client codes, said in the interface language. Neutral: an icon and words, never red. */
export function refusalMsg(code: string): Msg {
  switch (code) {
    case "UPLOAD_TOO_LARGE":
    case "PAYLOAD_TOO_LARGE":
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return msg("assets.refusal.too_large_server");
    case "IMAGE_INPUT_INVALID":
    case "IMAGE_DIGEST_MISMATCH":
      return msg("assets.refusal.not_png");
    case "SERVICE_UNAVAILABLE":
    case "NARRATION_MEDIA_UNAVAILABLE":
    case "MEDIA_UNAVAILABLE":
      return msg("assets.refusal.unavailable");
    case "NOT_FOUND":
      return msg("assets.refusal.not_supported");
    case "MEDIA_INVALID_INPUT":
    case "MEDIA_PROBE_FAILED":
    case "MEDIA_UNSUPPORTED":
    case "MEDIA_INTEGRITY_ERROR":
    case "IMAGE_INTEGRITY_ERROR":
      return msg("assets.refusal.unreadable");
    case "MEDIA_TOO_LONG":
    case "AUDIO_TOO_LONG":
      return msg("assets.refusal.too_long");
    case "REVISION_CONFLICT":
      return msg("assets.refusal.changed");
    case "UPLOAD_CORRUPT":
      return msg("assets.refusal.corrupt");
    case "NETWORK_ERROR":
      return msg("assets.refusal.network");
    case "AUTH_REQUIRED":
    case "CSRF_DENIED":
    case "SESSION_CLOSED":
      return msg("assets.refusal.session");
    case "INSTALLATION_QUARANTINED":
      return msg("assets.refusal.recovery");
    default:
      return msg("assets.refusal.other", { code });
  }
}

export function importDoneMsg(kind: ImportKind, use: AudioUse, name: string): Msg {
  if (kind === "audio") return msg(use === "music" ? "assets.import.done.music" : "assets.import.done.audio", { name });
  return msg(kind === "image" ? "assets.import.done.image" : "assets.import.done.video", { name });
}

/** A real fraction of the bytes sent; the server's check afterwards has no fraction, so it is indeterminate. */
export function sendingView(loaded: number, total: number): { fraction: number; label: Msg } {
  const whole = Math.max(total, 1);
  const sent = Math.min(Math.max(loaded, 0), whole);
  return { fraction: sent / whole, label: msg("assets.import.sending", { sent: formatBytes(sent), total: formatBytes(whole) }) };
}
