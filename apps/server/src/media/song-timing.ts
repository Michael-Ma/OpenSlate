import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { invariant } from "@openslate/core";

/**
 * Song timing for music videos: tempo, a beat grid and section starts from a normalized 48 kHz stereo PCM16
 * recording, and a fit of the film's shot lengths to the song. Analysis is local and deterministic (energy flux,
 * autocorrelation tempo, bar-level novelty); it never calls a provider. All positions are 30 fps film frames.
 */
export const SONG_SAMPLE_RATE = 48000;
export const FILM_FPS = 30;
/** 10 ms hops: a 100 Hz onset envelope. */
const HOP = 480;
const HOPS_PER_SECOND = SONG_SAMPLE_RATE / HOP;
const MIN_BPM = 60, MAX_BPM = 200, PREFERRED_BPM = 120;
/** Below this periodicity the beat grid is not trusted; only the length and sections are reported. */
const TEMPO_CONFIDENCE = 0.12;
const MAX_SECTIONS = 12;
export const SONG_TIMING_VERSION = "song-timing@1";

export interface SongTiming {
  version: typeof SONG_TIMING_VERSION;
  durationSamples: number;
  durationFrames: number;
  /** Null when the recording has no steady beat (speech, ambient, rubato). */
  bpm: number | null;
  /** Beat positions in film frames from the start of the recording; empty without a steady beat. */
  beatFrames: number[];
  /** Section starts in film frames, always beginning with 0. */
  sectionStartFrames: number[];
}

/** Incremental envelope of interleaved stereo PCM16, so a six-minute song never has to be held in memory. */
export class SongEnvelope {
  readonly #energies: number[] = [];
  #acc = 0;
  #count = 0;
  #samples = 0;
  /** Whole stereo frames only (a multiple of 4 bytes). */
  push(bytes: Uint8Array): void {
    invariant(bytes.byteLength % 4 === 0, "AUDIO_PCM_INVALID", "Song chunks must hold whole stereo frames");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 0; offset < bytes.byteLength; offset += 4) this.#frame((view.getInt16(offset, true) + view.getInt16(offset + 2, true)) / 65536);
  }
  /** Mono samples in [-1, 1), for tests and in-memory sources. */
  pushMono(samples: ArrayLike<number>): void { for (let i = 0; i < samples.length; i++) this.#frame(samples[i]!); }
  #frame(sample: number): void {
    this.#acc += sample * sample;
    this.#samples++;
    if (++this.#count === HOP) { this.#energies.push(this.#acc / HOP); this.#acc = 0; this.#count = 0; }
  }
  get samples(): number { return this.#samples; }
  energies(): Float64Array { return Float64Array.from(this.#count ? [...this.#energies, this.#acc / this.#count] : this.#energies); }
}

/** Analyze an envelope. Pure and deterministic. */
export function analyzeSongTiming(envelope: Float64Array, durationSamples: number): SongTiming {
  invariant(Number.isSafeInteger(durationSamples) && durationSamples > 0, "MEDIA_SOURCE_UNAVAILABLE", "Song length must be measured");
  const durationFrames = Math.max(1, Math.round(durationSamples * FILM_FPS / SONG_SAMPLE_RATE));
  const n = envelope.length;
  const log = Float64Array.from(envelope, (e) => Math.log(e + 1e-9));
  const onset = new Float64Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, log[i]! - log[i - 1]!);
  // Remove the slowly varying part so loud passages do not dominate the periodicity.
  const local = movingMean(onset, 50);
  for (let i = 0; i < n; i++) onset[i] = Math.max(0, onset[i]! - local[i]!);

  const tempo = estimateTempo(onset);
  let bpm: number | null = null, beatFrames: number[] = [];
  if (tempo) {
    bpm = Math.round(60 * HOPS_PER_SECOND / tempo.period * 10) / 10;
    const phase = beatPhase(onset, tempo.period);
    for (let t = phase; t < n; t += tempo.period) {
      const frame = Math.round(t / HOPS_PER_SECOND * FILM_FPS);
      if (frame < durationFrames && frame !== beatFrames.at(-1)) beatFrames.push(frame);
    }
  }
  return { version: SONG_TIMING_VERSION, durationSamples, durationFrames, bpm, beatFrames, sectionStartFrames: sections(log, tempo?.period ?? null, beatFrames, durationFrames) };
}

function movingMean(values: Float64Array, radius: number): Float64Array {
  const out = new Float64Array(values.length), prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(0, i - radius), b = Math.min(values.length, i + radius + 1);
    out[i] = (prefix[b]! - prefix[a]!) / (b - a);
  }
  return out;
}

/** Autocorrelation over 60–200 BPM, weighted towards 120 BPM to settle octave ambiguity. */
function estimateTempo(onset: Float64Array): { period: number; confidence: number } | null {
  const n = onset.length;
  const minLag = Math.floor(60 * HOPS_PER_SECOND / MAX_BPM), maxLag = Math.ceil(60 * HOPS_PER_SECOND / MIN_BPM);
  if (n < maxLag * 4) return null;
  // Centered correlation: noise scores near 0, a steady beat near 1 at its period.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i]!;
  mean /= n;
  const centered = Float64Array.from(onset, (value) => value - mean);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += centered[i]! * centered[i]!;
  if (energy <= 0) return null;
  const raw = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += centered[i]! * centered[i + lag]!;
    raw[lag] = sum / (n - lag) * n / energy;
  }
  let best = -1, bestScore = -Infinity;
  const preferredLag = 60 * HOPS_PER_SECOND / PREFERRED_BPM;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const weight = Math.exp(-0.5 * (Math.log2(lag / preferredLag) / 0.9) ** 2);
    const score = raw[lag]! * weight;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  const confidence = raw[best]!;
  if (best < 0 || confidence < TEMPO_CONFIDENCE) return null;
  // Parabolic refinement between neighbouring lags.
  const a = raw[best - 1]!, b = raw[best]!, c = raw[best + 1]!;
  const denominator = a - 2 * b + c;
  const shift = denominator < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denominator)) : 0;
  // Refine further with the onset comb over the whole song: small period errors accumulate over a minute.
  let period = best + shift, combBest = -Infinity;
  for (let p = period - 0.5; p <= period + 0.5 + 1e-9; p += 0.02) {
    const score = comb(onset, p, beatPhase(onset, p));
    if (score > combBest) { combBest = score; period = p; }
  }
  return { period, confidence };
}

function comb(onset: Float64Array, period: number, phase: number): number {
  let score = 0;
  for (let t = phase; t < onset.length; t += period) {
    const i = Math.round(t);
    score += Math.max(onset[i] ?? 0, 0.5 * (onset[i - 1] ?? 0), 0.5 * (onset[i + 1] ?? 0));
  }
  return score;
}

function beatPhase(onset: Float64Array, period: number): number {
  let best = 0, bestScore = -Infinity;
  for (let phase = 0; phase < period; phase++) {
    const score = comb(onset, period, phase);
    if (score > bestScore) { bestScore = score; best = phase; }
  }
  return best;
}

/** Section starts where the bar-level loudness changes most, at least eight seconds apart, snapped to beats. */
function sections(log: Float64Array, period: number | null, beatFrames: number[], durationFrames: number): number[] {
  const window = Math.max(1, Math.round(period ? period * 4 : 2 * HOPS_PER_SECOND));
  const bars: number[] = [];
  for (let i = 0; i + window <= log.length; i += window) {
    let sum = 0;
    for (let j = i; j < i + window; j++) sum += log[j]!;
    bars.push(sum / window);
  }
  const span = 4, novelty: number[] = [];
  for (let j = 0; j < bars.length; j++) {
    if (j < span || j + span > bars.length) { novelty.push(0); continue; }
    let before = 0, after = 0;
    for (let k = 1; k <= span; k++) { before += bars[j - k]!; after += bars[j + k - 1]!; }
    novelty.push(Math.abs(after - before) / span);
  }
  const values = novelty.filter((value) => value > 0);
  if (!values.length) return [0];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  const threshold = Math.max(mean + deviation, 0.5);
  const minGap = 8 * FILM_FPS;
  const candidates = novelty
    .map((value, j) => ({ value, j }))
    .filter(({ value, j }) => value >= threshold && value >= (novelty[j - 1] ?? 0) && value >= (novelty[j + 1] ?? 0))
    .sort((a, b) => b.value - a.value);
  const starts = [0];
  for (const { j } of candidates) {
    if (starts.length >= MAX_SECTIONS) break;
    let frame = Math.round(j * window / HOPS_PER_SECOND * FILM_FPS);
    if (beatFrames.length) frame = nearest(beatFrames, frame);
    if (frame <= 0 || frame >= durationFrames - minGap / 2) continue;
    if (starts.every((start) => Math.abs(start - frame) >= minGap)) starts.push(frame);
  }
  return starts.sort((a, b) => a - b);
}

function nearest(sorted: readonly number[], value: number): number {
  let best = sorted[0]!;
  for (const candidate of sorted) if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  return best;
}

/** Read a normalized 48 kHz stereo PCM16 WAV the application owns and analyze it. */
export async function analyzeSongFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<SongTiming> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.size >= 44 && stat.size <= maxBytes, "AUDIO_PCM_INVALID", "Song must be a bounded normalized recording");
    const header = Buffer.alloc(12);
    await file.read(header, 0, 12, 0);
    invariant(header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WAVE", "AUDIO_PCM_INVALID", "Song is not a WAV recording");
    let offset = 12, data: { start: number; size: number } | null = null, format: { channels: number; rate: number; bits: number } | null = null;
    const chunk = Buffer.alloc(24);
    while (offset + 8 <= stat.size && !data) {
      await file.read(chunk, 0, 8, offset);
      const id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4);
      if (id === "fmt ") {
        await file.read(chunk, 0, 16, offset + 8);
        format = { channels: chunk.readUInt16LE(2), rate: chunk.readUInt32LE(4), bits: chunk.readUInt16LE(14) };
      } else if (id === "data") data = { start: offset + 8, size: Math.min(size, stat.size - offset - 8) };
      offset += 8 + size + (size % 2);
    }
    invariant(format?.channels === 2 && format.rate === SONG_SAMPLE_RATE && format.bits === 16 && data, "AUDIO_PCM_INVALID", "Song must be normalized 48 kHz stereo PCM16");
    const envelope = new SongEnvelope(), buffer = Buffer.alloc(1 << 20);
    for (let at = 0; at < data.size;) {
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Song analysis cancelled");
      const want = Math.min(buffer.length, data.size - at) & ~3;
      if (want <= 0) break;
      const { bytesRead } = await file.read(buffer, 0, want, data.start + at);
      invariant(bytesRead > 0, "AUDIO_PCM_INVALID", "Truncated song recording");
      envelope.push(buffer.subarray(0, bytesRead - (bytesRead % 4)));
      at += bytesRead - (bytesRead % 4);
    }
    return analyzeSongTiming(envelope.energies(), envelope.samples);
  } finally { await file.close(); }
}

// ---- fitting the film to the song -------------------------------------------------------------

export interface FitShot { id: string; sceneId: string; desiredFrames: number; /** e.g. an accepted voice line */ minFrames?: number }
export interface SongFit {
  /** Film length the song asks for: the music's start offset plus the song. */
  targetFrames: number;
  /** The length these shots reach within 3–15 s each; differs from the target when there are too few or too many shots. */
  totalFrames: number;
  timings: Array<{ id: string; desiredFrames: number }>;
  /** Frames of song left uncovered (add shots), or film beyond the song (remove shots). */
  shortfallFrames: number;
  overflowFrames: number;
  /** Cuts that landed on a section start or a beat. */
  snapped: { sections: number; beats: number };
}
export const MIN_SHOT_FRAMES = 90, MAX_SHOT_FRAMES = 450;

/**
 * Shot lengths that make the film as long as the song, keeping the current proportions, with scene ends on
 * section starts and other cuts on beats when that keeps every shot within its limits. Pure.
 */
export function fitShotsToSong(shots: readonly FitShot[], timing: Pick<SongTiming, "durationFrames" | "beatFrames" | "sectionStartFrames" | "bpm">, startFrame = 0, maxFilmFrames = 10800): SongFit {
  invariant(Number.isSafeInteger(startFrame) && startFrame >= 0, "VALIDATION_ERROR", "Music start must be a whole frame");
  const targetFrames = Math.min(maxFilmFrames, startFrame + timing.durationFrames);
  const n = shots.length;
  if (!n) return { targetFrames, totalFrames: 0, timings: [], shortfallFrames: targetFrames, overflowFrames: 0, snapped: { sections: 0, beats: 0 } };
  const mins = shots.map((shot) => Math.min(MAX_SHOT_FRAMES, Math.max(MIN_SHOT_FRAMES, shot.minFrames ?? 0)));
  const minTotal = mins.reduce((a, b) => a + b, 0), maxTotal = n * MAX_SHOT_FRAMES;
  const total = Math.max(minTotal, Math.min(maxTotal, targetFrames));
  const weights = shots.map((shot) => Math.max(1, shot.desiredFrames));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  // Song positions are relative to the recording; the film timeline adds the music's start offset.
  const beats = timing.beatFrames.map((frame) => frame + startFrame);
  const sectionStarts = timing.sectionStartFrames.filter((frame) => frame > 0).map((frame) => frame + startFrame);
  const beatTolerance = timing.bpm ? Math.ceil(60 / timing.bpm * FILM_FPS) : 0;
  const suffixMin = mins.map((_, i) => mins.slice(i).reduce((a, b) => a + b, 0));
  const timings: SongFit["timings"] = [];
  const snapped = { sections: 0, beats: 0 };
  let previous = 0, cumulative = 0;
  for (let i = 0; i < n; i++) {
    cumulative += weights[i]!;
    if (i === n - 1) { timings.push({ id: shots[i]!.id, desiredFrames: total - previous }); break; }
    const remaining = n - i - 1;
    // This cut must leave the shot and the remaining shots within their limits.
    const low = Math.max(previous + mins[i]!, total - remaining * MAX_SHOT_FRAMES);
    const high = Math.min(previous + MAX_SHOT_FRAMES, total - suffixMin[i + 1]!);
    const ideal = Math.round(total * cumulative / weightSum);
    let cut = Math.max(low, Math.min(high, ideal));
    const sceneEnd = shots[i + 1]!.sceneId !== shots[i]!.sceneId;
    const pick = (candidates: number[], tolerance: number) => {
      let best: number | null = null;
      for (const candidate of candidates)
        if (candidate >= low && candidate <= high && Math.abs(candidate - ideal) <= tolerance && (best === null || Math.abs(candidate - ideal) < Math.abs(best - ideal))) best = candidate;
      return best;
    };
    const section = sceneEnd ? pick(sectionStarts, 3 * FILM_FPS) : null;
    const beat = section === null && beatTolerance ? pick(beats, beatTolerance) : null;
    if (section !== null) { cut = section; snapped.sections++; }
    else if (beat !== null) { cut = beat; snapped.beats++; }
    timings.push({ id: shots[i]!.id, desiredFrames: cut - previous });
    previous = cut;
  }
  return { targetFrames, totalFrames: total, timings, shortfallFrames: Math.max(0, targetFrames - total), overflowFrames: Math.max(0, total - targetFrames), snapped };
}
