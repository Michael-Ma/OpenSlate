import type { GenerationOverview, PriceQuote, ShotNarration, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { seconds } from "./keyframes.ts";
import type { InspectorRow } from "./inspector.ts";
import { formatMicros } from "./price.ts";
import { stockName } from "./settings-voice.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Narration per shot (classic-UI parity, card B13): the choice between no narration, a line the studio voices and
 * the person's own recording; the stock voice of a voiced line; the current take and its measured length; and the
 * voice line's state as the generation overview reports it. Shared by the Keyframes inspector's narration panel
 * and the Plan shot editor's narration field. Pure: message ids, never sentences.
 *
 * Server shapes: storyboard narration edits (`mode`, `text`, `voice`) through POST /storyboard; stock voices from
 * GET /api/narration/voices; the shot's narration section from GET /narration/shots/:shotId; a recording through
 * POST /shots/:shotId/narration/recording (see narration-recording.ts).
 */

/** The shot's narration mode as the project stores it. */
export type NarrationMode = "undecided" | "none" | "generated" | "uploaded";

/** What the person chooses: no narration, a line the studio voices, or their own recording. */
export type NarrationChoice = "none" | "line" | "recording";

export const NARRATION_CHOICES: readonly NarrationChoice[] = ["none", "line", "recording"];

const round1 = (value: number) => Math.round(value * 10) / 10;
/** Samples per second of the studio's normalized narration audio. */
export const NARRATION_SAMPLE_RATE = 48000;

export const choiceLabel = (choice: NarrationChoice): Msg => msg(`narr.choice.${choice}`);

/** The choice a shot is in now. A shot whose narration was never decided and has no line is "undecided". */
export function narrationChoiceOf(mode: NarrationMode | undefined, line: Pick<ShotNarration, "state" | "text">): NarrationChoice | "undecided" {
  if (mode === "uploaded") return "recording";
  if (line.state !== "none" && line.text.trim()) return "line";
  return mode === "undecided" ? "undecided" : "none";
}

/** The mode a choice stores. */
export const modeOf = (choice: NarrationChoice): Exclude<NarrationMode, "undecided"> => (choice === "none" ? "none" : choice === "line" ? "generated" : "uploaded");

/** The mode edit a choice needs (POST /storyboard, kind narration, field mode), or null when the shot is already in it. */
export function modeEdit(choice: NarrationChoice, mode: NarrationMode | undefined): Exclude<NarrationMode, "undecided"> | null {
  const target = modeOf(choice);
  return target === mode ? null : target;
}

/**
 * The section text the studio writes when a recording is added to a shot without words
 * (apps/server/src/narration/shot-recording-routes.ts). It is a stand-in, not the recording's words.
 */
export const RECORDING_WITHOUT_WORDS = "Uploaded narration recording";

/** The words a person gave the shot's line or recording; the studio's stand-in for none reads as none. */
export const wordsOf = (text: string): string => (text.trim() === RECORDING_WITHOUT_WORDS ? "" : text);

// ---- stock voices --------------------------------------------------------------------------------------

/** GET /api/narration/voices?projectId=…: the stock voices, the film's default marked. */
export interface StockVoicesRead {
  defaultNarratorVoice: string;
  voices: { id: string; default: boolean }[];
}

/** A shot's voice selector: "stock" follows the film's narrator; a stock id pins that voice; "personal" the film's personal voice. */
export type VoiceSelector = string;

export interface VoiceOption {
  value: VoiceSelector;
  label: Msg;
}

const isPersonalId = (voice: string) => voice.startsWith("openai-custom:") || voice.startsWith("elevenlabs-personal:");

/** "Same as the film (Cedar)": the selector that follows the film's narrator voice. */
function followLabel(read: StockVoicesRead | null): Msg {
  const film = read?.defaultNarratorVoice;
  if (!film) return msg("narr.voice.follow_plain");
  return isPersonalId(film) ? msg("narr.voice.follow_personal") : msg("narr.voice.follow", { voice: stockName(film) });
}

/**
 * The voice select: following the film first, then each stock voice (the film's default marked). A shot already
 * set to the film's personal voice keeps that option; a saved voice the list does not know is kept as it is.
 */
export function voiceOptions(read: StockVoicesRead | null, current: VoiceSelector | undefined): VoiceOption[] {
  const options: VoiceOption[] = [{ value: "stock", label: followLabel(read) }];
  for (const voice of read?.voices ?? [])
    options.push({ value: voice.id, label: msg(voice.default ? "narr.voice.name_default" : "narr.voice.name", { voice: stockName(voice.id) }) });
  if (current === "personal") options.push({ value: "personal", label: msg("narr.voice.personal") });
  else if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: msg("narr.voice.name", { voice: stockName(current) }) });
  return options;
}

/** One voice line's price for this scene (any scene's when it has none); null when no price is set. Never $0.00. */
export function voiceUnit(overview: GenerationOverview, sceneId: string): number | null {
  const unit = (quote: PriceQuote | undefined) => (!quote || quote.priceUnknown || !(Number(quote.unitMicros) > 0) ? null : Number(quote.unitMicros));
  const own = unit(overview.scenes.find((scene) => scene.sceneId === sceneId)?.quotes.voice);
  return own ?? overview.scenes.map((scene) => unit(scene.quotes.voice)).find((value) => value !== null) ?? null;
}

/**
 * Said before saving a new voice: a voiced line is made again in it (with the scene's next keyframes or video,
 * at the voice-line price), and only new lines change when none is voiced yet.
 */
export function voiceImpact(shot: ShotOverview, unitMicros: number | null, locale: string): Msg {
  if (shot.narration.state === "ready" || shot.narration.state === "failed")
    return unitMicros !== null ? msg("narr.voice.impact.remake", { price: formatMicros(unitMicros, locale) }) : msg("narr.voice.impact.remake_unpriced");
  return msg("narr.voice.impact.new", { shot: shot.label });
}

/** Said before saving no narration: the person's recording, or the voice line, stops being used (both stay in Assets). */
export function noneImpact(shot: ShotOverview, mode?: NarrationMode, origin: TakeOrigin | null = null): Msg {
  const values = { shot: shot.label };
  if (recordingInUse(shot, mode, origin)) return msg("narr.none.impact.recording", values);
  return msg(shot.narration.state === "ready" ? "narr.none.impact.voiced" : "narr.none.impact", values);
}

/**
 * Said before going from the person's recording back to a line: the recording stops being used (it stays in
 * Assets) and a voice line is made, at the voice-line price (or "no price set", never $0.00).
 */
export function lineFromRecordingImpact(unitMicros: number | null, locale: string): Msg {
  return unitMicros !== null ? msg("narr.line.impact.recording", { price: formatMicros(unitMicros, locale) }) : msg("narr.line.impact.recording_unpriced");
}

// ---- the shot's current take -----------------------------------------------------------------------------

/** One narration recording as GET /narration/shots/:shotId describes it (only the fields read here). */
export interface NarrationAudioRead {
  id: string;
  media: { sha256: string; probe?: { audio?: { samples?: number } | null } };
  /** A recording the person supplied (uploaded, or declared as made elsewhere). */
  declaredOrigin?: "uploaded" | "generated";
  /** A line the studio voiced, with its verified evidence. */
  originEvidence?: "verified_generated_audio";
  generation?: { voice?: string; model?: string };
}

/** GET /narration/shots/:shotId: the shot's narration section and its recording (only the fields read here). */
export interface ShotNarrationRead {
  shotId: string;
  headVersion: number;
  segment: { audio?: NarrationAudioRead | null } | null;
}

export interface TakeView {
  /** The recording, played through GET /narration/audio/:audioId/content and checked against its SHA-256. */
  audio: StudioArtifactRef;
  seconds: number;
  origin: "voice" | "recording";
  /** "Voice line · 7.4 s · Cedar" or "Your recording · 4.2 s". */
  label: Msg;
  /** The player's accessible name. */
  name: Msg;
}

/**
 * The take a person can listen to: the shot's current voice line or recording. Only while the overview says the
 * line is voiced (its length is measured), so an out-of-date or failed take is never offered as the current one.
 * The section is read a moment after the overview moves: one whose recording has another length is still the
 * take before (a recording that just replaced a voice line), so nothing is offered until it is read again.
 */
export function takeView(shot: ShotOverview, read: ShotNarrationRead | null): TakeView | null {
  const audio = read && read.shotId === shot.shotId ? read.segment?.audio : null;
  if (shot.narration.state !== "ready" || !audio) return null;
  const samples = audio.media.probe?.audio?.samples;
  const measured = shot.narration.measuredSeconds;
  if (samples && measured !== undefined && Math.abs(samples / NARRATION_SAMPLE_RATE - measured) > 0.01) return null;
  const length = round1(shot.narration.measuredSeconds ?? (samples ? samples / NARRATION_SAMPLE_RATE : 0));
  const ref: StudioArtifactRef = { artifactId: audio.id, sha256: audio.media.sha256, kind: "audio" };
  if (audio.originEvidence !== "verified_generated_audio")
    return { audio: ref, seconds: length, origin: "recording", label: msg("narr.take.recording", { seconds: length }), name: msg("narr.take.recording_name", { shot: shot.label, seconds: length }) };
  const voice = audio.generation?.voice;
  const label = !voice ? msg("narr.take.voice_plain", { seconds: length })
    : isPersonalId(voice) ? msg("narr.take.voice_personal", { seconds: length })
    : msg("narr.take.voice", { seconds: length, voice: stockName(voice) });
  return { audio: ref, seconds: length, origin: "voice", label, name: msg("narr.take.voice_name", { shot: shot.label, seconds: length }) };
}

/** Where the shot's current take came from: the person's own recording, or a voice line the studio made. */
export type TakeOrigin = TakeView["origin"];

/** The current take's origin, from the shot's narration section; null while it is not known (not read yet, unreadable, not voiced). */
export const takeOrigin = (shot: ShotOverview, read: ShotNarrationRead | null): TakeOrigin | null => takeView(shot, read)?.origin ?? null;

/**
 * The person's recording is what the shot uses now: set to "My recording", voiced, and the take is not a voice
 * line. A shot set to "My recording" keeps its voice line until a recording is added (the studio then still uses
 * that voice line), so a take known to be a voice line is not the person's recording. An unknown take counts as
 * the recording, so leaving it is never said to be free.
 */
export function recordingInUse(shot: ShotOverview, mode: NarrationMode | undefined, origin: TakeOrigin | null): boolean {
  return mode === "uploaded" && shot.narration.state === "ready" && origin !== "voice";
}

/**
 * The voice line's state from the overview's narration slot: being made, failed, no answer from the service,
 * not voiced yet, or no recording yet. A voiced shot says nothing (its take plays), unless "My recording" is the
 * choice and the take is still a voice line: then it says the voice line plays until a recording is added.
 */
export function slotNote(shot: ShotOverview, mode: NarrationMode | undefined, origin: TakeOrigin | null = null): { message: Msg; tone: "plain" | "warn" } | null {
  const line = shot.narration;
  switch (line.state) {
    case "making": return { message: msg("narr.state.making"), tone: "plain" };
    case "failed": return { message: msg("narr.state.failed"), tone: "warn" };
    case "no_answer": return { message: msg("narr.state.no_answer"), tone: "warn" };
    case "text_only": return { message: msg(mode === "uploaded" ? "narr.state.no_recording" : "narr.state.not_voiced"), tone: "plain" };
    case "none": return mode === "uploaded" ? { message: msg("narr.state.no_recording"), tone: "plain" } : null;
    case "ready": return mode === "uploaded" && origin === "voice" ? { message: msg("narr.state.voice_until_recording"), tone: "plain" } : null;
  }
}

// ---- the inspector's narration row -------------------------------------------------------------------------

/**
 * The inspector's Narration row: the line (or "Your recording"), its measured or estimated length, its state
 * (being made, failed, no answer), and how a too-long line was settled. Drawn neutral; "warn" is bold text.
 * `origin` is the current take's (takeOrigin): a shot set to "My recording" whose take is still a voice line says
 * so, and a take not read yet is given only its length, never called the person's recording.
 */
export function narrationRow(shot: ShotOverview, fps: number, mode?: NarrationMode, origin: TakeOrigin | null = null): InspectorRow {
  const line = shot.narration;
  const label = msg("inspector.narration");
  const notes: InspectorRow["notes"] = [];
  const recording = mode === "uploaded";
  if (!recording && (line.state === "none" || !line.text.trim()))
    return { key: "narration", label, value: msg(mode === "undecided" ? "narr.row.undecided" : "inspector.narration.none"), quoted: false, notes: [] };
  if (recording) {
    if (line.state === "ready" && line.measuredSeconds !== undefined) {
      const seconds = round1(line.measuredSeconds);
      const said = origin === "recording" ? "narr.row.recording_measured" : origin === "voice" ? "narr.row.recording_voice" : "narr.row.recording_take";
      notes.push({ message: msg(said, { seconds }), tone: "plain" });
    } else notes.push({ message: msg("narr.row.recording_missing"), tone: "plain" });
  } else if (line.measuredSeconds !== undefined) notes.push({ message: msg("inspector.narration.measured", { seconds: round1(line.measuredSeconds) }), tone: "plain" });
  else if (line.estimatedSeconds !== undefined) notes.push({ message: msg("inspector.narration.estimated", { seconds: round1(line.estimatedSeconds) }), tone: "plain" });
  if (line.state === "making") notes.push({ message: msg("inspector.narration.making"), tone: "plain" });
  if (line.state === "failed") notes.push({ message: msg("inspector.narration.failed"), tone: "warn" });
  if (line.state === "no_answer") notes.push({ message: msg("narr.row.no_answer"), tone: "warn" });
  if (line.fit === "cut_to_shot") notes.push({ message: msg("inspector.line_cut", { seconds: seconds(shot.durationFrames, fps) }), tone: "plain" });
  else if (line.fits === false) notes.push({ message: msg("inspector.narration.too_long"), tone: "warn" });
  return recording
    ? { key: "narration", label, value: msg("narr.row.recording"), quoted: false, notes }
    : { key: "narration", label, value: line.text, quoted: true, notes };
}

// ---- the Plan shot editor ------------------------------------------------------------------------------

/**
 * Under the Plan editor's narration choice when it is "My recording": recordings are added on the shot in
 * Keyframes. `origin` is the current take's (takeOrigin): only a take known to be the person's own is called
 * their recording; a voice line still in use is named as one.
 */
export function planRecordingNote(shot: ShotOverview, mode: NarrationMode | undefined, origin: TakeOrigin | null = null): Msg {
  const line = shot.narration;
  if (mode === "uploaded" && line.state === "ready" && line.measuredSeconds !== undefined) {
    const values = { seconds: round1(line.measuredSeconds), shot: shot.label };
    if (origin === "recording") return msg("narr.plan.recording_has", values);
    if (origin === "voice") return msg("narr.plan.recording_voice", values);
    return msg("narr.plan.recording_unknown", values);
  }
  return msg("narr.plan.recording_add", { shot: shot.label });
}

/** The impact line's part for choosing "My recording" in the Plan editor; `replaces` when a voice line is in use now. */
export function planRecordingImpact(shot: ShotOverview): { message: Msg; replaces: boolean } {
  const replaces = shot.narration.state === "ready";
  return { message: msg(replaces ? "narr.plan.impact.replaces" : "narr.plan.impact.add", { shot: shot.label }), replaces };
}

/**
 * The impact line's part for leaving "My recording" in the Plan editor while the recording is in use: it stops
 * being used (it stays in Assets); for a line, a voice line is made at the voice-line price (never $0.00).
 */
export function planLeaveRecordingImpact(target: "none" | "line", shot: ShotOverview, voiceMicros: number | null, locale: string): Msg {
  const values = { shot: shot.label };
  if (target === "none") return msg("narr.plan.impact.recording_none", values);
  return voiceMicros !== null ? msg("narr.plan.impact.recording_line", { ...values, price: formatMicros(voiceMicros, locale) }) : msg("narr.plan.impact.recording_line_unpriced", values);
}

/**
 * A Plan row's narration when the shot is set to "My recording": the words given for it (the studio's stand-in
 * for none hidden) and what is there now. The row reads no take, so a voiced shot is given the take's length and
 * the choice, not called the person's recording.
 */
export function planRowRecording(shot: ShotOverview): { text: string; detail: Msg } {
  const line = shot.narration;
  const text = line.state === "none" ? "" : wordsOf(line.text).trim();
  if (line.state === "ready" && line.measuredSeconds !== undefined) {
    return { text, detail: msg("narr.plan.row.take", { seconds: round1(line.measuredSeconds) }) };
  }
  return { text, detail: msg("narr.plan.row.missing") };
}
