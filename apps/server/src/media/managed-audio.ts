import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DomainError, invariant, newId } from "@openslate/core";
import type { SuppliedMedia } from "./types.js";

type ManagedAudioInput = Pick<SuppliedMedia, "sha256" | "byteLength" | "probe"> & { path: string };

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); }
}

/** Filesystem work must finish before the short SQL registration/publication transaction. */
export async function installManagedAudio(root: string, projectId: string, source: ManagedAudioInput, maxBytes: number, options: { signal?: AbortSignal } = {}): Promise<string> {
  const { signal } = options;
  source = structuredClone(source);
  const check = () => { if (signal?.aborted) throw new DomainError("MEDIA_CANCELLED", "Media operation cancelled"); };
  check();
  invariant(ID.test(projectId) && /^[a-f0-9]{64}$/.test(source.sha256), "MEDIA_INVALID_INPUT", "Invalid owned artifact identity");
  invariant(Number.isSafeInteger(source.byteLength) && source.byteLength > 0 && source.byteLength <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Audio exceeds its byte limit");
  invariant(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 256 * 1024 * 1024
    && !source.probe.video && source.probe.audio?.codec === "pcm_s16le" && source.probe.audio.sampleRate === 48000
    && source.probe.audio.channels === 2, "MEDIA_INVALID_INPUT", "Managed generated audio requires normalized PCM16");
  // Resolve configured platform aliases such as macOS /var -> /private/var once.
  root = await realpath(root);
  const directory = join(root, projectId);
  await mkdir(directory, { recursive: true });
  invariant(await realpath(root) === root && await realpath(directory) === directory, "MEDIA_INTEGRITY_ERROR", "Artifact storage cannot be replaced by links");
  const path = join(directory, `${source.sha256}.wav`), temporary = join(directory, `.media-${newId()}.tmp`);
  const input = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await input.stat();
    invariant(stat.isFile() && stat.size === source.byteLength, "MEDIA_INTEGRITY_ERROR", "Source size changed");
    const output = await open(temporary, "wx", 0o600);
    try {
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let size = 0;
      for (;;) {
        check(); const { bytesRead } = await input.read(buffer, 0, buffer.length, null); check(); if (!bytesRead) break;
        size += bytesRead; invariant(size <= source.byteLength, "MEDIA_OUTPUT_LIMIT", "Source grew during installation");
        const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await output.writeFile(chunk);
      }
      invariant(size === source.byteLength && hash.digest("hex") === source.sha256, "MEDIA_INTEGRITY_ERROR", "Source bytes changed");
      await output.chmod(0o444); await output.sync();
    } finally { await output.close(); }
    check();
    try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const installed = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await installed.stat(); invariant(stat.isFile() && stat.size === source.byteLength, "MEDIA_INTEGRITY_ERROR", "Installed audio size differs");
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let size = 0;
      for (;;) { check(); const { bytesRead } = await installed.read(buffer, 0, buffer.length, null); check(); if (!bytesRead) break;
        size += bytesRead; invariant(size <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Installed audio exceeds its bound"); hash.update(buffer.subarray(0, bytesRead)); }
      invariant(size === source.byteLength && hash.digest("hex") === source.sha256, "MEDIA_INTEGRITY_ERROR", "Installed audio digest differs");
    } finally { await installed.close(); }
    check();
    await syncDirectory(root); await syncDirectory(directory);
    check(); return path;
  } finally { await input.close(); await unlink(temporary).catch(() => {}); check(); }
}
