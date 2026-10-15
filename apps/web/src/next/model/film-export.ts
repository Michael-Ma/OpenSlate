import type { ExportReadiness, ExportRecord, ExportView, GenerationOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { making } from "./film.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The Film view's Export panel (SB-16, SB-17, SB-18): per-shot readiness, one Export button, rendering with
 * elapsed time (no percentage exists), Cancel, Check again for an export a restart interrupted (it only looks
 * for the finished file), and the last export with what changed since. Pure.
 */

/** The longest film the export takes (the server refuses more with too_long). */
export const MAX_FILM_SECONDS = 360;
/** Card B6 and lead decision 4: the storyboard export renders 1280 × 720. */
export const EXPORT_SIZE = { width: 1280, height: 720 } as const;

/** One render job from GET /api/projects/:projectId/media; only the fields the panel needs. */
export interface MediaJob {
  id: string;
  state: string;
  canRecover: boolean;
}

/** GET /api/projects/:projectId/media: the jobs (to tell an interrupted export) and the last export of any kind. */
export interface MediaView {
  jobs: MediaJob[];
  lastExport: { artifact: StudioArtifactRef; outdated: boolean; outdatedBy: ExportRecord["outdatedBy"] } | null;
}

export type Tone = "ok" | "plain";

export interface ReadinessRow {
  shotId: string;
  label: string;
  clip: { text: Msg; tone: Tone };
  voice: { text: Msg; tone: Tone };
}

export function clipCell(shot: ShotOverview, demo: boolean): ReadinessRow["clip"] {
  if (making(shot.video)) return { text: msg("film.cell.making"), tone: "plain" };
  switch (shot.video.state) {
    case "ready": return shot.video.artifact ? { text: msg(demo ? "film.cell.demo_clip" : "film.cell.clip"), tone: "ok" } : { text: msg("film.cell.no_clip"), tone: "plain" };
    case "outdated": return { text: msg("film.cell.clip_outdated"), tone: "plain" };
    case "failed": return { text: msg("film.cell.failed"), tone: "plain" };
    case "no_answer": return { text: msg("film.cell.no_answer"), tone: "plain" };
    default: return { text: msg("film.cell.no_clip"), tone: "plain" };
  }
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function voiceCell(shot: ShotOverview): ReadinessRow["voice"] {
  const n = shot.narration;
  switch (n.state) {
    case "none": return { text: msg("film.cell.no_line"), tone: "plain" };
    case "text_only": return { text: msg("film.cell.no_voice"), tone: "plain" };
    case "making": return { text: msg("film.cell.voice_making"), tone: "plain" };
    case "failed": return { text: msg("film.cell.voice_failed"), tone: "plain" };
    case "no_answer": return { text: msg("film.cell.no_answer"), tone: "plain" };
    case "ready": {
      const seconds = round1(n.measuredSeconds ?? 0);
      if (n.fits === false && !n.fit) return { text: msg("film.cell.too_long", { seconds }), tone: "plain" };
      return { text: msg(n.fit === "cut_to_shot" ? "film.cell.voice_cut" : "film.cell.voice", { seconds }), tone: "ok" };
    }
  }
}

/** Shots in storyboard order (scenes by ordinal). */
export function orderedShots(overview: GenerationOverview): ShotOverview[] {
  return [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).flatMap((scene) => scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot));
}

export function readinessRows(overview: GenerationOverview, demo: boolean): ReadinessRow[] {
  return orderedShots(overview).map((shot) => ({ shotId: shot.shotId, label: shot.label, clip: clipCell(shot, demo), voice: voiceCell(shot) }));
}

/** Why Export is off, from the server's blockers. Labels come from the overview; a list reads naturally per language. */
export function whyNotReady(readiness: ExportReadiness, overview: GenerationOverview, locale: string): Msg[] {
  const label = (id: string | undefined) => (id && overview.shots[id]?.label) || "";
  const shots = (codes: readonly string[]) => [...new Set(readiness.blockers.filter((b) => codes.includes(b.code)).map((b) => label(b.shotId)).filter(Boolean))];
  const clips = shots(["no_clip", "clip_outdated"]);
  const voices = shots(["voice_unsettled"]);
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  const reasons: Msg[] = [];
  if (clips.length && voices.length) reasons.push(msg("film.why.clips_voice", { count: clips.length, shots: list(voices) }));
  else if (clips.length) reasons.push(msg("film.why.clips", { count: clips.length }));
  else if (voices.length) reasons.push(msg("film.why.voice", { shots: list(voices) }));
  if (readiness.blockers.some((b) => b.code === "mixed_demo_media")) reasons.push(msg("film.why.mixed_demo"));
  if (readiness.blockers.some((b) => b.code === "too_long")) reasons.push(msg("film.why.too_long"));
  if (readiness.blockers.some((b) => b.code === "empty_film")) reasons.push(msg("film.why.empty"));
  return reasons;
}

/** The panel's state: what the current export record says, plus whether a restart left it without an owner. */
export type PanelState =
  | { kind: "idle"; failed: Msg | null; cancelled: boolean }
  | { kind: "rendering"; record: ExportRecord }
  | { kind: "interrupted"; record: ExportRecord };

export function panelState(view: ExportView | null, media: MediaView | null): PanelState {
  const current = view?.current ?? null;
  if (!current) return { kind: "idle", failed: null, cancelled: false };
  if (current.state === "rendering") {
    // A render the server no longer owns (its lease ran out at a restart) can only be recovered, never re-run.
    const job = media?.jobs.find((j) => j.id === current.exportId);
    return job?.canRecover ? { kind: "interrupted", record: current } : { kind: "rendering", record: current };
  }
  if (current.state === "failed") return { kind: "idle", failed: failureMsg(current.failure?.code), cancelled: false };
  if (current.state === "cancelled") return { kind: "idle", failed: null, cancelled: true };
  return { kind: "idle", failed: null, cancelled: false };
}

export function failureMsg(code: string | undefined): Msg {
  if (code === "MEDIA_NO_COMPLETION") return msg("film.export.failed_no_file");
  return msg("film.export.failed", { code: code ?? "RENDER_FAILED" });
}

export interface LastExport {
  record: ExportRecord | null;
  artifact: StudioArtifactRef;
  demo: boolean;
  /** When it finished (or started, when no finish time is recorded). */
  at: string | null;
  outdatedBy: ExportRecord["outdatedBy"];
  /** Other finished exports, kept in Assets. */
  earlier: number;
}

/** The last finished export stays downloadable and says what changed since (SB-15). */
export function lastExport(view: ExportView | null, media: MediaView | null): LastExport | null {
  const records = view ? [view.current, ...view.history].filter((r): r is ExportRecord => !!r) : [];
  const done = records.filter((r) => r.state === "done" && r.artifact);
  const latest = done[0];
  if (latest?.artifact) return { record: latest, artifact: latest.artifact, demo: latest.demo, at: latest.finishedAt ?? latest.startedAt, outdatedBy: latest.outdatedBy, earlier: done.length - 1 };
  // A render from an older plan-based export still counts as the film's last export.
  const legacy = media?.lastExport;
  if (legacy) return { record: null, artifact: legacy.artifact, demo: false, at: null, outdatedBy: legacy.outdatedBy, earlier: 0 };
  return null;
}

const CHANGE_IDS = { shots: "film.changed.shots", order: "film.changed.order", music: "film.changed.music", narration: "film.changed.narration" } as const;
export const changeMsg = (kind: ExportRecord["outdatedBy"][number]): Msg => msg(CHANGE_IDS[kind]);

/** "Today 14:02" or the date and time, in the interface language. */
export function whenMsg(iso: string | null, now: Date, locale: string): Msg | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  if (sameDay) return msg("film.when.today", { time });
  return msg("film.when.date", { date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(at), time });
}

/** Whole seconds since an ISO time (never negative). */
export const elapsedSeconds = (iso: string, nowMs: number) => Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));

// ---- readiness and fingerprints as the server computes them (used by the fixture film) ----------------

export interface FilmFingerprint {
  shots: string;
  order: string;
  music: string;
  narration: string;
}

const stable = (value: unknown) => JSON.stringify(value);

/** The same four parts the server compares (storyboard-capture.ts): shots, order, music and narration. */
export function filmFingerprint(overview: GenerationOverview, soundtrack: unknown): FilmFingerprint {
  const shots = orderedShots(overview);
  const byId = [...shots].sort((a, b) => a.shotId.localeCompare(b.shotId));
  return {
    shots: stable(byId.map((s) => [s.shotId, s.durationFrames, s.video.state === "ready" ? s.video.artifact?.sha256 ?? null : null, s.imagePrompt, s.motion])),
    order: stable(shots.map((s) => s.shotId)),
    music: stable(soundtrack ?? null),
    narration: stable(byId.map((s) => [s.shotId, s.narration.state, s.narration.text, s.narration.fit ?? null, s.narration.measuredSeconds ?? null])),
  };
}

export function changedSince(previous: FilmFingerprint, current: FilmFingerprint): ExportRecord["outdatedBy"] {
  return (["shots", "order", "music", "narration"] as const).filter((key) => previous[key] !== current[key]);
}

/** ExportReadiness from the overview, by the server's rule: a current clip and a settled voice for every shot. */
export function readinessOf(overview: GenerationOverview, demo: boolean): ExportReadiness {
  const shots = orderedShots(overview);
  const blockers: ExportReadiness["blockers"] = [];
  for (const shot of shots) {
    if (shot.video.state === "outdated") blockers.push({ code: "clip_outdated", shotId: shot.shotId });
    else if (shot.video.state !== "ready" || !shot.video.artifact) blockers.push({ code: "no_clip", shotId: shot.shotId });
    const n = shot.narration;
    const settled = n.state === "none" || (n.state === "ready" && (n.fits !== false || !!n.fit));
    if (!settled) blockers.push({ code: "voice_unsettled", shotId: shot.shotId });
  }
  const frames = shots.reduce((sum, shot) => sum + shot.durationFrames, 0);
  if (!shots.length) blockers.push({ code: "empty_film" });
  if (frames > MAX_FILM_SECONDS * overview.fps || shots.length > 64) blockers.push({ code: "too_long" });
  return { ready: !blockers.length, demo: demo && shots.length > 0 && shots.every((s) => s.video.state === "ready"), seconds: Math.round((frames / overview.fps) * 10) / 10, blockers };
}
