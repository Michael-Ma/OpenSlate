import { clipAudioSegments, DomainError, projectShotClipAudio } from "@openslate/core";
import type { ArtifactRef, ClipAudioSpan, ProjectRecord, ShotRecord } from "@openslate/core";
import type { LocalMediaService } from "./local-media.js";
import type { SuppliedAudioPlacement, SuppliedMedia } from "./types.js";

/**
 * Kept clip sound in the film (docs/ai/clip-audio/2026-10-28-clip-audio.md). Each kept shot's clip plays its own
 * sound from the clip's start, at the shot's start, for at most the shot's length, ducked under narration.
 * Pure apart from `resolveClipAudio`, which asks the media worker for the clip's derived sound.
 */

/** One kept shot with a clip, captured with the film (SQL only). */
export interface ClipAudioShot {
  shotId: string;
  artifact: ArtifactRef;
  fixture: boolean;
  /** The clip's normalized video descriptor; null for a fixture, whose source is made at freeze time. */
  source: SuppliedMedia | null;
  atSample: number;
  durationSamples: number;
  gainMilliDb: number;
}
export interface ClipAudioCapture { shots: ClipAudioShot[]; voices: ClipAudioSpan[] }

export type ClipAudioSkip = "no_audio_stream" | "source_unavailable" | "derivation_failed";
export interface ClipAudioReport { shotId: string; state: "mixed" | "skipped"; reason?: ClipAudioSkip; pieces?: number }

/** The fingerprint part for one shot: present only while its clip sound is kept, so muted films keep their digests. */
export function clipAudioFingerprint(project: Pick<ProjectRecord, "filmKind">, shot: ShotRecord): { clipAudio?: { keep: true; gainMilliDb: number } } {
  const effective = projectShotClipAudio(project, shot);
  return effective.keep ? { clipAudio: { keep: true, gainMilliDb: effective.gainMilliDb } } : {};
}

/** The kept shots (in film order) and the voice spans that duck them. */
export function captureClipAudio(project: Pick<ProjectRecord, "filmKind" | "shots">,
  cuts: readonly { shotId: string | null; startFrame: number; durationFrames: number }[],
  clips: ReadonlyMap<string, { artifact: ArtifactRef; fixture: boolean; source: SuppliedMedia | null }>,
  voices: readonly ClipAudioSpan[]): ClipAudioCapture {
  const shots: ClipAudioShot[] = [];
  for (const cut of cuts) {
    const shot = project.shots.find(row => row.id === cut.shotId), clip = cut.shotId ? clips.get(cut.shotId) : undefined;
    if (!shot || !clip) continue;
    const effective = projectShotClipAudio(project, shot);
    if (!effective.keep) continue;
    shots.push({ shotId: shot.id, artifact: clip.artifact, fixture: clip.fixture, source: clip.source,
      atSample: cut.startFrame * 1600, durationSamples: cut.durationFrames * 1600, gainMilliDb: effective.gainMilliDb });
  }
  return { shots, voices: voices.map(v => ({ atSample: v.atSample, durationSamples: v.durationSamples })) };
}

const DERIVATION_FAILURES = new Set(["MEDIA_TOOL_FAILED", "MEDIA_VALIDATION_FAILED", "MEDIA_DURATION_LIMIT", "MEDIA_UNSUPPORTED", "MEDIA_STREAM_MISSING"]);

/** The clip's derived sound, or why there is none. A clip that cannot be decoded is skipped, never the export. */
export async function resolveClipAudio(media: Pick<LocalMediaService, "deriveClipAudio">, video: SuppliedMedia | null | undefined,
  run: <T>(operation: () => Promise<T>) => Promise<T> = operation => operation()): Promise<{ media: SuppliedMedia } | { reason: ClipAudioSkip }> {
  if (!video) return { reason: "source_unavailable" };
  try { return await run(() => media.deriveClipAudio(video)); }
  catch (error) {
    if (error instanceof DomainError && DERIVATION_FAILURES.has(error.code)) return { reason: "derivation_failed" };
    throw error;
  }
}

/** Placements for the render manifest, and what happened to each kept shot. */
export function clipAudioPlacements(capture: ClipAudioCapture, derived: ReadonlyMap<string, { media: SuppliedMedia } | { reason: ClipAudioSkip }>):
  { placements: SuppliedAudioPlacement[]; report: ClipAudioReport[] } {
  const placements: SuppliedAudioPlacement[] = [], report: ClipAudioReport[] = [];
  for (const shot of capture.shots) {
    const result = derived.get(shot.shotId) ?? { reason: "source_unavailable" as const };
    if (!("media" in result)) { report.push({ shotId: shot.shotId, state: "skipped", reason: result.reason }); continue; }
    const samples = result.media.probe.audio?.samples ?? 0;
    const pieces = clipAudioSegments({ startSample: 0, atSample: shot.atSample, durationSamples: Math.min(samples, shot.durationSamples), gainMilliDb: shot.gainMilliDb }, capture.voices);
    if (!pieces.length) { report.push({ shotId: shot.shotId, state: "skipped", reason: "no_audio_stream" }); continue; }
    for (const piece of pieces) placements.push({ source: result.media, ...piece });
    report.push({ shotId: shot.shotId, state: "mixed", pieces: pieces.length });
  }
  return { placements, report };
}
