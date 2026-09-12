import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import { requireRuntime } from "./validation.js";

/** Trusted host projection reference, never a path supplied directly by model tool arguments. */
export interface DirectorImageInput {
  path: string;
  sha256: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
}
export const DIRECTOR_IMAGE_LIMITS = Object.freeze({ count: 4, totalBytes: 512 * 1024, dimension: 4096, pixels: 16_000_000 });
export function validateDirectorImages(value: unknown): asserts value is readonly DirectorImageInput[] | undefined {
  requireRuntime(value === undefined || (Array.isArray(value) && value.length <= DIRECTOR_IMAGE_LIMITS.count),
    "RUNTIME_IMAGES_INVALID", "Attach at most four bounded image references");
  const paths = new Set<string>();
  for (const image of value ?? []) {
    requireRuntime(image !== null && typeof image === "object" && !Array.isArray(image) &&
      Object.keys(image).every(key => ["path", "sha256", "mediaType"].includes(key)) &&
      typeof image.path === "string" && isAbsolute(image.path) && image.path.length <= 4096 && !image.path.includes("\0") &&
      !paths.has(image.path) && typeof image.sha256 === "string" && /^[a-f0-9]{64}$/.test(image.sha256) &&
      ["image/png", "image/jpeg", "image/webp"].includes(image.mediaType), "RUNTIME_IMAGES_INVALID", "Image references require unique absolute paths, SHA-256 and supported media types");
    paths.add(image.path);
  }
}
/** Header validation bounds native decoding; the native image decoder still validates the full file. */
function dimensions(bytes: Buffer, mediaType: DirectorImageInput["mediaType"]): [number, number] | undefined {
  if (mediaType === "image/png") {
    if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString("ascii", 12, 16) === "IHDR")
      return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    return;
  }
  if (mediaType === "image/jpeg") {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return;
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 255) return;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) return;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 7) return;
        return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
      }
      offset += length;
    }
    return;
  }
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return;
  const format = bytes.toString("ascii", 12, 16);
  if (format === "VP8X") return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
  if (format === "VP8L" && bytes[20] === 47) {
    const bits = bytes.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (format === "VP8 " && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
}
/** Freeze bounded bytes before native dispatch, so the model receives exactly the hashed image. */
export async function prepareDirectorImages(images: readonly DirectorImageInput[] | undefined, projection: string): Promise<{ type: "image"; url: string }[]> {
  validateDirectorImages(images);
  if (!images?.length) return [];
  const root = await realpath(projection); let total = 0;
  const result: { type: "image"; url: string }[] = [];
  for (const image of images) {
    const canonical = await realpath(image.path), delta = relative(root, canonical);
    requireRuntime(canonical === image.path && delta.length > 0 && !isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`),
      "RUNTIME_IMAGE_SCOPE", "Images must be canonical files inside the application projection");
    const file = await open(image.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      requireRuntime(stat.isFile() && stat.size > 0 && stat.size <= DIRECTOR_IMAGE_LIMITS.totalBytes - total,
        "RUNTIME_IMAGE_LIMIT", "Attached image bytes exceed the allowed total");
      const buffer = Buffer.alloc(stat.size + 1); let offset = 0;
      while (offset < buffer.length) {
        const read = await file.read(buffer, offset, buffer.length - offset, offset);
        if (read.bytesRead === 0) break;
        offset += read.bytesRead;
      }
      requireRuntime(offset === stat.size, "RUNTIME_IMAGE_CHANGED", "An attached image changed while it was being read");
      const bytes = buffer.subarray(0, offset);
      const size = dimensions(bytes, image.mediaType);
      requireRuntime(size && createHash("sha256").update(bytes).digest("hex") === image.sha256,
        "RUNTIME_IMAGE_CHANGED", "An attached image differs from its recorded content or media type");
      requireRuntime(size.every(value => value > 0 && value <= DIRECTOR_IMAGE_LIMITS.dimension) && size[0] * size[1] <= DIRECTOR_IMAGE_LIMITS.pixels,
        "RUNTIME_IMAGE_LIMIT", "Attached image dimensions exceed the thumbnail limit");
      total += bytes.length;
      result.push({ type: "image", url: `data:${image.mediaType};base64,${bytes.toString("base64")}` });
    } finally { await file.close(); }
  }
  return result;
}
