import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Assets → a music recording → Song analysis (GET/POST /audio-library/:audioId/song-analysis). Gemini listens
 * only when the person presses Analyze song: it is paid and sends the song to Google, so the press shows the price
 * and says so. Tempo and beats are always measured locally; this adds labels, lyrics and moods.
 */
export const songAnalysisPath = (audioId: string) => `/audio-library/${encodeURIComponent(audioId)}/song-analysis`;

interface Quote { typicalMicros: number; maxMicros: number }
/** The server's MusicEnrichment, as far as this panel reads it. */
export type SongAnalysisState =
  | { state: "ready"; sections: unknown[]; lyrics: unknown[]; analyzedAt: string; model: string }
  | { state: "needs_confirmation"; quote: Quote }
  | { state: "running"; quote: Quote }
  | { state: "failed"; code: string; charged: "no" | "maybe"; quote: Quote }
  | { state: "unavailable"; code: string };

export interface SongAnalysisView {
  /** One line saying where things stand. */
  line: Msg;
  /** A second line: what a press does (sends the song to Google), or that it may have been charged. */
  note: Msg | null;
  /** The press, with its price; null when nothing can be pressed. */
  action: Msg | null;
  /** Read again shortly (Gemini is listening). */
  polling: boolean;
}

/** Pure: what the panel shows for one answer. */
export function songAnalysisView(answer: SongAnalysisState, locale: string): SongAnalysisView {
  const price = (quote: Quote) => ({ price: formatMicros(quote.typicalMicros, locale), max: formatMicros(quote.maxMicros, locale) });
  switch (answer.state) {
    case "ready":
      return { line: msg("assets.song.ready", { sections: answer.sections.length, lines: answer.lyrics.length }), note: msg("assets.song.ready_note"), action: null, polling: false };
    case "needs_confirmation":
      return { line: msg("assets.song.offer", price(answer.quote)), note: msg("assets.song.leaves"), action: msg("assets.song.press", price(answer.quote)), polling: false };
    case "running":
      return { line: msg("assets.song.running"), note: null, action: null, polling: true };
    case "failed":
      return { line: msg(answer.code === "LISTEN_INTERRUPTED" ? "assets.song.interrupted" : "assets.song.failed", { code: answer.code }),
        note: answer.charged === "maybe" ? msg("assets.song.maybe_charged") : msg("assets.song.not_charged"), action: msg("assets.song.retry", price(answer.quote)), polling: false };
    case "unavailable": {
      const line = answer.code === "GEMINI_KEY_MISSING" ? msg("assets.song.no_key")
        : answer.code === "SONG_TOO_LONG" ? msg("assets.song.too_long")
        : answer.code === "SAMPLE_FILM" ? msg("assets.song.sample")
        : msg("assets.song.unavailable", { code: answer.code });
      return { line, note: null, action: null, polling: false };
    }
  }
}
