import type { ExportRecord, ExportView, GenerationOverview, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { changedSince, filmFingerprint, readinessOf, type FilmFingerprint, type MediaView } from "../../model/film-export.ts";
import type { MusicRecording, Soundtrack } from "../../model/film.ts";
import type { ProjectSnapshot } from "../../model/types.ts";
import { fixtureCommand, recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { artifactFor } from "../last-ferry.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * Simulated routes for the Film view on the sample film: storyboard-order exports (start, cancel, Check again),
 * the media jobs that tell an interrupted export, the music library, and the hold-free storyboard edits the
 * Film view makes (moveShot, soundtrack) with single-step Undo. Other storyboard edits go to the Keyframes
 * fixture. Nothing is rendered, saved or downloaded.
 *
 * Presets for reviewing states the sample film cannot reach by itself (its 3.2 never gets a voice line here):
 * `&film=ready` (every clip made, the last export changed since), `&film=demo`, `&film=interrupted`, `&film=failed`.
 */

/** Simulated render time; Check again finds the finished file after a short look. */
export const FILM_FIXTURE_TIMING = { exportMs: 6000, recoverMs: 1200 } as const;

/** The film's music library in the sample film (role music only, SB-24). */
export const FIXTURE_MUSIC: MusicRecording[] = [
  { id: "audio-low-tide", label: "low-tide.mp3", sha256: "a1".repeat(32), durationSeconds: 72, role: "music" },
  { id: "audio-foghorn", label: "foghorn-theme.wav", sha256: "b2".repeat(32), durationSeconds: 58, role: "music" },
];

interface ExportEntry {
  record: ExportRecord;
  film: FilmFingerprint;
  /** A restart left it without an owner: only Check again (recover) can finish it. */
  interrupted: boolean;
}

type Undo =
  | { commandId: string; kind: "order"; scenes: Record<string, string[]>; labels: Record<string, string>; shots: ProjectSnapshot["project"]["shots"] }
  | { commandId: string; kind: "music"; soundtrack: Soundtrack | null };

interface FilmFixture {
  serial: number;
  demo: boolean;
  exports: ExportEntry[];
  undo: Undo | null;
}

const states = new WeakMap<FixtureWorld, FilmFixture>();

type SnapshotWithMusic = ProjectSnapshot & { project: ProjectSnapshot["project"] & { soundtrack?: Soundtrack | null } };
const soundtrackOf = (world: FixtureWorld): Soundtrack | null => (world.snapshot as SnapshotWithMusic).project.soundtrack ?? null;
function setSoundtrack(world: FixtureWorld, soundtrack: Soundtrack | null): void {
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, soundtrack } } as SnapshotWithMusic;
}

const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const hex = (text: string) => [...text].map((c) => c.charCodeAt(0).toString(16)).join("").padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);

function presetName(): string | null {
  try { return new URLSearchParams(globalThis.location?.search ?? "").get("film"); } catch { return null; }
}

function state(world: FixtureWorld): FilmFixture {
  let value = states.get(world);
  if (!value) {
    value = { serial: 0, demo: false, exports: [], undo: null };
    states.set(world, value);
    const created = value;
    const preset = presetName();
    // The sample film has low-tide.mp3 from 0:04 at −18 dB, as in the design study.
    world.update((w) => {
      if (!soundtrackOf(w)) setSoundtrack(w, { audioId: "audio-low-tide", gainMilliDb: -18000, startFrame: 4 * w.overview.fps, muted: false });
      if (preset) applyPreset(w, created, preset);
    });
  }
  return value;
}

const nextId = (fixture: FilmFixture, prefix: string) => `${prefix}-${++fixture.serial}`;

function bump(world: FixtureWorld, fixture: FilmFixture): void {
  const revisionId = nextId(fixture, "film-rev");
  const headVersion = world.snapshot.project.headVersion + 1;
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, headVersion, revisionId } };
  world.overview = { ...world.overview, headVersion, revisionId };
}

function assertHead(world: FixtureWorld, body: { expectedHeadVersion?: unknown }): void {
  if (body.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
}

// ---- presets -------------------------------------------------------------------------------

/** Every shot has its keyframe and clip, 2.3 was lengthened to 8 s for its line and 3.2's line was voiced. */
function everyClipMade(world: FixtureWorld): void {
  const shots: Record<string, ShotOverview> = {};
  for (const [id, shot] of Object.entries(world.overview.shots)) {
    const keyframe = shot.keyframe.state === "ready" ? shot.keyframe : { state: "ready" as const, artifact: artifactFor(shot.label), takeCount: Math.max(1, shot.keyframe.takeCount), opened: true };
    const clip: StudioArtifactRef = { artifactId: `art-${shot.label}-clip`, sha256: hex(`${shot.label}-clip#1`), kind: "video" };
    let next: ShotOverview = { ...shot, keyframe: { ...keyframe, opened: true }, video: shot.video.state === "ready" ? shot.video : { state: "ready", artifact: clip, takeCount: shot.video.takeCount + 1 } };
    if (shot.label === "2.3") next = { ...next, durationFrames: 8 * world.overview.fps, narration: { ...shot.narration, fit: "extend_shot" } };
    if (shot.label === "3.2") next = { ...next, narration: { state: "ready", text: shot.narration.text, measuredSeconds: 1.6, fits: true } };
    shots[id] = next;
  }
  world.overview = recompute({ ...world.overview, shots });
  world.snapshot = {
    ...world.snapshot,
    project: { ...world.snapshot.project, shots: world.snapshot.project.shots.map((row) => ({ ...row, desiredFrames: world.overview.shots[row.id]?.durationFrames ?? row.desiredFrames })) },
  };
}

function doneExport(fixture: FilmFixture, film: FilmFingerprint, finishedAt: string, demo = false): ExportEntry {
  const exportId = nextId(fixture, "export");
  return {
    film,
    interrupted: false,
    record: { exportId, state: "done", headVersion: 0, demo, startedAt: finishedAt, finishedAt, artifact: { artifactId: `art-${exportId}`, sha256: hex(exportId), kind: "video" }, outdatedBy: [] },
  };
}

/** Exported half an hour ago; the shot order and the music changed since. Two earlier exports are in Assets. */
function earlierExports(world: FixtureWorld, fixture: FilmFixture): ExportEntry[] {
  const now = filmFingerprint(world.overview, soundtrackOf(world));
  return [
    doneExport(fixture, { ...now, order: "earlier order", music: "earlier music" }, nowIso(-30 * 60_000)),
    doneExport(fixture, { shots: "", order: "", music: "", narration: "" }, nowIso(-26 * 3600_000)),
    doneExport(fixture, { shots: "", order: "", music: "", narration: "" }, nowIso(-50 * 3600_000)),
  ];
}

function applyPreset(world: FixtureWorld, fixture: FilmFixture, name: string): void {
  if (!["ready", "demo", "interrupted", "failed"].includes(name)) return;
  everyClipMade(world);
  if (name === "demo") { fixture.demo = true; return; }
  const earlier = earlierExports(world, fixture);
  if (name === "ready") { fixture.exports = earlier; return; }
  const exportId = nextId(fixture, "export");
  const startedAt = nowIso(-4 * 60_000);
  const current: ExportEntry = name === "interrupted"
    ? { film: filmFingerprint(world.overview, soundtrackOf(world)), interrupted: true, record: { exportId, state: "rendering", headVersion: world.snapshot.project.headVersion, demo: false, startedAt, outdatedBy: [] } }
    : { film: filmFingerprint(world.overview, soundtrackOf(world)), interrupted: false, record: { exportId, state: "failed", headVersion: world.snapshot.project.headVersion, demo: false, startedAt, finishedAt: nowIso(-3 * 60_000), failure: { code: "RENDER_FAILED" }, outdatedBy: [] } };
  fixture.exports = [current, ...earlier];
}

/** For tests: set up a preset on a fresh world without reading the page's address. */
export function applyFilmPreset(world: FixtureWorld, name: string): void {
  const fixture = state(world);
  world.update((w) => applyPreset(w, fixture, name));
}

// ---- exports -------------------------------------------------------------------------------

function withChanges(world: FixtureWorld, entry: ExportEntry): ExportRecord {
  const now = filmFingerprint(world.overview, soundtrackOf(world));
  return { ...entry.record, outdatedBy: entry.record.state === "done" ? changedSince(entry.film, now) : [] };
}

function exportView(world: FixtureWorld): ExportView {
  const fixture = state(world);
  const records = fixture.exports.map((entry) => withChanges(world, entry));
  return { readiness: readinessOf(world.overview, fixture.demo), current: records[0] ?? null, history: records.slice(1) };
}

function mediaView(world: FixtureWorld): MediaView & { preview: null; sources: [] } {
  const fixture = state(world);
  return {
    jobs: fixture.exports.map(({ record, interrupted }) => ({ id: record.exportId, state: record.state === "rendering" ? "running" : record.state, canRecover: interrupted && record.state === "rendering" })),
    preview: null,
    lastExport: null,
    sources: [],
  };
}

function findExport(world: FixtureWorld, exportId: string): ExportEntry {
  const entry = state(world).exports.find((e) => e.record.exportId === exportId);
  if (!entry) throw new ApiError("NOT_FOUND", 404);
  return entry;
}

function startExport(world: FixtureWorld, body: { expectedHeadVersion?: unknown }): ExportRecord {
  const fixture = state(world);
  assertHead(world, body);
  const readiness = readinessOf(world.overview, fixture.demo);
  if (!readiness.ready) throw new ApiError("EXPORT_BLOCKED", 409, { ...readiness });
  const entry: ExportEntry = {
    film: filmFingerprint(world.overview, soundtrackOf(world)),
    interrupted: false,
    record: { exportId: nextId(fixture, "export"), state: "rendering", headVersion: world.snapshot.project.headVersion, demo: readiness.demo, startedAt: nowIso(), outdatedBy: [] },
  };
  world.update(() => { fixture.exports = [entry, ...fixture.exports]; });
  world.later(FILM_FIXTURE_TIMING.exportMs, () => {
    if (entry.record.state !== "rendering" || entry.interrupted) return;
    entry.record = { ...entry.record, state: "done", finishedAt: nowIso(), artifact: { artifactId: `art-${entry.record.exportId}`, sha256: hex(entry.record.exportId), kind: "video" } };
  });
  return { ...entry.record };
}

function cancelExport(world: FixtureWorld, exportId: string): ExportRecord {
  const entry = findExport(world, exportId);
  if (entry.record.state === "rendering") world.update(() => { entry.record = { ...entry.record, state: "cancelled", finishedAt: nowIso() }; });
  return withChanges(world, entry);
}

/** Check again: looks for the finished file and never renders again. The sample's interrupted export is found. */
function recoverExport(world: FixtureWorld, exportId: string): Promise<ExportRecord> | ExportRecord {
  const entry = findExport(world, exportId);
  if (entry.record.state !== "rendering") return withChanges(world, entry);
  if (!entry.interrupted) throw new ApiError("MEDIA_RENDER_BUSY", 409);
  return new Promise((resolve) => setTimeout(() => {
    world.update(() => {
      entry.interrupted = false;
      entry.record = { ...entry.record, state: "done", finishedAt: nowIso(), artifact: { artifactId: `art-${entry.record.exportId}`, sha256: hex(entry.record.exportId), kind: "video" } };
    });
    resolve(withChanges(world, entry));
  }, FILM_FIXTURE_TIMING.recoverMs));
}

// ---- hold-free storyboard edits: order within a scene and the music --------------------------

interface EditBody {
  kind?: string;
  expectedHeadVersion?: unknown;
  id?: string;
  sceneId?: string;
  beforeId?: string;
  field?: string;
  value?: string;
  commandId?: string;
}

function relabel(overview: GenerationOverview): GenerationOverview {
  const shots = { ...overview.shots };
  for (const scene of overview.scenes) scene.shotIds.forEach((id, index) => { const shot = shots[id]; if (shot) shots[id] = { ...shot, sceneId: scene.sceneId, label: `${scene.ordinal}.${index + 1}` }; });
  return { ...overview, shots };
}

/** The snapshot's shot rows follow the overview's storyboard order. */
function orderSnapshot(world: FixtureWorld): void {
  const order = [...world.overview.scenes].sort((a, b) => a.ordinal - b.ordinal).flatMap((scene) => scene.shotIds.map((id) => ({ id, sceneId: scene.sceneId })));
  const rows = new Map(world.snapshot.project.shots.map((row) => [row.id, row]));
  const shots = order.map(({ id, sceneId }) => { const row = rows.get(id); return row ? { ...row, sceneId } : null; }).filter((row): row is NonNullable<typeof row> => !!row);
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, shots } };
}

function moveShot(world: FixtureWorld, body: EditBody): { commandId: string; headVersion: number } {
  const fixture = state(world);
  assertHead(world, body);
  const shot = body.id ? world.overview.shots[body.id] : undefined;
  if (!shot) throw new ApiError("NOT_FOUND", 404);
  const target = world.overview.scenes.find((scene) => scene.sceneId === body.sceneId);
  if (!target) throw new ApiError("NOT_FOUND", 404);
  if (body.beforeId !== undefined && (body.beforeId === shot.shotId || !target.shotIds.includes(body.beforeId))) throw new ApiError("VALIDATION_ERROR", 400);
  const commandId = nextId(fixture, "film-command");
  const before: Undo = {
    commandId,
    kind: "order",
    scenes: Object.fromEntries(world.overview.scenes.map((scene) => [scene.sceneId, [...scene.shotIds]])),
    labels: Object.fromEntries(Object.values(world.overview.shots).map((s) => [s.shotId, s.label])),
    shots: world.snapshot.project.shots,
  };
  world.update((w) => {
    const scenes = w.overview.scenes.map((scene) => {
      const without = scene.shotIds.filter((id) => id !== shot.shotId);
      if (scene.sceneId !== target.sceneId) return { ...scene, shotIds: without };
      const at = body.beforeId ? without.indexOf(body.beforeId) : without.length;
      return { ...scene, shotIds: [...without.slice(0, at), shot.shotId, ...without.slice(at)] };
    });
    w.overview = recompute(relabel({ ...w.overview, scenes }));
    orderSnapshot(w);
    bump(w, fixture);
    fixture.undo = before;
  });
  return { commandId, headVersion: world.snapshot.project.headVersion };
}

function soundtrackEdit(world: FixtureWorld, body: EditBody): { commandId: string; headVersion: number } {
  const fixture = state(world);
  assertHead(world, body);
  const current = soundtrackOf(world);
  let next: Soundtrack | null;
  const value = body.value ?? "";
  if (body.field === "audioId") {
    if (!value) next = null;
    else {
      if (!FIXTURE_MUSIC.some((r) => r.id === value)) throw new ApiError("NOT_FOUND", 404);
      next = { audioId: value, gainMilliDb: current?.gainMilliDb ?? -18000, ...(current?.startFrame !== undefined ? { startFrame: current.startFrame } : {}), ...(current?.muted !== undefined ? { muted: current.muted } : {}) };
    }
  } else {
    if (!current) throw new ApiError("VALIDATION_ERROR", 400);
    const number = Number(value);
    if (body.field === "startFrame") {
      if (!Number.isSafeInteger(number) || number < 0 || number > 10800) throw new ApiError("VALIDATION_ERROR", 400);
      next = { ...current, startFrame: number };
    } else if (body.field === "gainMilliDb") {
      if (!Number.isSafeInteger(number) || number < -60000 || number > 0) throw new ApiError("VALIDATION_ERROR", 400);
      next = { ...current, gainMilliDb: number };
    } else if (body.field === "muted") {
      if (value !== "true" && value !== "false") throw new ApiError("VALIDATION_ERROR", 400);
      next = { ...current, muted: value === "true" };
    } else throw new ApiError("VALIDATION_ERROR", 400);
  }
  const commandId = nextId(fixture, "film-command");
  world.update((w) => {
    setSoundtrack(w, next);
    bump(w, fixture);
    fixture.undo = { commandId, kind: "music", soundtrack: current };
  });
  return { commandId, headVersion: world.snapshot.project.headVersion };
}

function undo(world: FixtureWorld, entry: Undo): { commandId: string; headVersion: number } {
  const fixture = state(world);
  world.update((w) => {
    if (entry.kind === "music") setSoundtrack(w, entry.soundtrack);
    else {
      const scenes = w.overview.scenes.map((scene) => ({ ...scene, shotIds: entry.scenes[scene.sceneId] ?? scene.shotIds }));
      const shots = { ...w.overview.shots };
      for (const [id, label] of Object.entries(entry.labels)) { const shot = shots[id]; if (shot) shots[id] = { ...shot, label }; }
      w.overview = recompute(relabel({ ...w.overview, scenes, shots }));
      const rows = new Map(w.snapshot.project.shots.map((row) => [row.id, row]));
      w.snapshot = { ...w.snapshot, project: { ...w.snapshot.project, shots: entry.shots.map((row) => ({ ...(rows.get(row.id) ?? row), sceneId: row.sceneId })) } };
    }
    bump(w, fixture);
    fixture.undo = null;
  });
  return { commandId: nextId(fixture, "film-command"), headVersion: world.snapshot.project.headVersion };
}

function storyboard(world: FixtureWorld, body: unknown): unknown {
  const fixture = state(world);
  const edit = (body ?? {}) as EditBody;
  if (edit.kind === "moveShot") return moveShot(world, edit);
  if (edit.kind === "soundtrack") return soundtrackEdit(world, edit);
  if (edit.kind === "undo" && fixture.undo && fixture.undo.commandId === edit.commandId) {
    assertHead(world, edit);
    return undo(world, fixture.undo);
  }
  // Only the latest edit can be undone: a new edit elsewhere ends this view's pending Undo.
  if (edit.kind !== "undo") fixture.undo = null;
  return fixtureCommand(world, "POST", "/storyboard", body);
}

/** Simulated server routes the Film view needs in the sample film. */
export const filmRoutes: FixtureRoute[] = [
  { method: "GET", match: /^\/exports$/, handle: (world) => exportView(world) },
  { method: "POST", match: /^\/exports$/, handle: (world, _params, body) => startExport(world, (body ?? {}) as { expectedHeadVersion?: unknown }) },
  { method: "POST", match: /^\/exports\/([^/]+)\/cancel$/, handle: (world, [id]) => cancelExport(world, decodeURIComponent(id ?? "")) },
  { method: "POST", match: /^\/exports\/([^/]+)\/recover$/, handle: (world, [id]) => recoverExport(world, decodeURIComponent(id ?? "")) },
  { method: "GET", match: /^\/media$/, handle: (world) => mediaView(world) },
  { method: "GET", match: /^\/audio-library(?:\?(.*))?$/, handle: (world, [query]) => {
    state(world);
    const role = new URLSearchParams(query ?? "").get("role");
    const recordings = FIXTURE_MUSIC.filter((r) => !role || r.role === role);
    return { recordings, coverage: { offset: 0, total: recordings.length, nextOffset: null }, capabilities: { import: false, maxBytes: 0, maxSeconds: 360 } };
  } },
  { method: "POST", match: /^\/storyboard$/, handle: (world, _params, body) => storyboard(world, body) },
];
