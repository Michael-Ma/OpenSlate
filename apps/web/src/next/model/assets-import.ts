import { clock } from "./motion.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Importing a file into the film's assets through the existing upload routes:
 *   image     POST /images/uploads?expectedHeadVersion=N           (PNG, JPEG, WebP or HEIC, up to 32 MiB)
 *   video     POST /media/uploads?expectedHeadVersion=N            (up to 128 MiB)
 *   audio     POST /audio-library/uploads?role=music|upload&name=  (up to 128 MiB)
 *   document  POST /documents/uploads?expectedHeadVersion=N&name=  (PDF, TXT or MD, up to 32 MiB)
 * Video and audio are taken up to 6 minutes long.
 * Each takes the raw bytes as application/octet-stream with an Idempotency-Key. Imports are free and
 * are not put on a shot. Voice lines are made or uploaded on a shot, in Keyframes.
 */

export type ImportKind = "image" | "video" | "audio" | "document";
/** How imported audio is tagged: the film's music, or other audio. */
export type AudioUse = "music" | "upload";

const MIB = 1024 * 1024;
/** Everything the studio imports, for a file chooser; the composer takes the same files. */
export const IMPORT_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,video/*,audio/*,application/pdf,text/plain,text/markdown,.png,.jpg,.jpeg,.webp,.heic,.heif,.mp4,.mov,.m4v,.webm,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.pdf,.txt,.md";
export const IMPORT_LIMITS: Readonly<Record<ImportKind, number>> = { image: 32 * MIB, video: 128 * MIB, audio: 128 * MIB, document: 32 * MIB };

export interface ChosenFile {
  name: string;
  type: string;
  size: number;
}

export type FileCheck = { ok: true; kind: ImportKind } | { ok: false; refusal: Msg };

/** What this studio can import, from GET /images and GET /audio-library. */
export interface ImportCapabilities {
  available: Record<ImportKind, boolean>;
  limits: Record<ImportKind, number>;
}

export const DEFAULT_CAPABILITIES: ImportCapabilities = { available: { image: true, video: true, audio: true, document: true }, limits: { ...IMPORT_LIMITS } };

interface CapabilityRead {
  capabilities?: { import?: boolean; maxBytes?: number };
}

/**
 * Video has no capability read of its own. It needs the same local FFmpeg and ffprobe as PNG images (without
 * them the studio does not offer the video upload route at all), so GET /images answers for it too.
 */
export function capabilitiesFrom(images: CapabilityRead | null, audio: CapabilityRead | null): ImportCapabilities {
  const limit = (read: CapabilityRead | null, kind: ImportKind) => {
    const max = read?.capabilities?.maxBytes;
    return typeof max === "number" && max > 0 ? Math.min(max, IMPORT_LIMITS[kind]) : IMPORT_LIMITS[kind];
  };
  const toolchain = images?.capabilities?.import !== false;
  return {
    // Documents are read as text by the studio itself; they need no media tools.
    available: { image: toolchain, video: toolchain, audio: audio?.capabilities?.import !== false, document: true },
    limits: { image: limit(images, "image"), video: IMPORT_LIMITS.video, audio: limit(audio, "audio"), document: IMPORT_LIMITS.document },
  };
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi"]);
const AUDIO_EXT = new Set(["wav", "mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "aif", "aiff", "weba"]);
/** Pictures the studio stores (as PNG); other picture formats are refused with a clear reason. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp", "image/heic", "image/heif"]);
const IMAGE_OK_EXT = new Set(["png", "jpg", "jpeg", "webp", "heic", "heif"]);
const IMAGE_OTHER_EXT = new Set(["gif", "bmp", "tif", "tiff", "avif", "svg"]);
const DOCUMENT_TYPES = new Set(["application/pdf", "text/plain", "text/markdown", "text/x-markdown"]);
const DOCUMENT_EXT = new Set(["pdf", "txt", "md", "markdown"]);

/** Which route a file goes to, from its type or (when the browser gives none) its extension. */
export function importKind(file: Pick<ChosenFile, "name" | "type">): ImportKind | "other_image" | null {
  const type = file.type.toLowerCase();
  const extension = ext(file.name);
  if (IMAGE_TYPES.has(type) || ((!type || type === "application/octet-stream") && IMAGE_OK_EXT.has(extension))) return "image";
  if (type.startsWith("image/") || (!type && IMAGE_OTHER_EXT.has(extension))) return "other_image";
  if (DOCUMENT_TYPES.has(type) || ((!type || type === "application/octet-stream") && DOCUMENT_EXT.has(extension))) return "document";
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
  if (kind === "other_image") return { ok: false, refusal: msg("assets.refusal.image_format") };
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
  if (kind === "document") {
    const query = new URLSearchParams({ expectedHeadVersion: String(headVersion) });
    const clean = cleanName(name);
    if (clean) query.set("name", clean);
    return `/documents/uploads?${query.toString()}`;
  }
  return `/${kind === "image" ? "images" : "media"}/uploads?expectedHeadVersion=${headVersion}`;
}

/**
 * The stored file's identity from the route's receipt, as a message attachment names it: an artifact for pictures,
 * video and documents, the library recording for audio (its normalized bytes' hash).
 */
export function importedRef(kind: ImportKind, receipt: unknown): { artifactId: string; sha256: string } | null {
  const value = receipt as { artifact?: { artifactId?: unknown; sha256?: unknown }; recording?: { id?: unknown; sha256?: unknown } } | null;
  const id = kind === "audio" ? value?.recording?.id : value?.artifact?.artifactId;
  const sha256 = kind === "audio" ? value?.recording?.sha256 : value?.artifact?.sha256;
  return typeof id === "string" && id && typeof sha256 === "string" && /^[a-f0-9]{64}$/.test(sha256) ? { artifactId: id, sha256 } : null;
}

/** The new file's artifact id from the route's receipt, so the view can select it. */
export function importedArtifactId(kind: ImportKind, receipt: unknown): string | null {
  const value = receipt as { artifact?: { artifactId?: unknown }; recording?: { id?: unknown } } | null;
  const id = kind === "audio" ? value?.recording?.id : value?.artifact?.artifactId;
  return typeof id === "string" && id ? id : null;
}

/**
 * What happens to a saved request after a failure.
 *   keep:   the answer is unknown (a lost reply, a timeout, a session that ended); the next try resends the same
 *           request with the same key, so the studio finds the import it may already have made.
 *   fresh:  a resend was refused as out of date, so the first try never arrived; a new request may be made.
 *   settle: the studio answered and refused; the next try is a new import.
 */
export type AfterFailure = "keep" | "fresh" | "settle";

const UNCERTAIN = new Set(["NETWORK_ERROR", "TIMEOUT", "REQUEST_FAILED", "INTERNAL_ERROR", "AUTH_REQUIRED", "CSRF_DENIED", "SESSION_CLOSED"]);

export function afterFailure(code: string, resent: boolean): AfterFailure {
  if (UNCERTAIN.has(code)) return "keep";
  if (code === "REVISION_CONFLICT" && resent) return "fresh";
  return "settle";
}

/**
 * Failures where the same file can work on another try: unknown answers, a film that moved, a file that changed in
 * transit, a slow check, a studio in recovery review (the same file imports once the review is finished).
 */
const RETRYABLE = new Set([...UNCERTAIN, "REVISION_CONFLICT", "UPLOAD_CORRUPT", "IMAGE_DIGEST_MISMATCH", "MEDIA_TIMEOUT", "MEDIA_CANCELLED", "INSTALLATION_QUARANTINED"]);

/**
 * Whether the import sheet offers Try again. Any other refusal is final for this file (not a PNG, too long, too
 * large, unreadable, not available here): Import stays off until another file is chosen.
 */
export const retryable = (code: string): boolean => RETRYABLE.has(code);

/** Which file and which use an import is for: the same file chosen again (even after a reload) resends its saved request. */
export interface FileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export function importIdentity(file: FileIdentity, kind: ImportKind, use: AudioUse): string {
  return [kind, kind === "audio" ? use : "-", file.size, file.lastModified, file.name].join(":");
}

export interface SavedImport {
  key: string;
  /** The exact path sent first, with its film version: a resend must match it to be found again. */
  path: string;
  /** When it was first sent (ms). Old entries are dropped. */
  at: number;
}

export interface ImportRequest {
  key: string;
  path: string;
  /** True when this resends a saved request whose reply was lost. */
  resent: boolean;
}

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A saved request older than this is forgotten; the studio keeps its receipts longer, but a day is plenty to retry. */
export const IMPORT_KEY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const IMPORT_KEY_LIMIT = 20;

/**
 * Import requests whose answer is not known yet, by file identity, kept like the store's press keys (and in
 * storage, so they survive closing the sheet or reloading). `begin` returns the saved request exactly as it was
 * first sent, including its film version, or makes a new one from `path`.
 */
export class ImportKeys {
  readonly #storage: KeyStorage | null;
  readonly #storageKey: string;
  readonly #newKey: () => string;
  readonly #now: () => number;
  #memory: Record<string, SavedImport>;

  constructor(projectId: string, storage: KeyStorage | null, newKey: () => string, now: () => number = Date.now) {
    this.#storage = storage;
    this.#storageKey = `openslate.next.asset-imports.${projectId}`;
    this.#newKey = newKey;
    this.#now = now;
    this.#memory = this.#read();
  }

  #read(): Record<string, SavedImport> {
    try {
      const raw = this.#storage?.getItem(this.#storageKey);
      const value: unknown = raw ? JSON.parse(raw) : {};
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const fresh: Record<string, SavedImport> = {};
      for (const [identity, entry] of Object.entries(value as Record<string, Partial<SavedImport>>))
        if (typeof entry?.key === "string" && typeof entry.path === "string" && typeof entry.at === "number" && this.#now() - entry.at < IMPORT_KEY_MAX_AGE_MS)
          fresh[identity] = { key: entry.key, path: entry.path, at: entry.at };
      return fresh;
    } catch {
      return {};
    }
  }

  #write(): void {
    try {
      if (Object.keys(this.#memory).length) this.#storage?.setItem(this.#storageKey, JSON.stringify(this.#memory));
      else this.#storage?.removeItem(this.#storageKey);
    } catch { /* storage unavailable: memory still protects this tab */ }
  }

  saved(identity: string): SavedImport | undefined {
    const entry = this.#memory[identity];
    return entry && this.#now() - entry.at < IMPORT_KEY_MAX_AGE_MS ? entry : undefined;
  }

  begin(identity: string, path: string): ImportRequest {
    const saved = this.saved(identity);
    if (saved) return { key: saved.key, path: saved.path, resent: true };
    const entry: SavedImport = { key: this.#newKey(), path, at: this.#now() };
    // Newest last; only the most recent few are kept.
    const kept = Object.entries(this.#memory).filter(([id]) => id !== identity).slice(-(IMPORT_KEY_LIMIT - 1));
    this.#memory = { ...Object.fromEntries(kept), [identity]: entry };
    this.#write();
    return { key: entry.key, path: entry.path, resent: false };
  }

  /** The studio answered definitely (imported, or refused); the next try is a new import. */
  settle(identity: string): void {
    if (!(identity in this.#memory)) return;
    const { [identity]: _dropped, ...rest } = this.#memory;
    this.#memory = rest;
    this.#write();
  }
}

/** The studio takes video and audio up to 6 minutes (10 800 frames at 30 fps). */
export const IMPORT_MAX_SECONDS = 360;

/** Refused before sending when the browser can read the length and it is over the limit; unknown lengths are left to the studio. */
export function checkLength(kind: ImportKind, seconds: number | null): FileCheck {
  if (kind === "image" || kind === "document" || seconds === null || !Number.isFinite(seconds) || seconds <= IMPORT_MAX_SECONDS + 0.05) return { ok: true, kind };
  return { ok: false, refusal: msg("assets.refusal.too_long_length", { length: clock(seconds) }) };
}

/** The studio takes PNG images of at most 4096 pixels on a side and 8 294 400 pixels in all (3840 × 2160). */
export const PNG_MAX_SIDE = 4096;
export const PNG_MAX_PIXELS = 8_294_400;
/** How many bytes from the start of a PNG hold its signature and size. */
export const PNG_HEADER_BYTES = 24;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const u32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;

/**
 * Checked before sending, from the first bytes of a chosen PNG: a real PNG signature and header, and a size in
 * pixels the studio takes. A file whose start cannot be read (null) is left to the studio.
 */
export function checkPngHeader(header: Uint8Array | null): FileCheck {
  if (!header) return { ok: true, kind: "image" };
  const signed = header.length >= PNG_HEADER_BYTES && PNG_SIGNATURE.every((byte, index) => header[index] === byte)
    && u32(header, 8) === 13 && String.fromCharCode(header[12]!, header[13]!, header[14]!, header[15]!) === "IHDR";
  if (!signed) return { ok: false, refusal: msg("assets.refusal.not_png") };
  const width = u32(header, 16), height = u32(header, 20);
  if (width <= 0 || height <= 0) return { ok: false, refusal: msg("assets.refusal.not_png") };
  if (width > PNG_MAX_SIDE || height > PNG_MAX_SIDE || width * height > PNG_MAX_PIXELS)
    return { ok: false, refusal: msg("assets.refusal.png_pixels", { width, height }) };
  return { ok: true, kind: "image" };
}

/**
 * Server and client codes, said in the interface language. Neutral: an icon and words, never red. `kind` tells
 * a missing route apart: without local FFmpeg the studio does not offer the video upload route at all.
 */
export function refusalMsg(code: string, kind?: ImportKind): Msg {
  if (code.startsWith("AUDIO_PCM_")) return msg(code === "AUDIO_PCM_DURATION_LIMIT" ? "assets.refusal.too_long" : "assets.refusal.unreadable");
  if (code.startsWith("MEDIA_TOOL_")) return msg(code === "MEDIA_TOOL_UNAVAILABLE" ? "assets.refusal.unavailable" : "assets.refusal.unreadable");
  switch (code) {
    case "UPLOAD_TOO_LARGE":
    case "MEDIA_INPUT_LIMIT":
    case "AUDIO_NORMALIZATION_INPUT_LIMIT":
      return msg("assets.refusal.too_large_server");
    case "IMAGE_INPUT_INVALID":
    case "IMAGE_VALIDATION_FAILED":
    case "IMAGE_EXECUTION_INPUT_INVALID":
      // The studio says the same for a damaged PNG and one too large in pixels.
      return msg("assets.refusal.png_refused");
    case "IMAGE_DIGEST_MISMATCH":
      return msg("assets.refusal.corrupt");
    case "SERVICE_UNAVAILABLE":
    case "NARRATION_MEDIA_UNAVAILABLE":
      return msg("assets.refusal.unavailable");
    case "NOT_FOUND":
      return msg(kind === "video" ? "assets.refusal.unavailable" : "assets.refusal.not_supported");
    case "MEDIA_UNSUPPORTED":
      return msg("assets.refusal.not_supported");
    case "MEDIA_INVALID_INPUT":
    case "MEDIA_STREAM_MISSING":
    case "MEDIA_VALIDATION_FAILED":
    case "MEDIA_INTEGRITY_ERROR":
    case "IMAGE_INTEGRITY_ERROR":
      return msg("assets.refusal.unreadable");
    case "MEDIA_DURATION_LIMIT":
      return msg("assets.refusal.too_long");
    case "MEDIA_TIMEOUT":
      return msg("assets.refusal.slow");
    case "REVISION_CONFLICT":
      return msg("assets.refusal.changed");
    case "UPLOAD_CORRUPT":
      return msg("assets.refusal.corrupt");
    case "NETWORK_ERROR":
    case "TIMEOUT":
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
