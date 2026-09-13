import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DomainError, invariant, newId } from "@openslate/core";
import type { RenderedVideoInput } from "./application-types.js";

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); }
}

/** Filesystem work must finish before the short SQL registration/publication transaction. */
export async function installManagedVideo(root: string, projectId: string, source: RenderedVideoInput, maxBytes: number, options: { signal?: AbortSignal } = {}): Promise<string> {
  const { signal } = options;
  source = structuredClone(source);
  const check = () => { if (signal?.aborted) throw new DomainError("MEDIA_CANCELLED", "Media operation cancelled"); };
  check();
  invariant(ID.test(projectId) && /^[a-f0-9]{64}$/.test(source.sha256), "MEDIA_INVALID_INPUT", "Invalid owned artifact identity");
  invariant(Number.isSafeInteger(source.byteLength) && source.byteLength > 0 && source.byteLength <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Video exceeds its byte limit");
  // Resolve configured platform aliases such as macOS /var -> /private/var once.
  root = await realpath(root);
  const directory = join(root, projectId);
  await mkdir(directory, { recursive: true });
  invariant(await realpath(root) === root && await realpath(directory) === directory, "MEDIA_INTEGRITY_ERROR", "Artifact storage cannot be replaced by links");
  const path = join(directory, `${source.sha256}.mp4`), temporary = join(directory, `.media-${newId()}.tmp`);
  const input = await open(source.path, constants.O_RDONLY | constants.O_NOFOLLOW);
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
    const installed = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await installed.stat(); invariant(stat.isFile() && stat.size === source.byteLength, "MEDIA_INTEGRITY_ERROR", "Installed video size differs");
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let size = 0;
      for (;;) { check(); const { bytesRead } = await installed.read(buffer, 0, buffer.length, null); check(); if (!bytesRead) break;
        size += bytesRead; invariant(size <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Installed video exceeds its bound"); hash.update(buffer.subarray(0, bytesRead)); }
      invariant(size === source.byteLength && hash.digest("hex") === source.sha256, "MEDIA_INTEGRITY_ERROR", "Installed video digest differs");
    } finally { await installed.close(); }
    check();
    await syncDirectory(root); await syncDirectory(directory);
    check(); return path;
  } finally { await input.close(); await unlink(temporary).catch(() => {}); check(); }
}
