import { constants, mkdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, invariant } from "@openslate/core";
import { digest } from "@openslate/core";
import { inspectPcmWave } from "./pcm-wave.js";
import { assertTranscriptionAudioReceipt } from "../execution/transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt } from "../execution/transcription-audio.js";
import type { MeasuredTranscriptionAudio } from "./transcription-audio-types.js";

const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "MEDIA_CANCELLED", "Transcription preparation cancelled");
const hash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
async function syncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
export interface StoredTranscriptionAudio { receipt: TranscriptionAudioReceipt; /** Trusted host only; never expose in a tool or browser response. */ path: string }
/** Detached upload bytes for a trusted transport. This is not provider dispatch authority. */
export interface TranscriptionAudioUpload { receipt: TranscriptionAudioReceipt; bytes: Uint8Array }

/** Owns immutable derivative bytes, not project/lease/SQL authority. Temps are never backup inputs. */
export class TranscriptionAudioStore {
  readonly rootDir: string;
  constructor(options: { rootDir: string }) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/", "TRANSCRIPTION_AUDIO_CONFIGURATION", "Configure a private absolute derivative directory");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir);
    for (const name of ["blobs", "completions", "tmp"]) {
      const path = join(this.rootDir, name); mkdirSync(path, { recursive: true, mode: 0o700 });
      invariant(realpathSync(path) === path, "TRANSCRIPTION_AUDIO_CORRUPT", "Derivative directories cannot be symlinks");
    }
  }
  private async directories(): Promise<void> {
    for (const path of [this.rootDir, ...["blobs", "completions", "tmp"].map(name => join(this.rootDir, name))])
      invariant(await realpath(path) === path, "TRANSCRIPTION_AUDIO_CORRUPT", "Derivative storage path changed");
  }
  private async readReceipt(id: string): Promise<TranscriptionAudioReceipt | null> {
    invariant(hash(id), "TRANSCRIPTION_AUDIO_CORRUPT", "Invalid derivative identity");
    await this.directories(); let file;
    try { file = await open(join(this.rootDir, "completions", `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = await file.stat(); invariant(stat.isFile() && stat.size > 0 && stat.size <= 32768, "TRANSCRIPTION_AUDIO_CORRUPT", "Invalid derivative completion size");
      const bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { const part = await file.read(bytes, offset, bytes.length - offset, null);
        invariant(part.bytesRead > 0, "TRANSCRIPTION_AUDIO_CORRUPT", "Truncated derivative completion"); offset += part.bytesRead; }
      invariant((await file.read(Buffer.alloc(1), 0, 1, null)).bytesRead === 0, "TRANSCRIPTION_AUDIO_CORRUPT", "Derivative completion grew");
      let receipt: TranscriptionAudioReceipt;
      try { receipt = JSON.parse(bytes.toString("utf8")) as TranscriptionAudioReceipt; }
      catch { invariant(false, "TRANSCRIPTION_AUDIO_CORRUPT", "Malformed derivative completion"); }
      invariant(receipt && typeof receipt === "object" && canonical(receipt) === bytes.toString("utf8"), "TRANSCRIPTION_AUDIO_CORRUPT", "Noncanonical derivative completion");
      return receipt;
    } finally { await file.close(); }
  }
  private async verifyBlob(receipt: TranscriptionAudioReceipt, intent: TranscriptionAudioIntent, signal?: AbortSignal): Promise<string> {
    await this.directories(); stopped(signal);
    const path = join(this.rootDir, "blobs", `${receipt.audio.sha256}.wav`);
    const measured = await inspectPcmWave(path, intent.recipe.maxOutputBytes, signal), audio = receipt.audio;
    invariant(measured.sha256 === audio.sha256 && measured.byteLength === audio.byteLength && measured.pcm.sampleRate === 16000
      && measured.pcm.channels === 1 && measured.pcm.bitsPerSample === 16 && measured.pcm.sampleCount === audio.sampleCount,
    "TRANSCRIPTION_AUDIO_CORRUPT", "Completed derivative bytes differ from their measured receipt");
    stopped(signal); return path;
  }
  async read(input: TranscriptionAudioIntent, options: { signal?: AbortSignal } = {}): Promise<StoredTranscriptionAudio | null> {
    const intent = structuredClone(input), signal = options.signal; stopped(signal);
    const receipt = await this.readReceipt(intent.id); stopped(signal);
    if (!receipt) return null;
    // Retain measured bad endpoints as evidence; the application separately rejects using them.
    assertTranscriptionAudioReceipt(intent, receipt, false);
    const path = await this.verifyBlob(receipt, intent, signal); stopped(signal); return { receipt, path };
  }
  async readUpload(input: TranscriptionAudioIntent, options: { signal?: AbortSignal } = {}): Promise<TranscriptionAudioUpload> {
    const intent = structuredClone(input), signal = options.signal; stopped(signal);
    const receipt = await this.readReceipt(intent.id); stopped(signal);
    invariant(receipt, "TRANSCRIPTION_AUDIO_NOT_READY", "The exact transcription derivative is not complete");
    // Historical measured failures remain readable through read(), but cannot become upload inputs.
    assertTranscriptionAudioReceipt(intent, receipt);
    const maximum = Math.min(intent.recipe.maxOutputBytes, 25_000_000);
    invariant(receipt.audio.byteLength <= maximum, "TRANSCRIPTION_AUDIO_CORRUPT", "Derivative exceeds its upload byte bound");
    // Reuse the complete PCM parser; matching the copied hash below proves these are the same verified bytes.
    const path = await this.verifyBlob(receipt, intent, signal); stopped(signal);
    await this.directories(); stopped(signal);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      stopped(signal); const before = await file.stat(); stopped(signal);
      invariant(before.isFile() && before.size === receipt.audio.byteLength && before.size <= maximum,
        "TRANSCRIPTION_AUDIO_CORRUPT", "Verified derivative size changed before upload");
      bytes = Buffer.alloc(before.size); const sha = createHash("sha256"); let offset = 0;
      while (offset < bytes.length) {
        stopped(signal); const part = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset); stopped(signal);
        invariant(part.bytesRead > 0, "TRANSCRIPTION_AUDIO_CORRUPT", "Verified derivative was truncated during upload read");
        sha.update(bytes.subarray(offset, offset + part.bytesRead)); offset += part.bytesRead;
      }
      const extra = await file.read(Buffer.alloc(1), 0, 1, bytes.length); stopped(signal);
      const after = await file.stat(); stopped(signal);
      invariant(extra.bytesRead === 0 && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
        && sha.digest("hex") === receipt.audio.sha256,
      "TRANSCRIPTION_AUDIO_CORRUPT", "Verified derivative changed during upload read");
    } finally { await file.close(); stopped(signal); }
    await this.directories(); stopped(signal);
    return { receipt, bytes };
  }
  async install(input: TranscriptionAudioIntent, value: MeasuredTranscriptionAudio, temporaryPath: string, options: { signal?: AbortSignal } = {}): Promise<StoredTranscriptionAudio> {
    const intent = structuredClone(input), audio = structuredClone(value), signal = options.signal, sourcePath = temporaryPath;
    const receipt: TranscriptionAudioReceipt = { id: intent.id, version: 1, projectId: intent.projectId, attemptId: intent.attemptId, intentDigest: digest(intent), audio };
    assertTranscriptionAudioReceipt(intent, receipt, false); stopped(signal); await this.directories(); stopped(signal);
    const directory = await mkdtemp(join(this.rootDir, "tmp", "install-"));
    try {
      const inputFile = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await inputFile.stat(); invariant(stat.isFile() && stat.size === audio.byteLength, "TRANSCRIPTION_AUDIO_CORRUPT", "Measured derivative size changed");
        const temporary = join(directory, "audio.wav"), output = await open(temporary, "wx", 0o600);
        try {
          const sha = createHash("sha256"), buffer = Buffer.alloc(65536); let size = 0;
          for (;;) { stopped(signal); const part = await inputFile.read(buffer, 0, buffer.length, null); stopped(signal); if (!part.bytesRead) break;
            size += part.bytesRead; invariant(size <= audio.byteLength, "TRANSCRIPTION_AUDIO_CORRUPT", "Measured derivative grew");
            const bytes = buffer.subarray(0, part.bytesRead); sha.update(bytes); await output.writeFile(bytes); }
          invariant(size === audio.byteLength && sha.digest("hex") === audio.sha256, "TRANSCRIPTION_AUDIO_CORRUPT", "Measured derivative hash changed");
          await output.chmod(0o444); await output.sync();
        } finally { await output.close(); }
        await this.directories(); stopped(signal);
        try { await link(temporary, join(this.rootDir, "blobs", `${audio.sha256}.wav`)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      } finally { await inputFile.close(); }
      const path = await this.verifyBlob(receipt, intent, signal);
      await syncDirectory(join(this.rootDir, "blobs")); await syncDirectory(this.rootDir); stopped(signal);
      const receiptPath = join(directory, "receipt.json"), file = await open(receiptPath, "wx", 0o444);
      try { await file.writeFile(canonical(receipt)); await file.sync(); } finally { await file.close(); }
      await this.directories(); stopped(signal);
      try { await link(receiptPath, join(this.rootDir, "completions", `${intent.id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      invariant(canonical(await this.readReceipt(intent.id)) === canonical(receipt), "TRANSCRIPTION_AUDIO_CONFLICT", "Derivative already completed with other bytes");
      await syncDirectory(join(this.rootDir, "completions")); await syncDirectory(this.rootDir);
      stopped(signal); return { receipt, path };
    } finally {
      // A late cancellation never removes completed immutable evidence or another caller's deduplicated blob.
      await rm(directory, { recursive: true, force: true }); stopped(signal);
    }
  }
}
