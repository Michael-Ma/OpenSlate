import type { ProjectSnapshot } from "./model.ts";
import { projectResults } from "./project-results-model.ts";
import type { ResultShot } from "./project-results-model.ts";

export type TimelineCommand = Record<string, unknown>;
export interface TimelineEditorClip {
  result: ResultShot;
  startFrame: number;
  endFrame: number;
  sceneId: string;
  sceneLabel: string;
}
/** Timeline follows saved Scene → Shot order, including orphaned saved shots. */
export function timelineEditor(snapshot: ProjectSnapshot) {
  const scenes = projectResults(snapshot).scenes;
  let frame = 0;
  const clips: TimelineEditorClip[] = [];
  const groups = scenes.map((scene) => {
    const startFrame = frame;
    for (const result of scene.shots) {
      const startFrame = frame;
      frame += Math.max(0, result.shot.desiredFrames);
      clips.push({
        result,
        startFrame,
        endFrame: frame,
        sceneId: scene.id,
        sceneLabel: scene.unassigned ? "未分组" : `Scene ${scene.label}`,
      });
    }
    return {
      id: scene.id,
      label: scene.unassigned ? "未分组" : `Scene ${scene.label}`,
      purpose: scene.purpose,
      startFrame,
      endFrame: frame,
    };
  });
  return { clips, groups, totalFrames: frame };
}
export function timelineMoveCommand(
  snapshot: ProjectSnapshot,
  id: string,
  targetId: string,
  edge: "before" | "after",
  expectedHeadVersion: number,
): TimelineCommand | null {
  if (expectedHeadVersion !== snapshot.project.headVersion || id === targetId)
    return null;
  const shot = snapshot.project.shots.find((shot) => shot.id === id),
    target = snapshot.project.shots.find((shot) => shot.id === targetId);
  if (
    !shot ||
    !target ||
    !snapshot.project.scenes.some((scene) => scene.id === target.sceneId)
  )
    return null;
  const before = snapshot.project.shots
    .filter((shot) => shot.sceneId === target.sceneId)
    .map((shot) => shot.id);
  const after = before.filter((shotId) => shotId !== id);
  const targetIndex = after.indexOf(targetId),
    insert = targetIndex + (edge === "after" ? 1 : 0);
  const beforeId = after[insert];
  after.splice(insert, 0, id);
  if (shot.sceneId === target.sceneId && before.join("\0") === after.join("\0"))
    return null;
  return {
    kind: "moveShot",
    id,
    sceneId: target.sceneId,
    ...(beforeId ? { beforeId } : {}),
    expectedHeadVersion,
  };
}
/** Arrow actions change order within the current scene; crossing scenes is an explicit drag. */
export function timelineNudgeCommand(
  snapshot: ProjectSnapshot,
  id: string,
  direction: -1 | 1,
): TimelineCommand | null {
  const shot = snapshot.project.shots.find((shot) => shot.id === id);
  if (!shot) return null;
  const peers = snapshot.project.shots.filter(
      (peer) => peer.sceneId === shot.sceneId,
    ),
    index = peers.findIndex((peer) => peer.id === id),
    target = peers[index + direction];
  return target
    ? timelineMoveCommand(
        snapshot,
        id,
        target.id,
        direction < 0 ? "before" : "after",
        snapshot.project.headVersion,
      )
    : null;
}
export function timelineDurationFrames(text: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(text.trim())) return null;
  const seconds = Number(text);
  return Number.isFinite(seconds) && seconds >= 3 && seconds <= 15
    ? Math.round(seconds * 30)
    : null;
}
export function timelineDurationCommand(
  snapshot: ProjectSnapshot,
  id: string,
  text: string,
  expectedHeadVersion: number,
): TimelineCommand | null {
  const frames = timelineDurationFrames(text),
    shot = snapshot.project.shots.find((shot) => shot.id === id);
  if (
    expectedHeadVersion !== snapshot.project.headVersion ||
    !shot ||
    frames === null ||
    shot.desiredFrames === frames
  )
    return null;
  return {
    kind: "shot",
    id,
    field: "desiredFrames",
    value: String(frames),
    expectedHeadVersion,
  };
}
export function timelineMusicStart(
  currentFrame: number,
  deltaPixels: number,
  trackWidth: number,
  totalFrames: number,
): number {
  if (
    ![currentFrame, deltaPixels, trackWidth, totalFrames].every(
      Number.isFinite,
    ) ||
    trackWidth <= 0 ||
    totalFrames <= 0
  )
    return 0;
  return Math.max(
    0,
    Math.min(
      totalFrames - 1,
      Math.round(currentFrame + (deltaPixels / trackWidth) * totalFrames),
    ),
  );
}
export function timelineMusicCommand(
  snapshot: ProjectSnapshot,
  field: "startFrame" | "gainMilliDb" | "muted",
  value: number | boolean,
  expectedHeadVersion: number,
): TimelineCommand | null {
  if (
    snapshot.project.headVersion !== expectedHeadVersion ||
    !snapshot.project.soundtrack
  )
    return null;
  const soundtrack = snapshot.project.soundtrack as NonNullable<
    ProjectSnapshot["project"]["soundtrack"]
  > & { startFrame?: number; muted?: boolean };
  if (field === "muted") {
    if (typeof value !== "boolean" || value === (soundtrack.muted ?? false))
      return null;
  } else {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
    if (
      field === "gainMilliDb" &&
      (value < -60000 || value > 0 || value === soundtrack.gainMilliDb)
    )
      return null;
    if (
      field === "startFrame" &&
      (value < 0 ||
        value >=
          snapshot.project.shots.reduce(
            (total, shot) => total + shot.desiredFrames,
            0,
          ) ||
        value === (soundtrack.startFrame ?? 0))
    )
      return null;
  }
  return {
    kind: "soundtrack",
    field,
    value: String(value),
    expectedHeadVersion,
  };
}
export function timelineMusicSpan(
  startFrame: number,
  sourceFrames: number | null,
  totalFrames: number,
): { left: number; width: number | null } {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0)
    return { left: 0, width: null };
  const left = Math.max(0, Math.min(totalFrames, startFrame));
  return {
    left: (left / totalFrames) * 100,
    width:
      sourceFrames === null ||
      !Number.isFinite(sourceFrames) ||
      sourceFrames <= 0
        ? null
        : (Math.max(0, Math.min(sourceFrames, totalFrames - left)) /
            totalFrames) *
          100,
  };
}
