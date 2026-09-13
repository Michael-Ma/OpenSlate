import { constants, mkdirSync, realpathSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { EXECUTION_SPOOL_LIMITS, isSpoolOutput, parseOpenAITranscriptionResponse } from "@openslate/providers";
import type { Attempt, ExecutionOutputIngestor } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import type { LocalMediaService } from "../media/local-media.js";
import type { TranscriptionAudioStore } from "../media/transcription-audio-store.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { compactTranscriptionExecutionResult, prepareTranscriptionExecutionRequest } from "./transcription-execution-receipts.js";
import { assertTranscriptCandidateIngestion, createTranscriptCandidate, resolveTranscriptionSpoolLineage,
  transcriptArtifactId } from "./transcript-candidate.js";
import type { TranscriptCandidateIngestion, TranscriptionSpoolLineage } from "./transcript-candidate.js";

const fail = (condition: unknown, message: string): void => invariant(condition, "TRANSCRIPT_INGESTION_CONFLICT", message);

/** Explicit exact-ASR ingester. Verifies existing media only; it cannot prepare audio, submit a provider request or adopt narration. */
export class SpoolTranscriptIngestor implements ExecutionOutputIngestor {
  readonly artifactDir: string;
  readonly #outputRoot: string;
  readonly #mediaRoot: string;
  readonly #audioRoot: string;
  constructor(readonly outputs: ExecutionOutputStore, readonly media: LocalMediaService, readonly audio: TranscriptionAudioStore,
    options: { artifactDir: string }) {
    invariant(isAbsolute(options.artifactDir) && options.artifactDir !== "/", "TRANSCRIPT_INGESTION_CONFIGURATION", "Configure a private absolute artifact directory");
    mkdirSync(options.artifactDir, { recursive: true, mode: 0o700 }); this.artifactDir = realpathSync(options.artifactDir);
    this.#outputRoot = outputs.rootDir; this.#mediaRoot = media.rootDir; this.#audioRoot = audio.rootDir;
  }

  async ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): Promise<TranscriptCandidateIngestion> {
    const attempt = structuredClone(input.attempt), output = structuredClone(input.output), signal = input.signal, artifactDir = input.artifactDir;
    invariant(attempt.request.kind === "transcription" && attempt.request.execution?.adapter === "openai-transcription"
      && attempt.request.execution.version === "1" && isSpoolOutput(output) && output.port === "cues" && output.kind === "data"
      && output.mimeType === "application/json" && output.extension === "json", "OUTPUT_INGESTION_UNSUPPORTED", "Transcript ingestion requires an exact owned OpenAI transcription response");
    fail(Number.isSafeInteger(output.byteLength) && output.byteLength > 0 && output.byteLength <= EXECUTION_SPOOL_LIMITS.data,
      "Raw transcription exceeds its bounded response size");
    this.owned(attempt, signal);
    // The host's configured root is immutable; a request cannot choose an output directory.
    fail(isAbsolute(artifactDir) && resolve(artifactDir) === artifactDir && await realpath(artifactDir) === this.artifactDir,
      "Transcript output directory differs from its configured root");
    this.owned(attempt, signal);
    await this.directories(this.outputs.rootDir, ["blobs", "manifests", "slots"]); this.owned(attempt, signal);
    const owned = await this.outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal });
    const lineage = this.lineage(attempt, signal, owned.spool.id), { intent, receipt } = lineage.preparation;
    fail(owned.path === join(this.outputs.rootDir, "blobs", `${output.sha256}.blob`), "Raw response is outside its exact owned blob");
    await this.directories(this.media.rootDir, ["blobs", "sources"]); this.owned(attempt, signal);
    const source = await this.media.verifiedSource(intent.source, { signal }); this.lineage(attempt, signal, owned.spool.id);
    fail(source.path === join(this.media.rootDir, "blobs", `${intent.source.sha256}.wav`) && canonical(source.source) === canonical(intent.source),
      "Transcription source differs from its exact managed recording");
    const pcm = await inspectPcmWave(source.path, intent.recipe.maxInputBytes, signal); this.lineage(attempt, signal, owned.spool.id);
    fail(pcm.sha256 === intent.source.sha256 && pcm.byteLength === intent.source.byteLength && pcm.pcm.sampleRate === 48000
      && pcm.pcm.channels === 2 && pcm.pcm.bitsPerSample === 16 && pcm.pcm.sampleCount === intent.sourceEndSample,
      "Transcription source bytes differ from the complete original recording");
    const upload = await this.audio.readUpload(intent, { signal }); this.lineage(attempt, signal, owned.spool.id);
    fail(canonical(upload.receipt) === canonical(receipt), "Transcription upload differs from its saved preparation");
    const prepared = prepareTranscriptionExecutionRequest(attempt.request, lineage.preparation, upload.bytes);
    fail(canonical(prepared.description) === canonical(lineage.mapping.transport), "Transcription multipart differs from the actual saved upload");
    await this.directories(this.outputs.rootDir, ["blobs", "manifests", "slots"]); this.owned(attempt, signal);
    const bytes = await this.readExact(owned.path, output.sha256, output.byteLength, () => this.owned(attempt, signal));
    this.lineage(attempt, signal, owned.spool.id);
    const parser = lineage.mapping.parser, parsed = parseOpenAITranscriptionResponse({ bytes, mimeType: "application/json",
      sourceDurationSeconds: receipt.audio.sampleCount / 16000 }, { maxTextBytes: parser.maxTextBytes, maxWords: parser.maxWords, maxWordBytes: parser.maxWordBytes });
    fail(lineage.result.observation.kind === "completed" && parsed.reportedModel === lineage.result.observation.reportedModel
      && canonical(compactTranscriptionExecutionResult(parsed.result)) === canonical(lineage.result.observation.result),
      "Transcript projection differs from its exact observed response and pinned parser");
    const candidate = createTranscriptCandidate(lineage, parsed), id = transcriptArtifactId(attempt.projectId, attempt.id, owned.spool.id);
    this.lineage(attempt, signal, owned.spool.id);
    const path = await this.install(attempt, bytes, output.sha256, signal);
    const result: TranscriptCandidateIngestion = { type: "transcript_candidate", candidate,
      artifact: { id, projectId: attempt.projectId, attemptId: attempt.id, artifact: { artifactId: id, kind: "data", sha256: output.sha256 },
        path, mimeType: "application/json", fixture: false, origin: "transcription_response", physicalDurationSeconds: null,
        byteLength: bytes.length, outputReceiptId: owned.spool.receiptId, outputSpoolId: owned.spool.id, transcriptCandidateId: candidate.id } };
    const current = this.lineage(attempt, signal, owned.spool.id);
    assertTranscriptCandidateIngestion(current, output, result); this.owned(attempt, signal); return result;
  }

  private owned(attempt: Attempt, signal: AbortSignal): void {
    invariant(!signal.aborted, "TRANSCRIPT_INGESTION_CANCELLED", "Transcript ingestion cancelled");
    fail(this.outputs.rootDir === this.#outputRoot && this.media.rootDir === this.#mediaRoot && this.audio.rootDir === this.#audioRoot,
      "Configured transcript storage roots changed");
    new InstallationRecoveryGuard(this.outputs.store).assertWritable(attempt.projectId);
    const current = this.outputs.store.get<Attempt>("attempt", attempt.id);
    invariant(current?.projectId === attempt.projectId && current.phase === "ingesting" && current.leaseOwner === attempt.leaseOwner
      && current.leaseEpoch === attempt.leaseEpoch && current.leaseExpiresAt > Date.now() && digest(current.request) === digest(attempt.request),
      "TRANSCRIPT_INGESTION_LEASE_LOST", "Transcript ingestion no longer owns its original active lease");
  }
  private lineage(attempt: Attempt, signal: AbortSignal, spoolId: string): TranscriptionSpoolLineage {
    this.owned(attempt, signal); return resolveTranscriptionSpoolLineage(this.outputs.store, attempt, spoolId);
  }
  private async directories(root: string, names: string[]): Promise<void> {
    for (const path of [root, ...names.map(name => join(root, name))]) fail(await realpath(path) === path, "Owned storage directories cannot become symlinks");
  }
  private async readExact(path: string, sha256: string, byteLength: number, check: () => void): Promise<Buffer> {
    check(); fail(Number.isSafeInteger(byteLength) && byteLength > 0 && byteLength <= EXECUTION_SPOOL_LIMITS.data, "Response exceeds its fixed raw-byte bound");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      check(); const before = await file.stat(); check(); fail(before.isFile() && before.size === byteLength, "Raw transcript file size differs");
      bytes = Buffer.alloc(byteLength); const hash = createHash("sha256"); let offset = 0;
      while (offset < bytes.length) {
        check(); const part = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset); check();
        fail(part.bytesRead > 0, "Raw transcript was truncated"); hash.update(bytes.subarray(offset, offset + part.bytesRead)); offset += part.bytesRead;
      }
      const tail = await file.read(Buffer.alloc(1), 0, 1, bytes.length); check(); const after = await file.stat(); check();
      fail(tail.bytesRead === 0 && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
        && hash.digest("hex") === sha256, "Raw transcript changed while reading");
    } finally { await file.close(); check(); }
    return bytes;
  }
  private async install(attempt: Attempt, bytes: Buffer, sha256: string, signal: AbortSignal): Promise<string> {
    const check = () => this.owned(attempt, signal); check();
    fail(/^[A-Za-z0-9_-]{1,128}$/.test(attempt.projectId) && /^[a-f0-9]{64}$/.test(sha256)
      && bytes.length > 0 && bytes.length <= EXECUTION_SPOOL_LIMITS.data, "Invalid bounded transcript artifact identity");
    const directory = join(this.artifactDir, attempt.projectId), path = join(directory, `${sha256}.json`);
    await mkdir(directory, { recursive: true, mode: 0o700 }); check(); await this.directories(this.artifactDir, [attempt.projectId]); check();
    const temporary = join(directory, `.media-${randomUUID()}.tmp`), file = await open(temporary, "wx", 0o600);
    try {
      try { for (let offset = 0; offset < bytes.length; offset += 65536) { check(); await file.writeFile(bytes.subarray(offset, offset + 65536)); check(); }
        await file.chmod(0o444); check(); await file.sync(); check();
      } finally { await file.close(); check(); }
      await this.directories(this.artifactDir, [attempt.projectId]); check();
      try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      check(); await this.readExact(path, sha256, bytes.length, check);
      await this.directories(this.artifactDir, [attempt.projectId]); check();
      for (const name of [directory, this.artifactDir]) { const handle = await open(name, "r"); try { await handle.sync(); } finally { await handle.close(); } check(); }
    } finally { await unlink(temporary); check(); }
    return path;
  }
}
