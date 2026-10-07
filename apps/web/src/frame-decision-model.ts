import type { DirectorStatus, ProjectSnapshot } from "./model.ts";
import type { ConversationSceneView } from "./conversation-actions-model.ts";
import type { PendingCommand } from "./pending-command.ts";
export interface FrameRequest {
  sceneId: string;
  targetShotIds?: string[];
  regenerate?: boolean;
}
export function scopedFrameCommand(
  view: ConversationSceneView,
  snapshot: ProjectSnapshot,
  director: DirectorStatus,
  request: FrameRequest,
  key: string,
  disabled = false,
): PendingCommand {
  const project = snapshot.project;
  if (
    disabled ||
    snapshot.control?.paused ||
    view.paused ||
    view.busy ||
    ["running", "waiting_user"].includes(director.status) ||
    snapshot.questions?.some(
      (q) => q.state === "pending" && q.canAnswer !== false,
    )
  )
    throw Error("先完成当前请求或问题，再生成关键帧。");
  if (
    view.projectId !== project.id ||
    view.sceneId !== request.sceneId ||
    view.headVersion !== project.headVersion ||
    view.revisionId !== project.revisionId ||
    !project.scenes.some((s) => s.id === request.sceneId)
  )
    throw Error("场景已更新，请重新检查。");
  const expected = project.shots
    .filter((s) => s.sceneId === request.sceneId)
    .map((s) => s.id);
  if (
    view.rows.length !== expected.length ||
    view.rows.some((r, i) => r.shotId !== expected[i])
  )
    throw Error("镜头列表已更新，请重新检查。");
  const ids = request.targetShotIds;
  if (
    ids &&
    (!ids.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !expected.includes(id)))
  )
    throw Error("请选择当前场景里的镜头。");
  if (request.regenerate && !ids?.length)
    throw Error("重新生成需要明确的镜头范围。");
  const rows = view.rows.filter(
    (r) =>
      (!ids || ids.includes(r.shotId)) &&
      (request.regenerate || !r.imageComplete),
  );
  if (!rows.length) throw Error("当前关键帧已保存。");
  if (
    rows.some(
      (r) =>
        r.imagePending ||
        r.videoPending ||
        r.blockedCode === "SUBMISSION_UNKNOWN",
    )
  )
    throw Error("请先核对这些镜头已有任务的结果。");
  if (!key) throw Error("请求需要恢复标识。");
  return {
    path: `/api/projects/${encodeURIComponent(project.id)}/scenes/${encodeURIComponent(request.sceneId)}/generate`,
    key,
    body: {
      headVersion: view.headVersion,
      revisionId: view.revisionId,
      kind: "image",
      reviewedFrames: [],
      reviewedControlAuthorityId: view.reviewedControlAuthorityId,
      reviewedHoldDigest: view.reviewedHoldDigest,
      ...(ids ? { targetShotIds: [...ids] } : {}),
      ...(request.regenerate ? { regenerate: true } : {}),
    },
    metadata: {
      sceneId: request.sceneId,
      kind: "image",
      revisionId: view.revisionId,
    },
  };
}
