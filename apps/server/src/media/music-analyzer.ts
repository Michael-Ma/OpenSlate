import { invariant } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "../narration/service.js";
import type { NarrationAudio } from "../narration/types.js";
import { storyboardAudioCuts } from "../narration/audio-placement.js";
import type { MusicEnrichment } from "./music-enrichment.js";
import { analyzeSongFile, FILM_FPS, fitShotsToSong, MAX_SHOT_FRAMES, MIN_SHOT_FRAMES, SONG_TIMING_VERSION, type FitShot, type SongTiming } from "./song-timing.js";

/**
 * Provider-neutral music analysis. Every analyzer returns the same shape; fields an analyzer cannot measure are
 * absent, never guessed. Analysis is read-only: it never changes the film, its soundtrack or any shot.
 */
export interface MusicAnalysis {
  audioId: string;
  sha256: string;
  analyzer: string;
  durationSeconds: number;
  /** Exact length in 30 fps film frames. */
  durationFrames: number;
  tempo: { bpm: number | null };
  beats: { frames: number[]; fps: typeof FILM_FPS };
  sections: MusicSection[];
  /** Ranges where a voice sings; absent when the analyzer cannot tell. */
  vocalRanges?: Array<{ startSeconds: number; endSeconds: number }>;
  /** Timed lyric lines; absent when the analyzer cannot transcribe. */
  lyrics?: Array<{ startSeconds: number; endSeconds: number; text: string }>;
  /**
   * The listening slot (Gemini): labelled, downbeat-snapped sections, vocal ranges, timed lyrics and moods when
   * ready; otherwise why not (no key, needs the person's confirmation, running, failed). Never replaces timing.
   */
  enrichment?: MusicEnrichment;
}
export interface MusicSection {
  startSeconds: number;
  endSeconds: number;
  startFrame: number;
  endFrame: number;
  /** verse, chorus, bridge... absent when unknown. */
  label?: string;
  /** Shot lengths (30 fps frames, 90–450) that fill the section on its beats. */
  suggestedShotFrames: number[];
}
export interface MusicAnalyzerInput { project: ProjectRecord; audio: NarrationAudio; signal?: AbortSignal }
export interface MusicAnalyzer {
  readonly id: string;
  analyze(input: MusicAnalyzerInput): Promise<MusicAnalysis>;
}

/** Shots in film order with their lengths and accepted within-shot narration floors, as the song fit reads them. */
export function songFitShots(project: ProjectRecord): FitShot[] {
  return storyboardAudioCuts(project).map(cut => project.shots.find(shot => shot.id === cut.shotId)!).map(shot => {
    const cue = project.cues.find(cue => cue.id === shot.cueId);
    return { id: shot.id, sceneId: shot.sceneId, desiredFrames: shot.desiredFrames,
      ...(shot.narrationTimingMode === "within_shot" && cue?.accepted ? { minFrames: cue.durationFrames } : {}) };
  });
}

interface SongTimingRecord { id: string; projectId: string; sha256: string; timing: SongTiming }
/** Song timing is derived from the exact normalized bytes, once, and cached beside the recording. */
export async function localSongTiming(production: ProductionService, narration: NarrationService | undefined, audio: NarrationAudio): Promise<SongTiming> {
  const store = production.store, cached = store.get<SongTimingRecord>("song_timing", audio.id);
  if (cached?.projectId === audio.projectId && cached.sha256 === audio.media.sha256 && cached.timing.version === SONG_TIMING_VERSION) return cached.timing;
  invariant(narration?.mediaAvailable, "NARRATION_MEDIA_UNAVAILABLE", "Song timing needs local media tools");
  const { path } = await narration.media.verifiedSource(audio.media);
  const timing = await analyzeSongFile(path, 128 * 1024 * 1024);
  store.put<SongTimingRecord>("song_timing", audio.id, audio.projectId, { id: audio.id, projectId: audio.projectId, sha256: audio.media.sha256, timing });
  return timing;
}

/** Shot lengths that cover one section, cut on beats where they fall inside 3–15 s. Pure. */
export function suggestedSectionShots(startFrame: number, endFrame: number, beatFrames: readonly number[], bpm: number | null): number[] {
  const length = endFrame - startFrame;
  if (length <= 0) return [];
  if (length < MIN_SHOT_FRAMES) return [MIN_SHOT_FRAMES];
  // About two bars per shot when the tempo is known; otherwise about 4 s.
  const preferred = bpm ? Math.min(MAX_SHOT_FRAMES, Math.max(MIN_SHOT_FRAMES, Math.round(8 * 60 * FILM_FPS / bpm))) : 120;
  const count = Math.max(1, Math.round(length / preferred));
  const cuts: number[] = [];
  for (let index = 1; index < count; index++) {
    const ideal = startFrame + Math.round(length * index / count);
    const beat = beatFrames.filter(frame => frame > startFrame && frame < endFrame).reduce<number | null>((best, frame) =>
      best === null || Math.abs(frame - ideal) < Math.abs(best - ideal) ? frame : best, null);
    cuts.push(beat !== null && Math.abs(beat - ideal) <= preferred / 4 ? beat : ideal);
  }
  const edges = [startFrame, ...cuts, endFrame];
  const lengths = edges.slice(1).map((edge, index) => edge - edges[index]!);
  if (lengths.every(value => value >= MIN_SHOT_FRAMES && value <= MAX_SHOT_FRAMES)) return lengths;
  // Off-beat fallback: equal parts within 3–15 s.
  const parts = Math.min(Math.max(count, Math.ceil(length / MAX_SHOT_FRAMES)), Math.max(1, Math.floor(length / MIN_SHOT_FRAMES)));
  const base = Math.floor(length / parts), extra = length - base * parts;
  return Array.from({ length: parts }, (_, index) => Math.min(MAX_SHOT_FRAMES, base + (index < extra ? 1 : 0)));
}

/** The default analyzer: the same local timing as GET audio-library/:audioId/timing. No network, no provider. */
export class LocalMusicAnalyzer implements MusicAnalyzer {
  readonly id = "local-song-timing@1";
  constructor(private readonly production: ProductionService, private readonly narration?: NarrationService) {}
  async analyze({ audio }: MusicAnalyzerInput): Promise<MusicAnalysis> {
    const timing = await localSongTiming(this.production, this.narration, audio);
    const seconds = (frame: number) => Math.round(frame / FILM_FPS * 100) / 100;
    const starts = timing.sectionStartFrames.length ? timing.sectionStartFrames : [0];
    return {
      audioId: audio.id, sha256: audio.media.sha256, analyzer: this.id,
      durationSeconds: Math.round(timing.durationSamples / 48000 * 100) / 100, durationFrames: timing.durationFrames,
      tempo: { bpm: timing.bpm }, beats: { frames: timing.beatFrames, fps: FILM_FPS },
      sections: starts.map((start, index) => {
        const end = starts[index + 1] ?? timing.durationFrames;
        return { startSeconds: seconds(start), endSeconds: seconds(end), startFrame: start, endFrame: end, suggestedShotFrames: suggestedSectionShots(start, end, timing.beatFrames, timing.bpm) };
      }),
    };
  }
}

/** A listener for the enrichment slot. It reports cached or pending listening and never spends on its own. */
export interface MusicEnricher {
  readonly id: string;
  enrichment(projectId: string, audioId: string): MusicEnrichment;
}
/**
 * Analyzer slots. "local" always runs first so beats and length stay exact. "enrichment" (the Gemini listener) may
 * add section labels, vocal ranges, lyrics and moods; it never replaces measured timing. A plain MusicAnalyzer in
 * the slot still merges labels onto the measured sections by position.
 */
export interface MusicAnalyzers { local: MusicAnalyzer; enrichment?: MusicAnalyzer | MusicEnricher }
const UNCONFIGURED: MusicEnrichment = { state: "unavailable", code: "MUSIC_LISTENER_NOT_CONFIGURED", reason: "No song listener is configured on this server; only measured timing is available." };

export async function analyzeMusic(store: ProductionService["store"], analyzers: MusicAnalyzers, projectId: string, audioId: string, signal?: AbortSignal): Promise<MusicAnalysis & { selectedAsSoundtrack: boolean; fit: ReturnType<typeof fitShotsToSong> }> {
  const audio = store.get<NarrationAudio>("narration_audio", audioId);
  invariant(audio?.projectId === projectId && audio.media.kind === "audio", "NOT_FOUND", "Choose a recording owned by this film");
  const project = store.getProject(projectId);
  const base = await analyzers.local.analyze({ project, audio, ...(signal ? { signal } : {}) });
  let analysis: MusicAnalysis = { ...base, enrichment: UNCONFIGURED };
  if (analyzers.enrichment && "enrichment" in analyzers.enrichment) {
    const enrichment = analyzers.enrichment.enrichment(projectId, audioId);
    analysis = { ...base, enrichment, ...(enrichment.state === "ready" ? { analyzer: `${base.analyzer}+${enrichment.analyzer}`,
      vocalRanges: enrichment.vocalRanges, lyrics: enrichment.lyrics } : {}) };
  } else if (analyzers.enrichment) {
    const extra = await analyzers.enrichment.analyze({ project, audio, ...(signal ? { signal } : {}) });
    analysis = { ...base, analyzer: `${base.analyzer}+${extra.analyzer}`,
      sections: base.sections.map((section, index) => ({ ...section, ...(extra.sections[index]?.label ? { label: extra.sections[index]!.label } : {}) })),
      ...(extra.vocalRanges ? { vocalRanges: extra.vocalRanges } : {}), ...(extra.lyrics ? { lyrics: extra.lyrics } : {}) };
  }
  const timing = { durationFrames: base.durationFrames, beatFrames: base.beats.frames, sectionStartFrames: base.sections.map(section => section.startFrame), bpm: base.tempo.bpm };
  const shots = songFitShots(project);
  const startFrame = project.soundtrack?.audioId === audioId ? project.soundtrack.startFrame ?? 0 : 0;
  return { ...analysis, selectedAsSoundtrack: project.soundtrack?.audioId === audioId,
    fit: fitShotsToSong(shots, timing, startFrame, Math.min(project.maxFrames, 10800)) };
}
