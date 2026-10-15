/**
 * Motion preview (plan decision D17). Motion is free text, so the preview guesses a camera move from
 * keywords in English or Chinese. Unknown text previews as static; the backend is unchanged.
 */
export type MotionKind = "push_in" | "pull_back" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down" | "breath" | "static";

// Camera moves win over "breath": "Slow push-in, breath visible" is a push-in.
const rules: readonly (readonly [MotionKind, RegExp])[] = [
  ["push_in", /push[\s-]*in|dolly[\s-]*in|zoom[\s-]*in|move[\s-]*in|creep[\s-]*in|推近|推进|推镜|拉近|前推/i],
  ["pull_back", /pull[\s-]*(back|out|away)|dolly[\s-]*(out|back)|zoom[\s-]*out|move[\s-]*(out|back)|拉远|后拉|拉镜|后退/i],
  ["pan_left", /(pan|truck|track)[\s-]*(to\s+the\s+)?left|左摇|向左摇|向左移|左移|向左横移/i],
  ["pan_right", /(pan|truck|track)[\s-]*(to\s+the\s+)?right|右摇|向右摇|向右移|右移|向右横移/i],
  ["tilt_up", /(tilt|pedestal|crane)[\s-]*up|上摇|向上摇|仰摇|升镜/i],
  ["tilt_down", /(tilt|pedestal|crane)[\s-]*down|下摇|向下摇|俯摇|降镜/i],
  // A bare direction-less move falls back to its most common form.
  ["push_in", /\bzoom\b|推/i],
  ["pan_right", /\bpan\b|横移|摇镜/i],
  ["tilt_down", /\btilt\b/i],
  ["breath", /breath|呼吸/i],
];

export function motionKind(text: string): MotionKind {
  for (const [kind, pattern] of rules) if (pattern.test(text)) return kind;
  return "static";
}

/** CSS transform for the preview at progress p (0 to 1). "none" for a still picture. */
export function motionTransform(kind: MotionKind, p: number): string {
  const t = Math.min(1, Math.max(0, p));
  const r = (value: number) => Math.round(value * 1000) / 1000;
  switch (kind) {
    case "push_in": return `scale(${r(1 + 0.12 * t)})`;
    case "pull_back": return `scale(${r(1.12 - 0.12 * t)})`;
    // The camera pans right, so the picture moves left.
    case "pan_right": return `scale(1.1) translateX(${r(4 - 8 * t)}%)`;
    case "pan_left": return `scale(1.1) translateX(${r(-4 + 8 * t)}%)`;
    // The camera tilts down, so the picture moves up.
    case "tilt_down": return `scale(1.1) translateY(${r(4 - 8 * t)}%)`;
    case "tilt_up": return `scale(1.1) translateY(${r(-4 + 8 * t)}%)`;
    case "breath": return `scale(${r(1.012 + 0.01 * Math.sin(t * Math.PI * 4))})`;
    default: return "none";
  }
}

/** "0:05", "1:02". Whole seconds, rounded down, like a player clock. */
export function clock(secondsValue: number): string {
  const whole = Math.max(0, Math.floor(secondsValue + 1e-9));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Playback of one shot or a queue of shots in the preview. */
export interface Playback {
  queue: string[];
  index: number;
  /** "clip" plays the shot's video; "motion" runs the keyframe's motion preview. */
  kind: "clip" | "motion";
}

export const playingShot = (playback: Playback | null): string | null => playback?.queue[playback.index] ?? null;

/** The next step after the current item ends: the following shot, or null when the queue is done. */
export function advance(playback: Playback): Playback | null {
  return playback.index + 1 < playback.queue.length ? { ...playback, index: playback.index + 1 } : null;
}
