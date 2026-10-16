import type { GenerationOverview, SceneOverview } from "@openslate/core/public";

/**
 * The request identity of the Keyframes view's paid presses (plan items GR-8, WA-7). The store sends them with
 * these ids and logical identities, and the view asks the store with the same ones whether pressing now would resend
 * a saved request whose reply was lost (same Idempotency-Key, so the studio replays it and never charges twice).
 *
 * Each identity also names what the studio last did for it: the scene's latest confirmation for a confirm, and each
 * target's latest keyframe job for making keyframes. A request that landed shows up there (a new confirmation; a
 * keyframe queued, running, made, failed or taken off), so once the film shows the job, pressing again is a new
 * request: a stopped confirm can be confirmed again, a failed keyframe made again, instead of replaying the old receipt.
 */
export interface PressIdentity {
  pressId: string;
  logical: unknown;
}

/** What the studio last did for a shot's keyframe (and its voice line, which making keyframes also makes). */
function keyframeJob(overview: GenerationOverview, shotId: string) {
  const shot = overview.shots[shotId];
  if (!shot) return null;
  const slot = shot.keyframe;
  return {
    state: slot.state,
    attemptId: slot.attemptId ?? null,
    failedAt: slot.failure?.at ?? null,
    artifactId: slot.artifact?.artifactId ?? null,
    takenOff: slot.takenOff ?? null,
    voice: shot.narration.state,
  };
}

/** Make the scene's missing keyframes, or regenerate the given shots' keyframes (a new take each). */
export function keyframesPress(overview: GenerationOverview, scene: SceneOverview, targetShotIds?: string[], regenerate?: boolean): PressIdentity {
  const targets = targetShotIds ?? scene.keyframeTargets;
  return {
    pressId: regenerate ? `regenerate:${targetShotIds?.join(",")}` : `keyframes:${scene.sceneId}`,
    logical: { kind: "image", sceneId: scene.sceneId, targets, regenerate: !!regenerate, jobs: targets.map((id) => keyframeJob(overview, id)) },
  };
}

/** Confirm the scene's opened frames and make its clips, after the scene's latest confirmation (if any). */
export function confirmPress(overview: GenerationOverview, scene: SceneOverview): PressIdentity {
  const frames = scene.videoTargets.map((id) => ({ shotId: id, artifactId: overview.shots[id]?.keyframe.artifact?.artifactId ?? null }));
  return { pressId: `confirm:${scene.sceneId}`, logical: { kind: "confirm", sceneId: scene.sceneId, frames, after: scene.confirmation?.confirmationId ?? null } };
}

/** Presses that buy something; a lost reply on one says that pressing again checks and never charges twice. */
export const PAID_PRESS = /^(keyframes|regenerate|confirm):/;

/**
 * The press a saved paid press id stands for, as it would be sent from the film as it is now (null for another id,
 * or when its scene or shots are gone). Comparing its logical identity with the saved one tells whether pressing it
 * again would resend the saved request.
 */
export function pressFromId(overview: GenerationOverview, pressId: string): PressIdentity | null {
  const colon = pressId.indexOf(":");
  if (colon < 0) return null;
  const kind = pressId.slice(0, colon);
  const rest = pressId.slice(colon + 1);
  if (kind === "confirm" || kind === "keyframes") {
    const scene = overview.scenes.find((s) => s.sceneId === rest);
    return scene ? (kind === "confirm" ? confirmPress(overview, scene) : keyframesPress(overview, scene)) : null;
  }
  if (kind !== "regenerate") return null;
  const shotIds = rest.split(",");
  const scene = overview.scenes.find((s) => s.sceneId === overview.shots[shotIds[0] ?? ""]?.sceneId);
  return scene && shotIds.every((id) => overview.shots[id]) ? keyframesPress(overview, scene, shotIds, true) : null;
}

/**
 * Whether "Not confirmed. Press again to check; it will not charge twice." still holds: one of the saved paid presses
 * (sent, no reply yet) would be resent as it was if pressed now (the same Idempotency-Key, so the studio replays it).
 * Once the studio answered, or the film shows the job (a new confirmation, a keyframe queued or running), it does
 * not: pressing again then is a new request, or there is nothing to press while the job runs.
 */
export function lostReplyHolds(overview: GenerationOverview, savedPressIds: readonly string[], wouldResend: (press: PressIdentity) => boolean): boolean {
  return savedPressIds.some((id) => {
    if (!PAID_PRESS.test(id)) return false;
    const press = pressFromId(overview, id);
    return !!press && wouldResend(press);
  });
}
