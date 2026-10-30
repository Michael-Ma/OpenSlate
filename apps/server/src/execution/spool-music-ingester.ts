import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { canonical, digest, invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { IngestibleExecutionOutput } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import type { SuppliedMedia, MediaAudioNormalizationIdentity } from "../media/types.js";
import { LocalMediaService } from "../media/local-media.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { installManagedAudio } from "../media/managed-audio.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { resolveCodePlanProviderAdmission } from "../code-plan/provider-authority.js";
import { ExecutionOutputStore } from "./output-store.js";
import type { Attempt, ArtifactRecord, ExecutionOutputIngestor } from "./engine.js";

interface MusicIntent { id: string; projectId: string; attemptId: string; requestDigest: string; spoolId: string; rawSha256: string; normalization: MediaAudioNormalizationIdentity }
export interface MusicReceipt extends MusicIntent { source: SuppliedMedia; leadInSamples: number }
export type MusicArtifact = ArtifactRecord & { leadInSamples: number };
const idFor = (attempt: Attempt): string => digest({ kind: "generated_music_v1", projectId: attempt.projectId, attemptId: attempt.id });
/** First stereo frame above -60 dBFS; works on the verified normalized PCM, in bounded chunks. */
export async function measureMusicLeadIn(path: string, samples: number, signal: AbortSignal): Promise<number> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const header = Buffer.alloc(8); let offset = 12, data = -1;
    const size = (await file.stat()).size;
    while (offset + 8 <= size) {
      invariant(!signal.aborted, "MEDIA_CANCELLED", "Music measurement cancelled");
      invariant((await file.read(header, 0, 8, offset)).bytesRead === 8, "LYRIA_PCM_INVALID", "Incomplete PCM chunk");
      const bytes = header.readUInt32LE(4);
      if (header.toString("ascii", 0, 4) === "data") { data = offset + 8; break; }
      offset += 8 + bytes + bytes % 2;
    }
    invariant(data >= 0 && data + samples * 4 <= size, "LYRIA_PCM_INVALID", "Music needs measured stereo PCM frames");
    const buffer = Buffer.alloc(256 * 1024);
    for (let frame = 0; frame < samples;) {
      invariant(!signal.aborted, "MEDIA_CANCELLED", "Music measurement cancelled");
      const bytes = Math.min(buffer.length, (samples - frame) * 4);
      invariant((await file.read(buffer, 0, bytes, data + frame * 4)).bytesRead === bytes, "LYRIA_PCM_INVALID", "Incomplete PCM data");
      for (let index = 0; index < bytes; index += 4) if (Math.abs(buffer.readInt16LE(index)) > 32 || Math.abs(buffer.readInt16LE(index + 2)) > 32) return frame + index / 4;
      frame += bytes / 4;
    }
    return samples; // All-silent output stays honest; it has no usable placement after its lead-in.
  } finally { await file.close(); }
}
export function assertMusicArtifact(store: Pick<Store, "get">, attempt: Attempt, output: IngestibleExecutionOutput, artifact: ArtifactRecord): asserts artifact is MusicArtifact {
  const receipt = store.get<MusicReceipt>("music_ingestion_receipt", idFor(attempt)), source = receipt?.source;
  invariant(isSpoolOutput(output) && receipt && receipt.id === idFor(attempt) && receipt.projectId === attempt.projectId
    && receipt.attemptId === attempt.id && receipt.requestDigest === digest(attempt.request) && receipt.spoolId === output.storage.spoolId
    && receipt.normalization.recipe === "pcm-s16le-48khz-stereo-v1" && source?.toolchainDigest === receipt.normalization.toolchainDigest
    && source.byteLength <= receipt.normalization.maxOutputBytes && source.probe.audio?.samples && source.probe.audio.samples <= receipt.normalization.maxSamples
    && receipt.rawSha256 === output.sha256 && source?.originalSha256 === output.sha256 && source.originalByteLength === output.byteLength
    && source.kind === "audio" && source.artifactId === receipt.id && source.probe.audio?.sampleRate === 48000 && source.probe.audio.channels === 2
    && source.probe.audio.samples && artifact.id === source.artifactId && artifact.artifact.sha256 === source.sha256
    && artifact.projectId === attempt.projectId && artifact.attemptId === attempt.id && artifact.artifact.kind === "audio" && artifact.artifact.artifactId === artifact.id
    && artifact.origin === "generated_audio" && artifact.outputSpoolId === output.storage.spoolId && artifact.outputReceiptId === output.storage.spoolId && artifact.fixture === false
    && artifact.derivationId === receipt.id && artifact.byteLength === source.byteLength && artifact.mimeType === "audio/wav" && artifact.sourceDescriptorId === source.id
    && artifact.physicalDurationSeconds === source.probe.audio.samples / 48000
    && (artifact as MusicArtifact).leadInSamples === receipt.leadInSamples
    && Number.isSafeInteger(receipt.leadInSamples) && receipt.leadInSamples >= 0 && receipt.leadInSamples <= source.probe.audio.samples,
  "LYRIA_INGESTION_CONFLICT", "Music artifact differs from its owned raw output and measured source");
}
/** MP3/WAV input uses the same bounded importer, resampler, probe and managed-audio installer as supplied audio. */
export class SpoolMusicIngestor implements ExecutionOutputIngestor {
  constructor(readonly outputs: ExecutionOutputStore, readonly media: LocalMediaService) {}
  async ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): Promise<MusicArtifact> {
    const attempt = structuredClone(input.attempt), output = structuredClone(input.output), signal = input.signal, store = this.outputs.store;
    invariant(isSpoolOutput(output) && output.kind === "audio" && output.port === "audio"
      && ["audio/wav", "audio/mpeg"].includes(output.mimeType) && attempt.request.kind === "music", "LYRIA_INGESTION_CONFLICT", "Music requires an owned MP3 or WAV spool");
    const owned = (): void => {
      invariant(!signal.aborted, "MEDIA_CANCELLED", "Music ingestion cancelled");
      new InstallationRecoveryGuard(store).assertWritable(attempt.projectId);
      const admission = resolveCodePlanProviderAdmission(store, attempt.request), current = admission?.attempt;
      invariant(current?.phase === "ingesting" && current.leaseOwner === attempt.leaseOwner && current.leaseEpoch === attempt.leaseEpoch
        && current.leaseExpiresAt > Date.now(), "LYRIA_INGESTION_LEASE", "Music ingestion lost its active lease");
    };
    owned();
    const spool = await this.outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal });
    const id = idFor(attempt);
    let intent = store.get<MusicIntent>("music_ingestion_intent", id);
    if (!intent) {
      const normalization = await this.media.describeAudioNormalization({ signal }); owned();
      intent = store.insert("music_ingestion_intent", id, attempt.projectId, { id, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request),
        spoolId: spool.spool.id, rawSha256: output.sha256, normalization });
    }
    invariant(intent.requestDigest === digest(attempt.request) && intent.spoolId === output.storage.spoolId && intent.rawSha256 === output.sha256,
      "LYRIA_INGESTION_CONFLICT", "Music normalization intent changed");
    let receipt = store.get<MusicReceipt>("music_ingestion_receipt", id);
    if (!receipt) {
      invariant(canonical(intent.normalization) === canonical(await this.media.describeAudioNormalization({ signal })), "LYRIA_RECIPE_CHANGED", "Incomplete music normalization requires its original toolchain");
      owned();
      const source = await this.media.importMedia({ artifactId: id, path: spool.path, kind: "audio" }, { signal });
      const verified = await this.media.verifiedSource(source, { signal });
      const pcm = await inspectPcmWave(verified.path, intent.normalization.maxOutputBytes, signal);
      invariant(pcm.pcm.sampleRate === 48000 && pcm.pcm.channels === 2 && pcm.sha256 === source.sha256 && pcm.pcm.sampleCount === source.probe.audio?.samples,
        "LYRIA_PCM_INVALID", "Music normalization must yield complete measured stereo PCM");
      const leadInSamples = await measureMusicLeadIn(verified.path, pcm.pcm.sampleCount, signal); owned();
      receipt = store.insert("music_ingestion_receipt", id, attempt.projectId, { ...intent, source, leadInSamples });
    }
    invariant(canonical({ ...intent, source: receipt.source, leadInSamples: receipt.leadInSamples }) === canonical(receipt),
      "LYRIA_INGESTION_CONFLICT", "Completed music differs from its pinned normalization intent");
    const verified = await this.media.verifiedSource(receipt.source, { signal }); owned();
    const path = await installManagedAudio(input.artifactDir, attempt.projectId, { ...verified.source, path: verified.path }, intent.normalization.maxOutputBytes, { signal });
    const source = receipt.source;
    const artifact: MusicArtifact = { id, projectId: attempt.projectId, attemptId: attempt.id, artifact: { artifactId: id, kind: "audio", sha256: source.sha256 },
      path, mimeType: "audio/wav", fixture: false, origin: "generated_audio", outputReceiptId: spool.spool.receiptId, outputSpoolId: spool.spool.id,
      byteLength: source.byteLength, physicalDurationSeconds: source.probe.audio!.samples! / 48000, sourceDescriptorId: source.id, derivationId: id, leadInSamples: receipt.leadInSamples };
    assertMusicArtifact(store, attempt, output, artifact); owned();
    return artifact;
  }
}
