import type { GenerationOverview, MediaSlot, ShotOverview } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

/**
 * "Needs attention" in the top bar (design study docs/ai/prototypes/failure-display, item 3): every job in the film
 * that failed for good or is waiting for the service's answer, so the person need not hunt shot by shot. Failures
 * with automatic retries left resolve themselves and stay out; so do outdated media and the Director's notes, which
 * the banner and the thread already carry. An item leaves when its slot does.
 */
export type AttentionGroup = "waiting" | "failed";

export interface AttentionItem {
  key: string;
  group: AttentionGroup;
  shotId: string;
  sceneId: string;
  label: string;
  title: Msg;
  detail: Msg;
}

type Media = "keyframe" | "video" | "voice";

function slotItem(shot: ShotOverview, media: Exclude<Media, "voice">, slot: MediaSlot): AttentionItem | null {
  const live = slot.replacement ?? slot;
  const base = { shotId: shot.shotId, sceneId: shot.sceneId, label: shot.label };
  if (live.state === "no_answer") return { ...base, key: `${shot.shotId}:${media}`, group: "waiting",
    title: msg(`attention.${media}.no_answer`, { shot: shot.label }), detail: msg("attention.no_answer.detail") };
  if (live.state === "failed" && (live.failure?.autoRetriesLeft ?? 0) === 0) return { ...base, key: `${shot.shotId}:${media}`, group: "failed",
    title: msg(`attention.${media}.failed`, { shot: shot.label }),
    detail: msg(live.failure?.charged ? "attention.failed.detail_charged" : "attention.failed.detail") };
  return null;
}

export function attentionItems(overview: GenerationOverview | null): AttentionItem[] {
  if (!overview) return [];
  const items: AttentionItem[] = [];
  for (const scene of overview.scenes) {
    for (const shotId of scene.shotIds) {
      const shot = overview.shots[shotId];
      if (!shot) continue;
      for (const item of [slotItem(shot, "keyframe", shot.keyframe), slotItem(shot, "video", shot.video)]) if (item) items.push(item);
      const voice = shot.narration.state;
      if (voice === "failed" || voice === "no_answer") items.push({ key: `${shot.shotId}:voice`, group: voice === "failed" ? "failed" : "waiting",
        shotId, sceneId: shot.sceneId, label: shot.label,
        title: msg(voice === "failed" ? "attention.voice.failed" : "attention.voice.no_answer", { shot: shot.label }),
        detail: msg(voice === "failed" ? "attention.voice.failed_detail" : "attention.no_answer.detail") });
    }
  }
  // Waiting first: it holds its scene back until the person decides.
  return [...items.filter((item) => item.group === "waiting"), ...items.filter((item) => item.group === "failed")];
}
