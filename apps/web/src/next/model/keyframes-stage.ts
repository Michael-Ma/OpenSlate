import type { GenerationOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";

/**
 * The Keyframes stage (the large preview): moving through the whole film with Previous / Next, a "3 / 8" counter
 * and the arrow keys, and the clip its Video side plays. Classic had both (FrameWorkspace.tsx:368, 519, 542).
 */

/** Every shot in film order: scenes by their ordinal, shots in scene order. */
export function filmShotOrder(overview: GenerationOverview): string[] {
  return [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).flatMap((scene) => scene.shotIds.filter((id) => !!overview.shots[id]));
}

export interface ShotPosition {
  /** 1-based, across the whole film. */
  index: number;
  total: number;
  previous: { shotId: string; label: string } | null;
  next: { shotId: string; label: string } | null;
}

/** Where a shot sits in the whole film ("3 / 8"), with its neighbours across scene boundaries. */
export function shotPosition(overview: GenerationOverview, shotId: string): ShotPosition | null {
  const order = filmShotOrder(overview);
  const at = order.indexOf(shotId);
  if (at < 0) return null;
  const near = (id: string | undefined) => (id ? { shotId: id, label: overview.shots[id]!.label } : null);
  return { index: at + 1, total: order.length, previous: near(order[at - 1]), next: near(order[at + 1]) };
}

export interface KeyModifiers {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * ArrowLeft / ArrowRight on the focused stage: -1 or 1. Null for other keys, with a modifier key (so browser and
 * system shortcuts keep working), or while a field or a video player has focus (they use the arrows themselves).
 */
export function stageStep(key: string, modifiers: KeyModifiers, inField: boolean): -1 | 1 | null {
  if (inField || modifiers.altKey || modifiers.ctrlKey || modifiers.metaKey || modifiers.shiftKey) return null;
  return key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : null;
}

/** Elements whose own arrow keys win over moving between shots (a selector for Element.closest). */
export const ARROW_OWNERS = 'input,textarea,select,video,audio,[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="textbox"]';

/** The clip the preview's Video side plays: the current one, else the earlier one an edit or a remake replaced. */
export function shotClip(shot: ShotOverview): { artifact: StudioArtifactRef; earlier: boolean } | null {
  const video = shot.video;
  if (video.state === "ready" && video.artifact) return { artifact: video.artifact, earlier: false };
  if (video.previous && video.previous.kind === "video") return { artifact: video.previous, earlier: true };
  return null;
}
