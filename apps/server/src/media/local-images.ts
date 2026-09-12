import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DomainError, digest, invariant } from "@openslate/core";
import { runMediaProcess } from "./process.js";

export interface ImageBytesInput {
  bytes: Uint8Array;
  sha256: string;
  mimeType: "image/png";
  width: number;
  height: number;
}
export interface StoredImage {
  sha256: string;
  byteLength: number;
  mimeType: "image/png";
  width: number;
  height: number;
  /** Trusted host location; expose a project-owned artifact ID to the browser. */
  path: string;
  validationDigest: string;
}
const MAX_BYTES = 32 * 1024 * 1024, MAX_PIXELS = 8_294_400;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const INPUT = ["-protocol_whitelist", "file", "-format_whitelist", "png_pipe"];
function cancelled(signal?: AbortSignal): void { invariant(!signal?.aborted, "MEDIA_CANCELLED", "Image validation cancelled"); }
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Decode before publication, preserving the exact bytes that can later be reviewed. */
export class LocalImageStore {
  readonly rootDir: string;
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private readonly timeoutMs: number;

  constructor(options: { rootDir: string; ffmpegPath: string; ffprobePath: string; timeoutMs?: number }) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/" && isAbsolute(options.ffmpegPath) && isAbsolute(options.ffprobePath), "IMAGE_CONFIGURATION_INVALID", "Private image storage and absolute media tools are required");
    const timeout = options.timeoutMs ?? 30000;
    invariant(Number.isSafeInteger(timeout) && timeout >= 50 && timeout <= 120000, "IMAGE_CONFIGURATION_INVALID", "Image validation deadline is outside supported bounds");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir);
    for (const name of ["tmp", "blobs"]) mkdirSync(join(this.rootDir, name), { recursive: true, mode: 0o700 });
    this.ffmpeg = realpathSync(options.ffmpegPath); this.ffprobe = realpathSync(options.ffprobePath); this.timeoutMs = timeout;
  }

  async ingest(input: ImageBytesInput, options: { signal?: AbortSignal } = {}): Promise<StoredImage> {
    const signal = options.signal;
    cancelled(signal);
    invariant(input.mimeType === "image/png" && input.bytes instanceof Uint8Array && input.bytes.byteLength > 32 && input.bytes.byteLength <= MAX_BYTES, "IMAGE_INPUT_INVALID", "Expected bounded PNG image bytes");
    invariant(Number.isSafeInteger(input.width) && Number.isSafeInteger(input.height) && input.width > 0 && input.height > 0 && input.width <= 4096 && input.height <= 4096 && input.width * input.height <= MAX_PIXELS, "IMAGE_INPUT_INVALID", "Image dimensions are outside supported bounds");
    // Snapshot every caller-controlled value before the first await.
    const bytes = Buffer.from(input.bytes), sha256 = input.sha256, width = input.width, height = input.height;
    invariant(/^[a-f0-9]{64}$/.test(sha256) && hash(bytes) === sha256, "IMAGE_DIGEST_MISMATCH", "Image bytes differ from the recorded response");
    invariant(bytes.subarray(0, 8).equals(PNG) && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR" && bytes.readUInt32BE(16) === width && bytes.readUInt32BE(20) === height, "IMAGE_INPUT_INVALID", "Image header does not match its declared PNG dimensions");
    const directory = await mkdtemp(join(this.rootDir, "tmp", "validate-"));
    let result: StoredImage;
    try {
      const source = join(directory, "source.png"), handle = await open(source, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const processOptions = { cwd: directory, timeoutMs: this.timeoutMs, maxOutputBytes: 16384, ...(signal ? { signal } : {}) };
      const description = await runMediaProcess(this.ffprobe, ["-v", "error", "-threads", "1", ...INPUT, "-count_frames", "-show_entries", "stream=codec_name,codec_type,width,height,nb_read_frames", "-of", "json", source], processOptions);
      let decoded: { streams?: Array<{ codec_name?: string; codec_type?: string; width?: number; height?: number; nb_read_frames?: string }> };
      try { decoded = JSON.parse(description) as typeof decoded; } catch { throw new DomainError("IMAGE_VALIDATION_FAILED", "Image probe did not return valid metadata"); }
      invariant(decoded.streams?.length === 1 && decoded.streams[0]?.codec_type === "video" && decoded.streams[0].codec_name === "png" && decoded.streams[0].width === width && decoded.streams[0].height === height && decoded.streams[0].nb_read_frames === "1", "IMAGE_VALIDATION_FAILED", "A keyframe must decode to exactly one image at the recorded dimensions");
      await runMediaProcess(this.ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-threads", "1", ...INPUT, "-i", source, "-map", "0:v:0", "-frames:v", "2", "-f", "null", "-"], processOptions);
      cancelled(signal);
      const path = join(this.rootDir, "blobs", `${sha256}.png`);
      await chmod(source, 0o444);
      cancelled(signal);
      try { await link(source, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const published = await this.readVerified(path, sha256, bytes.byteLength);
      invariant(published.equals(bytes), "IMAGE_INTEGRITY_ERROR", "Published image differs from validated bytes");
      const parent = await open(join(this.rootDir, "blobs"), "r"); try { await parent.sync(); } finally { await parent.close(); }
      const toolHashes = await Promise.all([this.ffmpeg, this.ffprobe].map(async tool => hash(await readFile(tool))));
      result = Object.freeze({ sha256, byteLength: bytes.byteLength, mimeType: "image/png", width, height, path,
        validationDigest: digest({ version: 1, sha256, width, height, tools: toolHashes, decodedFrames: 1 }) });
    } finally { await rm(directory, { recursive: true, force: true }); }
    // Cancellation can race publication or staging cleanup. The validated blob
    // remains reusable cache, but no successful descriptor escapes cancellation.
    // Never unlink it here: another concurrent import may already use the blob.
    cancelled(signal);
    return result;
  }

  private async readVerified(path: string, sha256: string, size: number): Promise<Buffer> {
    const info = await lstat(path);
    invariant(info.isFile() && !info.isSymbolicLink() && info.size === size && info.size <= MAX_BYTES, "IMAGE_INTEGRITY_ERROR", "Image storage entry is not the expected regular file");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat(); invariant(actual.isFile() && actual.size === size, "IMAGE_INTEGRITY_ERROR", "Image storage changed during verification");
      const bytes = await handle.readFile(); invariant(bytes.byteLength === size && hash(bytes) === sha256, "IMAGE_INTEGRITY_ERROR", "Stored image hash differs"); return bytes;
    } finally { await handle.close(); }
  }
}
