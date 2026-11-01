import { invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { CODEX_IMAGE_LIMITS, CODEX_IMAGE_V2_CANVASES } from "@openslate/providers";
import type { CodexImageAspect } from "@openslate/providers";
import type { ArtifactRecord } from "./engine.js";

export const imageAspectRatios = ["1:1", "2:3", "3:2", "9:16", "16:9"] as const;
/** The native turn supports three canvas preferences. Tall/wide film ratios use its nearest canvas. */
export function codexImageCanvas(ratio: string) {
  const aspect: CodexImageAspect = ratio === "2:3" || ratio === "9:16" ? "9:16" : ratio === "3:2" || ratio === "16:9" ? "16:9" : "1:1";
  invariant((imageAspectRatios as readonly string[]).includes(ratio), "CODE_PLAN_INPUT", `Use an image aspectRatio of ${imageAspectRatios.join(", ")}`);
  return { ...CODEX_IMAGE_V2_CANVASES[aspect], aspect };
}

export function imageCapabilities(profile?: ProviderProfile): { imageAspectRatios: string[]; maxReferences: number } {
  if (!profile || profile.adapter === "codex-image") return { imageAspectRatios: [...imageAspectRatios], maxReferences: CODEX_IMAGE_LIMITS.references };
  const settings = profile.configuration?.settings;
  // API image execution pins the installed canvas, including its result/receipt checks.
  const ratios = imageAspectRatios.filter(ratio => {
    const [w, h] = ratio.split(":").map(Number);
    return Number(settings?.width) * h! === Number(settings?.height) * w!;
  });
  return { imageAspectRatios: ratios, maxReferences: profile.adapter === "openai-image" ? CODEX_IMAGE_LIMITS.references : 0 };
}

export function assertImageReferences(references: unknown, profile?: ProviderProfile): asserts references is Record<string, unknown>[] | undefined {
  invariant(references === undefined || Array.isArray(references), "CODE_PLAN_INPUT", "Use references: [ownedImageArtifact, ...] for images");
  const maximum = imageCapabilities(profile).maxReferences;
  invariant(!references || references.length <= maximum, "CODE_PLAN_INPUT", `Use at most ${maximum} reference images for ${profile?.id ?? "this image model"}`);
  for (const ref of references ?? []) invariant(ref && typeof ref === "object" && !Array.isArray(ref) && ref.kind === "image"
    && typeof ref.sha256 === "string" && /^[a-f0-9]{64}$/.test(ref.sha256), "CODE_PLAN_INPUT", "Replace image references with owned PNG image artifacts; video/audio artifacts cannot condition an image");
}

/** Shared with dispatch admission. The provider's exported limits are the single byte/size authority. */
export function assertImageReferenceRecords(records: readonly ArtifactRecord[], code: string): void {
  invariant(records.length <= CODEX_IMAGE_LIMITS.references, code, `Use at most ${CODEX_IMAGE_LIMITS.references} reference images`);
  let total = 0;
  for (const record of records) {
    invariant(record.artifact.kind === "image" && record.fixture === false && record.mimeType === "image/png"
      && /^[a-f0-9]{64}$/.test(record.validationDigest ?? "") && Number.isSafeInteger(record.byteLength)
      && record.byteLength! >= 33 && record.byteLength! <= CODEX_IMAGE_LIMITS.referenceBytes
      && [record.width, record.height].every(size => Number.isSafeInteger(size) && size! > 0 && size! <= CODEX_IMAGE_LIMITS.dimension),
    code, `Use validated PNG references, each at most ${CODEX_IMAGE_LIMITS.referenceBytes / 1024 ** 2} MiB and ${CODEX_IMAGE_LIMITS.dimension}px per side`);
    total += record.byteLength!;
  }
  invariant(total <= CODEX_IMAGE_LIMITS.totalReferenceBytes, code, `Reduce PNG references to at most ${CODEX_IMAGE_LIMITS.totalReferenceBytes / 1024 ** 2} MiB in total`);
}
