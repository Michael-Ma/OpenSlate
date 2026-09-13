import { constants, mkdirSync, realpathSync } from "node:fs";
import { link, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { Attempt, ExecutionOutputIngestor } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { LocalMediaService } from "../media/local-media.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { installManagedAudio } from "../media/managed-audio.js";
import { assertNormalizedAudioIngestion, assertAudioDerivationIntent, assertAudioDerivationReceipt,
  AUDIO_DERIVATION_LIMITS, audioArtifactId, audioDerivationId } from "./audio-derivation.js";
import type { NormalizedAudioIngestion, AudioDerivationIntent, AudioDerivationReceipt } from "./audio-derivation.js";
import { assertSpeechSpoolLineage } from "./audio-execution-lineage.js";

const activeRoots = new Set<string>();
const cancelled = (signal: AbortSignal): void => invariant(!signal.aborted, "MEDIA_CANCELLED", "Audio derivation cancelled");

/** Optional WAV-only hook. It never downloads, generates, or changes canonical project state. */
export class SpoolAudioIngestor implements ExecutionOutputIngestor {
  readonly rootDir: string;
  constructor(readonly outputs: ExecutionOutputStore, readonly media: LocalMediaService, options: { rootDir: string }) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/", "AUDIO_DERIVATION_CONFIGURATION", "Configure a private absolute derivation directory");
    invariant(media.limits.maxOutputBytes <= AUDIO_DERIVATION_LIMITS.outputBytes && media.limits.timeoutMs <= AUDIO_DERIVATION_LIMITS.timeoutMs,
      "AUDIO_DERIVATION_CONFIGURATION", "Generated audio requires an actual shared output cap of 256 MiB and two-minute operation timeout");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir);
    for (const name of ["tmp", "completions"]) {
      const path = join(this.rootDir, name); mkdirSync(path, { recursive: true, mode: 0o700 });
      invariant(realpathSync(path) === path, "AUDIO_DERIVATION_CONFIGURATION", "Derivation directories cannot be symlinks");
    }
  }

  async ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): Promise<NormalizedAudioIngestion> {
    const attempt = structuredClone(input.attempt), output = structuredClone(input.output), signal = input.signal, artifactDir = input.artifactDir;
    invariant(isSpoolOutput(output) && output.kind === "audio" && output.port === "audio" && output.mimeType === "audio/wav" && output.extension === "wav",
      "OUTPUT_INGESTION_UNSUPPORTED", "This ingester requires an owned generated WAV spool");
    // Raw paid evidence is retained even when the configured normalizer cannot accept it.
    invariant(output.byteLength <= this.media.limits.maxInputBytes && output.byteLength <= AUDIO_DERIVATION_LIMITS.inputBytes,
      "AUDIO_NORMALIZATION_INPUT_LIMIT", "Raw audio exceeds the bounded normalization input limit");
    this.owned(attempt, signal);
    invariant(!activeRoots.has(this.rootDir), "MEDIA_BUSY", "This derivation worker is already running an operation");
    activeRoots.add(this.rootDir);
    try {
      const owned = await this.outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal });
      // The Engine may recover a generic spool without calling the provider bridge. Re-establish speech's exact response lineage here.
      this.owned(attempt, signal, owned.spool.id);
      const raw = await inspectPcmWave(owned.path, AUDIO_DERIVATION_LIMITS.inputBytes, signal);
      invariant(raw.sha256 === output.sha256 && raw.byteLength === output.byteLength, "AUDIO_DERIVATION_CONFLICT", "Raw PCM bytes differ from their spool");
      this.owned(attempt, signal, owned.spool.id);
      const id = audioDerivationId(attempt.projectId, attempt.id), saved = this.outputs.store.get<AudioDerivationIntent>("audio_derivation_intent", id);
      let intent = saved;
      if (!intent) {
        const normalization = await this.media.describeAudioNormalization({ signal });
        const proposed: AudioDerivationIntent = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id,
          requestDigest: digest(attempt.request), slotId: digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "audio" }),
          spoolId: owned.spool.id, rawSha256: output.sha256, rawByteLength: output.byteLength,
          artifactId: audioArtifactId(id), rawPcm: raw.pcm, recipe: "generated-audio-v1", normalization };
        assertAudioDerivationIntent(proposed, attempt, output);
        intent = this.outputs.store.transaction(() => {
          this.owned(attempt, signal, owned.spool.id);
          // A pre-transcode intent pins the recipe; restarts cannot silently choose another one.
          return this.outputs.store.put("audio_derivation_intent", id, attempt.projectId, proposed) as AudioDerivationIntent;
        });
      }
      assertAudioDerivationIntent(intent, attempt, output);
      invariant(canonical(intent.rawPcm) === canonical(raw.pcm), "AUDIO_DERIVATION_CONFLICT", "Raw PCM geometry differs from its intent");
      let receipt = await this.readIndex(id);
      const databaseReceipt = this.outputs.store.get<AudioDerivationReceipt>("audio_derivation_receipt", id);
      if (databaseReceipt) invariant(receipt && canonical(receipt) === canonical(databaseReceipt), "AUDIO_DERIVATION_CORRUPT", "Recorded derivation lost its exact durable completion");
      if (!receipt) {
        this.owned(attempt, signal, owned.spool.id);
        if (saved) {
          const normalization = await this.media.describeAudioNormalization({ signal });
          invariant(canonical(normalization) === canonical(intent.normalization), "AUDIO_DERIVATION_RECIPE_CHANGED", "Incomplete derivation requires its original normalization recipe and toolchain");
        }
        this.owned(attempt, signal, owned.spool.id);
        const source = await this.media.importMedia({ artifactId: intent.artifactId, path: owned.path, kind: "audio" }, { signal });
        const verified = await this.media.verifiedSource(source, { signal });
        const normalized = await inspectPcmWave(verified.path, intent.normalization.maxOutputBytes, signal);
        invariant(normalized.sha256 === source.sha256 && normalized.byteLength === source.byteLength
          && normalized.pcm.sampleRate === 48000 && normalized.pcm.channels === 2, "AUDIO_DERIVATION_CONFLICT", "Normalized PCM differs from its descriptor");
        receipt = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, intentDigest: digest(intent), source,
          normalizedSamples: normalized.pcm.sampleCount, endpointDeltaNumerator: normalized.pcm.sampleCount * raw.pcm.sampleRate - raw.pcm.sampleCount * 48000 };
        // Retain even an invalid measured endpoint so recovery never repeats this completed conversion.
        assertAudioDerivationReceipt(intent, receipt, false);
        // This completion index is durable before SQL artifact/source publication. Keep it on late cancellation.
        await this.writeIndex(receipt);
      }
      assertAudioDerivationReceipt(intent, receipt); this.owned(attempt, signal, owned.spool.id);
      const verified = await this.media.verifiedSource(receipt.source, { signal });
      const normalized = await inspectPcmWave(verified.path, intent.normalization.maxOutputBytes, signal);
      invariant(normalized.sha256 === receipt.source.sha256 && normalized.byteLength === receipt.source.byteLength
        && normalized.pcm.sampleRate === 48000 && normalized.pcm.channels === 2 && normalized.pcm.sampleCount === receipt.normalizedSamples,
        "AUDIO_DERIVATION_CONFLICT", "Completed PCM bytes differ from their measured receipt");
      this.owned(attempt, signal, owned.spool.id);
      const path = await installManagedAudio(artifactDir, attempt.projectId, { ...verified.source, path: verified.path }, intent.normalization.maxOutputBytes, { signal });
      this.owned(attempt, signal, owned.spool.id);
      const source = receipt.source;
      const result: NormalizedAudioIngestion = { type: "normalized_audio", derivation: receipt,
        artifact: { id: intent.artifactId, projectId: attempt.projectId, attemptId: attempt.id,
          artifact: { artifactId: intent.artifactId, kind: "audio", sha256: source.sha256 }, path, mimeType: "audio/wav", fixture: false,
          origin: "generated_audio", physicalDurationSeconds: receipt.normalizedSamples / 48000, byteLength: source.byteLength,
          outputReceiptId: owned.spool.receiptId, outputSpoolId: owned.spool.id, derivationId: id, sourceDescriptorId: source.id },
        mediaSource: { id: intent.artifactId, projectId: attempt.projectId, source, origin: "generated_audio", attemptId: attempt.id, derivationId: id } };
      assertNormalizedAudioIngestion(intent, attempt, output, result); cancelled(signal);
      return result;
    } finally { activeRoots.delete(this.rootDir); }
  }

  private owned(attempt: Attempt, signal: AbortSignal, spoolId?: string): void {
    cancelled(signal);
    new InstallationRecoveryGuard(this.outputs.store).assertWritable(attempt.projectId);
    const current = this.outputs.store.get<Attempt>("attempt", attempt.id);
    invariant(current?.projectId === attempt.projectId && current.phase === "ingesting" && current.leaseOwner === attempt.leaseOwner
      && current.leaseEpoch === attempt.leaseEpoch && current.leaseExpiresAt > Date.now() && digest(current.request) === digest(attempt.request), "AUDIO_DERIVATION_LEASE_LOST", "Audio derivation no longer owns the active ingestion lease");
    if (spoolId !== undefined) assertSpeechSpoolLineage(this.outputs.store, attempt, spoolId);
  }

  private async readIndex(id: string): Promise<AudioDerivationReceipt | null> {
    let file;
    try { file = await open(join(this.rootDir, "completions", `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 0 && stat.size <= AUDIO_DERIVATION_LIMITS.metadataBytes, "AUDIO_DERIVATION_CORRUPT", "Invalid derivation completion metadata");
      const bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, null);
        invariant(read.bytesRead > 0, "AUDIO_DERIVATION_CORRUPT", "Completion metadata was truncated"); offset += read.bytesRead; }
      invariant((await file.read(Buffer.alloc(1), 0, 1, null)).bytesRead === 0, "AUDIO_DERIVATION_CORRUPT", "Completion metadata grew while reading");
      let parsed: AudioDerivationReceipt;
      try { parsed = JSON.parse(bytes.toString("utf8")) as AudioDerivationReceipt; }
      catch { invariant(false, "AUDIO_DERIVATION_CORRUPT", "Malformed derivation completion metadata"); }
      invariant(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed), "AUDIO_DERIVATION_CORRUPT", "Invalid completion object");
      return parsed;
    } finally { await file.close(); }
  }

  private async writeIndex(receipt: AudioDerivationReceipt): Promise<void> {
    const text = canonical(receipt);
    invariant(Buffer.byteLength(text) <= AUDIO_DERIVATION_LIMITS.metadataBytes, "AUDIO_DERIVATION_CORRUPT", "Derivation completion exceeds its metadata bound");
    const directory = await mkdtemp(join(this.rootDir, "tmp", "complete-"));
    try {
      const temporary = join(directory, "receipt.json"), file = await open(temporary, "wx", 0o444);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, join(this.rootDir, "completions", `${receipt.id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      invariant(canonical(await this.readIndex(receipt.id)) === text, "AUDIO_DERIVATION_CONFLICT", "Derivation already completed with different normalized bytes");
      const root = await open(this.rootDir, "r");
      try {
        const completions = await open(join(this.rootDir, "completions"), "r");
        try { await completions.sync(); await root.sync(); } finally { await completions.close(); }
      } finally { await root.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
