import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { requireRuntime } from "../runtime/validation.js";

export function imageStopped(signal?: AbortSignal): void {
  requireRuntime(!signal?.aborted, "CODEX_IMAGE_ABORTED", "Image worker was cancelled");
}
export function imageWithin(root: string, path: string): boolean {
  const delta = relative(root, path);
  return delta !== "" && !isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`);
}
/** No-follow all path components, not merely the final file. */
export async function imagePath(root: string, path: string): Promise<void> {
  requireRuntime(imageWithin(root, path) && await realpath(root) === root, "CODEX_IMAGE_PATH_INVALID", "Image file is outside its owned workspace");
  let cursor = dirname(path);
  while (cursor !== root) {
    const value = await lstat(cursor);
    requireRuntime(value.isDirectory() && !value.isSymbolicLink(), "CODEX_IMAGE_PATH_INVALID", "Image directory is not canonical");
    cursor = dirname(cursor);
  }
  requireRuntime(await realpath(dirname(path)) === dirname(path), "CODEX_IMAGE_PATH_INVALID", "Image path is not canonical");
}
export async function imageRead(root: string, path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  imageStopped(signal); await imagePath(root, path); imageStopped(signal);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    requireRuntime(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= maxBytes,
      "CODEX_IMAGE_FILE_INVALID", "Image file exceeds its complete owned-file bounds");
    const data = Buffer.alloc(before.size); let offset = 0;
    while (offset < data.length) {
      imageStopped(signal); const read = await file.read(data, offset, Math.min(1024 * 1024, data.length - offset), offset);
      requireRuntime(read.bytesRead > 0, "CODEX_IMAGE_FILE_CHANGED", "Image file changed during reading"); offset += read.bytesRead;
    }
    const tail = await file.read(Buffer.alloc(1), 0, 1, offset), after = await file.stat(), installed = await lstat(path);
    requireRuntime(tail.bytesRead === 0 && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
      before.ino === installed.ino && before.dev === installed.dev && !installed.isSymbolicLink(),
    "CODEX_IMAGE_FILE_CHANGED", "Image file changed during reading");
    imageStopped(signal); return data;
  } finally { await file.close(); }
}
export async function imageDirectory(root: string, name: string): Promise<string> {
  const path = join(root, name); await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const state = await lstat(path);
  requireRuntime(state.isDirectory() && !state.isSymbolicLink() && await realpath(path) === path,
    "CODEX_IMAGE_PATH_INVALID", "Image workspace is not a canonical private directory");
  return path;
}
export async function imageWrite(root: string, path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  imageStopped(signal); await imagePath(root, path); imageStopped(signal);
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const directory = await open(dirname(path), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
  imageStopped(signal);
}
export async function imageFileSha(path: string, signal?: AbortSignal): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    requireRuntime(before.isFile() && before.size > 0 && before.size <= 512 * 1024 ** 2, "CODEX_IMAGE_BINARY_INVALID", "Native binary exceeds its identity bound");
    const hash = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024); let offset = 0;
    while (true) {
      imageStopped(signal); const read = await file.read(buffer, 0, buffer.length, offset); if (!read.bytesRead) break;
      hash.update(buffer.subarray(0, read.bytesRead)); offset += read.bytesRead;
      requireRuntime(offset <= before.size, "CODEX_IMAGE_BINARY_CHANGED", "Native binary changed while being verified");
    }
    const after = await file.stat();
    requireRuntime(offset === before.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs,
      "CODEX_IMAGE_BINARY_CHANGED", "Native binary changed while being verified");
    imageStopped(signal); return hash.digest("hex");
  } finally { await file.close(); }
}
