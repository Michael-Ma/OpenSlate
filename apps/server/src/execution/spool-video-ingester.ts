import { constants, mkdirSync, realpathSync } from "node:fs";
import { link, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { Attempt, ExecutionOutputIngestor } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { assertViggleSpoolLineage } from "./viggle-h3-lineage.js";
import { LocalMediaService } from "../media/local-media.js";
import { installManagedVideo } from "../media/managed-video.js";
import { assertNormalizedVideoIngestion, assertVideoDerivationIntent, assertVideoDerivationReceipt,
  VIDEO_DERIVATION_LIMITS, videoArtifactId, videoDerivationId } from "./video-derivation.js";
import type { NormalizedVideoIngestion, VideoDerivationIntent, VideoDerivationReceipt } from "./video-derivation.js";

const activeRoots = new Set<string>();
const cancelled = (signal: AbortSignal): void => invariant(!signal.aborted, "MEDIA_CANCELLED", "Video derivation cancelled");

/** Optional MP4-only hook. It never downloads, generates, or changes canonical project state. */
export class SpoolVideoIngestor implements ExecutionOutputIngestor {
  readonly rootDir: string;
  constructor(readonly outputs: ExecutionOutputStore, readonly media: LocalMediaService, options: { rootDir: string }) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/", "VIDEO_DERIVATION_CONFIGURATION", "Configure a private absolute derivation directory");
    invariant(media.limits.maxInputBytes <= VIDEO_DERIVATION_LIMITS.inputBytes && media.limits.maxOutputBytes <= VIDEO_DERIVATION_LIMITS.outputBytes,
      "VIDEO_DERIVATION_CONFIGURATION", "Initial normalization is capped at 128 MiB input and 256 MiB output");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir);
    for (const name of ["tmp", "completions"]) {
      const path = join(this.rootDir, name); mkdirSync(path, { recursive: true, mode: 0o700 });
      invariant(realpathSync(path) === path, "VIDEO_DERIVATION_CONFIGURATION", "Derivation directories cannot be symlinks");
    }
  }

  async ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): Promise<NormalizedVideoIngestion> {
    const attempt = structuredClone(input.attempt), output = structuredClone(input.output), signal = input.signal, artifactDir = input.artifactDir;
    invariant(isSpoolOutput(output) && output.kind === "video" && output.port === "video" && output.mimeType === "video/mp4" && output.extension === "mp4",
      "OUTPUT_INGESTION_UNSUPPORTED", "This ingester requires an owned generated MP4 spool");
    // A 256-MiB raw spool is valid storage evidence, but not automatically supported by this normalizer.
    invariant(output.byteLength <= this.media.limits.maxInputBytes && output.byteLength <= VIDEO_DERIVATION_LIMITS.inputBytes,
      "VIDEO_NORMALIZATION_INPUT_LIMIT", "Raw video exceeds the initial 128-MiB normalization limit");
    this.owned(attempt, signal);
    invariant(!activeRoots.has(this.rootDir), "MEDIA_BUSY", "This derivation worker is already running an operation");
    activeRoots.add(this.rootDir);
    try {
      const owned = await this.outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal });
      assertViggleSpoolLineage(this.outputs.store, attempt, owned.spool.id);
      const id = videoDerivationId(attempt.projectId, attempt.id), saved = this.outputs.store.get<VideoDerivationIntent>("video_derivation_intent", id);
      let intent = saved;
      if (!intent) {
        const normalization = await this.media.describeNormalization({ signal });
        const proposed: VideoDerivationIntent = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id,
          requestDigest: digest(attempt.request), slotId: digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "video" }),
          spoolId: owned.spool.id, rawSha256: output.sha256, rawByteLength: output.byteLength,
          artifactId: videoArtifactId(id), requiredFrames: Number(attempt.request.args.durationFrames), recipe: "generated-video-v1", normalization };
        assertVideoDerivationIntent(proposed, attempt, output);
        intent = this.outputs.store.transaction(() => {
          this.owned(attempt, signal);
          // A pre-transcode intent pins the recipe; restarts cannot silently choose another one.
          return this.outputs.store.put("video_derivation_intent", id, attempt.projectId, proposed) as VideoDerivationIntent;
        });
      }
      assertVideoDerivationIntent(intent, attempt, output);
      let receipt = await this.readIndex(id);
      const databaseReceipt = this.outputs.store.get<VideoDerivationReceipt>("video_derivation_receipt", id);
      if (databaseReceipt) invariant(receipt && canonical(receipt) === canonical(databaseReceipt), "VIDEO_DERIVATION_CORRUPT", "Recorded derivation lost its exact durable completion");
      if (!receipt) {
        if (saved) {
          const normalization = await this.media.describeNormalization({ signal });
          invariant(canonical(normalization) === canonical(intent.normalization), "VIDEO_DERIVATION_RECIPE_CHANGED", "Incomplete derivation requires its original normalization recipe and toolchain");
        }
        this.owned(attempt, signal);
        const source = await this.media.importMedia({ artifactId: intent.artifactId, path: owned.path, kind: "video" }, { signal });
        receipt = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, intentDigest: digest(intent), source };
        // Preserve measured normalization even when it is too short for the shot; recovery must not transcode it repeatedly.
        assertVideoDerivationReceipt(intent, receipt, false);
        // This completion index is durable before SQL artifact/source publication. Keep it on late cancellation.
        await this.writeIndex(receipt);
      }
      assertVideoDerivationReceipt(intent, receipt); this.owned(attempt, signal);
      const verified = await this.media.verifiedSource(receipt.source);
      const path = await installManagedVideo(artifactDir, attempt.projectId, { ...verified.source, path: verified.path }, intent.normalization.maxOutputBytes);
      this.owned(attempt, signal);
      const source = receipt.source;
      const result: NormalizedVideoIngestion = { type: "normalized_video", derivation: receipt,
        artifact: { id: intent.artifactId, projectId: attempt.projectId, attemptId: attempt.id,
          artifact: { artifactId: intent.artifactId, kind: "video", sha256: source.sha256 }, path, mimeType: "video/mp4", fixture: false,
          origin: "generated_video", physicalDurationSeconds: source.probe.video!.frames / 30, byteLength: source.byteLength,
          outputReceiptId: owned.spool.receiptId, outputSpoolId: owned.spool.id, derivationId: id, sourceDescriptorId: source.id },
        mediaSource: { id: intent.artifactId, projectId: attempt.projectId, source, origin: "generated_video", attemptId: attempt.id, derivationId: id } };
      assertNormalizedVideoIngestion(intent, attempt, output, result);
      assertViggleSpoolLineage(this.outputs.store, attempt, owned.spool.id); cancelled(signal);
      return result;
    } finally { activeRoots.delete(this.rootDir); }
  }

  private owned(attempt: Attempt, signal: AbortSignal): void {
    cancelled(signal);
    const current = this.outputs.store.get<Attempt>("attempt", attempt.id);
    invariant(current?.projectId === attempt.projectId && current.phase === "ingesting" && current.leaseOwner === attempt.leaseOwner
      && current.leaseEpoch === attempt.leaseEpoch && current.leaseExpiresAt > Date.now(), "VIDEO_DERIVATION_LEASE_LOST", "Video derivation no longer owns the active ingestion lease");
  }

  private async readIndex(id: string): Promise<VideoDerivationReceipt | null> {
    let file;
    try { file = await open(join(this.rootDir, "completions", `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 0 && stat.size <= VIDEO_DERIVATION_LIMITS.metadataBytes, "VIDEO_DERIVATION_CORRUPT", "Invalid derivation completion metadata");
      const bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, null);
        invariant(read.bytesRead > 0, "VIDEO_DERIVATION_CORRUPT", "Completion metadata was truncated"); offset += read.bytesRead; }
      invariant((await file.read(Buffer.alloc(1), 0, 1, null)).bytesRead === 0, "VIDEO_DERIVATION_CORRUPT", "Completion metadata grew while reading");
      return JSON.parse(bytes.toString("utf8")) as VideoDerivationReceipt;
    } finally { await file.close(); }
  }

  private async writeIndex(receipt: VideoDerivationReceipt): Promise<void> {
    const text = canonical(receipt);
    invariant(Buffer.byteLength(text) <= VIDEO_DERIVATION_LIMITS.metadataBytes, "VIDEO_DERIVATION_CORRUPT", "Derivation completion exceeds its metadata bound");
    const directory = await mkdtemp(join(this.rootDir, "tmp", "complete-"));
    try {
      const temporary = join(directory, "receipt.json"), file = await open(temporary, "wx", 0o444);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, join(this.rootDir, "completions", `${receipt.id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      invariant(canonical(await this.readIndex(receipt.id)) === text, "VIDEO_DERIVATION_CONFLICT", "Derivation already completed with different normalized bytes");
      const root = await open(this.rootDir, "r");
      try {
        const completions = await open(join(this.rootDir, "completions"), "r");
        try { await completions.sync(); await root.sync(); } finally { await completions.close(); }
      } finally { await root.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
