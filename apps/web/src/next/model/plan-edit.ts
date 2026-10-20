import type { GenerationOverview, MediaSlot, PriceQuote, SceneOverview, ShotOverview } from "@openslate/core/public";
import { estimateNarrationSeconds, MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "./checks.ts";
import { clipUnit } from "./inspector.ts";
import { modeEdit, narrationChoiceOf, planLeaveRecordingImpact, planRecordingImpact, wordsOf, type NarrationChoice as Choice, type TakeOrigin } from "./narration.ts";
import { directedPrompt, promptText, promptToSave, secondsOf, written, type NarrationMode, type SnapshotShot } from "./plan.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The Plan view's in-place shot editor (plan items SB-10, SB-8, SB-4, SB-9). It says before saving what a change
 * outdates, mirroring the server's per-field rule (storyboard.ts): purpose, action and framing are written into
 * both prompts, so they outdate the keyframe and the clip; a picture prompt change outdates both; motion, length
 * or the video prompt outdate only the clip; a new line outdates the voice line. The shot's fields save as one
 * command (shotFields), so one Undo restores them all; narration is its own command. Pure: only message ids.
 */

/** No narration, a line the studio voices, the person's own recording (model/narration.ts), or not decided yet. */
export type NarrationChoice = Choice | "undecided";

/** A type, not an interface, so the changed-underneath model can hold it as a record of fields. */
export type ShotDraft = {
  purpose: string;
  /** What happens in the shot. */
  action: string;
  /** Free text in the film's words ("Low-angle medium over shoulder"); the usual framings are suggestions. */
  framing: string;
  /** The picture prompt in the person's words (after the server's direction header, if any). */
  prompt: string;
  /** The video prompt in the person's words. */
  videoPrompt: string;
  motion: string;
  seconds: number;
  narration: NarrationChoice;
  line: string;
};

/** Fields of the editor, in the words of the form. */
export type DraftField = "purpose" | "action" | "framing" | "prompt" | "videoPrompt" | "motion" | "length" | "narration" | "line";

/** The shot fields one shotFields command carries (B12 item 6); desiredFrames in whole frames. */
export type ShotFields = {
  purpose?: string;
  action?: string;
  framing?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  motion?: string;
  desiredFrames?: number;
};

/** One storyboard command (POST /api/projects/:projectId/storyboard). */
export type ShotFieldEdit =
  | { kind: "shotFields"; fields: ShotFields }
  | { kind: "narration"; field: "text" | "mode"; value: string };

/** A command of a save and the editor fields it carries. */
export interface DraftCommand {
  fields: DraftField[];
  edit: ShotFieldEdit;
}

/** The shot as stored, placeholders included: what the server builds its direction header from. */
export interface StoredShot {
  purpose: string;
  action: string;
  framing: string;
  motion: string;
  imagePrompt: string;
  videoPrompt: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** An attempt in flight; a queued job is simply taken off by the edit. */
const inFlight = (slot: MediaSlot) => slot.state === "running";

/** The stored shot: the overview's fields, and the action and video prompt only the snapshot carries. */
export function storedShot(shot: ShotOverview, stored: Pick<SnapshotShot, "action" | "videoPrompt"> | undefined): StoredShot {
  return { purpose: shot.purpose, action: stored?.action ?? "", framing: shot.framing, motion: shot.motion, imagePrompt: shot.imagePrompt, videoPrompt: stored?.videoPrompt ?? "" };
}

/** The editor's starting values for a shot as it is now. */
export function draftOf(shot: ShotOverview, mode: NarrationMode | undefined, fps: number, stored?: Pick<SnapshotShot, "action" | "videoPrompt">): ShotDraft {
  return {
    purpose: written("purpose", shot.purpose),
    action: written("action", stored?.action),
    framing: written("framing", shot.framing),
    prompt: promptText(shot.imagePrompt),
    videoPrompt: promptText(stored?.videoPrompt ?? ""),
    motion: written("motion", shot.motion),
    seconds: secondsOf(shot.durationFrames, fps),
    narration: narrationChoiceOf(mode, shot.narration),
    // A recording added without words carries the studio's stand-in text; it is not a line to voice.
    line: wordsOf(shot.narration.text),
  };
}

const TEXT_FIELDS = ["purpose", "action", "framing", "prompt", "videoPrompt", "motion"] as const;

export function changedFields(base: ShotDraft, draft: ShotDraft): DraftField[] {
  const fields: DraftField[] = TEXT_FIELDS.filter((field) => draft[field].trim() !== base[field].trim());
  if (!same(draft.seconds, base.seconds)) fields.push("length");
  if (draft.narration !== base.narration && draft.narration !== "undecided") fields.push("narration");
  if (draft.narration === "line" && draft.line.trim() !== base.line.trim()) fields.push("line");
  return fields;
}

const REQUIRED: Record<(typeof TEXT_FIELDS)[number], "plan.edit.required_purpose" | "plan.edit.required_action" | "plan.edit.required_framing" | "plan.edit.required_prompt" | "plan.edit.required_video_prompt" | "plan.edit.required_motion"> = {
  purpose: "plan.edit.required_purpose",
  action: "plan.edit.required_action",
  framing: "plan.edit.required_framing",
  prompt: "plan.edit.required_prompt",
  videoPrompt: "plan.edit.required_video_prompt",
  motion: "plan.edit.required_motion",
};

/** Why the draft cannot be saved as it is, or null (the server refuses an emptied field). */
export function draftProblem(base: ShotDraft, draft: ShotDraft): Msg | null {
  const fields = changedFields(base, draft);
  for (const field of TEXT_FIELDS) if (fields.includes(field) && !draft[field].trim()) return msg(REQUIRED[field]);
  if (draft.narration === "line" && !draft.line.trim() && (fields.includes("narration") || fields.includes("line"))) return msg("plan.line.empty");
  return null;
}

/**
 * The commands that save a draft, in an order the server accepts: dropping the line first (so a shorter shot is
 * no longer held by its voice), then every shot field as one shotFields command (refused whole if the length is
 * below the accepted voice line), then the line, then the choice to narrate.
 *
 * Prompts are the whole prompt as stored. A rewritten prompt keeps the server's direction header in front of the
 * person's words; when purpose, action or framing (or, for the video prompt, motion) change in the same save, the
 * header is written anew from the saved values, as the server would write it (an explicit prompt wins there).
 */
export function draftEdits(base: ShotDraft, draft: ShotDraft, fps: number, narrationMode: NarrationMode | undefined, stored?: StoredShot): DraftCommand[] {
  const changed = changedFields(base, draft);
  const has = (field: DraftField) => changed.includes(field);
  const out: DraftCommand[] = [];
  const mode = has("narration") && draft.narration !== "undecided" ? modeEdit(draft.narration, narrationMode) : null;
  if (mode === "none") out.push({ fields: ["narration"], edit: { kind: "narration", field: "mode", value: "none" } });

  const now: StoredShot = stored ?? { purpose: base.purpose, action: base.action, framing: base.framing, motion: base.motion, imagePrompt: base.prompt, videoPrompt: base.videoPrompt };
  const final = {
    purpose: has("purpose") ? draft.purpose.trim() : now.purpose,
    action: has("action") ? draft.action.trim() : now.action,
    framing: has("framing") ? draft.framing.trim() : now.framing,
    motion: has("motion") ? draft.motion.trim() : now.motion,
  };
  const direction = has("purpose") || has("action") || has("framing");
  const fields: ShotFields = {};
  const shotFields: DraftField[] = [];
  const put = <K extends keyof ShotFields>(field: DraftField, key: K, value: ShotFields[K]) => { fields[key] = value; shotFields.push(field); };
  if (has("purpose")) put("purpose", "purpose", final.purpose);
  if (has("action")) put("action", "action", final.action);
  if (has("framing")) put("framing", "framing", final.framing);
  if (has("prompt"))
    put("prompt", "imagePrompt", direction ? directedPrompt([final.purpose, final.action, final.framing], draft.prompt.trim()) : promptToSave(now.imagePrompt, draft.prompt.trim()));
  if (has("videoPrompt"))
    put("videoPrompt", "videoPrompt", direction || has("motion")
      ? directedPrompt([final.purpose, final.action, final.framing, `Camera movement: ${final.motion}`], draft.videoPrompt.trim())
      : promptToSave(now.videoPrompt, draft.videoPrompt.trim()));
  if (has("motion")) put("motion", "motion", final.motion);
  if (has("length")) put("length", "desiredFrames", Math.round(draft.seconds * fps));
  if (shotFields.length) out.push({ fields: shotFields, edit: { kind: "shotFields", fields } });

  if (has("line")) out.push({ fields: ["line"], edit: { kind: "narration", field: "text", value: draft.line.trim() } });
  // A line or a recording is chosen last, after the line it voices.
  if (mode && mode !== "none") out.push({ fields: ["narration"], edit: { kind: "narration", field: "mode", value: mode } });
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

/**
 * The voice-line floor (SB-8): the server refuses a shot shorter than its accepted line. Shot lengths are whole
 * seconds (as Make 8 s and the Film view's tools write them), so the floor is the whole second that holds the
 * line: a 7.4 s line needs at least 8 s.
 */
export function lengthFloor(shot: ShotOverview, fps: number, narration: NarrationChoice): LengthFloor {
  const line = shot.narration;
  const none: LengthFloor = { min: MIN_SHOT_SECONDS, reason: null, lineSeconds: null };
  if (narration === "none" || line.state !== "ready" || line.measuredSeconds === undefined) return none;
  const measured = line.measuredSeconds;
  if (line.fit === "cut_to_shot") return { min: Math.max(MIN_SHOT_SECONDS, secondsOf(shot.durationFrames, fps)), reason: "cut", lineSeconds: round1(measured) };
  if (line.fits === true || line.fit === "extend_shot") return { min: Math.max(MIN_SHOT_SECONDS, Math.ceil(measured - 1e-6)), reason: "voice", lineSeconds: round1(measured) };
  return none;
}

const whole = (seconds: number) => Math.abs(seconds - Math.round(seconds)) < 1e-6;

/**
 * One step of the length stepper: a whole second at a time, never below the floor or outside 3–15 s. A length
 * between whole seconds (written elsewhere) snaps onto the whole-second grid on its first step.
 */
export function stepLength(seconds: number, delta: 1 | -1, floor: LengthFloor): number {
  const low = Math.max(MIN_SHOT_SECONDS, floor.min);
  if (delta > 0) {
    if (seconds >= MAX_SHOT_SECONDS - 1e-6) return seconds;
    return Math.min(MAX_SHOT_SECONDS, whole(seconds) ? Math.round(seconds) + 1 : Math.ceil(seconds));
  }
  if (seconds <= low + 1e-6) return seconds;
  return round1(Math.max(low, whole(seconds) ? Math.round(seconds) - 1 : Math.floor(seconds)));
}

export const canStep = (seconds: number, delta: 1 | -1, floor: LengthFloor) => !same(stepLength(seconds, delta, floor), seconds);

/** The hint under the stepper. */
export function lengthHint(shot: ShotOverview, floor: LengthFloor): Msg {
  const line = shot.narration;
  if (line.state === "ready" && line.measuredSeconds !== undefined && line.fits === false && !line.fit) return msg("plan.len.line_long", { line: round1(line.measuredSeconds) });
  if (floor.reason === "cut") return msg("plan.len.floor_cut");
  if (floor.reason === "voice" && floor.min > MIN_SHOT_SECONDS) return msg("plan.len.floor_voice", { min: floor.min, line: floor.lineSeconds ?? 0 });
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

/** Per-unit estimates; subscription usage is distinct from a missing per-call price (never shown as $0.00). */
export interface UnitPrices {
  keyframe: number | null;
  clip: number | null;
  voice: number | null;
  keyframeSubscription?: PriceQuote["subscription"];
}

const unit = (quote: PriceQuote | undefined): number | null => (!quote || quote.priceUnknown || !(Number(quote.unitMicros) > 0) ? null : Number(quote.unitMicros));

export function unitPrices(overview: GenerationOverview, sceneId: string): UnitPrices {
  const scene: SceneOverview | undefined = overview.scenes.find((s) => s.sceneId === sceneId);
  const anyScene = (pick: (s: SceneOverview) => PriceQuote | undefined) => overview.scenes.map(pick).find((quote) => quote !== undefined);
  const clip = clipUnit(overview, scene);
  const keyframe = scene?.quotes.regenerateKeyframe ?? scene?.quotes.makeKeyframes ?? anyScene((s) => s.quotes.regenerateKeyframe);
  return {
    keyframe: unit(keyframe),
    clip: clip && !clip.unknown && Number(clip.unitMicros) > 0 ? Number(clip.unitMicros) : null,
    voice: unit(scene?.quotes.oneVoice ?? anyScene((s) => s.quotes.oneVoice)),
    ...(keyframe?.subscription ? { keyframeSubscription: keyframe.subscription } : {}),
  };
}

export interface DraftEffects {
  fields: DraftField[];
  /** Purpose, action or framing changed: they are written into both prompts, in front of the words. */
  rewrites: boolean;
  keyframe: boolean;
  clip: boolean;
  voice: boolean;
  voiceDropped: boolean;
  /** "My recording" was chosen; it is added on the shot in Keyframes. */
  recording: boolean;
  /** The person's recording, in use now, stops being used (for no narration, or a line the studio voices). */
  recordingDropped: boolean;
  /** A keyframe or clip the change touches is being made right now. */
  running: boolean;
  promptLike: boolean;
  clipLike: boolean;
}

/**
 * `origin` is the current take's (model/narration.ts takeOrigin), read for the shot being edited: a shot set to
 * "My recording" may still be using its voice line. Unknown (null), the take counts as the person's recording.
 */
export function draftEffects(shot: ShotOverview, base: ShotDraft, draft: ShotDraft, origin: TakeOrigin | null = null): DraftEffects {
  const fields = changedFields(base, draft);
  const has = (field: DraftField) => fields.includes(field);
  const direction = has("purpose") || has("action") || has("framing");
  const promptLike = direction || has("prompt");
  // The video prompt drives only the clip, like motion and length: the keyframe stays.
  const clipLike = promptLike || has("motion") || has("length") || has("videoPrompt");
  const voiceReady = shot.narration.state === "ready";
  const leaving = base.narration === "recording" && has("narration") && voiceReady;
  const recordingDropped = leaving && origin !== "voice";
  return {
    fields,
    rewrites: direction,
    keyframe: promptLike && shot.keyframe.state === "ready",
    clip: clipLike && shot.video.state === "ready",
    // Leaving a recording for a line says the voice line's price once, with the recording it replaces.
    voice: voiceReady && draft.narration === "line" && has("line") && !recordingDropped,
    voiceDropped: voiceReady && draft.narration === "none" && (base.narration === "line" || (leaving && origin === "voice")),
    recording: draft.narration === "recording" && has("narration"),
    recordingDropped,
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

export function shotImpact(shot: ShotOverview, base: ShotDraft, draft: ShotDraft, prices: UnitPrices, locale: string, origin: TakeOrigin | null = null): Impact {
  const effects = draftEffects(shot, base, draft, origin);
  if (!effects.fields.length) return { tone: "none", parts: [msg("plan.impact.unchanged")] };
  const money = (micros: number) => formatMicros(micros, locale);
  const label = shot.label;
  const parts: Msg[] = [];
  if (effects.rewrites) parts.push(msg("plan.impact.rewrites"));
  if (effects.running) parts.push(msg("plan.impact.running", { shot: label }));
  if (effects.keyframe && prices.keyframeSubscription === "codex")
    parts.push(msg(effects.clip ? prices.clip !== null ? "plan.impact.kf_clip_codex" : "plan.impact.kf_clip_codex_unpriced" : "plan.impact.kf_codex", { shot: label, ...(prices.clip !== null ? { price: money(prices.clip) } : {}) }));
  else if (effects.keyframe && effects.clip)
    parts.push(prices.keyframe !== null && prices.clip !== null ? msg("plan.impact.kf_clip", { shot: label, price: money(prices.keyframe + prices.clip) }) : msg("plan.impact.kf_clip_unpriced", { shot: label }));
  else if (effects.keyframe) parts.push(prices.keyframe !== null ? msg("plan.impact.kf", { shot: label, price: money(prices.keyframe) }) : msg("plan.impact.kf_unpriced", { shot: label }));
  else if (effects.clip) parts.push(prices.clip !== null ? msg("plan.impact.clip", { shot: label, price: money(prices.clip) }) : msg("plan.impact.clip_unpriced", { shot: label }));
  if (effects.voice) parts.push(prices.voice !== null ? msg("plan.impact.voice", { price: money(prices.voice) }) : msg("plan.impact.voice_unpriced"));
  if (effects.voiceDropped) parts.push(msg("plan.impact.voice_dropped", { shot: label }));
  if (effects.recordingDropped && draft.narration !== "undecided" && draft.narration !== "recording") parts.push(planLeaveRecordingImpact(draft.narration, shot, prices.voice, locale));
  const recording = effects.recording ? planRecordingImpact(shot) : null;
  if (recording) parts.push(recording.message);
  const any = effects.keyframe || effects.clip || effects.voice || effects.voiceDropped || effects.recordingDropped || !!recording?.replaces;
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

const FIELD_CHANGE: Record<DraftField, `plan.change.field.${"purpose" | "action" | "framing" | "prompt" | "video_prompt" | "motion" | "length" | "narration" | "line"}`> = {
  purpose: "plan.change.field.purpose",
  action: "plan.change.field.action",
  framing: "plan.change.field.framing",
  prompt: "plan.change.field.prompt",
  videoPrompt: "plan.change.field.video_prompt",
  motion: "plan.change.field.motion",
  length: "plan.change.field.length",
  narration: "plan.change.field.narration",
  line: "plan.change.field.line",
};

/**
 * What Undo names (the header and the toast), from the fields of each command of a save. The shot's fields are one
 * command, so Undo restores them all ("edit 1.2"). Narration is its own command and the server undoes only its
 * latest one, so a save that also changes the narration can be undone only for its last command; this names it.
 */
export function editChange(label: string, commands: readonly (readonly DraftField[])[]): Msg {
  const last = commands[commands.length - 1];
  if (commands.length <= 1 || !last?.length) return msg("plan.change.edit_shot", { shot: label });
  if (last.length > 1) return msg("plan.change.shot_fields", { shot: label });
  return msg(FIELD_CHANGE[last[0]!], { shot: label });
}

/** The editor's label of each field, for the fields the saved film changed under a draft. */
export const FIELD_LABEL: Record<DraftField, "plan.field.purpose" | "plan.field.action" | "plan.field.framing" | "plan.field.prompt" | "plan.field.video_prompt" | "plan.field.motion" | "plan.field.length" | "plan.field.narration" | "plan.field.line"> = {
  purpose: "plan.field.purpose",
  action: "plan.field.action",
  framing: "plan.field.framing",
  prompt: "plan.field.prompt",
  videoPrompt: "plan.field.video_prompt",
  motion: "plan.field.motion",
  length: "plan.field.length",
  narration: "plan.field.narration",
  line: "plan.field.line",
};

/** The editor field each draft key is shown in. */
export const DRAFT_FIELD: Record<keyof ShotDraft, DraftField> = {
  purpose: "purpose", action: "action", framing: "framing", prompt: "prompt", videoPrompt: "videoPrompt", motion: "motion", seconds: "length", narration: "narration", line: "line",
};

/**
 * Standard framings offered in the editor (as suggestions: framing is free text), and motion suggestions. They are shot content, which feeds the prompts,
 * so they stay in the film's own words (as the shots of the sample film are) whatever the interface language;
 * only the field labels are translated.
 */
export const FRAMINGS: readonly string[] = ["Wide", "Medium", "Close-up", "Extreme close-up"];
export const MOTIONS: readonly string[] = ["Static", "Static, breath visible", "Slow push-in", "Slow pull-back", "Slow pan left", "Slow pan right", "Slow tilt up", "Slow tilt down"];
