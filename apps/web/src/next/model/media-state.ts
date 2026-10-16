import type { MediaSlot } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

type Progress = Pick<MediaSlot, "state" | "waiting" | "failure">;

/** Only a recognized execution wait or a proven automatic retry is work queued to run. */
export function queuedToRun(slot: Progress): boolean {
  if (slot.state !== "queued") return false;
  const code = slot.waiting?.code;
  if (code === "review" || code === "stopped" || code === "unknown" || code === "timing") return false;
  return (slot.failure?.autoRetriesLeft ?? 0) > 0 || !!code && ["capacity", "edit_pending", "input_pending", "voice"].includes(code);
}

/** An unclassified queue is neither proof of running work nor a request for the person's confirm. */
export function awaitingStudioStatus(slot: Progress): boolean {
  return slot.state === "queued" && !queuedToRun(slot) && (!slot.waiting || slot.waiting.code === "unknown");
}

/** Wait codes stay words in every view, including a neutral fallback for an unclassified queue. */
export function waitingMsg(slot: Pick<MediaSlot, "waiting" | "failure">): Msg {
  const code = slot.waiting?.code;
  if (code === "capacity") return msg("media.waiting.capacity", { ahead: slot.waiting?.ahead ?? 0 });
  if (code) return msg(`media.waiting.${code}`);
  return msg((slot.failure?.autoRetriesLeft ?? 0) > 0 ? "media.waiting.queued" : "media.waiting.unknown");
}
