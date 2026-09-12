import { constants, mkdirSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { digest, invariant, newId } from "@openslate/core";

export interface ManagedUpload { path: string; sha256: string; byteLength: number; release(): Promise<void> }

/** Trusted host staging. One shared instance per upload root in the single local backend. */
export class ManagedUploadStore {
  readonly rootDir: string;
  readonly maxBytes: number;
  private readonly users = new Map<string, number>();
  constructor(options: { rootDir: string; maxBytes?: number }) {
    this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
    invariant(Number.isSafeInteger(this.maxBytes) && this.maxBytes > 0 && this.maxBytes <= 128 * 1024 * 1024, "VALIDATION_ERROR", "Invalid upload byte limit");
    mkdirSync(options.rootDir, { recursive: true }); this.rootDir = realpathSync(options.rootDir);
  }

  async receive(stream: AsyncIterable<Uint8Array>, stableIdentity: string, assertCurrent: () => void): Promise<ManagedUpload> {
    invariant(typeof stableIdentity === "string" && stableIdentity.length > 0 && stableIdentity.length <= 2048, "VALIDATION_ERROR", "Invalid upload identity");
    assertCurrent();
    const directory = join(this.rootDir, digest(stableIdentity)); await mkdir(directory, { recursive: true });
    invariant(await realpath(directory) === directory, "SCOPE_DENIED", "Upload staging cannot be replaced with a link");
    const temporary = join(directory, `.incoming-${newId()}`), output = await open(temporary, "wx", 0o600);
    let path: string | null = null, released = false;
    const release = async () => {
      if (released || !path) return; released = true;
      const count = this.users.get(path) ?? 0;
      if (count > 1) this.users.set(path, count - 1);
      else { this.users.delete(path); await unlink(path).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }); }
      await rmdir(directory).catch(() => {});
    };
    try {
      const hash = createHash("sha256"); let byteLength = 0;
      for await (const value of stream) {
        invariant(value instanceof Uint8Array, "VALIDATION_ERROR", "Upload must contain binary bytes");
        byteLength += value.byteLength;
        invariant(byteLength <= this.maxBytes, "UPLOAD_TOO_LARGE", "Recording exceeds the 128 MiB upload limit");
        hash.update(value); await output.writeFile(value);
      }
      invariant(byteLength > 0, "VALIDATION_ERROR", "Choose a nonempty recording"); assertCurrent();
      const sha256 = hash.digest("hex"); path = join(directory, `${sha256}.upload`);
      this.users.set(path, (this.users.get(path) ?? 0) + 1);
      await output.chmod(0o444); await output.sync(); await output.close();
      try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await existing.stat(); invariant(stat.isFile() && stat.size === byteLength, "UPLOAD_CORRUPT", "Staged recording size changed");
        const savedHash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let bytes = 0;
        for (;;) { const read = await existing.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break; bytes += read.bytesRead;
          invariant(bytes <= byteLength, "UPLOAD_CORRUPT", "Staged recording grew during verification"); savedHash.update(buffer.subarray(0, read.bytesRead)); }
        invariant(bytes === byteLength && savedHash.digest("hex") === sha256, "UPLOAD_CORRUPT", "Staged recording bytes changed");
      } finally { await existing.close(); }
      assertCurrent();
      return { path, sha256, byteLength, release };
    } catch (error) { await release(); throw error; }
    finally { await output.close().catch(() => {}); await unlink(temporary).catch(() => {}); await rmdir(directory).catch(() => {}); }
  }
}
