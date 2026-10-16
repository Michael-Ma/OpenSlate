import type { ExportRecord, ExportView, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { changedSince, filmFingerprint, readinessOf, type FilmFingerprint, type MediaView } from "../../model/film-export.ts";
import type { MusicRecording, Soundtrack } from "../../model/film.ts";
import type { ProjectSnapshot } from "../../model/types.ts";
import { recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { artifactFor } from "../last-ferry.ts";
import { DECLINE, type FixtureRoute } from "./types.ts";

/**
 * Simulated routes for the Film view on the sample film: storyboard-order exports (start, cancel, Check again),
 * the media jobs that tell an interrupted export, the music library (GET /audio-library; music imported in the
 * Assets view joins it through addMusicRecording), and the music edits (soundtrack) with single-step Undo.
 * Plan's /storyboard route owns the endpoint and hands the music edits here; shot order is Plan's (moveShot).
 * Nothing is rendered, saved or downloaded.
 *
 * Presets for reviewing states the sample film cannot reach by itself (its 3.2 never gets a voice line here):
 * `&film=ready` (every clip made, the last export changed since), `&film=demo`, `&film=interrupted`, `&film=failed`,
 * `&film=long` (20 shots), `&film=stopped` (ready, but stopped), `&film=stalled` (an export prepared and never started
 * because of a restart), `&film=library` (45 music recordings, the film's music on the second page) and
 * `&film=music-missing` (the film's music is gone from its assets).
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
  /** Prepared, and a restart came before it started: it never runs and cannot be recovered. */
  stalled?: boolean;
}

/** The latest music edit, undoable while nothing changed since (the head version is the one it produced). */
interface Undo {
  commandId: string;
  headAfter: number;
  soundtrack: Soundtrack | null;
}

interface FilmFixture {
  serial: number;
  demo: boolean;
  exports: ExportEntry[];
  undo: Undo | null;
  /** The film's music-role recordings (the server pages them by 40). */
  library: MusicRecording[];
}

const LIBRARY_PAGE = 40;
const MIB = 1024 * 1024;

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
    value = { serial: 0, demo: false, exports: [], undo: null, library: [...FIXTURE_MUSIC] };
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
  world.overview = recompute({ ...world.overview, shots }, world.snapshot.notes ?? []);
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

/** A longer film: three more scenes of four 5 s shots with nothing made yet, so the readiness table has 20 rows. */
function longFilm(world: FixtureWorld): void {
  const { fps } = world.overview;
  const template = world.overview.shots[world.overview.scenes.find((scene) => scene.ordinal === 3)?.shotIds[0] ?? ""];
  const sceneTemplate = world.overview.scenes.find((scene) => scene.ordinal === 3);
  const rowTemplate = world.snapshot.project.shots.find((row) => row.id === template?.shotId);
  if (!template || !sceneTemplate || !rowTemplate) return;
  const shots = { ...world.overview.shots };
  const scenes = [...world.overview.scenes];
  const rows = [...world.snapshot.project.shots];
  const sceneRows = [...world.snapshot.project.scenes];
  const titles = ["The crossing", "Island pier", "Morning"];
  titles.forEach((title, index) => {
    const ordinal = 4 + index;
    const id = `scene-${ordinal}`;
    const shotIds = [1, 2, 3, 4].map((n) => `shot-${ordinal}-${n}`);
    shotIds.forEach((shotId, n) => {
      shots[shotId] = { ...template, shotId, sceneId: id, label: `${ordinal}.${n + 1}`, durationFrames: 5 * fps, narration: { state: "none", text: "", fits: true } };
      const { narration: _none, ...row } = rowTemplate;
      rows.push({ ...row, id: shotId, sceneId: id, desiredFrames: 5 * fps });
    });
    scenes.push({ ...sceneTemplate, sceneId: id, ordinal, title, purpose: title, shotIds, keyframeTargets: shotIds, counts: { shots: 4, keyframesReady: 0, opened: 0, videosReady: 0 } });
    sceneRows.push({ id, revisionId: `scene-rev-${ordinal}`, purpose: title, title });
  });
  world.overview = recompute({ ...world.overview, scenes, shots }, world.snapshot.notes ?? []);
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, shots: rows, scenes: sceneRows } };
}

/** 43 more music recordings after the sample's two; the film's music is the last one, on the second page. */
function bigLibrary(world: FixtureWorld, fixture: FilmFixture): void {
  const more = Array.from({ length: 43 }, (_, index): MusicRecording => {
    const n = String(index + 1).padStart(2, "0");
    return { id: `audio-cue-${n}`, label: `harbour-cue-${n}.wav`, sha256: hex(`cue-${n}`), durationSeconds: 30 + index, role: "music" };
  });
  // The server lists the newest first; the film's music is the oldest.
  fixture.library = [...more.reverse(), ...FIXTURE_MUSIC];
  const oldest = fixture.library[fixture.library.length - 1]!;
  const current = soundtrackOf(world);
  setSoundtrack(world, { audioId: oldest.id, gainMilliDb: current?.gainMilliDb ?? -18000, startFrame: current?.startFrame ?? 4 * world.overview.fps, muted: false });
}

function applyPreset(world: FixtureWorld, fixture: FilmFixture, name: string): void {
  if (name === "long") { longFilm(world); return; }
  if (name === "library") { bigLibrary(world, fixture); return; }
  if (name === "music-missing") { setSoundtrack(world, { audioId: "audio-deleted", gainMilliDb: -18000, startFrame: 0, muted: false }); return; }
  if (!["ready", "demo", "interrupted", "failed", "stopped", "stalled"].includes(name)) return;
  everyClipMade(world);
  if (name === "demo") { fixture.demo = true; return; }
  const earlier = earlierExports(world, fixture);
  if (name === "ready") { fixture.exports = earlier; return; }
  if (name === "stopped") {
    fixture.exports = earlier;
    world.overview = { ...world.overview, stopped: { stopId: "stop-film", at: nowIso(-60_000), sentJobs: 0, detachedJobs: 0 } };
    world.snapshot = { ...world.snapshot, control: { paused: true } };
    return;
  }
  const exportId = nextId(fixture, "export");
  const startedAt = nowIso(-4 * 60_000);
  const film = filmFingerprint(world.overview, soundtrackOf(world));
  const head = world.snapshot.project.headVersion;
  const current: ExportEntry = name === "interrupted"
    ? { film, interrupted: true, record: { exportId, state: "rendering", headVersion: head, demo: false, startedAt, outdatedBy: [] } }
    : name === "stalled"
      ? { film, interrupted: false, stalled: true, record: { exportId, state: "rendering", headVersion: head, demo: false, startedAt, outdatedBy: [] } }
      : { film, interrupted: false, record: { exportId, state: "failed", headVersion: head, demo: false, startedAt, finishedAt: nowIso(-3 * 60_000), failure: { code: "MEDIA_TOOL_FAILED" }, outdatedBy: [] } };
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
  // As the server's capture: music that is gone (or never measured) stops the readiness read.
  const music = soundtrackOf(world);
  if (music && !fixture.library.some((r) => r.id === music.audioId)) throw new ApiError("MEDIA_ARTIFACT_UNAVAILABLE", 409);
  const records = fixture.exports.map((entry) => withChanges(world, entry));
  return { readiness: readinessOf(world.overview, fixture.demo), current: records[0] ?? null, history: records.slice(1) };
}

function mediaView(world: FixtureWorld): MediaView & { preview: null; sources: [] } {
  const fixture = state(world);
  return {
    jobs: fixture.exports.map(({ record, interrupted, stalled }) => {
      const prepared = !!stalled && record.state === "rendering";
      return { id: record.exportId, state: prepared ? "prepared" : record.state === "rendering" ? "running" : record.state, canRecover: interrupted && record.state === "rendering", canRun: prepared, createdAt: record.startedAt };
    }),
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
  // Exports render locally and spend nothing; the server allows them while the film is stopped (card B12).
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
  if (entry.stalled) throw new ApiError("MEDIA_RENDER_NOT_STARTED", 409);
  if (!entry.interrupted) throw new ApiError("MEDIA_RENDER_BUSY", 409);
  return new Promise((resolve) => setTimeout(() => {
    world.update(() => {
      entry.interrupted = false;
      entry.record = { ...entry.record, state: "done", finishedAt: nowIso(), artifact: { artifactId: `art-${entry.record.exportId}`, sha256: hex(entry.record.exportId), kind: "video" } };
    });
    resolve(withChanges(world, entry));
  }, FILM_FIXTURE_TIMING.recoverMs));
}

// ---- hold-free storyboard edits: the music ---------------------------------------------------

interface EditBody {
  kind?: string;
  expectedHeadVersion?: unknown;
  field?: string;
  value?: string;
  commandId?: string;
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
      if (!fixture.library.some((r) => r.id === value)) throw new ApiError("NOT_FOUND", 404);
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
    fixture.undo = { commandId, headAfter: w.snapshot.project.headVersion, soundtrack: current };
  });
  return { commandId, headVersion: world.snapshot.project.headVersion };
}

function undo(world: FixtureWorld, entry: Undo): { commandId: string; headVersion: number } {
  const fixture = state(world);
  // Only the latest edit can be undone: any change since (an edit in another view, an import) ends it.
  if (entry.headAfter !== world.snapshot.project.headVersion) {
    fixture.undo = null;
    throw new ApiError("UNDO_UNAVAILABLE", 409);
  }
  world.update((w) => {
    setSoundtrack(w, entry.soundtrack);
    bump(w, fixture);
    fixture.undo = null;
  });
  return { commandId: nextId(fixture, "film-command"), headVersion: world.snapshot.project.headVersion };
}

/** The music edits and their Undo; Plan's route has already checked the kind, the head version and a pending plan. */
function storyboard(world: FixtureWorld, body: unknown): unknown {
  const fixture = state(world);
  const edit = (body ?? {}) as EditBody;
  if (edit.kind === "soundtrack") return soundtrackEdit(world, edit);
  if (edit.kind === "undo" && fixture.undo && fixture.undo.commandId === edit.commandId) {
    assertHead(world, edit);
    return undo(world, fixture.undo);
  }
  return DECLINE;
}

/** The finished exports, newest first: the Assets view lists them (the latest is current). */
export function finishedExports(world: FixtureWorld): ExportRecord[] {
  return state(world).exports.map((entry) => entry.record).filter((record) => record.state === "done" && !!record.artifact);
}

/** Music imported in the Assets view joins the film's library, so Change music lists it. */
export function addMusicRecording(world: FixtureWorld, recording: MusicRecording): void {
  const fixture = state(world);
  if (!fixture.library.some((r) => r.id === recording.id)) fixture.library = [recording, ...fixture.library];
}

/** Simulated server routes the Film view needs in the sample film. */
export const filmRoutes: FixtureRoute[] = [
  { method: "GET", match: /^\/exports$/, handle: (world) => exportView(world) },
  { method: "POST", match: /^\/exports$/, handle: (world, _params, body) => startExport(world, (body ?? {}) as { expectedHeadVersion?: unknown }) },
  { method: "POST", match: /^\/exports\/([^/]+)\/cancel$/, handle: (world, [id]) => cancelExport(world, decodeURIComponent(id ?? "")) },
  { method: "POST", match: /^\/exports\/([^/]+)\/recover$/, handle: (world, [id]) => recoverExport(world, decodeURIComponent(id ?? "")) },
  { method: "GET", match: /^\/media$/, handle: (world) => mediaView(world) },
  { method: "GET", match: /^\/audio-library(?:\?(.*))?$/, handle: (world, [query]) => {
    const fixture = state(world);
    const params = new URLSearchParams(query ?? "");
    const role = params.get("role");
    const offset = Number(params.get("offset") ?? 0);
    const all = fixture.library.filter((r) => !role || r.role === role);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > all.length) throw new ApiError("VALIDATION_ERROR", 400);
    const recordings = all.slice(offset, offset + LIBRARY_PAGE);
    const next = offset + recordings.length;
    // The sample studio imports audio (the Assets view's import), up to 128 MiB and 6 minutes like the studio.
    return { recordings, coverage: { offset, total: all.length, nextOffset: next < all.length ? next : null }, capabilities: { import: true, maxBytes: 128 * MIB, maxSeconds: 360 } };
  } },
  { method: "POST", match: /^\/storyboard$/, handle: (world, _params, body) => storyboard(world, body) },
];
