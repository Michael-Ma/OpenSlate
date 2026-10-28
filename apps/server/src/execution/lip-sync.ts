import { invariant } from "@openslate/core";
import type { ProjectRecord, ShotRecord } from "@openslate/core";
import type { ExecutionCallOptions, ExecutionOutcome, ExecutionOutput } from "@openslate/providers";
import { storyboardAudioCuts } from "../narration/audio-placement.js";

/**
 * Provider-neutral lip-sync seam for music videos (docs/ai/music-video/audio-and-lipsync.md). A singing shot's
 * finished clip gets a second pass that re-times the mouth to the exact song segment under that shot. No real
 * adapter ships here: providers plug in behind LipSyncAdapter and report the same ExecutionOutcome shapes as video
 * providers, so attempt/outcome rules stay the same (an unknown outcome is never resubmitted blindly; a lost
 * submission with no task id needs a human press; a refused job is not charged).
 */
export const SAMPLES_PER_FRAME = 1600;

/** The part of the song heard under one shot, in 48 kHz samples. */
export interface SongSegment {
  audioId: string;
  sha256: string;
  /** Position in the song recording. */
  startSample: number;
  durationSamples: number;
  /** Where in the shot the segment starts: non-zero when the music starts after the shot does. */
  shotOffsetSamples: number;
}

/**
 * Cut the soundtrack for one shot from the film clock: the shot covers [start, start + length) frames and the song
 * plays from the soundtrack's startFrame. Null when no song is heard under the shot (muted, before the music starts,
 * after it ends). Pure.
 */
export function songSegmentForShot(project: Pick<ProjectRecord, "scenes" | "shots" | "soundtrack">, shotId: string, song: { audioId: string; sha256: string; samples: number }): SongSegment | null {
  const soundtrack = project.soundtrack;
  if (!soundtrack || soundtrack.muted || soundtrack.audioId !== song.audioId) return null;
  invariant(Number.isSafeInteger(song.samples) && song.samples > 0, "MEDIA_SOURCE_UNAVAILABLE", "Song length must be measured");
  const cut = storyboardAudioCuts(project).find((row) => row.shotId === shotId);
  invariant(cut, "NOT_FOUND", "Shot does not belong to this film.");
  const songStart = (soundtrack.startFrame ?? 0) * SAMPLES_PER_FRAME;
  const shotStart = cut.startFrame * SAMPLES_PER_FRAME, shotEnd = shotStart + cut.durationFrames * SAMPLES_PER_FRAME;
  const from = Math.max(shotStart, songStart), to = Math.min(shotEnd, songStart + song.samples);
  if (to <= from) return null;
  return { audioId: song.audioId, sha256: song.sha256, startSample: from - songStart, durationSamples: to - from, shotOffsetSamples: from - shotStart };
}

/** Singing in the shot's own direction. A typed `performance` field is spec-only (see the doc). */
const SINGING = /\b(sing|sings|singing|sang|lip[\s-]?sync(?:s|ing)?|raps?|rapping|chorus|verse)\b|唱|演唱|对口型|對口型|说唱/i;
export function isSingingShot(shot: Pick<ShotRecord, "purpose" | "action"> & { performance?: string }): boolean {
  if (shot.performance !== undefined) return shot.performance === "singing";
  return SINGING.test(`${shot.purpose}\n${shot.action}`);
}

export interface LipSyncJob {
  /** The lip-sync attempt's own identity, separate from the clip's attempt. */
  attemptId: string;
  shotId: string;
  /** The finished performance clip (video + audio models) or keyframe (image + audio models). */
  picture: { artifactId: string; sha256: string; kind: "video" | "image"; frames: number };
  segment: SongSegment;
  /** Send the isolated vocal stem rather than the full mix (recommended for songs). */
  audio: "vocals" | "mix";
}

export interface LipSyncAdapter {
  readonly id: string;
  /** Whether the provider refunds a job that fails after it was accepted. Unknown policies count as charged. */
  readonly refundsFailedJobs: boolean;
  readonly maxSegmentSamples: number;
  submit(job: Readonly<LipSyncJob>, options?: ExecutionCallOptions): Promise<ExecutionOutcome>;
  poll(taskId: string, job: Readonly<LipSyncJob>, options?: ExecutionCallOptions): Promise<ExecutionOutcome>;
}

export type Charged = "no" | "yes" | "unknown";
export type LipSyncState =
  | { phase: "not_started" }
  | { phase: "running"; taskId: string }
  | { phase: "completed"; taskId: string; outputs: ExecutionOutput[] }
  | { phase: "failed"; taskId: string | null; failureId: string; charged: Charged; retryAllowed: boolean }
  /** Waiting for the service's answer. With a task id it is polled; without one only a human press may buy again. */
  | { phase: "unknown"; taskId: string | null; diagnostic: string };

/** Apply one provider observation. Pure; terminal states never move. */
export function lipSyncTransition(state: LipSyncState, outcome: ExecutionOutcome, adapter: Pick<LipSyncAdapter, "refundsFailedJobs">): LipSyncState {
  if (state.phase === "completed" || state.phase === "failed") return state;
  const known = state.phase === "running" || state.phase === "unknown" ? state.taskId : null;
  switch (outcome.type) {
    case "accepted": return { phase: "running", taskId: outcome.taskId };
    case "completed":
      // Spooled (version 2) completions belong to the ingestion router, not this seam yet.
      if ("version" in outcome) return { phase: "unknown", taskId: outcome.vendorTaskId ?? known, diagnostic: "Spooled lip-sync output is not supported by this seam" };
      return { phase: "completed", taskId: outcome.taskId, outputs: outcome.outputs };
    case "rejected": return { phase: "failed", taskId: null, failureId: outcome.failureId, charged: "no", retryAllowed: outcome.retryAllowed ?? outcome.technical };
    case "failed": {
      const taskId = outcome.taskId ?? known;
      // Accepted work that fails is charged unless the provider documents refunds; a lost submission is spent.
      const charged: Charged = taskId === null ? "unknown" : adapter.refundsFailedJobs ? "no" : "unknown";
      return { phase: "failed", taskId, failureId: outcome.failureId, charged, retryAllowed: outcome.retryAllowed ?? false };
    }
    case "unknown": return { phase: "unknown", taskId: outcome.taskId ?? known, diagnostic: outcome.diagnostic };
  }
}

/**
 * One step of the pass: submit once, then only poll. An unknown outcome without a task id is never resubmitted;
 * it waits for a human press (a new attempt with its own identity).
 */
export async function advanceLipSync(adapter: LipSyncAdapter, job: Readonly<LipSyncJob>, state: LipSyncState, options?: ExecutionCallOptions): Promise<LipSyncState> {
  invariant(job.segment.durationSamples > 0 && job.segment.durationSamples <= adapter.maxSegmentSamples, "VALIDATION_ERROR", "The song segment is longer than this lip-sync service accepts");
  if (state.phase === "not_started") return lipSyncTransition(state, await settle(() => adapter.submit(job, options)), adapter);
  if ((state.phase === "running" || state.phase === "unknown") && state.taskId) return lipSyncTransition(state, await settle(() => adapter.poll(state.taskId!, job, options)), adapter);
  return state;
}

/** A thrown call is an unknown outcome, never a failure that would invite a resubmission. */
async function settle(call: () => Promise<ExecutionOutcome>): Promise<ExecutionOutcome> {
  try { return await call(); } catch (error) { return { type: "unknown", diagnostic: error instanceof Error ? error.message.slice(0, 200) : "Lip-sync call failed" }; }
}

/**
 * What the shot shows for its lip-sync pass. The performance clip always stays the shot's picture until a synced
 * clip completes; a failed pass says whether it was charged and whether trying again is offered.
 */
export function lipSyncDisplay(state: LipSyncState): { state: "none" | "syncing" | "synced" | "failed" | "no_answer"; charged: Charged; retry: "offered" | "human_press" | "none"; keepsOriginalClip: boolean } {
  switch (state.phase) {
    case "not_started": return { state: "none", charged: "no", retry: "none", keepsOriginalClip: true };
    case "running": return { state: "syncing", charged: "unknown", retry: "none", keepsOriginalClip: true };
    case "completed": return { state: "synced", charged: "yes", retry: "none", keepsOriginalClip: false };
    case "failed": return { state: "failed", charged: state.charged, retry: state.retryAllowed ? "offered" : "human_press", keepsOriginalClip: true };
    case "unknown": return { state: "no_answer", charged: "unknown", retry: state.taskId ? "none" : "human_press", keepsOriginalClip: true };
  }
}

/** Deterministic test adapter: replays scripted outcomes and records every call. No network. */
export class FakeLipSyncAdapter implements LipSyncAdapter {
  readonly id = "fake-lip-sync";
  readonly calls: Array<{ kind: "submit" | "poll"; attemptId: string; taskId?: string; segment: SongSegment }> = [];
  constructor(private readonly script: { submit: ExecutionOutcome | Error; polls?: Array<ExecutionOutcome | Error> }, readonly refundsFailedJobs = false, readonly maxSegmentSamples = 60 * 48000) {}
  async submit(job: Readonly<LipSyncJob>): Promise<ExecutionOutcome> {
    this.calls.push({ kind: "submit", attemptId: job.attemptId, segment: job.segment });
    if (this.script.submit instanceof Error) throw this.script.submit;
    return this.script.submit;
  }
  async poll(taskId: string, job: Readonly<LipSyncJob>): Promise<ExecutionOutcome> {
    this.calls.push({ kind: "poll", attemptId: job.attemptId, taskId, segment: job.segment });
    const next = this.script.polls?.shift() ?? { type: "unknown", diagnostic: "No scripted poll", taskId };
    if (next instanceof Error) throw next;
    return next;
  }
}
