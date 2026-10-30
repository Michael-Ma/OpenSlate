import { digest, invariant } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { ArtifactRecord } from "../execution/engine.js";
import type { LocalMediaService } from "../media/local-media.js";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";

export interface CodePlanPoster { id: string; projectId: string; source: ArtifactRef; poster?: ArtifactRef; failed?: boolean }

/** Independent derived state: no step, attempt, submission, provider call or liability. */
export async function makeCodePlanPoster(store: Store, media: LocalMediaService, artifactDir: string,
  projectId: string, ref: ArtifactRef, signal: AbortSignal): Promise<void> {
  if (signal.aborted || store.get("code_plan_poster", ref.artifactId)) return;
  const recovery = new InstallationRecoveryGuard(store);
  try {
    recovery.assertWritable(projectId);
    const source = store.get<ArtifactRecord>("artifact", ref.artifactId);
    invariant(source?.projectId === projectId && source.artifact.kind === "video" && source.artifact.sha256 === ref.sha256,
      "CODE_PLAN_ARTIFACT_INVALID", "A poster requires an owned video artifact");
    const image = await media.poster({ path: source.path, sha256: ref.sha256, artifactDir }, { signal });
    if (signal.aborted) return;
    recovery.assertWritable(projectId);
    const id = digest({ poster: ref.artifactId, sha256: image.sha256 });
    const artifact: ArtifactRecord = { id, projectId, artifact: { artifactId: id, kind: "image", sha256: image.sha256 },
      path: image.path, mimeType: image.mimeType, byteLength: image.byteLength, width: image.width, height: image.height,
      validationDigest: image.validationDigest, fixture: source.fixture, attemptId: null, physicalDurationSeconds: null };
    store.transaction(() => {
      store.put("artifact", id, projectId, artifact);
      store.put<CodePlanPoster>("code_plan_poster", ref.artifactId, projectId, { id: ref.artifactId, projectId, source: ref, poster: artifact.artifact });
    });
  } catch (error) {
    // Worker contention and shutdown are temporary. Other failures are durable so a
    // broken old clip cannot monopolize every backfill tick. Never fail its media step.
    if (signal.aborted || recovery.isQuarantined() || (error as { code?: string }).code === "MEDIA_BUSY") return;
    store.put<CodePlanPoster>("code_plan_poster", ref.artifactId, projectId, { id: ref.artifactId, projectId, source: ref, failed: true });
  }
}
