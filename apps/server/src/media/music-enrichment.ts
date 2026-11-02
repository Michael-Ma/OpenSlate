import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { invariant } from "@openslate/core";
import { GEMINI_AUDIO_DEFAULT_MODEL, GeminiHttpTransport, geminiAudioQuote, type GeminiAudioModel, type GeminiAudioQuote, type GeminiAudioTransport,
  type GeminiCharge, type GeminiUsage, GEMINI_AUDIO_PRICES } from "@openslate/providers";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "../narration/service.js";
import type { NarrationAudio } from "../narration/types.js";
import { FILM_FPS, type SongTiming } from "./song-timing.js";
import { localSongTiming, suggestedSectionShots } from "./music-analyzer.js";

/**
 * Gemini song listening for analyze_music's enrichment slot: section labels, vocal ranges, timed lyrics and a mood
 * per section. It only adds these; tempo, beats and length always come from the local analyzer. Section edges
 * are snapped to measured downbeats and every snap is recorded.
 *
 * Consent: a listen is paid (a few cents) and sends the song to Google, so it runs only when the person presses
 * "Analyze song" on that recording (once per recording bytes and analyzer version); the result is cached. The
 * Director's analyze_music never calls Gemini: it reads the cache or says what the person can press.
 */
export const MUSIC_ENRICHMENT_VERSION = "gemini-music@1";
export const SECTION_LABELS = Object.freeze(["intro", "verse", "pre-chorus", "chorus", "bridge", "solo", "outro"] as const);
export type SectionLabel = (typeof SECTION_LABELS)[number];
export const SECTION_ENERGY = Object.freeze(["low", "medium", "high"] as const);
export type SectionEnergy = (typeof SECTION_ENERGY)[number];
/** Inline audio only: 16 kHz mono PCM16 is 32 kB/s, so 8 minutes stays under the 20 MB request limit as base64. */
export const LISTEN_MAX_SECONDS = 480;
export const LISTEN_SAMPLE_RATE = 16000;
/** A generous estimate of the prompt's text tokens, for the quote. */
const PROMPT_TOKENS = 600;
const LIMITS = { sections: 40, vocals: 200, lyrics: 600, text: 300, mood: 60 } as const;
export const GEMINI_KEY_VARIABLE = "OPENSLATE_GEMINI_API_KEY";
export const AUDIO_LEAVES_MACHINE = "Analyze song sends this recording to Google (Gemini API). Tempo, beats and length are measured on this computer and never sent.";

// ---- schema and prompt ------------------------------------------------------------------------------------

const TIME = { type: "string", description: "Minutes:seconds from the start of the recording, with tenths when known, e.g. 1:05.5" };
const RANGE = { type: "object", properties: { start: TIME, end: TIME }, required: ["start", "end"] };
export function enrichmentSchema(): Record<string, unknown> {
  return { type: "object", properties: {
    canHear: { type: "boolean", description: "false when no audio reached you" },
    sections: { type: "array", maxItems: LIMITS.sections, items: { type: "object", properties: {
      label: { type: "string", enum: [...SECTION_LABELS] }, start: TIME, end: TIME,
      mood: { type: "string", description: "two to five words" }, energy: { type: "string", enum: [...SECTION_ENERGY] } },
    required: ["label", "start", "end", "mood", "energy"] } },
    vocals: { type: "array", maxItems: LIMITS.vocals, items: RANGE },
    lyrics: { type: "array", maxItems: LIMITS.lyrics, items: { type: "object", properties: { start: TIME, end: TIME, text: { type: "string" } }, required: ["start", "end", "text"] } },
  }, required: ["canHear", "sections", "vocals", "lyrics"] };
}
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
export function enrichmentPrompt(durationSeconds: number): string {
  const end = clock(durationSeconds);
  return [
    `Listen to this song recording. It lasts exactly ${end} (${durationSeconds.toFixed(2)} seconds). Describe only what you hear.`,
    `If no audio reached you, answer {"canHear": false, "sections": [], "vocals": [], "lyrics": []}. Never guess from names or metadata.`,
    `All times are minutes:seconds from the start of the recording, with tenths when you can (for example 1:05.5). No time is later than ${end}.`,
    "sections: the whole song in order, without gaps or overlaps. label is one of intro, verse, pre-chorus, chorus, bridge, solo, outro (use solo for an instrumental break). mood is two to five words. energy is low, medium or high.",
    "vocals: every range where a voice sings or speaks.",
    "lyrics: one entry per sung line with when it starts and ends and the words as sung. Leave out words you cannot make out and never invent lyrics. An instrumental has no lyrics.",
  ].join("\n");
}

// ---- validation, clamping and downbeat snapping (pure) --------------------------------------------------------

export interface MeasuredSong { durationFrames: number; beatFrames: readonly number[]; sectionStartFrames: readonly number[] }
export interface SnapMark { frame: number; movedFrames: number; to: "downbeat" | "edge" | "none" }
export interface EnrichedSection {
  label: SectionLabel; mood?: string; energy?: SectionEnergy;
  startSeconds: number; endSeconds: number; startFrame: number; endFrame: number;
  /** Shot lengths (30 fps frames, 90–450) that fill the snapped section on its beats. */
  suggestedShotFrames: number[];
  /** What Gemini reported, and where each edge moved. */
  snap: { reportedStartSeconds: number; reportedEndSeconds: number; start: SnapMark; end: SnapMark };
}
export interface TimedRange { startSeconds: number; endSeconds: number }
export interface TimedLyric extends TimedRange { text: string }
export interface EnrichmentAdjustments {
  /** Items whose start was at or after the measured end: dropped. */
  outOfRange: number;
  /** Ends past the measured end: clamped to it. */
  clampedEnds: number;
  /** Unreadable times, unknown labels, empty text: dropped. */
  invalid: number;
  /** Sections that became empty after snapping: dropped. */
  collapsedSections: number;
  /** Overlapping sections trimmed to the next one's start. */
  trimmedOverlaps: number;
}
export interface Downbeats { frames: number[]; beatsPerBar: 4; phase: number; source: "measured_beats" | "none" }
export interface EnrichmentResult { sections: EnrichedSection[]; vocalRanges: TimedRange[]; lyrics: TimedLyric[]; downbeats: Downbeats; adjustments: EnrichmentAdjustments }
export type ParsedEnrichment = { kind: "ok"; result: EnrichmentResult } | { kind: "unheard" } | { kind: "malformed"; code: string; reason: string };

/** "1:05.5", "01:05", "1:02:03.5" or a number of seconds; null for anything else. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || value.length > 16) return null;
  const text = value.trim();
  let match = /^(\d{1,3}):([0-5]?\d(?:\.\d{1,3})?)$/.exec(text);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  match = /^(\d{1,2}):([0-5]\d):([0-5]\d(?:\.\d{1,3})?)$/.exec(text);
  if (match) return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  match = /^(\d{1,5}(?:\.\d{1,3})?)s?$/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Downbeats from the measured beats, assuming four beats to the bar: every fourth beat, with the phase that puts
 * most measured section starts (bar-level loudness changes, already on beats) on a downbeat. Pure.
 */
export function measuredDownbeats(beatFrames: readonly number[], sectionStartFrames: readonly number[]): Downbeats {
  if (beatFrames.length < 8) return { frames: [], beatsPerBar: 4, phase: 0, source: "none" };
  const index = new Map(beatFrames.map((frame, i) => [frame, i]));
  let phase = 0, best = -1;
  for (let p = 0; p < 4; p++) {
    const score = sectionStartFrames.filter(start => start > 0 && index.has(start) && index.get(start)! % 4 === p).length;
    if (score > best) { best = score; phase = p; }
  }
  return { frames: beatFrames.filter((_, i) => i % 4 === phase), beatsPerBar: 4, phase, source: "measured_beats" };
}

/** Snap one edge: the song's own edges within 1 s, else the nearest downbeat within half a bar. Pure. */
export function snapEdge(frame: number, downbeats: readonly number[], durationFrames: number): SnapMark {
  if (frame <= FILM_FPS) return { frame: 0, movedFrames: -frame, to: frame === 0 ? "none" : "edge" };
  if (frame >= durationFrames - FILM_FPS) return { frame: durationFrames, movedFrames: durationFrames - frame, to: frame === durationFrames ? "none" : "edge" };
  if (downbeats.length < 2) return { frame, movedFrames: 0, to: "none" };
  const gaps = downbeats.slice(1).map((value, i) => value - downbeats[i]!).sort((a, b) => a - b);
  const bar = gaps[Math.floor(gaps.length / 2)]!;
  const nearest = downbeats.reduce((a, b) => Math.abs(b - frame) < Math.abs(a - frame) ? b : a);
  return Math.abs(nearest - frame) <= bar / 2 + 1 ? { frame: nearest, movedFrames: nearest - frame, to: "downbeat" } : { frame, movedFrames: 0, to: "none" };
}

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Validate Gemini's JSON against the measured song: clamp to its length, then snap sections to downbeats. Pure. */
export function parseEnrichment(text: string, measured: MeasuredSong): ParsedEnrichment {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { kind: "malformed", code: "GEMINI_OUTPUT_MALFORMED", reason: "Gemini's answer was not JSON" }; }
  const body = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!body || typeof body.canHear !== "boolean") return { kind: "malformed", code: "GEMINI_OUTPUT_MALFORMED", reason: "Gemini's answer does not match the requested shape" };
  if (!body.canHear) return { kind: "unheard" };
  if (![body.sections, body.vocals, body.lyrics].every(Array.isArray)) return { kind: "malformed", code: "GEMINI_OUTPUT_MALFORMED", reason: "Gemini's answer does not match the requested shape" };
  const duration = measured.durationFrames / FILM_FPS;
  const adjustments: EnrichmentAdjustments = { outOfRange: 0, clampedEnds: 0, invalid: 0, collapsedSections: 0, trimmedOverlaps: 0 };
  let timed = 0;
  /** A start/end pair inside the measured song, or null (counted). */
  const range = (item: unknown): (TimedRange & { raw: Record<string, unknown> }) | null => {
    const raw = item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const start = raw ? parseTimestamp(raw.start) : null, end = raw ? parseTimestamp(raw.end) : null;
    if (!raw || start === null || end === null || end <= start) { adjustments.invalid++; return null; }
    timed++;
    if (start >= duration) { adjustments.outOfRange++; return null; }
    if (end > duration) adjustments.clampedEnds++;
    return { startSeconds: start, endSeconds: Math.min(end, duration), raw };
  };
  const sectionItems = (body.sections as unknown[]).slice(0, LIMITS.sections).map(range).flatMap(item => {
    if (!item) return [];
    const label = item.raw.label;
    if (typeof label !== "string" || !(SECTION_LABELS as readonly string[]).includes(label)) { adjustments.invalid++; return []; }
    const mood = clean(item.raw.mood, LIMITS.mood), energy = item.raw.energy;
    return [{ ...item, label: label as SectionLabel, ...(mood ? { mood } : {}),
      ...(typeof energy === "string" && (SECTION_ENERGY as readonly string[]).includes(energy) ? { energy: energy as SectionEnergy } : {}) }];
  }).sort((a, b) => a.startSeconds - b.startSeconds);
  const vocalItems = (body.vocals as unknown[]).slice(0, LIMITS.vocals).map(range).filter(item => item !== null);
  const lyricItems = (body.lyrics as unknown[]).slice(0, LIMITS.lyrics).map(range).flatMap(item => {
    if (!item) return [];
    const words = clean(item.raw.text, LIMITS.text);
    if (!words) { adjustments.invalid++; return []; }
    return [{ startSeconds: round2(item.startSeconds), endSeconds: round2(item.endSeconds), text: words }];
  }).sort((a, b) => a.startSeconds - b.startSeconds);
  // Most times past the song's end means Gemini heard a different timescale: nothing it said can be placed.
  if (timed > 0 && adjustments.outOfRange * 2 > timed)
    return { kind: "malformed", code: "GEMINI_TIMESTAMPS_OUT_OF_RANGE", reason: "Most of Gemini's times are past the end of the measured song" };
  if (!sectionItems.length) return { kind: "malformed", code: "GEMINI_SECTIONS_MISSING", reason: "Gemini gave no usable sections" };

  const downbeats = measuredDownbeats(measured.beatFrames, measured.sectionStartFrames);
  const sections: EnrichedSection[] = [];
  sectionItems.forEach((item, i) => {
    const next = sectionItems[i + 1];
    let end = item.endSeconds;
    if (next && end > next.startSeconds) { end = next.startSeconds; adjustments.trimmedOverlaps++; }
    const start = snapEdge(Math.round(item.startSeconds * FILM_FPS), downbeats.frames, measured.durationFrames);
    const stop = snapEdge(Math.round(end * FILM_FPS), downbeats.frames, measured.durationFrames);
    const previous = sections.at(-1);
    const startFrame = previous ? Math.max(start.frame, previous.endFrame) : start.frame;
    if (stop.frame <= startFrame) { adjustments.collapsedSections++; return; }
    sections.push({ label: item.label, ...(item.mood ? { mood: item.mood } : {}), ...(item.energy ? { energy: item.energy } : {}),
      startSeconds: round2(startFrame / FILM_FPS), endSeconds: round2(stop.frame / FILM_FPS), startFrame, endFrame: stop.frame,
      suggestedShotFrames: suggestedSectionShots(startFrame, stop.frame, measured.beatFrames, null),
      snap: { reportedStartSeconds: round2(item.startSeconds), reportedEndSeconds: round2(item.endSeconds),
        start: startFrame === start.frame ? start : { frame: startFrame, movedFrames: startFrame - Math.round(item.startSeconds * FILM_FPS), to: "none" }, end: stop } });
  });
  if (!sections.length) return { kind: "malformed", code: "GEMINI_SECTIONS_MISSING", reason: "Gemini gave no usable sections" };
  // Vocal ranges: sorted and merged where they overlap.
  const vocalRanges: TimedRange[] = [];
  for (const item of vocalItems.sort((a, b) => a.startSeconds - b.startSeconds)) {
    const last = vocalRanges.at(-1);
    if (last && item.startSeconds <= last.endSeconds) last.endSeconds = round2(Math.max(last.endSeconds, item.endSeconds));
    else vocalRanges.push({ startSeconds: round2(item.startSeconds), endSeconds: round2(item.endSeconds) });
  }
  return { kind: "ok", result: { sections, vocalRanges, lyrics: lyricItems, downbeats, adjustments } };
}

/** The bpm-aware shot suggestion needs the tempo; re-run it with the measured bpm. Pure. */
function withTempo(result: EnrichmentResult, timing: Pick<SongTiming, "beatFrames" | "bpm">): EnrichmentResult {
  return { ...result, sections: result.sections.map(section => ({ ...section,
    suggestedShotFrames: suggestedSectionShots(section.startFrame, section.endFrame, timing.beatFrames, timing.bpm) })) };
}

// ---- listening audio ------------------------------------------------------------------------------------

/** A mono PCM16 WAV header at `rate` for `samples` samples. */
function wavHeader(samples: number, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(36 + samples * 2, 4); header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36, "ascii");
  header.writeUInt32LE(samples * 2, 40);
  return header;
}

/**
 * The audio Gemini hears: the owned normalized song (48 kHz stereo PCM16 WAV) downmixed to mono and averaged
 * three-to-one to 16 kHz. Gemini itself reduces audio to 16 kbps mono, so nothing it uses is lost.
 */
export async function listeningWav(path: string, signal?: AbortSignal): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.size >= 44, "AUDIO_PCM_INVALID", "Song must be an owned normalized recording");
    const head = Buffer.alloc(12); await file.read(head, 0, 12, 0);
    invariant(head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE", "AUDIO_PCM_INVALID", "Song is not a WAV recording");
    let offset = 12, data: { start: number; size: number } | null = null, format: { channels: number; rate: number; bits: number } | null = null;
    const chunk = Buffer.alloc(16);
    for (let n = 0; offset + 8 <= stat.size && !data && n < 64; n++) {
      await file.read(chunk, 0, 8, offset);
      const id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4);
      if (id === "fmt ") { await file.read(chunk, 0, 16, offset + 8); format = { channels: chunk.readUInt16LE(2), rate: chunk.readUInt32LE(4), bits: chunk.readUInt16LE(14) }; }
      else if (id === "data") data = { start: offset + 8, size: Math.min(size, stat.size - offset - 8) };
      offset += 8 + size + (size % 2);
    }
    invariant(format?.channels === 2 && format.rate === 48000 && format.bits === 16 && data, "AUDIO_PCM_INVALID", "Song must be normalized 48 kHz stereo PCM16");
    const groups = Math.floor(data.size / 12);
    invariant(groups > 0 && groups <= LISTEN_MAX_SECONDS * LISTEN_SAMPLE_RATE, "SONG_TOO_LONG", `Song analysis takes songs up to ${LISTEN_MAX_SECONDS / 60} minutes`);
    const out = Buffer.alloc(44 + groups * 2);
    wavHeader(groups, LISTEN_SAMPLE_RATE).copy(out, 0);
    const block = Buffer.alloc(12 * 87_381);
    for (let done = 0; done < groups;) {
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Song analysis was cancelled");
      const want = Math.min(87_381, groups - done) * 12;
      const { bytesRead } = await file.read(block, 0, want, data.start + done * 12);
      invariant(bytesRead === want, "AUDIO_PCM_INVALID", "Truncated song recording");
      for (let at = 0; at < want; at += 12, done++) {
        let sum = 0;
        for (let k = 0; k < 12; k += 2) sum += block.readInt16LE(at + k);
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / 6))), 44 + done * 2);
      }
    }
    return out;
  } finally { await file.close(); }
}

// ---- the listener -------------------------------------------------------------------------------------

export interface MusicEnrichmentQuote {
  model: GeminiAudioModel; audioSeconds: number;
  typicalMicros: number; maxMicros: number; typicalUsd: string; maxUsd: string;
  basis: string;
}
export type MusicEnrichment =
  | { state: "ready"; analyzer: string; model: string; sha256: string; analyzedAt: string; audioLeftMachine: string;
      sections: EnrichedSection[]; vocalRanges: TimedRange[]; lyrics: TimedLyric[]; downbeats: { count: number; beatsPerBar: 4; source: Downbeats["source"] };
      adjustments: EnrichmentAdjustments; cost: { estimatedMicros: number | null; estimatedUsd: string | null; usage: GeminiUsage }; note: string }
  | { state: "needs_confirmation"; reason: string; quote: MusicEnrichmentQuote; audioLeavesMachine: string; next: string }
  | { state: "running"; startedAt: string; quote: MusicEnrichmentQuote; next: string }
  | { state: "failed"; code: string; reason: string; charged: GeminiCharge; quote: MusicEnrichmentQuote; next: string }
  | { state: "unavailable"; code: string; reason: string };

interface ListenRecord {
  id: string; projectId: string; audioId: string; sha256: string; version: string; model: GeminiAudioModel;
  state: "running" | "done" | "failed"; pressedAt: string; principalId: "local-user"; quote: MusicEnrichmentQuote;
  finishedAt?: string; error?: { code: string; reason: string; charged: GeminiCharge };
}
interface EnrichmentRecord {
  id: string; projectId: string; audioId: string; sha256: string; version: string; model: GeminiAudioModel; analyzedAt: string;
  result: EnrichmentResult; usage: GeminiUsage; modelVersion: string | null; estimatedMicros: number | null;
}
export interface MusicListenerCredentials {
  status(): { credentials: ReadonlyArray<{ id: string; configured: boolean }> };
  resolve(id: "gemini-audio"): string;
}
export interface MusicListenerStatus {
  id: "gemini-music"; provider: "Google Gemini"; model: GeminiAudioModel; variable: typeof GEMINI_KEY_VARIABLE;
  configured: boolean; backendUnavailable: boolean; audioLeavesMachine: string;
  /** A typical three-minute song, for Settings. */
  typicalSongMicros: number;
}
export interface GeminiMusicListenerOptions {
  production: ProductionService; narration?: NarrationService; credentials: MusicListenerCredentials;
  /** Injected for tests; the default is the real HTTP transport. */
  transport?: (apiKey: string) => GeminiAudioTransport;
  model?: GeminiAudioModel; now?: () => Date;
}

export const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 3 : 2)}`;
const NEXT_PRESS = "Ask the person to press Analyze song on this recording in Assets; it shows the price and that the song goes to Google. Meanwhile plan from the measured timing. Never claim labels or lyrics you did not get.";

export class GeminiMusicListener {
  readonly id = "gemini-music";
  readonly model: GeminiAudioModel;
  readonly #production: ProductionService; readonly #narration: NarrationService | undefined; readonly #credentials: MusicListenerCredentials;
  readonly #transport: (apiKey: string) => GeminiAudioTransport; readonly #now: () => Date;
  readonly #inflight = new Map<string, Promise<void>>();
  constructor(options: GeminiMusicListenerOptions) {
    this.#production = options.production; this.#narration = options.narration; this.#credentials = options.credentials;
    this.#transport = options.transport ?? (apiKey => new GeminiHttpTransport({ apiKey }));
    this.model = options.model ?? GEMINI_AUDIO_DEFAULT_MODEL; this.#now = options.now ?? (() => new Date());
    invariant(Object.hasOwn(GEMINI_AUDIO_PRICES, this.model), "MUSIC_LISTENER_CONFIGURATION_INVALID", "Choose a priced Gemini audio model");
  }

  /** Key readiness for Settings; reads the variable by name only and never the value into a result. */
  status(): MusicListenerStatus {
    let configured = false, backendUnavailable = false;
    try { configured = this.#credentials.status().credentials.some(item => item.id === "gemini-audio" && item.configured); }
    catch { backendUnavailable = true; }
    return { id: this.id, provider: "Google Gemini", model: this.model, variable: GEMINI_KEY_VARIABLE, configured, backendUnavailable,
      audioLeavesMachine: AUDIO_LEAVES_MACHINE, typicalSongMicros: this.quote(180).typicalMicros };
  }

  quote(audioSeconds: number): MusicEnrichmentQuote {
    const quote: GeminiAudioQuote = geminiAudioQuote(this.model, audioSeconds, PROMPT_TOKENS, this.#now());
    return { model: this.model, audioSeconds: round2(audioSeconds), typicalMicros: quote.typicalMicros, maxMicros: quote.maxMicros,
      typicalUsd: usd(quote.typicalMicros), maxUsd: usd(quote.maxMicros),
      basis: `${quote.inputTokens} input tokens (32 per audio second), about ${quote.typicalOutputTokens} and at most ${quote.maxOutputTokens} output tokens, at ${this.model}'s paid price${quote.priceUntil ? ` until ${quote.priceUntil}` : ""}` };
  }

  /** What analyze_music and the Assets panel show. Never calls Gemini. */
  enrichment(projectId: string, audioId: string): MusicEnrichment {
    const audio = this.#recording(projectId, audioId), sha256 = audio.media.sha256;
    const cached = this.#production.store.get<EnrichmentRecord>("music_enrichment", this.#cacheId(projectId, sha256));
    if (cached?.projectId === projectId && cached.sha256 === sha256) return this.#ready(cached);
    const key = this.status();
    if (key.backendUnavailable) return { state: "unavailable", code: "MEDIA_CREDENTIAL_UNAVAILABLE", reason: "The key store on this computer could not be read." };
    if (!key.configured) return { state: "unavailable", code: "GEMINI_KEY_MISSING", reason: `Song analysis needs a Gemini key: set ${GEMINI_KEY_VARIABLE} on this computer and restart OpenSlate.` };
    const seconds = this.#seconds(audio);
    if (seconds > LISTEN_MAX_SECONDS) return { state: "unavailable", code: "SONG_TOO_LONG", reason: `Song analysis takes songs up to ${LISTEN_MAX_SECONDS / 60} minutes.` };
    const quote = this.quote(seconds);
    const listen = this.#production.store.get<ListenRecord>("music_listen", this.#listenId(projectId, audioId));
    if (listen && listen.sha256 === sha256 && listen.version === MUSIC_ENRICHMENT_VERSION && listen.model === this.model) {
      if (listen.state === "running" && this.#inflight.has(listen.id))
        return { state: "running", startedAt: listen.pressedAt, quote, next: "Gemini is listening. Read analyze_music again later; plan from the measured timing meanwhile." };
      if (listen.state === "running")
        return { state: "failed", code: "LISTEN_INTERRUPTED", reason: "OpenSlate stopped while Gemini was listening.", charged: "maybe", quote, next: NEXT_PRESS };
      if (listen.state === "failed" && listen.error)
        return { state: "failed", ...listen.error, quote, next: NEXT_PRESS };
    }
    return { state: "needs_confirmation", quote, audioLeavesMachine: AUDIO_LEAVES_MACHINE, next: NEXT_PRESS,
      reason: `Song analysis is paid (about ${quote.typicalUsd}, at most ${quote.maxUsd}) and sends the song to Google, so the person confirms it once for this recording.` };
  }

  /** The person's press. Returns at once; the listen runs in the background and its outcome is recorded. */
  listen(projectId: string, audioId: string, expectedSha256: string): MusicEnrichment {
    const audio = this.#recording(projectId, audioId);
    invariant(audio.media.sha256 === expectedSha256, "RECORDING_CHANGED", "This recording changed; look at it again before analyzing");
    const current = this.enrichment(projectId, audioId);
    if (current.state === "ready" || current.state === "running" || current.state === "unavailable") return current;
    invariant(this.#narration?.mediaAvailable, "NARRATION_MEDIA_UNAVAILABLE", "Song analysis needs local media tools");
    const id = this.#listenId(projectId, audioId);
    const record: ListenRecord = { id, projectId, audioId, sha256: audio.media.sha256, version: MUSIC_ENRICHMENT_VERSION, model: this.model,
      state: "running", pressedAt: this.#now().toISOString(), principalId: "local-user", quote: current.quote };
    this.#production.store.put("music_listen", id, projectId, record);
    // A store failure while recording the outcome leaves the record "running", which reads as interrupted.
    const run = this.#run(record, audio).catch(() => undefined).finally(() => this.#inflight.delete(id));
    this.#inflight.set(id, run);
    return this.enrichment(projectId, audioId);
  }

  /** Resolves when a running listen for this recording has finished (tests and shutdown). */
  async settled(projectId: string, audioId: string): Promise<void> { await this.#inflight.get(this.#listenId(projectId, audioId)); }

  async #run(record: ListenRecord, audio: NarrationAudio): Promise<void> {
    const store = this.#production.store;
    let dispatched = false;
    const fail = (code: string, reason: string, charged: GeminiCharge) =>
      store.put<ListenRecord>("music_listen", record.id, record.projectId, { ...record, state: "failed", finishedAt: this.#now().toISOString(), error: { code, reason, charged } });
    try {
      const timing = await localSongTiming(this.#production, this.#narration, audio);
      const { path } = await this.#narration!.media.verifiedSource(audio.media);
      const wav = await listeningWav(path);
      const transport = this.#transport(this.#credentials.resolve("gemini-audio"));
      dispatched = true;
      const answer = await transport.generate({ model: this.model, audio: { bytes: wav, sha256: createHash("sha256").update(wav).digest("hex"), mediaType: "audio/wav" },
        prompt: enrichmentPrompt(timing.durationFrames / FILM_FPS), responseSchema: enrichmentSchema() });
      if (answer.kind === "refused") return void fail("GEMINI_REFUSED", `Gemini declined to analyze this recording (${answer.reason}).`, answer.charged);
      if (answer.kind === "failed") return void fail(answer.error.code, failureReason(answer.error.code), answer.error.charged);
      const parsed = parseEnrichment(answer.text, timing);
      if (parsed.kind === "unheard") return void fail("GEMINI_COULD_NOT_HEAR", "Gemini reported that it could not hear the recording.", "maybe");
      if (parsed.kind === "malformed") return void fail(parsed.code, parsed.reason, "maybe");
      const analyzedAt = this.#now().toISOString();
      store.put<EnrichmentRecord>("music_enrichment", this.#cacheId(record.projectId, record.sha256), record.projectId, {
        id: this.#cacheId(record.projectId, record.sha256), projectId: record.projectId, audioId: record.audioId, sha256: record.sha256,
        version: MUSIC_ENRICHMENT_VERSION, model: this.model, analyzedAt, result: withTempo(parsed.result, timing), usage: answer.usage,
        modelVersion: answer.modelVersion, estimatedMicros: this.#spent(answer.usage) });
      store.put<ListenRecord>("music_listen", record.id, record.projectId, { ...record, state: "done", finishedAt: analyzedAt });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      fail(typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "LISTEN_FAILED",
        dispatched ? "The listen failed after the song was sent." : "The song could not be prepared on this computer; nothing was sent.", dispatched ? "maybe" : "no");
    }
  }

  #spent(usage: GeminiUsage): number | null {
    if (usage.inputTokens === null || usage.outputTokens === null) return null;
    const day = this.#now().toISOString().slice(0, 10);
    const row = GEMINI_AUDIO_PRICES[this.model].find(price => price.until === null || day <= price.until)!;
    return Math.ceil((usage.inputTokens * row.inputMicrosPerMillion + (usage.outputTokens + (usage.thoughtTokens ?? 0)) * row.outputMicrosPerMillion) / 1_000_000);
  }
  #ready(record: EnrichmentRecord): MusicEnrichment {
    const { result } = record;
    return { state: "ready", analyzer: record.version, model: record.modelVersion ?? record.model, sha256: record.sha256, analyzedAt: record.analyzedAt,
      audioLeftMachine: `This recording was sent to Google (${record.model}) when the person pressed Analyze song.`,
      sections: result.sections, vocalRanges: result.vocalRanges, lyrics: result.lyrics,
      downbeats: { count: result.downbeats.frames.length, beatsPerBar: 4, source: result.downbeats.source }, adjustments: result.adjustments,
      cost: { estimatedMicros: record.estimatedMicros, estimatedUsd: record.estimatedMicros === null ? null : usd(record.estimatedMicros), usage: record.usage },
      note: "Labels, vocal ranges, lyrics and moods are Gemini's listening; section edges are snapped to measured downbeats (snap shows each move). Tempo, beats and length above are measured locally." };
  }
  #recording(projectId: string, audioId: string): NarrationAudio {
    const audio = this.#production.store.get<NarrationAudio>("narration_audio", audioId);
    invariant(audio?.projectId === projectId && audio.media.kind === "audio", "NOT_FOUND", "Choose a recording owned by this film");
    return audio;
  }
  #seconds(audio: NarrationAudio): number {
    const samples = audio.media.probe.audio?.samples;
    return typeof samples === "number" && samples > 0 ? samples / 48000 : Number.POSITIVE_INFINITY;
  }
  #cacheId(projectId: string, sha256: string) { return `${projectId}:${sha256}:${MUSIC_ENRICHMENT_VERSION}:${this.model}`; }
  #listenId(projectId: string, audioId: string) { return `${projectId}:${audioId}`; }
}

function failureReason(code: string): string {
  switch (code) {
    case "GEMINI_AUTH_REJECTED": return "Google rejected the Gemini key.";
    case "GEMINI_RATE_LIMITED": return "Gemini is busy or the key's quota is used up; try again later.";
    case "GEMINI_INVALID_REQUEST": return "Gemini refused the request before listening.";
    case "GEMINI_OUTPUT_TRUNCATED": return "Gemini's answer was cut off.";
    case "GEMINI_CALL_TIMEOUT": return "Gemini did not answer in time.";
    default: return "Gemini could not finish the listen.";
  }
}
