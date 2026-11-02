import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { invariant } from "@openslate/core";
import type { LipSyncSettings } from "../execution/lip-sync.js";

/** A canonical mono PCM16 48 kHz WAV header for `samples` samples. */
export function monoWavHeader(samples: number): Buffer {
  invariant(Number.isSafeInteger(samples) && samples > 0 && samples * 2 <= 0xffffffff - 36, "AUDIO_PCM_INVALID", "Audio length is out of range");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + samples * 2, 4); header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(96000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36, "ascii");
  header.writeUInt32LE(samples * 2, 40);
  return header;
}

/**
 * The audio a lip-sync clip is made from: `clipSamples` of mono 48 kHz PCM16, silent except for the song window,
 * which is cut from the owned normalized song (48 kHz stereo PCM16 WAV) and downmixed. Reads only that window.
 * The full mix is used: vocal isolation needs a model (for example Demucs) that is not a local dependency.
 */
export async function lipSyncAudio(path: string, settings: LipSyncSettings, signal?: AbortSignal): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.size >= 44, "AUDIO_PCM_INVALID", "Song must be an owned normalized recording");
    const head = Buffer.alloc(12); await file.read(head, 0, 12, 0);
    invariant(head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE", "AUDIO_PCM_INVALID", "Song is not a WAV recording");
    let offset = 12, data: { start: number; size: number } | null = null, format: { channels: number; rate: number; bits: number } | null = null;
    const chunk = Buffer.alloc(16);
    for (let count = 0; offset + 8 <= stat.size && !data && count < 64; count++) {
      await file.read(chunk, 0, 8, offset);
      const id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4);
      if (id === "fmt ") { await file.read(chunk, 0, 16, offset + 8); format = { channels: chunk.readUInt16LE(2), rate: chunk.readUInt32LE(4), bits: chunk.readUInt16LE(14) }; }
      else if (id === "data") data = { start: offset + 8, size: Math.min(size, stat.size - offset - 8) };
      offset += 8 + size + (size % 2);
    }
    invariant(format?.channels === 2 && format.rate === 48000 && format.bits === 16 && data, "AUDIO_PCM_INVALID", "Song must be normalized 48 kHz stereo PCM16");
    invariant((settings.startSample + settings.durationSamples) * 4 <= data.size, "MEDIA_SOURCE_UNAVAILABLE", "The song is shorter than the reviewed lip-sync window");
    const stereo = Buffer.alloc(settings.durationSamples * 4);
    for (let at = 0; at < stereo.length;) {
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Lip-sync audio preparation was cancelled");
      const { bytesRead } = await file.read(stereo, at, Math.min(1 << 20, stereo.length - at), data.start + settings.startSample * 4 + at);
      invariant(bytesRead > 0, "AUDIO_PCM_INVALID", "Truncated song recording");
      at += bytesRead;
    }
    const out = Buffer.alloc(44 + settings.clipSamples * 2);
    monoWavHeader(settings.clipSamples).copy(out, 0);
    for (let i = 0; i < settings.durationSamples; i++) {
      const mixed = (stereo.readInt16LE(i * 4) + stereo.readInt16LE(i * 4 + 2)) / 2;
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mixed))), 44 + (settings.shotOffsetSamples + i) * 2);
    }
    return out;
  } finally { await file.close(); }
}
