import type { GenerationOverview, ProjectListItem, SceneOverview, ShotOverview } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import type { ConversationEntry, DirectorStatus, ProjectSnapshot } from "../../model/types.ts";
import { FIXTURE_REPLY_MS } from "../fixture-director.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { FPS, lastFerryOverview, lastFerrySnapshot, PROJECT_ID, sceneId } from "../last-ferry.ts";
import { catalogDigest, changeCatalogOnce, CODEX_DEFAULTS, computer, startPreset } from "./computer.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * The Start view's routes in the sample film: the films list (with archived films), rename, archive
 * and restore, creating a film, the demo, and the other films' Director setup, reads and plan import.
 * Other films are small simulated films that open in the studio; nothing is generated, charged or
 * saved. This computer (Codex, keys, the provider catalog) is computer.ts; the sample film's own
 * Director setup is answered by settings.ts.
 *
 * `?start=no-keys` simulates a computer without keys or Codex. `?start=first-run` also archives The
 * Last Ferry, so the studio opens with no film (GET /api/projects is empty) and shows the welcome and
 * the demo path; with no film open the view cannot read whether this computer has Codex, so a new
 * film's Director step is where it finds out.
 * `?start=setup-busy` has keys and Codex, but each new film's first Codex setup answers
 * DIRECTOR_SETUP_BUSY (the check is still running), so Try again shows.
 * `?start=refusals` shows refusals inside the modal dialogs: this computer's models change once, just
 * before the first Create that names them (PROVIDER_CATALOG_CHANGED), and Night bus has a keyframe
 * running, so archiving it is refused (ATTEMPTS_RUNNING).
 * `?start=slow-models` answers GET /api/providers after a moment, so the sheet's Create waits for it.
 * `?start=no-stand-in` is a studio without the stand-in Director: filling the demo is refused (ACTOR_DENIED).
 */

interface Film {
  id: string;
  name: string;
  archived: boolean;
  updatedAt: string;
  director: "fake" | "native";
  /** Null for The Last Ferry, whose state is the fixture world's. */
  data: { snapshot: ProjectSnapshot; overview: GenerationOverview } | null;
  planImport: { id: string; name: string; text: string } | null;
}

interface StartWorld {
  films: Film[];
  /** Films whose next Codex setup answers DIRECTOR_SETUP_BUSY (setup-busy). */
  busyOnce: Set<string> | null;
  next: number;
  /** The world cursor last seen, so The Last Ferry's "changed" follows its edits. */
  seenCursor: number;
}

const worlds = new WeakMap<FixtureWorld, StartWorld>();

/** A local time `days` before today, never later than a few minutes ago (early in the morning "today 10:44" has not happened yet). */
function daysAgo(now: Date, days: number, hours: number, minutes: number): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hours, minutes);
  return new Date(Math.min(at.getTime(), now.getTime() - 16 * 60_000)).toISOString();
}

// ---- small simulated films ----

function emptyFilm(id: string, name: string, headVersion = 1): { snapshot: ProjectSnapshot; overview: GenerationOverview } {
  const revisionId = `rev-${id}-${headVersion}`;
  return {
    snapshot: { project: { id, name, revisionId, headVersion, brief: "", story: "", scenes: [], shots: [] }, conversation: [], questions: [], control: { paused: false }, cursor: 1 },
    overview: { projectId: id, revisionId, headVersion, cursor: 1, fps: FPS, stopped: null, director: { state: "idle", scopeIds: [] }, controlAuthorityId: null, scenes: [], shots: {}, restartCasualties: [] },
  };
}

/** Scene 1 of The Last Ferry as its own film (the demo): three shots, every clip made. */
function demoFilm(id: string, name: string): { snapshot: ProjectSnapshot; overview: GenerationOverview } {
  const overview = lastFerryOverview();
  const snapshot = lastFerrySnapshot();
  const scene = overview.scenes[0]!;
  const shots: Record<string, ShotOverview> = {};
  for (const shotId of scene.shotIds) shots[shotId] = overview.shots[shotId]!;
  return {
    snapshot: {
      ...snapshot,
      project: { ...snapshot.project, id, name, headVersion: 3, revisionId: `rev-${id}`, scenes: snapshot.project.scenes.slice(0, 1), shots: snapshot.project.shots.filter((shot) => shot.sceneId === scene.sceneId) },
      conversation: [{ id: `${id}-m1`, role: "assistant", text: "This is the demo: Scene 1 of The Last Ferry, made by stand-in models. Nothing was sent anywhere.", runtime: "scripted" }],
      questions: [],
      notes: [],
      cursor: 2,
    },
    overview: { ...overview, projectId: id, revisionId: `rev-${id}`, headVersion: 3, cursor: 2, scenes: [scene], shots, restartCasualties: [] },
  };
}

/** A film with direction written and nothing made yet. */
function draftFilm(id: string, name: string, title: string, rows: { framing: string; prompt: string; motion: string; seconds: number }[]): { snapshot: ProjectSnapshot; overview: GenerationOverview } {
  const scene = sceneId(1);
  const shotIds = rows.map((_, index) => `${id}-shot-${index + 1}`);
  const shots: Record<string, ShotOverview> = {};
  rows.forEach((row, index) => {
    shots[shotIds[index]!] = {
      shotId: shotIds[index]!, sceneId: scene, label: `1.${index + 1}`, framing: row.framing, purpose: row.prompt, imagePrompt: row.prompt, motion: row.motion,
      durationFrames: row.seconds * FPS, keyframe: { state: "none", takeCount: 0, opened: false }, video: { state: "none", takeCount: 0 }, narration: { state: "none", text: "", fits: true },
    };
  });
  const sceneOverview: SceneOverview = {
    sceneId: scene, ordinal: 1, title, purpose: title, state: "not_started", shotIds,
    counts: { shots: rows.length, keyframesReady: 0, opened: 0, videosReady: 0 },
    videoTargets: [], keyframeTargets: shotIds,
    quotes: { makeKeyframes: { micros: String(rows.length * 40000), units: rows.length, unitMicros: "40000", priceUnknown: false }, regenerateKeyframe: { micros: "40000", units: 1, unitMicros: "40000", priceUnknown: false } },
    blockers: [], confirmationDigest: null,
  };
  const base = emptyFilm(id, name, 4);
  return {
    snapshot: {
      ...base.snapshot,
      project: {
        ...base.snapshot.project,
        scenes: [{ id: scene, revisionId: `${id}-scene-rev`, purpose: title, title }],
        shots: rows.map((row, index) => ({ id: shotIds[index]!, sceneId: scene, purpose: row.prompt, framing: row.framing, motion: row.motion, desiredFrames: row.seconds * FPS, imagePrompt: row.prompt, videoPrompt: `${row.prompt} ${row.motion}.` })),
      },
    },
    overview: { ...base.overview, scenes: [sceneOverview], shots },
  };
}

function initial(world: FixtureWorld): StartWorld {
  const now = new Date();
  const start = startPreset();
  const firstRun = start === "first-run";
  const ferry: Film = { id: PROJECT_ID, name: world.snapshot.project.name, archived: firstRun, updatedAt: daysAgo(now, 0, 10, 44), director: "fake", data: null, planImport: null };
  const others: Film[] = firstRun ? [] : [
    { id: "demo-ferry", name: "Demo: The Last Ferry", archived: false, updatedAt: daysAgo(now, 1, 18, 10), director: "fake", data: demoFilm("demo-ferry", "Demo: The Last Ferry"), planImport: null },
    { id: "night-bus", name: "Night bus", archived: false, updatedAt: daysAgo(now, 6, 21, 5), director: "fake", planImport: null,
      data: draftFilm("night-bus", "Night bus", "Last stop", [
        { framing: "Wide", prompt: "An empty night bus under orange street lights.", motion: "Slow push-in", seconds: 5 },
        { framing: "Close-up", prompt: "The driver's tired eyes in the mirror.", motion: "Static", seconds: 5 },
      ]) },
    { id: "lighthouse-test", name: "Lighthouse test", archived: true, updatedAt: daysAgo(now, 13, 16, 30), director: "fake", planImport: null,
      data: draftFilm("lighthouse-test", "Lighthouse test", "Beam", [{ framing: "Wide", prompt: "A lighthouse beam sweeping over a calm sea.", motion: "Static", seconds: 5 }]) },
  ];
  if (start === "refusals") {
    const bus = others.find((item) => item.id === "night-bus")!.data!;
    const [first] = Object.keys(bus.overview.shots);
    bus.overview.shots[first!] = { ...bus.overview.shots[first!]!, keyframe: { state: "running", takeCount: 0, opened: false } };
  }
  return { films: [ferry, ...others], busyOnce: start === "setup-busy" ? new Set() : null, next: 1, seenCursor: world.overview.cursor };
}

function state(world: FixtureWorld): StartWorld {
  let current = worlds.get(world);
  if (!current) { current = initial(world); worlds.set(world, current); }
  // Edits in The Last Ferry move its "changed" time.
  if (world.overview.cursor !== current.seenCursor) {
    current.seenCursor = world.overview.cursor;
    const ferry = current.films.find((film) => film.id === PROJECT_ID);
    if (ferry) ferry.updatedAt = new Date().toISOString();
  }
  return current;
}

function film(world: FixtureWorld, id: string | undefined): Film {
  const found = state(world).films.find((item) => item.id === (id ?? PROJECT_ID));
  if (!found) throw new ApiError("NOT_FOUND", 404);
  return found;
}

const dataOf = (world: FixtureWorld, item: Film) => item.data ?? { snapshot: world.snapshot, overview: world.overview };
const headOf = (world: FixtureWorld, item: Film) => dataOf(world, item).snapshot.project.headVersion;

function listItem(world: FixtureWorld, item: Film): ProjectListItem {
  const { snapshot, overview } = dataOf(world, item);
  const shots = Object.values(overview.shots);
  return {
    id: item.id,
    name: item.id === PROJECT_ID ? world.snapshot.project.name : item.name,
    archived: item.archived,
    scenes: snapshot.project.scenes.length,
    shots: snapshot.project.shots.length,
    seconds: shots.reduce((sum, shot) => sum + shot.durationFrames, 0) / overview.fps,
    videosReady: shots.filter((shot) => shot.video.state === "ready").length,
    updatedAt: item.updatedAt,
  };
}

/** Change a simulated film: a new head version and cursor, like a server command. */
function change(world: FixtureWorld, item: Film, edit: (data: { snapshot: ProjectSnapshot; overview: GenerationOverview }) => { snapshot: ProjectSnapshot; overview: GenerationOverview }): void {
  item.updatedAt = new Date().toISOString();
  if (!item.data) {
    world.update((w) => {
      const next = edit({ snapshot: w.snapshot, overview: w.overview });
      w.snapshot = next.snapshot;
      w.overview = next.overview;
    });
    state(world);
    return;
  }
  const next = edit(item.data);
  const cursor = item.data.snapshot.cursor + 1;
  item.data = { snapshot: { ...next.snapshot, cursor }, overview: { ...next.overview, cursor } };
}

const bumpHead = (data: { snapshot: ProjectSnapshot; overview: GenerationOverview }, project: Partial<ProjectSnapshot["project"]> = {}) => {
  const headVersion = data.snapshot.project.headVersion + 1;
  return {
    snapshot: { ...data.snapshot, project: { ...data.snapshot.project, ...project, headVersion } },
    overview: { ...data.overview, headVersion },
  };
};

const RUNNING = new Set(["queued", "running", "no_answer"]);
const runningIn = (overview: GenerationOverview) => Object.values(overview.shots).some((shot) => RUNNING.has(shot.keyframe.state) || RUNNING.has(shot.video.state) || shot.narration.state === "making");

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// ---- routes ----

/** A film's own path: relative for The Last Ferry (below its base), absolute for the others. */
const own = (rest: string) => new RegExp(`^(?:/api/projects/([^/?]+))?${rest}$`);
const other = (rest: string) => new RegExp(`^/api/projects/([^/?]+)${rest}$`);

function setupRead(world: FixtureWorld, item: Film) {
  const { codex } = computer(world);
  const defaults = codex ? { ...CODEX_DEFAULTS } : { binaryPath: "", model: CODEX_DEFAULTS.model };
  const selection = item.director === "native" ? { mode: "native" as const, ...CODEX_DEFAULTS } : { mode: "fake" as const };
  return { selection, selectionDigest: "d".repeat(64), busy: false, changeAvailable: true, changeAppliesTo: "next_turn", defaults, locked: false, modelCalls: 0, modelChoices: [], modelCatalogStatus: "unchecked", modelCatalogCheckedAt: null };
}

export const startRoutes: FixtureRoute[] = [
  {
    // What the studio opens with: the sample film, or no film on a first run (it is archived). Only the films
    // list (below) names the other films, so the top bar shows the sample film's title until Start is opened.
    method: "GET",
    match: /^\/api\/projects$/,
    handle(world) {
      const ferry = film(world, PROJECT_ID);
      return { projects: ferry.archived ? [] : [{ id: ferry.id, name: world.snapshot.project.name }] };
    },
  },
  {
    method: "GET",
    match: /^\/api\/projects\?includeArchived=(true|false)$/,
    handle(world, [include]) {
      const all = state(world).films.filter((item) => include === "true" || !item.archived);
      return { projects: all.map((item) => listItem(world, item)) };
    },
  },
  {
    method: "POST",
    match: /^\/api\/projects$/,
    handle(world, _params, body) {
      const input = asObject(body);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 160) throw new ApiError("VALIDATION_ERROR", 400);
      const start = state(world);
      if (input.expectedCatalogDigest !== undefined) {
        changeCatalogOnce(world);
        if (input.expectedCatalogDigest !== catalogDigest(world)) throw new ApiError("PROVIDER_CATALOG_CHANGED", 409);
      }
      const id = `film-${start.next++}`;
      const data = emptyFilm(id, name);
      start.films.push({ id, name, archived: false, updatedAt: new Date().toISOString(), director: "fake", data, planImport: null });
      start.busyOnce?.add(id);
      return { ...data.snapshot.project };
    },
  },
  {
    method: "POST",
    match: own("/rename"),
    handle(world, [id], body) {
      const item = film(world, id);
      const input = asObject(body);
      const name = typeof input.name === "string" ? input.name.trim() : "";
      if (!name || name.length > 160) throw new ApiError("VALIDATION_ERROR", 400);
      if (input.expectedHeadVersion !== headOf(world, item)) throw new ApiError("REVISION_CONFLICT", 409);
      item.name = name;
      change(world, item, (data) => bumpHead(data, { name }));
      return { headVersion: headOf(world, item), project: { id: item.id, name } };
    },
  },
  {
    method: "POST",
    match: own("/(archive|unarchive)"),
    handle(world, [id, action]) {
      const item = film(world, id);
      if (action === "archive" && runningIn(dataOf(world, item).overview)) throw new ApiError("ATTEMPTS_RUNNING", 409);
      item.archived = action === "archive";
      change(world, item, (data) => bumpHead(data));
      return { headVersion: headOf(world, item), project: { id: item.id, archived: item.archived } };
    },
  },
  {
    method: "POST",
    match: own("/demo"),
    handle(world, [id], body) {
      const item = film(world, id);
      if (asObject(body).action !== "create") throw new ApiError("VALIDATION_ERROR", 400);
      if (item.director !== "fake" || startPreset() === "no-stand-in") throw new ApiError("ACTOR_DENIED", 409);
      if (!item.data || item.data.snapshot.project.shots.length) throw new ApiError("DEMO_REQUIRES_EMPTY_PROJECT", 409);
      const seeded = demoFilm(item.id, item.name);
      change(world, item, () => seeded);
      return { requestId: `${item.id}-demo`, turnId: `${item.id}-turn`, status: "queued", director: "fake" };
    },
  },
  // The other films' Director setup (the sample film's is settings.ts).
  { method: "GET", match: other("/director/setup"), handle: (world, [id]) => setupRead(world, film(world, id)) },
  {
    method: "POST",
    match: other("/director/setup"),
    handle(world, [id], body) {
      const item = film(world, id);
      const input = asObject(body);
      const busy = state(world).busyOnce;
      if (busy?.delete(item.id)) throw new ApiError("DIRECTOR_SETUP_BUSY", 409);
      if (input.mode === "native") {
        if (!computer(world).codex || typeof input.binaryPath !== "string" || !input.binaryPath) throw new ApiError("VALIDATION_ERROR", 400);
        item.director = "native";
      } else item.director = "fake";
      return { ...setupRead(world, item), readiness: null, readinessSelectionDigest: "d".repeat(64), selectionMatchesCommand: true };
    },
  },
  // Reads of the simulated films (The Last Ferry's are answered by the fixture port).
  { method: "GET", match: other(""), handle: (world, [id]) => structuredClone(dataOf(world, film(world, id)).snapshot) },
  { method: "GET", match: other("/generation"), handle: (world, [id]) => structuredClone(dataOf(world, film(world, id)).overview) },
  {
    method: "GET",
    match: other("/director"),
    handle(world, [id]): DirectorStatus {
      const item = film(world, id);
      return { mode: item.director, status: "idle", activeRequestId: null };
    },
  },
  { method: "GET", match: other("/director/proposals"), handle: (world, [id]) => { film(world, id); return { proposals: [] }; } },
  {
    // The scripted Director in a simulated film (The Last Ferry's is fixture-director.ts).
    method: "POST",
    match: other("/messages"),
    handle(world, [id], body) {
      const item = film(world, id);
      const text = typeof asObject(body).text === "string" ? (asObject(body).text as string).trim() : "";
      if (!item.data || !text || text.length > 16000) throw new ApiError("VALIDATION_ERROR", 400);
      const requestId = `${item.id}-request-${(item.data.snapshot.conversation?.length ?? 0) + 1}`;
      const entry: ConversationEntry = { id: requestId, role: "user", text, requestId, at: new Date().toISOString(), scopeIds: [] };
      change(world, item, (data) => ({
        snapshot: { ...data.snapshot, conversation: [...(data.snapshot.conversation ?? []), entry] },
        overview: { ...data.overview, director: { state: "working", scopeIds: [], requestId } },
      }));
      world.later(FIXTURE_REPLY_MS, () => {
        const reply: ConversationEntry = { id: `${requestId}-reply`, role: "assistant", text: "Noted. I would draft scenes and shots from that and show them in the Plan before anything is made.", requestId, at: new Date().toISOString(), runtime: "scripted" };
        change(world, item, (data) => ({
          snapshot: { ...data.snapshot, conversation: [...(data.snapshot.conversation ?? []), reply] },
          overview: { ...data.overview, director: { state: "idle", scopeIds: [] } },
        }));
      });
      return { requestId, status: "queued", director: item.director };
    },
  },
  {
    method: "GET",
    match: other("/plan-imports"),
    handle(world, [id]) {
      const pending = film(world, id).planImport;
      return { pending: pending ? { id: pending.id, name: pending.name, text: pending.text, sourceDigest: "e".repeat(64), stale: false, running: true, draft: null } : null };
    },
  },
  {
    method: "POST",
    match: other("/plan-imports"),
    handle(world, [id], body) {
      const item = film(world, id);
      const input = asObject(body);
      if (item.director !== "native") throw new ApiError("DIRECTOR_REQUIRED", 409);
      const text = typeof input.text === "string" ? input.text : "";
      const name = typeof input.name === "string" ? input.name : "";
      if (!text.trim() || text.length > 12000 || !/\.(txt|md)$/i.test(name)) throw new ApiError("VALIDATION_ERROR", 400);
      if (input.expectedHeadVersion !== headOf(world, item)) throw new ApiError("REVISION_CONFLICT", 409);
      if (item.planImport) throw new ApiError("IMPORT_PENDING", 409);
      item.planImport = { id: `${item.id}-import`, name, text };
      item.updatedAt = new Date().toISOString();
      return { requestId: item.planImport.id };
    },
  },
];
