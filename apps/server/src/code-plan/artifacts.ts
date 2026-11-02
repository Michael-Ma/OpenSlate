import type { ArtifactRef } from "@openslate/core";
import type { StudioArtifactRef } from "@openslate/core/public";
import type { ArtifactRecord } from "../execution/engine.js";
import type { Store } from "../persistence/store.js";
import type { CodePlanImageReference } from "./uploads.js";
import type { CodePlanPoster } from "./posters.js";

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
export const pictureSize = (record: ArtifactRecord | undefined): { width?: number; height?: number } => ({
  ...(positive(record?.width) ? { width: record.width } : {}), ...(positive(record?.height) ? { height: record.height } : {}),
});
export function publicArtifact(ref: ArtifactRef): StudioArtifactRef {
  return { artifactId: ref.artifactId, sha256: ref.sha256, kind: ref.kind as StudioArtifactRef["kind"] };
}

/** Normalized inputs retain content identity, not artifact ids. Resolve only inside this film. */
export function codePlanArtifacts(store: Store, projectId: string) {
  const records = store.list<ArtifactRecord>("artifact", projectId);
  const byId = new Map(records.map(record => [record.id, record]));
  const byContent = new Map(records.map(record => [`${record.artifact.kind}:${record.artifact.sha256}`, record]));
  const find = (value: unknown): ArtifactRecord | undefined => {
    const ref = object(value), record = typeof ref.artifactId === "string" ? byId.get(ref.artifactId)
      : byContent.get(`${String(ref.kind)}:${String(ref.sha256)}`);
    return record?.projectId === projectId && record.artifact.kind === ref.kind && record.artifact.sha256 === ref.sha256 ? record : undefined;
  };
  const rows = store.list<CodePlanPoster>("code_plan_poster", projectId);
  const posters = new Map(rows.flatMap(row => {
    const source = find(row.source), poster = find(row.poster);
    return source && poster?.artifact.kind === "image" ? [[source.id, poster] as const] : [];
  }));
  const imageReferences = new Map(store.list<CodePlanImageReference>("code_plan_image_reference", projectId).flatMap(row => {
    const source = find(row.source), reference = find(row.reference);
    return source && reference?.artifact.kind === "image" ? [[source.id, reference] as const] : [];
  }));
  return { records, find, posters, imageReferences, referenceIds: new Set([...imageReferences.values()].map(record => record.id)), posterIds: new Set(rows.flatMap(row => row.poster ? [row.poster.artifactId] : [])) };
}

/** Measured output only; requested dimensions never stand in for a returned file. */
export function codePlanOutput(media: ReturnType<typeof codePlanArtifacts>, ref: ArtifactRef | undefined) {
  const artifact = ref ? media.find(ref) : undefined;
  return artifact ? { ...pictureSize(artifact.artifact.kind === "image" ? artifact : media.posters.get(artifact.id)),
    ...(positive(artifact.physicalDurationSeconds) ? { durationSeconds: artifact.physicalDurationSeconds } : {}) } : undefined;
}
