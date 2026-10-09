import type { Artifact, ArtifactFixture, ProjectSnapshot } from "./model.ts";
import { frameExposureIdentity } from "./project-results-model.ts";
import type {
  ResultScene,
  ResultShot,
  SceneFrameExposure,
} from "./project-results-model.ts";

export type FrameView = "plan" | "frames";
export interface FrameHistoryEntry {
  artifact: Artifact;
  fixture: ArtifactFixture;
  label: string;
}
export interface FrameSelection {
  result: ResultShot;
  scene: ResultScene;
  index: number;
  count: number;
}

/** Stable shot IDs, rather than shelf positions, own the selected result. */
export function frameSelection(
  scenes: readonly ResultScene[],
  selectedShotId: string | null,
): FrameSelection | null {
  const all = scenes.flatMap((scene) =>
    scene.shots.map((result) => ({ result, scene })),
  );
  const index = Math.max(
    0,
    all.findIndex((item) => item.result.shot.id === selectedShotId),
  );
  const selected = all[index];
  return selected ? { ...selected, index, count: all.length } : null;
}

export function adjacentFrameShot(
  scenes: readonly ResultScene[],
  selectedShotId: string | null,
  offset: -1 | 1,
): string | null {
  const selection = frameSelection(scenes, selectedShotId);
  if (!selection) return null;
  return (
    scenes.flatMap((scene) => scene.shots)[selection.index + offset]?.shot.id ??
    null
  );
}

export function currentFrameExposures(
  snapshot: ProjectSnapshot,
  scenes: readonly ResultScene[],
): SceneFrameExposure[] {
  return scenes.flatMap((scene) =>
    scene.shots
      .filter((result) => result.keyframe.current && result.keyframe.artifact)
      .map((result) => ({
        projectId: snapshot.project.id,
        projectRevisionId: snapshot.project.revisionId,
        shotId: result.shot.id,
        artifactId: result.keyframe.artifact!.artifactId,
        sha256: result.keyframe.artifact!.sha256,
        displayed: true,
      })),
  );
}

/** Revocation follows authoritative identity changes, never navigation or theme. */
export function revokedFrameExposures(
  seen: ReadonlyMap<string, SceneFrameExposure>,
  current: readonly SceneFrameExposure[],
): SceneFrameExposure[] {
  const valid = new Set(current.map(frameExposureIdentity));
  return [...seen.entries()]
    .filter(([identity]) => !valid.has(identity))
    .map(([, exposure]) => ({ ...exposure, displayed: false }));
}

export function canExposeFrame(
  exposure: SceneFrameExposure | null,
  current: readonly SceneFrameExposure[],
  visibility: { active: boolean; visible: boolean; decoded: boolean },
): boolean {
  return (
    !!exposure &&
    visibility.active &&
    visibility.visible &&
    visibility.decoded &&
    current.some(
      (frame) =>
        frameExposureIdentity(frame) === frameExposureIdentity(exposure),
    )
  );
}

/** A history comparison is read-only. Unconfirmed or current attempts never become earlier takes. */
export function frameHistory(
  snapshot: ProjectSnapshot,
  result: ResultShot,
): FrameHistoryEntry[] {
  if (!result.keyframe.nodeId) return [];
  const nodeId = result.keyframe.nodeId,
    current = result.keyframe.artifact;
  const same = (artifact: Artifact) =>
    artifact.artifactId === current?.artifactId &&
    artifact.sha256 === current?.sha256;
  const entries: FrameHistoryEntry[] = [],
    seen = new Set<string>();
  const add = (artifact: Artifact, fixture: ArtifactFixture) => {
    const identity = JSON.stringify([artifact.artifactId, artifact.sha256]);
    if (artifact.kind !== "image" || same(artifact) || seen.has(identity))
      return;
    seen.add(identity);
    entries.push({ artifact, fixture, label: "之前的关键帧" });
  };
  for (const previous of snapshot.previousPreviews ?? [])
    if (previous.nodeId === nodeId)
      add(previous.artifact, previous.fixture ?? null);
  if (snapshot.currentAttemptIds !== undefined) {
    const currentAttempts = new Set(snapshot.currentAttemptIds);
    for (const attempt of [...snapshot.attempts].reverse()) {
      if (
        attempt.nodeId !== nodeId ||
        currentAttempts.has(attempt.id) ||
        attempt.phase !== "succeeded" ||
        attempt.request?.kind !== "image"
      )
        continue;
      for (const artifact of Object.values(attempt.outputs ?? {}))
        add(artifact, null);
    }
  }
  return entries;
}
