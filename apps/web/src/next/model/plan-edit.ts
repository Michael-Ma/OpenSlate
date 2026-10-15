import type { GenerationOverview, MediaSlot, PriceQuote, SceneOverview, ShotOverview } from "@openslate/core/public";
import { estimateNarrationSeconds, MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "./checks.ts";
import { clipUnit } from "./inspector.ts";
import { promptText, secondsOf, written, type NarrationMode } from "./plan.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The Plan view's in-place shot editor (plan items SB-10, SB-8, SB-4, SB-9). It says before saving what a change
 * outdates, mirroring the server's per-field rule (storyboard.ts): purpose and framing are written into the
 * picture prompt, so they outdate the keyframe and the clip; a prompt change outdates both; motion or length
 * outdates only the clip; a new line outdates the voice line. Pure: no sentences, only message ids.
 */

export type NarrationChoice = "none" | "line" | "undecided";

export interface ShotDraft {
  purpose: string;
  framing: string;
  prompt: string;
  motion: string;
  seconds: number;
  narration: NarrationChoice;
  line: string;
}

/** Fields of the editor, in the words of the form. */
export type DraftField = "purpose" | "framing" | "prompt" | "motion" | "length" | "narration" | "line";

/** One storyboard command (POST /api/projects/:projectId/storyboard); the server takes one field per command. */
export type ShotFieldEdit =
  | { kind: "shot"; field: "purpose" | "framing" | "imagePrompt" | "motion" | "desiredFrames"; value: string }
  | { kind: "narration"; field: "text" | "mode"; value: string };

const round1 = (value: number) => Math.round(value * 10) / 10;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** An attempt in flight; a queued job is simply taken off by the edit. */
const inFlight = (slot: MediaSlot) => slot.state === "running";

/** The editor's starting values for a shot as it is now. */
export function draftOf(shot: ShotOverview, mode: NarrationMode | undefined, fps: number): ShotDraft {
  const hasLine = shot.narration.state !== "none" && shot.narration.text.trim() !== "";
  return {
    purpose: written("purpose", shot.purpose),
    framing: written("framing", shot.framing),
    prompt: promptText(shot.imagePrompt),
    motion: written("motion", shot.motion),
    seconds: secondsOf(shot.durationFrames, fps),
    narration: hasLine ? "line" : mode === "undecided" ? "undecided" : "none",
    line: shot.narration.text,
  };
}

export function changedFields(base: ShotDraft, draft: ShotDraft): DraftField[] {
  const fields: DraftField[] = [];
  if (draft.purpose.trim() !== base.purpose.trim()) fields.push("purpose");
  if (draft.framing.trim() !== base.framing.trim()) fields.push("framing");
  if (draft.prompt.trim() !== base.prompt.trim()) fields.push("prompt");
  if (draft.motion.trim() !== base.motion.trim()) fields.push("motion");
  if (!same(draft.seconds, base.seconds)) fields.push("length");
  if (draft.narration !== base.narration && draft.narration !== "undecided") fields.push("narration");
  if (draft.narration === "line" && draft.line.trim() !== base.line.trim()) fields.push("line");
  return fields;
}

/** Why the draft cannot be saved as it is, or null. */
export function draftProblem(base: ShotDraft, draft: ShotDraft): Msg | null {
  const fields = changedFields(base, draft);
  const required: [DraftField, keyof ShotDraft][] = [["purpose", "purpose"], ["framing", "framing"], ["prompt", "prompt"], ["motion", "motion"]];
  for (const [field, key] of required)
    if (fields.includes(field) && !String(draft[key]).trim()) return msg(`plan.edit.required_${field}` as "plan.edit.required_purpose");
  if (draft.narration === "line" && !draft.line.trim() && (fields.includes("narration") || fields.includes("line"))) return msg("plan.line.empty");
  return null;
}

/**
 * The commands that save a draft, in an order the server accepts: dropping the line first (so a shorter shot is
 * no longer held by its voice), then the length (refused before anything else is saved if it is too short), the
 * prompt before purpose and framing (which are written into it), and the line before choosing to narrate.
 */
export function draftEdits(base: ShotDraft, draft: ShotDraft, fps: number, mode: NarrationMode | undefined): { field: DraftField; edit: ShotFieldEdit }[] {
  const fields = new Set(changedFields(base, draft));
  const out: { field: DraftField; edit: ShotFieldEdit }[] = [];
  if (fields.has("narration") && draft.narration === "none") out.push({ field: "narration", edit: { kind: "narration", field: "mode", value: "none" } });
  if (fields.has("length")) out.push({ field: "length", edit: { kind: "shot", field: "desiredFrames", value: String(Math.round(draft.seconds * fps)) } });
  if (fields.has("prompt")) out.push({ field: "prompt", edit: { kind: "shot", field: "imagePrompt", value: draft.prompt.trim() } });
  if (fields.has("motion")) out.push({ field: "motion", edit: { kind: "shot", field: "motion", value: draft.motion.trim() } });
  if (fields.has("purpose")) out.push({ field: "purpose", edit: { kind: "shot", field: "purpose", value: draft.purpose.trim() } });
  if (fields.has("framing")) out.push({ field: "framing", edit: { kind: "shot", field: "framing", value: draft.framing.trim() } });
  if (fields.has("line")) out.push({ field: "line", edit: { kind: "narration", field: "text", value: draft.line.trim() } });
  if (fields.has("narration") && draft.narration === "line" && mode !== "generated" && mode !== "uploaded")
    out.push({ field: "narration", edit: { kind: "narration", field: "mode", value: "generated" } });
  return out;
}

// ---- length ---------------------------------------------------------------------------------------------

export interface LengthFloor {
  /** The shortest length the server accepts for this shot now, in seconds. */
  min: number;
  /** voice: an accepted voice line fits the shot; cut: the line is cut at the shot's end. */
  reason: "voice" | "cut" | null;
  lineSeconds: number | null;
}

/** The voice-line floor (SB-8): the server refuses a shot shorter than its accepted line. */
export function lengthFloor(shot: ShotOverview, fps: number, narration: NarrationChoice): LengthFloor {
  const line = shot.narration;
  const none: LengthFloor = { min: MIN_SHOT_SECONDS, reason: null, lineSeconds: null };
  if (narration === "none" || line.state !== "ready" || line.measuredSeconds === undefined) return none;
  const measured = line.measuredSeconds;
  if (line.fit === "cut_to_shot") return { min: Math.max(MIN_SHOT_SECONDS, secondsOf(shot.durationFrames, fps)), reason: "cut", lineSeconds: round1(measured) };
  if (line.fits === true || line.fit === "extend_shot") return { min: Math.max(MIN_SHOT_SECONDS, Math.ceil(measured * 10 - 1e-6) / 10), reason: "voice", lineSeconds: round1(measured) };
  return none;
}

/** One step of the length stepper: a second at a time, never below the floor or outside 3–15 s. */
export function stepLength(seconds: number, delta: 1 | -1, floor: LengthFloor): number {
  const low = Math.max(MIN_SHOT_SECONDS, floor.min);
  if (delta > 0) return seconds >= MAX_SHOT_SECONDS - 1e-6 ? seconds : round1(Math.min(MAX_SHOT_SECONDS, seconds + 1));
  return seconds <= low + 1e-6 ? seconds : round1(Math.max(low, seconds - 1));
}

export const canStep = (seconds: number, delta: 1 | -1, floor: LengthFloor) => !same(stepLength(seconds, delta, floor), seconds);

/** The hint under the stepper. */
export function lengthHint(shot: ShotOverview, floor: LengthFloor): Msg {
  const line = shot.narration;
  if (line.state === "ready" && line.measuredSeconds !== undefined && line.fits === false && !line.fit) return msg("plan.len.line_long", { line: round1(line.measuredSeconds) });
  if (floor.reason === "cut") return msg("plan.len.floor_cut");
  if (floor.reason === "voice" && floor.min > MIN_SHOT_SECONDS) return msg("plan.len.floor_voice", { line: floor.lineSeconds ?? 0 });
  return msg("plan.len.range", { min: MIN_SHOT_SECONDS, max: MAX_SHOT_SECONDS });
}

/** The measured line while the words are unchanged; a labelled estimate once they change (SB-4). */
export function lineNote(shot: ShotOverview, draft: ShotDraft): Msg | null {
  if (draft.narration !== "line") return null;
  const text = draft.line.trim();
  if (!text) return msg("plan.line.empty");
  const unchanged = text === shot.narration.text.trim();
  const shotSeconds = round1(draft.seconds);
  if (unchanged && shot.narration.measuredSeconds !== undefined) {
    const seconds = round1(shot.narration.measuredSeconds);
    return msg(seconds <= shotSeconds + 1e-6 ? "plan.line.measured_fits" : "plan.line.measured_long", { seconds, shot: shotSeconds });
  }
  const seconds = unchanged && shot.narration.estimatedSeconds !== undefined ? round1(shot.narration.estimatedSeconds) : estimateNarrationSeconds(text);
  return msg(seconds <= shotSeconds + 1e-6 ? "plan.line.estimate_fits" : "plan.line.estimate_long", { seconds, shot: shotSeconds });
}

// ---- what a save outdates -------------------------------------------------------------------------------

/** Per-unit estimates in micro-dollars; null when the model has no price set (never shown as $0.00). */
export interface UnitPrices {
  keyframe: number | null;
  clip: number | null;
  voice: number | null;
}

const unit = (quote: PriceQuote | undefined): number | null => (!quote || quote.priceUnknown || !(Number(quote.unitMicros) > 0) ? null : Number(quote.unitMicros));

export function unitPrices(overview: GenerationOverview, sceneId: string): UnitPrices {
  const scene: SceneOverview | undefined = overview.scenes.find((s) => s.sceneId === sceneId);
  const anyScene = (pick: (s: SceneOverview) => PriceQuote | undefined) => overview.scenes.map(pick).find((quote) => quote !== undefined);
  const clip = clipUnit(overview, scene);
  return {
    keyframe: unit(scene?.quotes.regenerateKeyframe ?? scene?.quotes.makeKeyframes ?? anyScene((s) => s.quotes.regenerateKeyframe)),
    clip: clip && !clip.unknown && Number(clip.unitMicros) > 0 ? Number(clip.unitMicros) : null,
    voice: unit(scene?.quotes.voice ?? anyScene((s) => s.quotes.voice)),
  };
}

export interface DraftEffects {
  fields: DraftField[];
  /** Purpose or framing changed while the prompt did not: the server writes them into the prompt. */
  rewrites: boolean;
  keyframe: boolean;
  clip: boolean;
  voice: boolean;
  voiceDropped: boolean;
  /** A keyframe or clip the change touches is being made right now. */
  running: boolean;
  promptLike: boolean;
  clipLike: boolean;
}

export function draftEffects(shot: ShotOverview, base: ShotDraft, draft: ShotDraft): DraftEffects {
  const fields = changedFields(base, draft);
  const has = (field: DraftField) => fields.includes(field);
  const promptLike = has("purpose") || has("framing") || has("prompt");
  const clipLike = promptLike || has("motion") || has("length");
  const voiceReady = shot.narration.state === "ready";
  return {
    fields,
    rewrites: (has("purpose") || has("framing")) && !has("prompt"),
    keyframe: promptLike && shot.keyframe.state === "ready",
    clip: clipLike && shot.video.state === "ready",
    voice: voiceReady && draft.narration === "line" && has("line"),
    voiceDropped: voiceReady && draft.narration === "none" && base.narration === "line",
    running: (promptLike && inFlight(shot.keyframe)) || (clipLike && inFlight(shot.video)),
    promptLike,
    clipLike,
  };
}

export interface Impact {
  /** cost: something made goes out of date (an icon and words, neutral); none: nothing does (green check). */
  tone: "none" | "cost";
  parts: Msg[];
}

export function shotImpact(shot: ShotOverview, base: ShotDraft, draft: ShotDraft, prices: UnitPrices, locale: string): Impact {
  const effects = draftEffects(shot, base, draft);
  if (!effects.fields.length) return { tone: "none", parts: [msg("plan.impact.unchanged")] };
  const money = (micros: number) => formatMicros(micros, locale);
  const label = shot.label;
  const parts: Msg[] = [];
  if (effects.rewrites) parts.push(msg("plan.impact.rewrites"));
  if (effects.running) parts.push(msg("plan.impact.running", { shot: label }));
  if (effects.keyframe && effects.clip)
    parts.push(prices.keyframe !== null && prices.clip !== null ? msg("plan.impact.kf_clip", { shot: label, price: money(prices.keyframe + prices.clip) }) : msg("plan.impact.kf_clip_unpriced", { shot: label }));
  else if (effects.keyframe) parts.push(prices.keyframe !== null ? msg("plan.impact.kf", { shot: label, price: money(prices.keyframe) }) : msg("plan.impact.kf_unpriced", { shot: label }));
  else if (effects.clip) parts.push(prices.clip !== null ? msg("plan.impact.clip", { shot: label, price: money(prices.clip) }) : msg("plan.impact.clip_unpriced", { shot: label }));
  if (effects.voice) parts.push(prices.voice !== null ? msg("plan.impact.voice", { price: money(prices.voice) }) : msg("plan.impact.voice_unpriced"));
  if (effects.voiceDropped) parts.push(msg("plan.impact.voice_dropped", { shot: label }));
  const any = effects.keyframe || effects.clip || effects.voice || effects.voiceDropped;
  if (!any && !effects.running) {
    const nothingMade = !shot.keyframe.previous && (shot.keyframe.state === "none" || shot.keyframe.state === "direction_required") && shot.video.state === "none" && shot.narration.state !== "ready";
    if (nothingMade) parts.push(msg("plan.impact.nothing_made", { shot: label }));
    else if (effects.clipLike && shot.keyframe.state === "ready" && shot.video.state !== "ready") parts.push(msg("plan.impact.keyframe_stays", { shot: label }));
    else parts.push(msg("plan.impact.none"));
  }
  if (effects.keyframe || effects.clip) parts.push(msg("plan.impact.takes"));
  return { tone: any ? "cost" : "none", parts };
}

/** The toast after a save: what went out of date, most important first. */
export function savedMessage(shot: ShotOverview, base: ShotDraft, draft: ShotDraft): Msg {
  const effects = draftEffects(shot, base, draft);
  const values = { shot: shot.label };
  if (effects.keyframe && effects.clip) return msg("plan.toast.saved_kf_clip", values);
  if (effects.keyframe) return msg("plan.toast.saved_kf", values);
  if (effects.clip) return msg("plan.toast.saved_clip", values);
  if (effects.voice) return msg("plan.toast.saved_voice", values);
  return msg("plan.toast.saved", values);
}

/** What the header's Undo names: the whole edit when it was one command, else the field the last command saved. */
export function editChange(label: string, fields: readonly DraftField[]): Msg {
  const last = fields[fields.length - 1];
  if (fields.length <= 1 || !last) return msg("plan.change.edit_shot", { shot: label });
  return msg(`plan.change.field.${last}` as "plan.change.field.purpose", { shot: label });
}

/** Standard framings offered in the editor; content, so they are written in the interface language. */
export const FRAMINGS = ["wide", "medium", "close_up", "extreme_close_up"] as const;
