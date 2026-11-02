import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DomainError, digest, invariant } from "@openslate/core";
import { runMediaProcess } from "./process.js";
import { imageFits, imageFormat, imageInputArgs, IMAGE_MAX_DECODE_PIXELS } from "./image-input.js";

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
const INPUT = imageInputArgs({ name: "PNG", demuxer: "png_pipe" });
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

  /** Human uploads may use common image containers; published references stay PNG. */
  async normalizeUpload(input: { bytes: Uint8Array; sha256: string }, options: { signal?: AbortSignal } = {}): Promise<StoredImage> {
    const signal = options.signal;
    cancelled(signal);
    invariant(input.bytes instanceof Uint8Array && input.bytes.byteLength > 0 && input.bytes.byteLength <= MAX_BYTES, "IMAGE_INPUT_INVALID", "Choose a picture of at most 32 MiB");
    const bytes = Buffer.from(input.bytes), sha256 = input.sha256;
    invariant(/^[a-f0-9]{64}$/.test(sha256) && hash(bytes) === sha256, "IMAGE_DIGEST_MISMATCH", "Image bytes differ from the upload receipt");
    const format = imageFormat(bytes);
    if (format.name === "PNG" && bytes.length > 32 && imageFits(bytes.readUInt32BE(16), bytes.readUInt32BE(20)))
      return this.ingest({ bytes, sha256, mimeType: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, signal ? { signal } : {});
    // A missing JPEG EOI can otherwise be silently repaired by the decoder.
    invariant(format.name !== "JPEG" || bytes.lastIndexOf(Buffer.from([255, 217])) >= 2, "IMAGE_VALIDATION_FAILED", "This JPEG is incomplete. Export it again and retry.");
    const directory = await mkdtemp(join(this.rootDir, "tmp", "normalize-"));
    try {
      const source = join(directory, "source"), destination = join(directory, "normalized.png");
      const handle = await open(source, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      const inputArgs = [...imageInputArgs(format), "-max_pixels", String(IMAGE_MAX_DECODE_PIXELS)];
      const processOptions = { cwd: directory, timeoutMs: this.timeoutMs, maxOutputBytes: 262144, ...(signal ? { signal } : {}) };
      try {
        // Metadata first: cap decoded allocation before requesting even one frame.
        // Select only geometry: full per-tile stream metadata exhausts the output
        // budget on ordinary phone grids containing dozens of tiles.
        const header = JSON.parse(await runMediaProcess(this.ffprobe, ["-v", "error", "-threads", "1", ...inputArgs,
          "-show_entries", "stream=index,codec_type,width,height:stream_disposition=default:stream_group=index,type:stream_group_disposition=default:stream_group_component=width,height,coded_width,coded_height,horizontal_offset,vertical_offset:subcomponent=stream_index,tile_horizontal_offset,tile_vertical_offset",
          "-of", "json=compact=1", source], processOptions)) as {
            streams?: Array<{ index: number; codec_type?: string; width?: number; height?: number; disposition?: { default?: number } }>;
            stream_groups?: Array<{ index: number; type?: string; disposition?: { default?: number }; components?: Array<{ width: number; height: number; coded_width: number; coded_height: number; horizontal_offset: number; vertical_offset: number; subcomponents: Array<{ stream_index: number; tile_horizontal_offset: number; tile_vertical_offset: number }> }> }>;
          };
        const streams = header.streams?.filter(stream => stream.codec_type === "video");
        const frame = streams?.find(stream => stream.disposition?.default === 1) ?? streams?.[0];
        // FFmpeg 8 exposes HEIF tile grids as a complete image stream group.
        const grids = header.stream_groups?.filter(group => group.type === "Tile Grid");
        const grid = grids?.find(group => group.disposition?.default === 1) ?? grids?.[0];
        const geometry = grid?.components?.[0];
        const width = geometry?.width ?? frame?.width, height = geometry?.height ?? frame?.height;
        if ((!width || !height) && (format.animated || ["AVIF", "HEIC", "HEIF"].includes(format.name)))
          throw new DomainError("IMAGE_FORMAT_UNSUPPORTED", `${format.name} pictures are not supported on this computer. Save the first picture as PNG or JPEG and try again.`);
        invariant(frame && (grid || streams?.length === 1 || (["HEIC", "HEIF"].includes(format.name) && frame.disposition?.default === 1)) && Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
          width! > 0 && height! > 0 && width! * height! <= IMAGE_MAX_DECODE_PIXELS,
        "IMAGE_VALIDATION_FAILED", "Pictures must be at most 100 million pixels. Export a smaller copy and retry.");
        // Autorotation runs before this filter, so EXIF 6 swaps the stored axes.
        const filter = `scale=w='max(1,floor(iw*min(1,min(4096/max(iw,ih),sqrt(${MAX_PIXELS}/(iw*ih))))))':h='max(1,floor(ih*min(1,min(4096/max(iw,ih),sqrt(${MAX_PIXELS}/(iw*ih))))))'`;
        let mapping = ["-map", `0:${frame.index}`, "-vf", filter];
        if (grid) {
          invariant(geometry && geometry.subcomponents.length > 0 && geometry.subcomponents.length <= 256 &&
            Number.isSafeInteger(geometry.coded_width) && Number.isSafeInteger(geometry.coded_height) && geometry.coded_width > 0 && geometry.coded_height > 0 &&
            geometry.coded_width * geometry.coded_height <= IMAGE_MAX_DECODE_PIXELS &&
            [geometry.horizontal_offset, geometry.vertical_offset].every(n => Number.isSafeInteger(n) && n >= 0) &&
            geometry.horizontal_offset + width! <= geometry.coded_width && geometry.vertical_offset + height! <= geometry.coded_height,
          "IMAGE_VALIDATION_FAILED", "This HEIF picture has an invalid or oversized tile grid. Export it as PNG and retry.");
          const tiles = geometry.subcomponents;
          for (const tile of tiles) {
            const stream = streams?.find(s => s.index === tile.stream_index);
            invariant(stream && Number.isSafeInteger(stream.width) && Number.isSafeInteger(stream.height) && stream.width! > 0 && stream.height! > 0 &&
              [tile.tile_horizontal_offset, tile.tile_vertical_offset].every(n => Number.isSafeInteger(n) && n >= 0) &&
              tile.tile_horizontal_offset + stream.width! <= geometry.coded_width && tile.tile_vertical_offset + stream.height! <= geometry.coded_height,
            "IMAGE_VALIDATION_FAILED", "This HEIF picture has invalid tiles. Export it as PNG and retry.");
          }
          invariant(tiles.reduce((sum,t) => { const s = streams!.find(s => s.index === t.stream_index)!; return sum + s.width! * s.height!; },0) <= IMAGE_MAX_DECODE_PIXELS,
            "IMAGE_VALIDATION_FAILED", "This HEIF picture has too many tile pixels. Export a smaller copy and retry.");
          const inputs = tiles.map(t => `[0:${t.stream_index}]`).join("");
          const stack = tiles.length === 1 ? `${inputs}null` : `${inputs}xstack=inputs=${tiles.length}:layout=${tiles.map(t => `${t.tile_horizontal_offset}_${t.tile_vertical_offset}`).join("|")}:fill=black`;
          mapping = ["-filter_complex", `${stack},crop=${width}:${height}:${geometry.horizontal_offset}:${geometry.vertical_offset},${filter}[picture]`, "-map", "[picture]"];
        }
        await runMediaProcess(this.ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", ...inputArgs,
          "-i", source, ...mapping, "-frames:v", "1", "-map_metadata", "-1", "-threads", "1", "-c:v", "png", "-f", "image2", destination], processOptions);
      } catch (error) {
        if (error instanceof DomainError && error.code === "MEDIA_TOOL_FAILED") {
          const diagnostic = String((error.details as { diagnostic?: string } | undefined)?.diagnostic ?? "");
          if (format.animated || ["AVIF", "HEIC", "HEIF"].includes(format.name) || /decoder.*not found|decoding.*not supported|unsupported codec/i.test(diagnostic))
            throw new DomainError("IMAGE_FORMAT_UNSUPPORTED", `This computer cannot read ${format.name} pictures${format.animated ? " (animated WebP is not supported)" : ""}. Save the first picture as PNG or JPEG and try again.`);
          throw new DomainError("IMAGE_VALIDATION_FAILED", `This ${format.name} picture could not be read. Export it again as PNG or JPEG and retry.`);
        }
        throw error;
      }
      cancelled(signal);
      const converted = await readFile(destination);
      invariant(converted.byteLength > 32 && converted.byteLength <= MAX_BYTES && converted.subarray(0, 8).equals(PNG), "IMAGE_VALIDATION_FAILED", "Converted image exceeds the supported PNG size");
      return await this.ingest({ bytes: converted, sha256: hash(converted), mimeType: "image/png", width: converted.readUInt32BE(16), height: converted.readUInt32BE(20) }, signal ? { signal } : {});
    } finally { await rm(directory, { recursive: true, force: true }); }
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
