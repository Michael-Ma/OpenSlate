import { digest, invariant } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { ArtifactRecord } from "../execution/engine.js";
import { assertImageReferenceRecords } from "../execution/codex-image-plan.js";
import type { LocalMediaService } from "../media/local-media.js";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";

export interface CodePlanImageReference { id: string; projectId: string; source: ArtifactRef; reference?: ArtifactRef; failed?: boolean }
export interface FilmUpload {
  name: string; artifact: ArtifactRef; width: number; height: number; byteLength: number;
  reduced?: true; imageReferences?: false;
}
function referenceFits(record: ArtifactRecord): boolean {
  try { assertImageReferenceRecords([record], "CODE_PLAN_INPUT"); return true; } catch { return false; }
}
/** Insertion order is upload order. Deduplicate before applying the bounded turn-context window. */
function originals(store: Store, projectId: string): ArtifactRecord[] {
  const seen = new Set<string>();
  return store.list<ArtifactRecord>("artifact", projectId).reverse().filter(record => {
    if (record.origin !== "supplied_image" || record.fixture !== false || record.artifact.kind !== "image" || seen.has(record.artifact.sha256)) return false;
    seen.add(record.artifact.sha256); return true;
  }).slice(0, 24);
}
export function codePlanUploads(store: Store, projectId: string): FilmUpload[] {
  return originals(store, projectId).map(source => {
    const row = store.get<CodePlanImageReference>("code_plan_image_reference", source.id);
    const reference = row?.projectId === projectId && row.source.artifactId === source.id && row.source.sha256 === source.artifact.sha256 && row.reference
      ? store.get<ArtifactRecord>("artifact", row.reference.artifactId) : undefined;
    const reduced = reference?.projectId === projectId && reference.artifact.kind === "image"
      && reference.artifact.sha256 === row?.reference?.sha256 && referenceFits(reference) ? reference : undefined;
    const record = reduced ?? source;
    return { name: source.name ?? "Uploaded picture", artifact: record.artifact,
      width: record.width ?? 0, height: record.height ?? 0, byteLength: record.byteLength ?? 0,
      ...(reduced ? { reduced: true as const } : {}), ...(!referenceFits(record) ? { imageReferences: false as const } : {}) };
  });
}

/** Free derived state. Contention/shutdown/quarantine retry next turn; other failures never block a conversation. */
export async function prepareCodePlanUploads(store: Store, media: LocalMediaService, artifactDir: string,
  projectId: string, signal: AbortSignal): Promise<void> {
  const recovery = new InstallationRecoveryGuard(store);
  for (const source of originals(store, projectId)) {
    if (signal.aborted || recovery.isQuarantined()) return;
    if (referenceFits(source) || store.get("code_plan_image_reference", source.id)) continue;
    try {
      recovery.assertWritable(projectId);
      const image = await media.reducedPicture({ path: source.path, sha256: source.artifact.sha256, artifactDir }, { signal });
      if (signal.aborted) return;
      recovery.assertWritable(projectId);
      const id = digest({ imageReference: source.id, sha256: image.sha256 });
      const artifact: ArtifactRecord = { id, projectId, artifact: { artifactId: id, kind: "image", sha256: image.sha256 },
        path: image.path, mimeType: image.mimeType, byteLength: image.byteLength, width: image.width, height: image.height,
        validationDigest: image.validationDigest, fixture: false, attemptId: null, physicalDurationSeconds: null };
      invariant(referenceFits(artifact), "MEDIA_OUTPUT_LIMIT", "Reduced picture exceeds image reference bounds");
      store.transaction(() => {
        store.put("artifact", id, projectId, artifact);
        store.put<CodePlanImageReference>("code_plan_image_reference", source.id, projectId,
          { id: source.id, projectId, source: source.artifact, reference: artifact.artifact });
      });
    } catch (error) {
      if (signal.aborted || recovery.isQuarantined() || (error as { code?: string }).code === "MEDIA_BUSY") continue;
      store.put<CodePlanImageReference>("code_plan_image_reference", source.id, projectId,
        { id: source.id, projectId, source: source.artifact, failed: true });
    }
  }
}
