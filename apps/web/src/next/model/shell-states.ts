import type { GenerationOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import type { EditDraft, StudioState } from "../store/state.ts";
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

/** While the event stream is down, how often the shell asks the studio (a plain read) whether it is still there. */
export const REACH_PROBE_MS = 5000;

/**
 * The studio counts as unreachable only when the event stream is down past the grace period and a plain read
 * failed too. A stream that dropped while reads still work (a proxy that cuts long requests, a hidden tab
 * coming back) is not offline: edits still save, so nothing is turned off.
 */
export function unreachable(input: { streamDown: boolean; graceOver: boolean; lastRead: "ok" | "failed" | null }): boolean {
  return input.streamDown && input.graceOver && input.lastRead === "failed";
}

// ---- guards ---------------------------------------------------------------------------

/**
 * What a control needs (P5 shell change 8): `server` for anything that writes (an edit, Continue, a note's
 * choice, an answer, sending to the Director), `run` for anything that starts work (a paid make, a confirm).
 * The composer needs only `server`: while the film is stopped Send stays on and its hint says the Director
 * waits for Continue (a message does not resume the film), so stopped changes the hint, not whether it sends.
 */
export type Needs = "server" | "run";

/**
 * The film-wide rule every view applies to its controls: offline or an expired session turns off every write;
 * a stopped film turns off what would start work. The reason goes in the control's title.
 */
export interface WriteGuard {
  /** Writes reach the studio. */
  server: boolean;
  /** New work may start. */
  run: boolean;
  /** Why writes are off; null while they are on. */
  serverWhy: Msg | null;
  /** Why new work is off; null while it may start. */
  runWhy: Msg | null;
}

/**
 * `quarantined`: the studio was restored from a backup and is in recovery review (model/recovery.ts). Reads work and
 * every write is off with that one reason until the review is finished; offline and expired still come first,
 * because nothing works without the studio.
 */
export function writeGuard({ offline, expired, stopped, quarantined = false }: { offline: boolean; expired: boolean; stopped: boolean; quarantined?: boolean }): WriteGuard {
  const serverWhy = expired ? msg("guard.expired") : offline ? msg("guard.offline") : quarantined ? msg("guard.recovery") : null;
  const runWhy = serverWhy ?? (stopped ? msg("guard.stopped") : null);
  return { server: !serverWhy, run: !runWhy, serverWhy, runWhy };
}

/** One control's state under the guard: off, and why (for its title). */
export function guardFor(guard: WriteGuard, needs: Needs): { off: boolean; why: Msg | null } {
  const why = needs === "run" ? guard.runWhy : guard.serverWhy;
  return { off: why !== null, why };
}

/** No guard: everything on (outside a provider, and in tests). */
export const OPEN_GUARD: WriteGuard = { server: true, run: true, serverWhy: null, runWhy: null };

// ---- text ------------------------------------------------------------------------------

/** What goes between two sentences of a strip: a space in English, nothing after Chinese full stops. */
export const sentenceGap = (locale: Locale): string => (locale.startsWith("zh") ? "" : " ");

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
  | { kind: "recovery" }
  | { kind: "stopped"; sent: number; detached: number; restored?: boolean }
  | { kind: "restart"; restart: RestartCasualties };

export interface FilmStripInput {
  view: ViewName;
  /** The event stream has been down for longer than OFFLINE_GRACE_MS. */
  offline: boolean;
  overview: GenerationOverview | null;
  /** The restart key the person dismissed, if any. */
  dismissedRestart: string | null;
  /**
   * The studio is in recovery review and the full review is put away (the person is looking around): the strip says
   * so in every view, Start included, and opens the review again.
   */
  recovery?: boolean;
  /** The film was stopped by the restore from a backup (model/recovery.ts stoppedByRestore): the stopped strip says why. */
  stoppedByRestore?: boolean;
}

/**
 * One strip at a time, most urgent first: offline (nothing on screen is current), then stopped (nothing new
 * is sent), then restart casualties. Start has no film open, so only offline applies there.
 */
export function filmStrip({ view, offline, overview, dismissedRestart, recovery = false, stoppedByRestore = false }: FilmStripInput): FilmStrip | null {
  if (offline) return { kind: "offline" };
  if (recovery) return { kind: "recovery" };
  if (view === "start" || !overview) return null;
  if (overview.stopped)
    return { kind: "stopped", sent: overview.stopped.sentJobs, detached: overview.stopped.detachedJobs, ...(stoppedByRestore ? { restored: true } : {}) };
  const restart = restartCasualties(overview);
  if (restart && restart.key !== dismissedRestart) return { kind: "restart", restart };
  return null;
}

/** The stopped strip's line after its bold title: why (a restore), what finishes and is charged, and what was taken off. */
export function stoppedLines(strip: { sent: number; detached: number; restored?: boolean }): Msg[] {
  return [
    ...(strip.restored ? [msg("strip.stopped.restored")] : []),
    ...(strip.sent > 0 ? [msg("strip.stopped.sent", { count: strip.sent })] : []),
    ...(strip.detached > 0 ? [msg("strip.stopped.detached", { count: strip.detached })] : []),
  ];
}

/** The toast after Continue: jobs taken off by the Stop are not sent by Continue; they need a new confirm. */
export const continuedToast = (detached: number): Msg => msg(detached > 0 ? "strip.continued_detached" : "strip.continued");

// ---- Stop ----------------------------------------------------------------------------

/**
 * Whether the top bar offers Stop: something runs (canStop), writes reach the studio (the guard, so a stream
 * that is only reconnecting does not hide it) and a film is open.
 */
export function showStop(overview: GenerationOverview | null, director: DirectorStatus | null, reachable: boolean, view: ViewName): boolean {
  return reachable && view !== "start" && canStop(overview, director);
}

/** What a Stop would do, counted the way the server's Stop counts (sent jobs finish; unsent ones are taken off). */
export interface StopPreview {
  /**
   * Jobs already with a provider (running, sent and unanswered, or released by the person and still polled):
   * they finish and are charged. The server's Stop counts every attempt that has not finished the same way.
   */
  sent: number;
  /** Bound unsent jobs, including review, input and unclassified waits: Stop detaches them, even though they are not all being made. */
  queued: number;
  /** The Director is working or waiting on a question: it stops. */
  director: boolean;
}

export function stopPreview(overview: GenerationOverview | null, director: DirectorStatus | null): StopPreview {
  let sent = 0;
  let queued = 0;
  // A no-answer attempt the person gave up on is still polled and may still be charged; it is not the slot's
  // current attempt any more, and two slots never share one, but count each id once all the same.
  const released = new Set<string>();
  for (const shot of Object.values(overview?.shots ?? {})) {
    for (const slot of [shot.keyframe, shot.video]) {
      if (slot.state === "running" || slot.state === "no_answer") sent++;
      else if (slot.state === "queued") queued++;
      if (slot.replacement?.state === "running" || slot.replacement?.state === "no_answer") sent++;
      else if (slot.replacement?.state === "queued") queued++;
      for (const id of slot.releasedAttemptIds ?? []) if (id !== slot.attemptId && id !== slot.replacement?.attemptId) released.add(id);
    }
    if (shot.narration.state === "making" || shot.narration.state === "no_answer") sent++;
  }
  sent += released.size;
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

// ---- a reconnect after the session expired, or after Disconnect this studio ------------------

/** An inline edit that was not saved yet (the Keyframes inspector's prompt, motion or line). */
export type CarriedEdit = Pick<EditDraft, "shotId" | "field" | "value" | "expectedHeadVersion" | "baselineValue" | "baselineMotion" | "baselineFrames" | "secondsText">;

/**
 * What the page carries into the new session when the person reconnects in the same window, after the session expired
 * or after they disconnected it: the unsent message and its chips, an inline edit not saved yet, and where they were.
 * Not authority, only the person's own place and words.
 */
export interface Carry {
  projectId: string;
  view: ViewName;
  sceneId: string | null;
  shotId: string | null;
  text: string;
  targets: Target[];
  edit: CarriedEdit | null;
}

export function carryFrom(state: Pick<StudioState, "projectId" | "view" | "sceneId" | "shotId" | "composer"> & Partial<Pick<StudioState, "edit">>): Carry | null {
  if (!state.projectId) return null;
  const edit = state.edit;
  return {
    projectId: state.projectId,
    view: state.view,
    sceneId: state.sceneId,
    shotId: state.shotId,
    text: state.composer.text,
    targets: state.composer.targets.map((target) => ({ ...target })),
    edit: edit ? { shotId: edit.shotId, field: edit.field, value: edit.value,
      ...(edit.expectedHeadVersion !== undefined ? { expectedHeadVersion: edit.expectedHeadVersion } : {}),
      ...(edit.baselineValue !== undefined ? { baselineValue: edit.baselineValue } : {}),
      ...(edit.baselineMotion !== undefined ? { baselineMotion: edit.baselineMotion } : {}),
      ...(edit.baselineFrames !== undefined ? { baselineFrames: edit.baselineFrames } : {}),
      ...(edit.secondsText !== undefined ? { secondsText: edit.secondsText } : {}) } : null,
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

/**
 * The parts of the carry that still exist in the film as it is now; chips for removed scenes or shots are dropped, and
 * an edit of a shot that is gone.
 */
export function carryToApply(carry: Carry, overview: GenerationOverview): Carry {
  const exists = (target: Target) => (target.kind === "scene" ? overview.scenes.some((scene) => scene.sceneId === target.id) : !!overview.shots[target.id]);
  return {
    ...carry,
    sceneId: carry.sceneId && overview.scenes.some((scene) => scene.sceneId === carry.sceneId) ? carry.sceneId : null,
    shotId: carry.shotId && overview.shots[carry.shotId] ? carry.shotId : null,
    targets: carry.targets.filter(exists),
    edit: carry.edit && overview.shots[carry.edit.shotId] ? { ...carry.edit } : null,
  };
}

/**
 * Where a disconnected session's carry waits for the next session. The launcher opens its fresh link in a new tab, so
 * the page keeps it in this browser's storage (the first studio session that connects takes it), for a day at most.
 */
export const CARRY_STORAGE_KEY = "openslate.next.carry";
export const CARRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CARRY_VIEWS = new Set<ViewName>(["plan", "keyframes", "assets", "film", "settings", "start"]);
const EDIT_FIELDS = new Set<CarriedEdit["field"]>(["imagePrompt", "motion", "desiredFrames", "narration"]);
const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const optionalId = (value: unknown): string | null => (isId(value) ? value : null);

/** The carry as it is kept in storage, with when it was kept. */
export const storedCarry = (carry: Carry, now: number): string => JSON.stringify({ savedAt: now, carry });

/**
 * A kept carry read back, or null when there is none, it is not one, or it is older than CARRY_MAX_AGE_MS. Only the
 * person's own words, place and original edit baseline come back; command authority is never restored.
 */
export function parseStoredCarry(raw: string | null, now: number): Carry | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { savedAt?: unknown; carry?: Record<string, unknown> };
    const carry = value.carry;
    if (typeof value.savedAt !== "number" || now - value.savedAt > CARRY_MAX_AGE_MS || value.savedAt - now > 60_000 || !carry) return null;
    if (!isId(carry.projectId) || !CARRY_VIEWS.has(carry.view as ViewName) || typeof carry.text !== "string" || !Array.isArray(carry.targets)) return null;
    const targets = (carry.targets as unknown[]).flatMap((target) => {
      const t = target as Partial<Target> | null;
      return t && (t.kind === "shot" || t.kind === "scene") && isId(t.id) ? [{ kind: t.kind, id: t.id }] : [];
    });
    const rawEdit = carry.edit as Partial<CarriedEdit> | null | undefined;
    const edit = rawEdit && isId(rawEdit.shotId) && EDIT_FIELDS.has(rawEdit.field as CarriedEdit["field"]) && typeof rawEdit.value === "string"
      ? { shotId: rawEdit.shotId, field: rawEdit.field as CarriedEdit["field"], value: rawEdit.value,
        ...(Number.isSafeInteger(rawEdit.expectedHeadVersion) && rawEdit.expectedHeadVersion! >= 0 ? { expectedHeadVersion: rawEdit.expectedHeadVersion! } : {}),
        ...(typeof rawEdit.baselineValue === "string" ? { baselineValue: rawEdit.baselineValue } : {}),
        ...(typeof rawEdit.baselineMotion === "string" ? { baselineMotion: rawEdit.baselineMotion } : {}),
        ...(Number.isSafeInteger(rawEdit.baselineFrames) && rawEdit.baselineFrames! > 0 ? { baselineFrames: rawEdit.baselineFrames! } : {}),
        ...(typeof rawEdit.secondsText === "string" ? { secondsText: rawEdit.secondsText } : {}) } : null;
    return { projectId: carry.projectId, view: carry.view as ViewName, sceneId: optionalId(carry.sceneId), shotId: optionalId(carry.shotId), text: carry.text, targets, edit };
  } catch {
    return null;
  }
}

/**
 * The carry to keep when a session is disconnected: its own, unless it holds none of the person's words and an earlier
 * one nobody took yet does (a session disconnected again before it had put the draft back).
 */
export const carryToKeep = (earlier: Carry | null, latest: Carry | null): Carry | null =>
  earlier && carriedDraft(latest) === "none" ? earlier : latest ?? earlier;

/** What of the person's own words the carry holds: an unsent message (text or chips), an unsaved edit, both or none. */
export type CarriedDraft = "none" | "message" | "edit" | "both";

export function carriedDraft(carry: Carry | null): CarriedDraft {
  const message = !!carry && (!!carry.text.trim() || carry.targets.length > 0);
  const edit = !!carry?.edit;
  return message && edit ? "both" : message ? "message" : edit ? "edit" : "none";
}

/** The toast once the page is connected again: it says the draft is still there when there was one. */
export function reconnectedToast(carry: Carry | null): Msg {
  const draft = carriedDraft(carry);
  return msg(draft === "both" ? "expired.back_with_both" : draft === "message" ? "expired.back_with_draft" : draft === "edit" ? "expired.back_with_edit" : "expired.back");
}

/**
 * What the Disconnect confirm adds about the person's unsaved words: an unsent message or an unsaved edit is kept in
 * this browser and comes back when a session connects again; a form still open elsewhere on the page (Plan, Settings)
 * is not carried and closes without saving.
 */
export function disconnectNotes(draft: CarriedDraft, openForm: boolean): Msg[] {
  return [
    ...(draft === "none" ? [] : [msg(draft === "both" ? "disconnect.kept_both" : draft === "message" ? "disconnect.kept_message" : "disconnect.kept_edit")]),
    ...(openForm ? [msg("disconnect.open_form")] : []),
  ];
}
