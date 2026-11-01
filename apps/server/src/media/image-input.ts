import { DomainError } from "@openslate/core";

export const IMAGE_UPLOAD_FORMATS = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff", "image/avif", "image/heic", "image/heif"];
export const IMAGE_MAX_DECODE_PIXELS = 100_000_000;
export const IMAGE_MAX_PIXELS = 8_294_400;
export function imageFits(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 4096 && height <= 4096 && width * height <= IMAGE_MAX_PIXELS;
}
export function imageSize(width: number, height: number): [number, number] {
  const ratio = Math.min(1, 4096 / width, 4096 / height, Math.sqrt(IMAGE_MAX_PIXELS / (width * height)));
  return [Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio))];
}
export interface ImageFormat { name: string; demuxer: string; animated?: boolean }
/** Content only: filenames and browser MIME types never select a decoder. */
export function imageFormat(bytes: Uint8Array): ImageFormat {
  const b = Buffer.from(bytes), ascii = (start: number, end: number) => b.toString("ascii", start, end);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { name: "PNG", demuxer: "png_pipe" };
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return { name: "JPEG", demuxer: "jpeg_pipe" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    // The animation flag is in VP8X; do not mistake compressed payload bytes for chunks.
    let animated = false;
    for (let at = 12; at + 8 <= b.length;) {
      const kind = ascii(at, at + 4), size = b.readUInt32LE(at + 4);
      if (kind === "ANIM" || (kind === "VP8X" && size >= 1 && (b[at + 8]! & 2))) animated = true;
      at += 8 + size + (size % 2);
    }
    return { name: animated ? "animated WebP" : "WebP", demuxer: "webp_pipe", animated };
  }
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { name: "GIF", demuxer: "gif" };
  if (ascii(0, 2) === "BM") return { name: "BMP", demuxer: "bmp_pipe" };
  if (["49492a00", "4d4d002a"].includes(b.subarray(0, 4).toString("hex"))) return { name: "TIFF", demuxer: "tiff_pipe" };
  if (b.length >= 16 && ascii(4, 8) === "ftyp") {
    const end = Math.min(b.length, b.readUInt32BE(0), 4096), brands = [ascii(8, 12)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(at, at + 4));
    if (brands.some(brand => ["avif", "avis"].includes(brand))) return { name: "AVIF", demuxer: "mov" };
    if (brands.some(brand => ["heic", "heix", "hevc", "hevx"].includes(brand))) return { name: "HEIC", demuxer: "mov" };
    if (brands.some(brand => ["mif1", "msf1"].includes(brand))) return { name: "HEIF", demuxer: "mov" };
  }
  if (/<(?:[a-z]+:)?svg(?:\s|>)/i.test(b.subarray(0, 4096).toString("utf8")))
    throw new DomainError("IMAGE_FORMAT_UNSUPPORTED", "SVG pictures cannot be imported. Export this picture as PNG or JPEG and try again.");
  throw new DomainError("IMAGE_FORMAT_UNSUPPORTED", "This picture format is not supported. Save it as PNG or JPEG and try again.");
}
export function imageInputArgs(format: ImageFormat): string[] {
  return ["-protocol_whitelist", "file", "-format_whitelist", format.demuxer, "-f", format.demuxer];
}
