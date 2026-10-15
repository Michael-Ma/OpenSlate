import type { Entry } from "./entry.ts";

/** Director column: thread, notes, composer, modes. */
export const director = {
  "director.title": { en: "Director", zh: "导演" },
  "director.you": { en: "You", zh: "你" },
  "director.byline": { en: "{who} · {time}", zh: "{who} · {time}" },
  "director.working": { en: "Working…", zh: "正在处理…" },
  "director.waiting": { en: "Waiting for your answer", zh: "等待你的回答" },
  "director.idle": { en: "Ready", zh: "就绪" },
  "director.offline": { en: "The Director is not connected. Set it up in the classic studio's model settings.", zh: "导演未连接。请在经典界面的模型设置中配置。" },
  "director.mode.fake": { en: "Scripted Director: replies are canned and nothing in the film changes.", zh: "示例导演：回复是预设的，不会改动影片。" },
  "director.mode.native": { en: "Codex Director", zh: "Codex 导演" },
  "director.error": { en: "The Director stopped with an error. Send a message to try again.", zh: "导演出错停止了。发送一条消息重试。" },
  "director.empty": { en: "Tell the Director what to change. Point at a scene or shot with @.", zh: "告诉导演要改什么。用 @ 指向某一场或某个镜头。" },
  "director.composer.placeholder": { en: "Reply to the Director…", zh: "回复导演…" },
  "director.composer.hint": { en: "@ a scene or shot to point at it", zh: "用 @ 指向某一场或某个镜头" },
  "director.composer.send": { en: "Send", zh: "发送" },
  "director.composer.pick": { en: "Point at a scene or shot", zh: "指向某一场或某个镜头" },
  "director.composer.remove": { en: "Remove {target}", zh: "移除 {target}" },
  "director.composer.too_long": { en: "Keep the message under 16,000 characters.", zh: "消息请少于 16,000 个字符。" },
  "director.target.scene": { en: "Scene {scene}", zh: "第 {scene} 场" },
  "director.target.shot": { en: "{shot}", zh: "{shot}" },
  "director.question.answer": { en: "Answer", zh: "回答" },
  "director.question.other": { en: "Or write your own answer", zh: "或者自己写回答" },
} satisfies Record<string, Entry>;
