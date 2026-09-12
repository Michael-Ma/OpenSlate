import { canonical, digest, invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { IngestibleExecutionOutput } from "@openslate/providers";
import type { Attempt, ArtifactRecord } from "./engine.js";
import type { GeneratedMediaSource } from "../media/application-types.js";
import type { MediaNormalizationIdentity, SuppliedMedia } from "../media/types.js";

export const VIDEO_DERIVATION_LIMITS = Object.freeze({ inputBytes: 128 * 1024 * 1024, outputBytes: 256 * 1024 * 1024, metadataBytes: 32768 });
export interface VideoDerivationIntent {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string;
  slotId: string; spoolId: string; rawSha256: string; rawByteLength: number;
  artifactId: string; requiredFrames: number; recipe: "generated-video-v1";
  normalization: MediaNormalizationIdentity;
}
export interface VideoDerivationReceipt {
  id: string; version: 1; projectId: string; attemptId: string; intentDigest: string; source: SuppliedMedia;
}
export interface NormalizedVideoIngestion {
  type: "normalized_video"; artifact: ArtifactRecord; derivation: VideoDerivationReceipt; mediaSource: GeneratedMediaSource;
}
export function videoDerivationId(projectId: string, attemptId: string): string {
  return digest({ version: 1, kind: "generated_video_derivation", slotId: digest({ projectId, attemptId, port: "video" }) });
}
export function videoArtifactId(derivationId: string): string { return digest({ version: 1, kind: "generated_video_artifact", derivationId }); }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown, min: number, max: number): boolean => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

export function assertVideoDerivationIntent(intent: VideoDerivationIntent, attempt: Attempt, output: IngestibleExecutionOutput): void {
  invariant(isSpoolOutput(output) && output.kind === "video" && output.port === "video" && output.mimeType === "video/mp4" && output.extension === "mp4"
    && intent?.version === 1 && intent.recipe === "generated-video-v1" && intent.projectId === attempt.projectId && intent.attemptId === attempt.id
    && intent.id === videoDerivationId(attempt.projectId, attempt.id) && intent.artifactId === videoArtifactId(intent.id)
    && intent.requestDigest === digest(attempt.request) && attempt.request.kind === "video"
    && intent.slotId === digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "video" })
    && intent.spoolId === output.storage.spoolId && intent.rawSha256 === output.sha256 && intent.rawByteLength === output.byteLength
    && integer(intent.rawByteLength, 1, VIDEO_DERIVATION_LIMITS.inputBytes)
    && integer(intent.requiredFrames, 1, 10800) && intent.requiredFrames === attempt.request.args.durationFrames,
  "VIDEO_DERIVATION_CONFLICT", "Video derivation does not match its exact admitted raw output and requested duration");
  const recipe = intent.normalization;
  invariant(recipe?.version === 1 && recipe.recipe === "silent-h264-30fps-v1" && hash(recipe.toolchainDigest)
    && integer(recipe.maxInputBytes, 1024, VIDEO_DERIVATION_LIMITS.inputBytes) && intent.rawByteLength <= recipe.maxInputBytes
    && integer(recipe.maxOutputBytes, 1024, VIDEO_DERIVATION_LIMITS.outputBytes)
    && integer(recipe.maxDurationFrames, intent.requiredFrames, 10800) && integer(recipe.timeoutMs, 50, 600000),
  "VIDEO_DERIVATION_CONFLICT", "Normalization recipe or limits differ from the supported derivation contract");
}

export function assertVideoDerivationReceipt(intent: VideoDerivationIntent, receipt: VideoDerivationReceipt, requireUsableFrames = true): void {
  const source = receipt?.source, video = source?.probe?.video;
  invariant(receipt?.version === 1 && receipt.id === intent.id && receipt.projectId === intent.projectId && receipt.attemptId === intent.attemptId
    && receipt.intentDigest === digest(intent) && source?.artifactId === intent.artifactId && source.kind === "video"
    && source.originalSha256 === intent.rawSha256 && source.originalByteLength === intent.rawByteLength
    && hash(source.sha256) && integer(source.byteLength, 1, intent.normalization.maxOutputBytes)
    && source.toolchainDigest === intent.normalization.toolchainDigest && video?.codec === "h264" && video.frameRate === "30/1" && video.streamIndex === 0
    && integer(video.frames, 1, intent.normalization.maxDurationFrames) && integer(video.width, 1, 4096) && integer(video.height, 1, 4096)
    && !source.probe.audio && Number.isFinite(source.probe.durationSeconds) && source.probe.durationSeconds > 0
    && Math.abs(source.probe.durationSeconds - video.frames / 30) <= 1 / 30 + 0.001
    && Number.isFinite(video.durationSeconds) && video.durationSeconds > 0
    && Math.abs(video.durationSeconds - video.frames / 30) <= 1 / 30 + 0.001,
  "VIDEO_DERIVATION_CONFLICT", "Normalized source differs from its pinned raw bytes, recipe, or measured media");
  const { id, ...body } = source;
  invariant(id === digest(body), "VIDEO_DERIVATION_CONFLICT", "Normalized source descriptor identity differs");
  if (requireUsableFrames) invariant(video.frames >= intent.requiredFrames, "VIDEO_TOO_SHORT", "Decoded video has fewer frames than the admitted shot requires");
}

export function assertNormalizedVideoIngestion(intent: VideoDerivationIntent, attempt: Attempt, output: IngestibleExecutionOutput, result: NormalizedVideoIngestion): void {
  assertVideoDerivationIntent(intent, attempt, output); assertVideoDerivationReceipt(intent, result.derivation);
  const record = result.artifact, source = result.derivation.source;
  invariant(result.type === "normalized_video" && record?.id === intent.artifactId && record.projectId === intent.projectId && record.attemptId === attempt.id
    && canonical(record.artifact) === canonical({ artifactId: intent.artifactId, kind: "video", sha256: source.sha256 })
    && record.mimeType === "video/mp4" && record.fixture === false && record.origin === "generated_video"
    && record.outputReceiptId === intent.spoolId && record.outputSpoolId === intent.spoolId
    && record.derivationId === intent.id && record.sourceDescriptorId === source.id && record.byteLength === source.byteLength
    && record.physicalDurationSeconds === source.probe.video!.frames / 30
    && canonical(result.mediaSource) === canonical({ id: intent.artifactId, projectId: intent.projectId, source,
      origin: "generated_video", attemptId: attempt.id, derivationId: intent.id }),
  "VIDEO_DERIVATION_CONFLICT", "Normalized artifact and generated media source lost their derivation provenance");
}
