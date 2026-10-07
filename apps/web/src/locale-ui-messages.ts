import { shellUiTranslations } from "./shell-ui-messages.ts";
import { errorUiTranslations } from "./locale-errors.ts";
import type { UiTranslations } from "./locale-model";
/** Shared interface labels only. User/model-authored content is never passed through this catalog. */
export const commonUiTranslations: UiTranslations = {
  ...shellUiTranslations,
  ...errorUiTranslations,
  Close: "关闭",
  "Close dialog": "关闭对话框",
  Cancel: "取消",
  Save: "保存",
  "Saving…": "保存中…",
  Done: "完成",
  Refresh: "刷新",
  Retry: "重试",
  "Loading…": "加载中…",
  Image: "图像",
  Video: "视频",
  Audio: "音频",
  Keyframe: "关键帧",
  Keyframes: "关键帧",
  Narration: "旁白",
  Director: "导演",
  Timeline: "时间线",
  Assets: "素材",
  Plan: "计划",
  Prompt: "提示词",
  None: "无",
  Unknown: "未知",
  Saved: "已保存",
  Ready: "就绪",
  Pending: "待处理",
  Approved: "已批准",
  Current: "当前",
  Earlier: "较早",
  Working: "进行中",
  Failed: "失败",
  Stopped: "已停止",
  Completed: "已完成",
  "Not started": "未开始",
  "Not connected": "未连接",
  Unavailable: "不可用",
  "No narration": "无旁白",
  "Generated voice": "生成语音",
  "Owned recording": "已有录音",
  "Stock voice": "预设声音",
  "Personal voice": "个人声音",
  image: "图像",
  video: "视频",
  audio: "音频",
  data: "数据",
  pending: "待处理",
  active: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  superseded: "已替代",
  preparing: "准备中",
  submitting: "提交中",
  remote_pending: "生成中",
  ingesting: "保存中",
  succeeded: "已完成",
  submission_unknown: "提交结果待确认",
  "The action could not be completed.": "无法完成此操作。",
  "The local server could not complete that action. Refresh and try again.":
    "本地服务无法完成此操作，请刷新后重试。",
  "Open a connected window from the OpenSlate launcher with pnpm studio.":
    "请使用 pnpm studio 从 OpenSlate 启动器打开已连接的窗口。",
  "This studio link has expired or was already used. Run pnpm studio to open a fresh window.":
    "此工作区链接已过期或已使用，请运行 pnpm studio 打开新窗口。",
  "Your studio session changed. Reload this page to reconnect.":
    "工作区会话已变化，请重新加载页面以连接。",
  "This project changed while you were working. Refresh to continue with its latest state.":
    "项目在操作期间已更新，请刷新后继续。",
  "That item is no longer available. Refresh the project.":
    "此项目内容已不可用，请刷新项目。",
  "This scene changed. Review its refreshed frames and direction.":
    "场景已变化，请检查更新后的画面与方向。",
  "These frames have changed. Refresh the storyboard and review the new version.":
    "画面已变化，请刷新分镜并检查新版本。",
  "The video is waiting for approval of its exact keyframe and motion plan.":
    "视频正在等待关键帧和运动计划的确认。",
  "The review no longer matches the current shot. Refresh before approving.":
    "检查方案与当前镜头不一致，请刷新后再确认。",
  "Use the scene controls to request this media from the current plan.":
    "请通过场景操作生成当前计划中的媒体。",
  "A newer request replaced this action. Refresh to continue.":
    "新请求已替代此操作，请刷新后继续。",
  "Finish the restored installation review before making changes.":
    "请先完成恢复后的安装检查，再进行修改。",
  "The recovery state changed. Refresh and review it again.":
    "恢复状态已变化，请刷新后重新检查。",
};
