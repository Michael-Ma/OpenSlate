import type { MediaSlot } from "@openslate/core/public";
import { msg, type Msg } from "./types.ts";

type Progress = Pick<MediaSlot, "state" | "waiting" | "failure">;

/** A failed candidate still owned by technical retries cannot be replaced by a fresh paid request. */
export function pendingAutomaticRetry(slot: Pick<MediaSlot, "state" | "failure" | "replacement">): NonNullable<MediaSlot["failure"]> | null {
  return [slot, ...(slot.replacement ? [slot.replacement] : [])]
    .find((candidate) => candidate.state === "failed" && candidate.failure?.technical && candidate.failure.autoRetriesLeft > 0)?.failure ?? null;
}

/** Only a recognized execution wait or a proven automatic retry is work queued to run. */
export function queuedToRun(slot: Progress): boolean {
  if (slot.state !== "queued") return false;
  const code = slot.waiting?.code;
  if (code === "review" || code === "stopped" || code === "unknown" || code === "timing" || code === "input_pending") return false;
  // A downstream candidate waiting for an absent/failed input cannot run until that input is repaired.
  return (slot.failure?.autoRetriesLeft ?? 0) > 0 || !!code && ["capacity", "edit_pending", "voice"].includes(code);
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
