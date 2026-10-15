import type { Entry } from "./entry.ts";

/** Server and client error codes. Unknown codes fall back to error.unknown with the code shown. */
export const errors = {
  "error.unknown": { en: "Something went wrong ({code}).", zh: "出错了（{code}）。" },
  "error.NETWORK_ERROR": { en: "The studio did not answer. Check that it is still running.", zh: "工作室没有响应，请确认它仍在运行。" },
  "error.AUTH_REQUIRED": { en: "This window is no longer connected. Open a fresh studio link.", zh: "这个窗口已断开连接，请打开新的工作室链接。" },
  "error.REVISION_CONFLICT": { en: "The film changed while you were editing. Your edit was not saved; try again.", zh: "你编辑时影片已经变化，这次修改没有保存，请重试。" },
  "error.IDEMPOTENCY_CONFLICT": { en: "This press was already used for a different request. Try again.", zh: "这次操作已用于另一个请求，请重试。" },
  "error.FRAME_STALE": { en: "This keyframe was replaced. Open the new one.", zh: "这张关键帧已被替换，请查看新的。" },
  "error.EXECUTION_PAUSED": { en: "The film is stopped. Continue first.", zh: "影片已停止，请先继续。" },
  "error.ESTIMATE_CHANGED": { en: "The price changed. Check the new price and press again.", zh: "价格变了，请确认新价格后再按一次。" },
  "error.SCENE_EMPTY": { en: "This scene has no shots yet.", zh: "这一场还没有镜头。" },
  "error.DIRECTION_REQUIRED": { en: "Some shots need a picture description first.", zh: "有镜头需要先写好画面描述。" },
  "error.SHOT_SHORTER_THAN_NARRATION": { en: "The shot would be shorter than its narration. Make it longer or cut the line.", zh: "镜头会比旁白短。请加长镜头或截短旁白。" },
  "error.SCENE_REVIEW_STALE": { en: "The scene changed since you looked. Check it again.", zh: "你查看后这一场有变化，请再看一遍。" },
  "error.WAITING_USER": { en: "The Director is waiting for an answer about this scene.", zh: "导演在等你回答这一场的问题。" },
  "error.ATTEMPT_NOT_RELEASABLE": { en: "This job can no longer be given up.", zh: "这个任务已无法放弃。" },
  "error.ARTIFACT_CHANGED": { en: "The picture did not match its record and was not shown.", zh: "画面与记录不一致，没有显示。" },
  "error.VALIDATION_ERROR": { en: "That value is not allowed here.", zh: "这里不允许这个值。" },
  "error.HUMAN_EDITED_FIELD": { en: "You changed this after the Director started; your edit was kept.", zh: "导演开始后你改过这里，已保留你的修改。" },
} satisfies Record<string, Entry>;
