/**
 * Clip audio: the sound a generated clip carries itself (MiniMax H3 through Viggle makes sound effects and ambience
 * with every clip). Browser-safe and pure; the server and the Film view share these rules
 * (docs/ai/clip-audio/2026-10-28-clip-audio.md).
 *
 * Mix rules:
 * - A kept clip's sound plays from the clip's first sample, at the shot's start, for at most the shot's length.
 * - Its level is the shot's own gain, or the bed gain (-6 dB). The music bed defaults to -18 dB, so clip sound sits
 *   above the music; the music itself is never ducked (there are no other ducking rules in the mix).
 * - Under narration and voice lines the clip sound drops a further 12 dB (floor -60 dB), for exactly the time the
 *   voice plays. Voice and music levels do not change.
 */

/** Per-shot choice. Absent: the project default applies (older projects: muted). */
export interface ShotClipAudio {
  keep: boolean;
  /** Clip sound level in milli-dB, -60000..0. Absent: the bed gain. */
  gainMilliDb?: number;
}

export const CLIP_AUDIO_BED_GAIN_MILLI_DB = -6000;
export const CLIP_AUDIO_DUCK_MILLI_DB = -12000;
export const CLIP_AUDIO_MIN_GAIN_MILLI_DB = -60000;
export const CLIP_AUDIO_MAX_GAIN_MILLI_DB = 0;

export type ClipAudioDefaultReason = "social" | "comedy" | "music_video" | "none";
export interface ClipAudioDefault { keep: boolean; gainMilliDb: number; reason: ClipAudioDefaultReason }

/**
 * The project default from an already-read film kind (`kind` and `tones` of film-kind@1). A music video is muted
 * (the song is the track), even with a comedy tone; a social film (skit is its subtype) or a comedy keeps clip sound.
 * Anything else, and a project without a film kind, is muted, so older projects are unchanged.
 */
export function clipAudioDefaultFor(film: { kind?: unknown; tones?: unknown } | null | undefined): ClipAudioDefault {
  const kind = film && typeof film === "object" ? film.kind : undefined;
  const tones = film && typeof film === "object" && Array.isArray(film.tones) ? film.tones : [];
  const reason: ClipAudioDefaultReason = kind === "music_video" ? "music_video" : kind === "social" ? "social" : tones.includes("comedy") ? "comedy" : "none";
  return { keep: reason === "social" || reason === "comedy", gainMilliDb: CLIP_AUDIO_BED_GAIN_MILLI_DB, reason };
}

/** What a shot plays: its own choice over the default; `source` says which. */
export function effectiveShotClipAudio(shot: { clipAudio?: ShotClipAudio }, fallback: ClipAudioDefault): { keep: boolean; gainMilliDb: number; source: "shot" | "default" } {
  const own = shot.clipAudio;
  if (!own) return { keep: fallback.keep, gainMilliDb: fallback.gainMilliDb, source: "default" };
  return { keep: own.keep, gainMilliDb: own.gainMilliDb ?? fallback.gainMilliDb, source: "shot" };
}

export function isClipAudioGain(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= CLIP_AUDIO_MIN_GAIN_MILLI_DB && (value as number) <= CLIP_AUDIO_MAX_GAIN_MILLI_DB;
}

export interface ClipAudioSpan { atSample: number; durationSamples: number }
export interface ClipAudioSegment { startSample: number; durationSamples: number; atSample: number; gainMilliDb: number }

/** Voice spans sorted and merged, so overlapping or touching lines duck once. */
export function mergeSpans(spans: readonly ClipAudioSpan[]): ClipAudioSpan[] {
  const sorted = spans.filter(s => s.durationSamples > 0).map(s => ({ ...s })).sort((a, b) => a.atSample - b.atSample);
  const merged: ClipAudioSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.atSample <= last.atSample + last.durationSamples)
      last.durationSamples = Math.max(last.durationSamples, span.atSample + span.durationSamples - last.atSample);
    else merged.push(span);
  }
  return merged;
}

/**
 * One kept clip's sound as contiguous fixed-gain pieces: the base gain, and base + duck while a voice plays.
 * The renderer mixes fixed-gain placements only, so ducking is these gain steps; the preview applies the same steps.
 */
export function clipAudioSegments(base: ClipAudioSegment, voices: readonly ClipAudioSpan[], duckMilliDb = CLIP_AUDIO_DUCK_MILLI_DB): ClipAudioSegment[] {
  if (base.durationSamples <= 0) return [];
  const end = base.atSample + base.durationSamples;
  const ducked = Math.max(CLIP_AUDIO_MIN_GAIN_MILLI_DB, base.gainMilliDb + duckMilliDb);
  const pieces: ClipAudioSegment[] = [];
  const push = (from: number, to: number, gainMilliDb: number) => {
    if (to <= from) return;
    const last = pieces.at(-1);
    if (last && last.gainMilliDb === gainMilliDb && last.atSample + last.durationSamples === from) { last.durationSamples += to - from; return; }
    pieces.push({ startSample: base.startSample + (from - base.atSample), durationSamples: to - from, atSample: from, gainMilliDb });
  };
  let cursor = base.atSample;
  for (const voice of mergeSpans(voices)) {
    const from = Math.max(voice.atSample, base.atSample), to = Math.min(voice.atSample + voice.durationSamples, end);
    if (to <= from) continue;
    push(cursor, from, base.gainMilliDb);
    push(from, to, ducked);
    cursor = to;
  }
  push(cursor, end, base.gainMilliDb);
  return pieces;
}
