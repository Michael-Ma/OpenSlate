import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, rm, statfs } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, DomainError, invariant } from "@openslate/core";
import type { ExecutionIdentity } from "@openslate/providers";
import type { Attempt } from "./engine.js";
import { Store } from "../persistence/store.js";

const MiB = 1024 * 1024, HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/;
export const OUTPUT_STORE_LIMITS = Object.freeze({ imageBytes: 32 * MiB, videoBytes: 256 * MiB,
  metadataBytes: 16 * 1024, locatorBytes: 8192, chunkBytes: MiB, concurrentWriters: 2,
  diskHeadroomBytes: 16 * MiB, timeoutMs: 600000 });
export type OutputReceiptSource =
  | { kind: "returned_bytes"; sha256: string; byteLength: number }
  | { kind: "protected_locator"; locator: string; expiresAt: string | null };
export interface OutputReceiptInput {
  attemptId: string;
  /** Digest of the complete persisted application request, not a vendor idempotency key. */
  expectedRequestDigest: string;
  port: "image" | "video";
  kind: "image" | "video";
  mimeType: "image/png" | "video/mp4";
  vendorTaskId: string | null;
  diagnosticRequestId: string | null;
  source: OutputReceiptSource;
}
/** Protected operational evidence; never a browser/model projection. */
export interface OutputReceipt extends Omit<OutputReceiptInput, "expectedRequestDigest"> {
  id: string; projectId: string; version: 1; requestDigest: string; execution: ExecutionIdentity;
}
export interface OutputSpool {
  id: string; projectId: string; version: 1; storageId: string; receiptId: string; attemptId: string;
  requestDigest: string; port: "image" | "video"; sha256: string; byteLength: number; blobKey: string;
}
interface OutputSlot {
  id: string; projectId: string; version: 1; storageId: string; attemptId: string; port: "image" | "video";
  spoolId: string; sha256: string; byteLength: number;
}
export type OutputByteSource = (signal: AbortSignal) => AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>;
const activeWriters = new Map<string, number>();
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function exact(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  invariant(object(value) && Object.keys(value).every(key => fields.includes(key)), "OUTPUT_RECEIPT_INVALID", "Unsupported output receipt fields");
}
function limitFor(kind: "image" | "video"): number { return kind === "image" ? OUTPUT_STORE_LIMITS.imageBytes : OUTPUT_STORE_LIMITS.videoBytes; }
function stopped(signal?: AbortSignal): void { invariant(!signal?.aborted, "OUTPUT_STORE_CANCELLED", "Output storage was cancelled"); }
function small(value: unknown): string {
  const body = canonical(value);
  invariant(Buffer.byteLength(body) <= OUTPUT_STORE_LIMITS.metadataBytes, "OUTPUT_RECEIPT_INVALID", "Output metadata exceeds its byte limit");
  return body;
}
function optionalId(value: unknown): boolean { return value === null || (typeof value === "string" && ID.test(value)); }

/** Storage only: no provider dispatch, URL fetch, media decoder, artifact selection, or grant mutation. */
export class ExecutionOutputStore {
  readonly rootDir: string;
  readonly storageId: string;
  private readonly timeoutMs: number;

  constructor(readonly store: Store, options: { rootDir: string; timeoutMs?: number }) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/", "OUTPUT_STORE_CONFIGURATION", "Configure a private absolute output storage directory");
    this.timeoutMs = options.timeoutMs ?? OUTPUT_STORE_LIMITS.timeoutMs;
    invariant(Number.isSafeInteger(this.timeoutMs) && this.timeoutMs >= 10 && this.timeoutMs <= OUTPUT_STORE_LIMITS.timeoutMs,
      "OUTPUT_STORE_CONFIGURATION", "Invalid output storage deadline");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir);
    for (const directory of ["tmp", "blobs", "manifests", "slots"]) {
      const child = join(this.rootDir, directory); mkdirSync(child, { recursive: true, mode: 0o700 });
      invariant(realpathSync(child) === child, "OUTPUT_STORE_CONFIGURATION", "Output storage directories cannot be symlinks");
    }
    const path = join(this.rootDir, "identity.json");
    if (!existsSync(path)) {
      const temporary = join(this.rootDir, "tmp", `identity-${randomUUID()}.partial`), fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, small({ version: 1, id: randomUUID() })); fsyncSync(fd); }
      finally { closeSync(fd); }
      try { try { linkSync(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
      finally { unlinkSync(temporary); }
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let identity: unknown;
    try {
      const stat = fstatSync(fd); invariant(stat.isFile() && stat.size > 0 && stat.size <= 1024, "OUTPUT_STORE_CONFIGURATION", "Invalid storage identity");
      const bytes = readFileSync(fd); invariant(bytes.length === stat.size, "OUTPUT_STORE_CONFIGURATION", "Storage identity changed during reading"); identity = JSON.parse(bytes.toString("utf8"));
    }
    finally { closeSync(fd); }
    invariant(object(identity) && identity.version === 1 && typeof identity.id === "string" && /^[a-f0-9-]{36}$/.test(identity.id),
      "OUTPUT_STORE_CONFIGURATION", "Invalid storage identity");
    this.storageId = identity.id;
    const root = openSync(this.rootDir, "r"); try { fsyncSync(root); } finally { closeSync(root); }
  }

  recordReceipt(projectId: string, input: OutputReceiptInput): OutputReceipt {
    // Copy before validation so the saved observation cannot borrow later caller mutations.
    const value = structuredClone(input);
    exact(value, ["attemptId", "expectedRequestDigest", "port", "kind", "mimeType", "vendorTaskId", "diagnosticRequestId", "source"]);
    invariant(typeof value.attemptId === "string" && ID.test(value.attemptId) && typeof value.expectedRequestDigest === "string" && HASH.test(value.expectedRequestDigest),
      "OUTPUT_RECEIPT_INVALID", "Output requires an admitted attempt and exact request digest");
    invariant((value.kind === "image" && value.port === "image" && value.mimeType === "image/png")
      || (value.kind === "video" && value.port === "video" && value.mimeType === "video/mp4"), "OUTPUT_RECEIPT_INVALID", "Unsupported output role or format");
    invariant(optionalId(value.vendorTaskId) && optionalId(value.diagnosticRequestId), "OUTPUT_RECEIPT_INVALID", "Invalid provider diagnostic identity");
    exact(value.source, ["kind", "sha256", "byteLength", "locator", "expiresAt"]);
    if (value.source.kind === "returned_bytes") {
      exact(value.source, ["kind", "sha256", "byteLength"]);
      invariant(typeof value.source.sha256 === "string" && HASH.test(value.source.sha256) && Number.isSafeInteger(value.source.byteLength)
        && Number(value.source.byteLength) > 0 && Number(value.source.byteLength) <= limitFor(value.kind), "OUTPUT_RECEIPT_INVALID", "Invalid expected output bytes");
    } else {
      exact(value.source, ["kind", "locator", "expiresAt"]);
      invariant(value.source.kind === "protected_locator" && typeof value.source.locator === "string" && value.source.locator.length > 0
        && Buffer.byteLength(value.source.locator) <= OUTPUT_STORE_LIMITS.locatorBytes && !/[\u0000-\u001f\u007f]/.test(value.source.locator)
        && typeof value.vendorTaskId === "string" && (value.source.expiresAt === null || (typeof value.source.expiresAt === "string"
          && value.source.expiresAt.length <= 64 && Number.isFinite(Date.parse(value.source.expiresAt)))), "OUTPUT_RECEIPT_INVALID", "Invalid protected output locator");
    }
    return this.store.transaction(() => {
      const attempt = this.attempt(projectId, value.attemptId, value.expectedRequestDigest);
      invariant(attempt.request.kind === value.kind && (!attempt.taskId || value.vendorTaskId === attempt.taskId),
        "OUTPUT_RECEIPT_CONFLICT", "Output does not match the admitted operation or accepted task");
      const { expectedRequestDigest, ...observation } = value;
      const body = { ...observation, version: 1 as const, projectId, requestDigest: expectedRequestDigest,
        execution: attempt.request.execution ?? { adapter: "fake", version: "1" } };
      small(body); const id = digest(body);
      const saved = this.store.get<OutputReceipt>("execution_output_receipt", id);
      if (saved) { invariant(canonical(saved) === canonical({ ...body, id }), "OUTPUT_RECEIPT_CONFLICT", "Receipt identity already has different content"); return saved; }
      return this.store.insert("execution_output_receipt", id, projectId, body) as OutputReceipt;
    });
  }

  /** Opens caller-owned bytes lazily; a protected locator is never dereferenced here. */
  async spool(projectId: string, receiptId: string, source: OutputByteSource, options: { signal?: AbortSignal } = {}): Promise<OutputSpool> {
    const externalSignal = options.signal;
    const receipt = this.receipt(projectId, receiptId);
    stopped(externalSignal);
    invariant(typeof source === "function", "OUTPUT_RECEIPT_INVALID", "Supply a trusted byte-stream factory");
    const active = activeWriters.get(this.rootDir) ?? 0;
    invariant(active < OUTPUT_STORE_LIMITS.concurrentWriters, "OUTPUT_STORE_BUSY", "Two output storage operations are already active");
    activeWriters.set(this.rootDir, active + 1);
    let wasCancelled = false;
    const controller = new AbortController(), abort = (): void => { wasCancelled = true; controller.abort(); };
    externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    let interrupt!: () => void;
    const cancelled = new Promise<never>((_, reject) => { interrupt = () => reject(new DomainError("OUTPUT_STORE_CANCELLED", "Output storage was cancelled or timed out")); });
    // Recovery is deliberately awaited without a race; observe cancellation while it retains ownership.
    void cancelled.catch(() => {});
    controller.signal.addEventListener("abort", interrupt, { once: true });
    const wait = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, cancelled]);
    let directory: string | undefined, iterator: AsyncIterator<Uint8Array> | undefined, result: OutputSpool | undefined;
    try {
      // Recovery may publish metadata: retain writer ownership until its filesystem work settles.
      const existing = await this.recoverInternal(projectId, receiptId, controller.signal);
      if (existing) result = existing;
      else {
        const expected = receipt.source.kind === "returned_bytes" ? receipt.source.byteLength : limitFor(receipt.kind);
        const disk = await wait(statfs(this.rootDir, { bigint: true }));
        invariant(disk.bavail * disk.bsize >= BigInt(expected + OUTPUT_STORE_LIMITS.diskHeadroomBytes),
          "OUTPUT_STORE_DISK_FULL", "Insufficient available disk space for bounded output storage");
        // Keep ownership of resource-creating filesystem calls even if cancellation races them.
        directory = await mkdtemp(join(this.rootDir, "tmp", "spool-")); stopped(controller.signal);
        const path = join(directory, "output.partial"), handle = await open(path, "wx", 0o600);
        const hash = createHash("sha256"); let byteLength = 0;
        try {
          stopped(controller.signal);
          const opening = Promise.resolve(source(controller.signal));
          void opening.then(iterable => {
            if (controller.signal.aborted && iterable && typeof iterable[Symbol.asyncIterator] === "function") {
              try { const close = iterable[Symbol.asyncIterator]().return?.(); if (close) void Promise.resolve(close).catch(() => {}); } catch { /* Late source cleanup is best effort. */ }
            }
          }).catch(() => {});
          const iterable = await wait(opening);
          invariant(iterable && typeof iterable[Symbol.asyncIterator] === "function", "OUTPUT_RECEIPT_INVALID", "Invalid output byte stream");
          iterator = iterable[Symbol.asyncIterator]();
          while (true) {
            const next = await wait(iterator.next()); stopped(controller.signal);
            if (next.done) break;
            invariant(next.value instanceof Uint8Array && next.value.byteLength > 0 && next.value.byteLength <= OUTPUT_STORE_LIMITS.chunkBytes,
              "OUTPUT_BYTES_INVALID", "Output chunks must contain at most one MiB");
            const bytes = Buffer.from(next.value); byteLength += bytes.length;
            invariant(byteLength <= limitFor(receipt.kind) && (receipt.source.kind !== "returned_bytes" || byteLength <= receipt.source.byteLength),
              "OUTPUT_BYTES_INVALID", "Output exceeds its admitted byte limit");
            hash.update(bytes);
            let offset = 0;
            while (offset < bytes.length) { const written = await handle.write(bytes, offset, bytes.length - offset); invariant(written.bytesWritten > 0, "OUTPUT_STORE_WRITE_FAILED", "Output write made no progress"); offset += written.bytesWritten; }
          }
          invariant(byteLength > 0, "OUTPUT_BYTES_INVALID", "Output stream is empty");
          const sha256 = hash.digest("hex");
          invariant(receipt.source.kind !== "returned_bytes" || (sha256 === receipt.source.sha256 && byteLength === receipt.source.byteLength),
            "OUTPUT_BYTES_INVALID", "Output bytes differ from their receipt");
          stopped(controller.signal); await handle.sync(); await chmod(path, 0o444);
          const spool = this.descriptor(receipt, sha256, byteLength);
          await this.publish(path, join(this.rootDir, "blobs", spool.blobKey));
          await this.verifyBlob(spool, controller.signal);
          result = await this.complete(receipt, spool, controller.signal);
        } finally { await handle.close(); }
      }
    } finally {
      controller.signal.removeEventListener("abort", interrupt);
      controller.abort();
      try { if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* A source cleanup error cannot retain writer ownership. */ }
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally {
        clearTimeout(timer); externalSignal?.removeEventListener("abort", abort);
        const remaining = (activeWriters.get(this.rootDir) ?? 1) - 1;
        if (remaining === 0) activeWriters.delete(this.rootDir); else activeWriters.set(this.rootDir, remaining);
      }
    }
    stopped(externalSignal);
    invariant(!wasCancelled, "OUTPUT_STORE_CANCELLED", "Output storage was cancelled or timed out");
    invariant(result, "OUTPUT_NOT_READY", "Output bytes are not durably available");
    return result;
  }

  /** Recovers durable bytes/metadata only; never generates, downloads, or invents a remote task. */
  async recover(projectId: string, receiptId: string, options: { signal?: AbortSignal } = {}): Promise<OutputSpool | null> {
    const signal = options.signal;
    stopped(signal);
    const active = activeWriters.get(this.rootDir) ?? 0;
    invariant(active < OUTPUT_STORE_LIMITS.concurrentWriters, "OUTPUT_STORE_BUSY", "Two output storage operations are already active");
    activeWriters.set(this.rootDir, active + 1);
    try { const result = await this.recoverInternal(projectId, receiptId, signal); stopped(signal); return result; }
    finally { const remaining = (activeWriters.get(this.rootDir) ?? 1) - 1; if (remaining === 0) activeWriters.delete(this.rootDir); else activeWriters.set(this.rootDir, remaining); }
  }

  private async recoverInternal(projectId: string, receiptId: string, signal?: AbortSignal): Promise<OutputSpool | null> {
    stopped(signal); const receipt = this.receipt(projectId, receiptId);
    const saved = this.store.get<OutputSpool>("execution_output_spool", receiptId);
    const manifest = await this.readJson<OutputSpool>(join(this.rootDir, "manifests", `${receiptId}.json`));
    let spool = manifest;
    if (!spool && receipt.source.kind === "returned_bytes") {
      const expected = this.descriptor(receipt, receipt.source.sha256, receipt.source.byteLength);
      try { await lstat(join(this.rootDir, "blobs", expected.blobKey)); spool = expected; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (!spool) { invariant(!saved, "OUTPUT_STORE_CORRUPT", "Stored completion lost its durable manifest"); return null; }
    invariant(canonical(spool) === canonical(this.descriptor(receipt, spool.sha256, spool.byteLength)),
      "OUTPUT_STORE_CORRUPT", "Completion manifest differs from its receipt or storage identity");
    if (saved) invariant(canonical(saved) === canonical(spool), "OUTPUT_STORE_CORRUPT", "Stored output differs from its manifest");
    await this.verifyBlob(spool, signal);
    return this.complete(receipt, spool, signal);
  }

  /** Trusted host path after byte verification; still requires media decoding before artifact publication. */
  async resolveOwned(projectId: string, receiptId: string, options: { signal?: AbortSignal } = {}): Promise<{ spool: OutputSpool; path: string }> {
    const spool = await this.recover(projectId, receiptId, options);
    invariant(spool, "OUTPUT_NOT_READY", "Output bytes are not durably available");
    return { spool, path: join(this.rootDir, "blobs", spool.blobKey) };
  }

  private attempt(projectId: string, attemptId: string, requestDigest: string): Attempt {
    const attempt = this.store.get<Attempt>("attempt", attemptId);
    invariant(attempt?.projectId === projectId && digest(attempt.request) === requestDigest,
      "OUTPUT_RECEIPT_CONFLICT", "Output receipt does not match an admitted immutable request");
    return attempt;
  }
  private receipt(projectId: string, receiptId: string): OutputReceipt {
    invariant(typeof receiptId === "string" && HASH.test(receiptId), "OUTPUT_RECEIPT_INVALID", "Invalid output receipt identity");
    const receipt = this.store.get<OutputReceipt>("execution_output_receipt", receiptId);
    invariant(receipt?.projectId === projectId, "SCOPE_DENIED", "Output receipt is outside this project");
    const { id, ...body } = receipt;
    invariant(digest(body) === id, "OUTPUT_STORE_CORRUPT", "Stored output receipt identity differs");
    this.attempt(projectId, receipt.attemptId, receipt.requestDigest);
    return receipt;
  }
  private descriptor(receipt: OutputReceipt, sha256: string, byteLength: number): OutputSpool {
    invariant(typeof sha256 === "string" && HASH.test(sha256) && Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= limitFor(receipt.kind),
      "OUTPUT_STORE_CORRUPT", "Invalid spool identity or size");
    invariant(receipt.source.kind !== "returned_bytes" || (receipt.source.sha256 === sha256 && receipt.source.byteLength === byteLength),
      "OUTPUT_STORE_CORRUPT", "Spool differs from its expected response bytes");
    return { id: receipt.id, projectId: receipt.projectId, version: 1, storageId: this.storageId, receiptId: receipt.id,
      attemptId: receipt.attemptId, requestDigest: receipt.requestDigest, port: receipt.port, sha256, byteLength, blobKey: `${sha256}.blob` };
  }
  private async complete(receipt: OutputReceipt, spool: OutputSpool, signal?: AbortSignal): Promise<OutputSpool> {
    stopped(signal);
    await this.publishJson(join(this.rootDir, "manifests", `${receipt.id}.json`), spool);
    const slotId = digest({ projectId: receipt.projectId, attemptId: receipt.attemptId, port: receipt.port });
    const slot: OutputSlot = { id: slotId, projectId: receipt.projectId, version: 1, storageId: this.storageId,
      attemptId: receipt.attemptId, port: receipt.port, spoolId: spool.id, sha256: spool.sha256, byteLength: spool.byteLength };
    const slotPath = join(this.rootDir, "slots", `${slotId}.json`);
    // First-writer publication is exclusive; matching later receipts may share identical bytes.
    await this.publishJson(slotPath, slot, true);
    const selected = await this.readJson<OutputSlot>(slotPath);
    invariant(selected && typeof selected.spoolId === "string" && HASH.test(selected.spoolId)
      && canonical(selected) === canonical({ ...slot, spoolId: selected.spoolId }),
      "OUTPUT_SLOT_CONFLICT", "Another output byte identity already occupies this attempt and port");
    if (selected.spoolId !== spool.id && !this.store.get<OutputSpool>("execution_output_spool", selected.spoolId))
      await this.recoverInternal(receipt.projectId, selected.spoolId, signal);
    stopped(signal);
    return this.store.transaction(() => {
      this.receipt(receipt.projectId, receipt.id);
      const selectedSpool = selected.spoolId === spool.id ? spool : this.store.get<OutputSpool>("execution_output_spool", selected.spoolId);
      // A prior manifest may have won immediately before a crash; recover it explicitly first.
      invariant(selectedSpool, "OUTPUT_RECOVERY_REQUIRED", "Recover the first completed receipt before a later observation");
      const saved = this.store.put("execution_output_spool", spool.id, spool.projectId, spool) as OutputSpool;
      this.store.put("execution_output_slot", selected.id, selected.projectId, selected);
      return saved;
    });
  }
  private async verifyBlob(spool: OutputSpool, signal?: AbortSignal): Promise<void> {
    stopped(signal);
    const path = join(this.rootDir, "blobs", spool.blobKey), info = await lstat(path);
    invariant(info.isFile() && !info.isSymbolicLink() && info.size === spool.byteLength, "OUTPUT_STORE_CORRUPT", "Stored output file differs from its manifest");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await handle.stat(); invariant(actual.isFile() && actual.size === spool.byteLength, "OUTPUT_STORE_CORRUPT", "Stored output changed during verification");
      const hash = createHash("sha256"), buffer = Buffer.alloc(OUTPUT_STORE_LIMITS.chunkBytes); let total = 0;
      while (true) { stopped(signal); const read = await handle.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break;
        total += read.bytesRead; invariant(total <= spool.byteLength, "OUTPUT_STORE_CORRUPT", "Stored output grew during verification"); hash.update(buffer.subarray(0, read.bytesRead)); }
      invariant(total === spool.byteLength && hash.digest("hex") === spool.sha256, "OUTPUT_STORE_CORRUPT", "Stored output hash differs from its receipt");
    } finally { await handle.close(); }
  }
  private async publish(source: string, destination: string): Promise<void> {
    try { await link(source, destination); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const parent = await open(join(destination, ".."), "r"); try { await parent.sync(); } finally { await parent.close(); }
  }
  private async publishJson(path: string, value: unknown, keepExisting = false): Promise<void> {
    const directory = await mkdtemp(join(this.rootDir, "tmp", "metadata-"));
    try {
      const source = join(directory, "record.json"), handle = await open(source, "wx", 0o600), body = small(value);
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      await chmod(source, 0o444); await this.publish(source, path);
      const saved = await this.readJson<unknown>(path);
      invariant(keepExisting || canonical(saved) === body, "OUTPUT_STORE_CORRUPT", "Published metadata already has different content");
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  private async readJson<T>(path: string): Promise<T | null> {
    let handle;
    try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = await handle.stat(); invariant(stat.isFile() && stat.size > 0 && stat.size <= OUTPUT_STORE_LIMITS.metadataBytes,
        "OUTPUT_STORE_CORRUPT", "Invalid output metadata file");
      const bytes = await handle.readFile(); invariant(bytes.length === stat.size, "OUTPUT_STORE_CORRUPT", "Output metadata changed during reading");
      return JSON.parse(bytes.toString("utf8")) as T;
    } finally { await handle.close(); }
  }
}
