import { constants, deflateSync, inflateSync } from "node:zlib";
import { invariant } from "@openslate/core";

export interface PngCenterCrop {
  recipe: "center-crop-v1";
  sourceWidth: number; sourceHeight: number; width: number; height: number;
}
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_BYTES = 32 * 1024 ** 2, MAX_PIXELS = 8_294_400;
function valid(condition: unknown): asserts condition {
  invariant(condition, "PNG_CROP_INVALID", "Expected a bounded, complete PNG for the centre crop");
}

/** Largest exact-ratio rectangle with even sides. An exact source or an unsupported ratio is unchanged. */
export function pngCenterCropDimensions(sourceWidth: number, sourceHeight: number, aspect: string): PngCenterCrop | undefined {
  valid(Number.isSafeInteger(sourceWidth) && Number.isSafeInteger(sourceHeight) && sourceWidth > 0 && sourceHeight > 0
    && sourceWidth <= 8192 && sourceHeight <= 8192 && sourceWidth * sourceHeight <= MAX_PIXELS);
  if (aspect !== "9:16" && aspect !== "16:9") return undefined;
  const [x, y] = aspect === "9:16" ? [9, 16] : [16, 9];
  if (sourceWidth * y === sourceHeight * x) return undefined;
  const scale = 2 * Math.floor(Math.min(sourceWidth / x, sourceHeight / y) / 2);
  valid(scale > 0);
  return { recipe: "center-crop-v1", sourceWidth, sourceHeight, width: x * scale, height: y * scale };
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
};
// Adam7 pass offsets/steps; output is always noninterlaced, with filter 0 on every row.
const PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;
const extent = (size: number, start: number, step: number): number => Math.max(0, Math.ceil((size - start) / step));
function sample(row: Buffer, x: number, depth: number): number {
  const bit = x * depth;
  return (row[bit >>> 3]! >>> (8 - depth - bit % 8)) & ((1 << depth) - 1);
}
function put(row: Buffer, x: number, depth: number, value: number): void {
  const bit = x * depth, index = bit >>> 3;
  row[index] = row[index]! | value << (8 - depth - bit % 8);
}

/**
 * Pure byte-preserving pixel crop. Supports PNG colour types/depths and Adam7, retaining only PLTE/tRNS when needed.
 * Recipe v1 freezes the pass order, top/left floor for odd margins, filter 0, and these exact deflate settings.
 * Never change this recipe's encoding: saved mappings bind its bytes across re-preparation on the pinned Node runtime.
 */
export function centerCropPng(input: Uint8Array, aspect: string): { bytes: Buffer; crop?: PngCenterCrop } {
  valid(input instanceof Uint8Array && input.byteLength >= 45 && input.byteLength <= MAX_BYTES);
  const bytes = Buffer.from(input);
  valid(bytes.subarray(0, 8).equals(PNG) && bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR");
  const sourceWidth = bytes.readUInt32BE(16), sourceHeight = bytes.readUInt32BE(20);
  const crop = pngCenterCropDimensions(sourceWidth, sourceHeight, aspect);
  // Owned ingestion already validated unchanged images. Preserve their entire original container, including metadata.
  if (!crop) return { bytes };
  const header = Buffer.from(bytes.subarray(16, 29)), depth = header[8]!, color = header[9]!, interlace = header[12]!;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color];
  valid(channels && (color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16]).includes(depth)
    && header[10] === 0 && header[11] === 0 && (interlace === 0 || interlace === 1));
  const idat: Buffer[] = []; let palette: Buffer | undefined, transparency: Buffer | undefined;
  let offset = 8, count = 0, ended = false, dataEnded = false;
  while (offset < bytes.length) {
    valid(++count <= 4096 && bytes.length - offset >= 12 && !ended);
    const length = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    valid(length <= bytes.length - offset - 12 && /^[A-Za-z]{4}$/.test(type)
      && bytes.readUInt32BE(offset + length + 8) === crc32(bytes.subarray(offset + 4, offset + length + 8)));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") valid(offset === 8 && length === 13);
    else if (type === "PLTE") {
      valid(!palette && !idat.length && length > 0 && length <= 768 && length % 3 === 0 && color !== 0 && color !== 4);
      palette = data;
    } else if (type === "tRNS") {
      valid(!transparency && !idat.length && (color === 0 ? length === 2 : color === 2 ? length === 6
        : color === 3 && palette && length > 0 && length <= palette.length / 3));
      transparency = data;
    } else if (type === "IDAT") { valid(!dataEnded); idat.push(data); }
    else if (type === "IEND") { valid(length === 0); ended = true; }
    else valid(type[0] === type[0]!.toLowerCase()); // Unknown critical chunks cannot be discarded.
    if (idat.length && type !== "IDAT") dataEnded = true;
    offset += length + 12;
  }
  valid(ended && idat.length > 0 && (color !== 3 || palette && palette.length / 3 <= 2 ** depth));
  const bits = channels * depth, pixelBytes = Math.max(1, Math.ceil(bits / 8));
  const passes = interlace ? PASSES : [[0, 0, 1, 1] as const];
  const expected = passes.reduce((size, [x, y, dx, dy]) => {
    const width = extent(sourceWidth, x, dx), height = extent(sourceHeight, y, dy);
    return size + (width && height ? (1 + Math.ceil(width * bits / 8)) * height : 0);
  }, 0);
  let inflated: Buffer;
  try { inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); }
  catch { valid(false); }
  valid(inflated.length === expected);
  const rowBytes = Math.ceil(crop.width * bits / 8), output = Buffer.alloc((rowBytes + 1) * crop.height);
  const left = Math.floor((sourceWidth - crop.width) / 2), top = Math.floor((sourceHeight - crop.height) / 2);
  let cursor = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const width = extent(sourceWidth, x0, dx), height = extent(sourceHeight, y0, dy);
    if (!width || !height) continue;
    const size = Math.ceil(width * bits / 8); let previous = Buffer.alloc(size);
    for (let y = 0; y < height; y++) {
      const filter = inflated[cursor++]!, row = Buffer.from(inflated.subarray(cursor, cursor + size)); cursor += size;
      valid(filter <= 4);
      for (let i = 0; i < size; i++) {
        const a = i >= pixelBytes ? row[i - pixelBytes]! : 0, b = previous[i]!, c = i >= pixelBytes ? previous[i - pixelBytes]! : 0;
        row[i] = (row[i]! + (filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c))) & 255;
      }
      const destinationY = y0 + y * dy - top;
      if (destinationY >= 0 && destinationY < crop.height) {
        const destination = output.subarray(destinationY * (rowBytes + 1) + 1, (destinationY + 1) * (rowBytes + 1));
        if (dx === 1 && bits >= 8) row.copy(destination, 0, left * pixelBytes, (left + crop.width) * pixelBytes);
        else for (let x = 0; x < width; x++) {
          const destinationX = x0 + x * dx - left;
          if (destinationX < 0 || destinationX >= crop.width) continue;
          if (bits < 8) put(destination, destinationX, depth, sample(row, x, depth));
          else row.copy(destination, destinationX * pixelBytes, x * pixelBytes, (x + 1) * pixelBytes);
        }
      }
      previous = row;
    }
  }
  header.writeUInt32BE(crop.width); header.writeUInt32BE(crop.height, 4); header[12] = 0;
  const compressed = deflateSync(output, { level: 9, strategy: constants.Z_FIXED, windowBits: 15, memLevel: 8 });
  const result = Buffer.concat([PNG, chunk("IHDR", header), ...(color === 3 ? [chunk("PLTE", palette!)] : []),
    ...(transparency ? [chunk("tRNS", transparency)] : []), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
  valid(result.length <= MAX_BYTES);
  return { bytes: result, crop };
}
