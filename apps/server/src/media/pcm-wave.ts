import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { invariant } from "@openslate/core";
import type { AudioPcmGeometry } from "./types.js";

export const GENERATED_AUDIO_SAMPLE_RATES = Object.freeze([8000, 16000, 22050, 24000, 32000, 44100, 48000, 96000]);
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "MEDIA_CANCELLED", "PCM verification cancelled");

/** Narrow complete PCM16 WAV parser. The caller supplies an already owned path; no media process is launched. */
export async function inspectPcmWave(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ sha256: string; byteLength: number; pcm: AudioPcmGeometry }> {
  stopped(signal);
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 256 * 1024 * 1024, "AUDIO_PCM_INVALID", "Invalid PCM byte bound");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.size >= 44 && stat.size <= maxBytes, "AUDIO_PCM_INVALID", "PCM input must be a bounded complete file");
    const read = async (offset: number, size: number): Promise<Buffer> => {
      invariant(offset >= 0 && size <= 18 && offset + size <= stat.size, "AUDIO_PCM_INVALID", "Truncated PCM chunk");
      const bytes = Buffer.alloc(size); let done = 0;
      while (done < size) { stopped(signal); const result = await file.read(bytes, done, size - done, offset + done);
        invariant(result.bytesRead > 0, "AUDIO_PCM_INVALID", "PCM file was truncated"); done += result.bytesRead; }
      stopped(signal); return bytes;
    };
    const header = await read(0, 12);
    invariant(header.toString("latin1", 0, 4) === "RIFF" && header.toString("latin1", 8, 12) === "WAVE"
      && header.readUInt32LE(4) + 8 === stat.size, "AUDIO_PCM_INVALID", "WAV must declare its exact complete RIFF size");
    let format: { sampleRate: number; channels: 1 | 2; blockAlign: number } | undefined;
    let dataBytes: number | undefined, position = 12, chunks = 0, ancillary = 0;
    while (position < stat.size) {
      invariant(++chunks <= 128, "AUDIO_PCM_INVALID", "Too many WAV chunks");
      const chunk = await read(position, 8), name = chunk.toString("latin1", 0, 4), size = chunk.readUInt32LE(4);
      const start = position + 8, end = start + size;
      invariant(end + (size & 1) <= stat.size, "AUDIO_PCM_INVALID", "WAV chunk exceeds declared file");
      if (name === "fmt ") {
        invariant(!format && dataBytes === undefined && (size === 16 || size === 18), "AUDIO_PCM_INVALID", "WAV requires one PCM format before its data");
        const fmt = await read(start, size), channels = fmt.readUInt16LE(2), rate = fmt.readUInt32LE(4), blockAlign = fmt.readUInt16LE(12);
        invariant(fmt.readUInt16LE(0) === 1 && (channels === 1 || channels === 2) && GENERATED_AUDIO_SAMPLE_RATES.includes(rate)
          && fmt.readUInt16LE(14) === 16 && blockAlign === channels * 2 && fmt.readUInt32LE(8) === rate * blockAlign
          && (size === 16 || fmt.readUInt16LE(16) === 0), "AUDIO_PCM_UNSUPPORTED", "Use supported mono/stereo PCM16 WAV geometry");
        format = { sampleRate: rate, channels, blockAlign };
      } else if (name === "data") {
        invariant(format && dataBytes === undefined && size > 0 && size % format.blockAlign === 0,
          "AUDIO_PCM_INVALID", "WAV requires one nonempty aligned PCM data region"); dataBytes = size;
      } else {
        ancillary += size + 8 + (size & 1);
        invariant(ancillary <= 65536 && ["JUNK", "LIST", "bext", "iXML", "id3 ", "PAD ", "fact", "cue ", "smpl"].includes(name),
          "AUDIO_PCM_UNSUPPORTED", "Unsupported or oversized WAV ancillary chunks");
        if (name === "LIST") invariant(size >= 4 && (await read(start, 4)).toString("latin1") === "INFO", "AUDIO_PCM_UNSUPPORTED", "WAV lists cannot contain additional audio regions");
      }
      position = end + (size & 1);
    }
    invariant(format && dataBytes !== undefined && position === stat.size, "AUDIO_PCM_INVALID", "WAV has no complete PCM region");
    invariant(stat.size - dataBytes <= 65536, "AUDIO_PCM_UNSUPPORTED", "WAV framing exceeds its complete header bound");
    const pcm: AudioPcmGeometry = { sampleRate: format.sampleRate, channels: format.channels, sampleCount: dataBytes / format.blockAlign, bitsPerSample: 16 };
    invariant(pcm.sampleCount <= pcm.sampleRate * 360, "AUDIO_PCM_DURATION_LIMIT", "Generated audio exceeds six minutes");
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let bytes = 0;
    for (;;) { stopped(signal); const result = await file.read(buffer, 0, Math.min(buffer.length, stat.size + 1 - bytes), bytes);
      stopped(signal); if (!result.bytesRead) break; bytes += result.bytesRead;
      invariant(bytes <= stat.size, "AUDIO_PCM_INVALID", "PCM file grew during verification"); hash.update(buffer.subarray(0, result.bytesRead)); }
    const after = await file.stat();
    invariant(bytes === stat.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs,
      "AUDIO_PCM_INVALID", "PCM file changed during verification");
    stopped(signal); return { sha256: hash.digest("hex"), byteLength: bytes, pcm };
  } finally { await file.close(); stopped(signal); }
}
