import type { GenerationOverview } from "@openslate/core/public";
import type { StudioState } from "../store/state.ts";
import { canStop } from "./director.ts";
import { msg, type DirectorStatus, type Msg, type Target, type ViewName } from "./types.ts";

/**
 * Film-wide states the shell shows the same way in every view (GR-13, GR-14, P5 states study):
 * the strip at the top of the workspace (offline, stopped, restart casualties), what Stop will do,
 * and what survives a reconnect after the session expired. Pure: no React, no clock, no storage.
 */

/**
 * How long the event stream may be down before the workspace says so. A tab coming back from the background
 * reconnects well within this, so the strip does not flash on every return.
 */
export const OFFLINE_GRACE_MS = 2000;

// ---- restart casualties --------------------------------------------------------------

/** Jobs that were mid-send when OpenSlate restarted and that the service never confirmed. */
export interface RestartCasualties {
  /** Changes when the set of casualties changes, so a dismissed strip comes back for new ones. */
  key: string;
  count: number;
  /** keyframe or clip when every casualty is one of those; job when they are mixed or not all on a shot. */
  kind: "keyframe" | "clip" | "job";
  /** Shot labels in film order ("2.1"), only when every casualty was found on a shot. */
  labels: string[];
  /** The first shot to show, when one is known. */
  first: { shotId: string; label: string } | null;
}

const SLOTS = [["keyframe", "keyframe"], ["video", "clip"]] as const;

export function restartCasualties(overview: GenerationOverview | null): RestartCasualties | null {
  if (!overview?.restartCasualties.length) return null;
  const shots = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).flatMap((scene) => scene.shotIds.map((id) => overview.shots[id]).filter((shot) => !!shot));
  // A casualty the person already gave up on is still polled by the server, but it no longer needs them.
  const released = new Set(shots.flatMap((shot) => [...(shot.keyframe.releasedAttemptIds ?? []), ...(shot.video.releasedAttemptIds ?? [])]));
  const ids = [...new Set(overview.restartCasualties)].filter((id) => !released.has(id));
  if (!ids.length) return null;
  const found: { shotId: string; label: string; kind: "keyframe" | "clip" }[] = [];
  for (const shot of shots)
    for (const [slot, kind] of SLOTS) {
      const attemptId = shot[slot].attemptId;
      if (attemptId && ids.includes(attemptId)) found.push({ shotId: shot.shotId, label: shot.label, kind });
    }
  const complete = found.length === ids.length;
  const kinds = new Set(found.map((entry) => entry.kind));
  const kind = complete && kinds.size === 1 ? found[0]!.kind : "job";
  const first = found[0];
  return {
    key: [...ids].sort().join(","),
    count: ids.length,
    kind,
    labels: complete ? [...new Set(found.map((entry) => entry.label))] : [],
    first: first ? { shotId: first.shotId, label: first.label } : null,
  };
}

/** The strip's first sentence. `join` lists the shots in the interface language ("2.1 and 2.2"). */
export function restartTitle(restart: RestartCasualties, join: (labels: readonly string[]) => string): Msg {
  if (!restart.labels.length) return msg("strip.restart.jobs", { count: restart.count });
  const shots = join(restart.labels);
  if (restart.kind === "keyframe") return msg("strip.restart.keyframes", { count: restart.count, shots });
  if (restart.kind === "clip") return msg("strip.restart.clips", { count: restart.count, shots });
  return msg("strip.restart.mixed", { count: restart.count, shots });
}

// ---- the strip -----------------------------------------------------------------------

export type FilmStrip =
  | { kind: "offline" }
  | { kind: "stopped"; sent: number; detached: number }
  | { kind: "restart"; restart: RestartCasualties };

export interface FilmStripInput {
  view: ViewName;
  /** The event stream has been down for longer than OFFLINE_GRACE_MS. */
  offline: boolean;
  overview: GenerationOverview | null;
  /** The restart key the person dismissed, if any. */
  dismissedRestart: string | null;
}

/**
 * One strip at a time, most urgent first: offline (nothing on screen is current), then stopped (nothing new
 * is sent), then restart casualties. Start has no film open, so only offline applies there.
 */
export function filmStrip({ view, offline, overview, dismissedRestart }: FilmStripInput): FilmStrip | null {
  if (offline) return { kind: "offline" };
  if (view === "start" || !overview) return null;
  if (overview.stopped) return { kind: "stopped", sent: overview.stopped.sentJobs, detached: overview.stopped.detachedJobs };
  const restart = restartCasualties(overview);
  if (restart && restart.key !== dismissedRestart) return { kind: "restart", restart };
  return null;
}

/** The stopped strip's line after its bold title: what finishes and is charged, and what was taken off. */
export function stoppedLines(strip: { sent: number; detached: number }): Msg[] {
  return [
    ...(strip.sent > 0 ? [msg("strip.stopped.sent", { count: strip.sent })] : []),
    ...(strip.detached > 0 ? [msg("strip.stopped.detached", { count: strip.detached })] : []),
  ];
}

/** The toast after Continue: jobs taken off by the Stop are not sent by Continue; they need a new confirm. */
export const continuedToast = (detached: number): Msg => msg(detached > 0 ? "strip.continued_detached" : "strip.continued");

// ---- Stop ----------------------------------------------------------------------------

/** Whether the top bar offers Stop: something runs (canStop), the studio is reachable and a film is open. */
export function showStop(overview: GenerationOverview | null, director: DirectorStatus | null, connected: boolean, view: ViewName): boolean {
  return connected && view !== "start" && canStop(overview, director);
}

/** What a Stop would do, counted the way the server's Stop counts (sent jobs finish; unsent ones are taken off). */
export interface StopPreview {
  /** Jobs already with a provider (running, or sent and unanswered): they finish and are charged. */
  sent: number;
  /** Jobs bound but not sent yet: Stop takes them off and they need a new confirm. */
  queued: number;
  /** The Director is working or waiting on a question: it stops. */
  director: boolean;
}

export function stopPreview(overview: GenerationOverview | null, director: DirectorStatus | null): StopPreview {
  let sent = 0;
  let queued = 0;
  for (const shot of Object.values(overview?.shots ?? {})) {
    for (const slot of [shot.keyframe, shot.video]) {
      if (slot.state === "running" || slot.state === "no_answer") sent++;
      else if (slot.state === "queued") queued++;
    }
    if (shot.narration.state === "making" || shot.narration.state === "no_answer") sent++;
  }
  const directorBusy = director?.status === "running" || director?.status === "waiting_user" || (!!overview && overview.director.state !== "idle");
  return { sent, queued, director: directorBusy };
}

/** The confirm's bullet points, in the order the design lists them. */
export function stopLines(preview: StopPreview): Msg[] {
  return [
    ...(preview.sent > 0 ? [msg("stop.dialog.sent", { count: preview.sent })] : []),
    ...(preview.queued > 0 ? [msg("stop.dialog.queued", { count: preview.queued })] : []),
    ...(preview.director ? [msg("stop.dialog.director")] : []),
  ];
}

// ---- a reconnect after the session expired --------------------------------------------

/**
 * What the page carries into the new session when the person reconnects after the session expired:
 * the unsent message and its chips, and where they were. Not authority, only the person's own place and words.
 */
export interface Carry {
  projectId: string;
  view: ViewName;
  sceneId: string | null;
  shotId: string | null;
  text: string;
  targets: Target[];
}

export function carryFrom(state: Pick<StudioState, "projectId" | "view" | "sceneId" | "shotId" | "composer">): Carry | null {
  if (!state.projectId) return null;
  return {
    projectId: state.projectId,
    view: state.view,
    sceneId: state.sceneId,
    shotId: state.shotId,
    text: state.composer.text,
    targets: state.composer.targets.map((target) => ({ ...target })),
  };
}

/**
 * Whether the new session is ready to take the carried state: the same film is open and its overview read,
 * so the scene and shot can be checked. A different film (the list changed) drops the carry.
 */
export function carryReady(carry: Carry, state: Pick<StudioState, "projectId" | "overview">): "wait" | "apply" | "drop" {
  if (!state.projectId) return "wait";
  if (state.projectId !== carry.projectId) return "drop";
  return state.overview ? "apply" : "wait";
}

/** The parts of the carry that still exist in the film as it is now; chips for removed scenes or shots are dropped. */
export function carryToApply(carry: Carry, overview: GenerationOverview): Carry {
  const exists = (target: Target) => (target.kind === "scene" ? overview.scenes.some((scene) => scene.sceneId === target.id) : !!overview.shots[target.id]);
  return {
    ...carry,
    sceneId: carry.sceneId && overview.scenes.some((scene) => scene.sceneId === carry.sceneId) ? carry.sceneId : null,
    shotId: carry.shotId && overview.shots[carry.shotId] ? carry.shotId : null,
    targets: carry.targets.filter(exists),
  };
}

/** The toast once the page is connected again: it says the draft is still there when there was one. */
export const reconnectedToast = (carry: Carry | null): Msg => msg(carry && (carry.text.trim() || carry.targets.length) ? "expired.back_with_draft" : "expired.back");
