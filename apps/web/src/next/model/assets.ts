import type { AssetItem, AssetRole, GenerationOverview, StudioArtifactRef } from "@openslate/core/public";
import { clock } from "./motion.ts";
import { msg, type Msg, type Target } from "./types.ts";

/**
 * The Assets view (SB-21): every AssetItem on the shot it belongs to, grouped by whole film, scene and
 * shot, with role filters and the detail panel's rows and actions. Only AssetItem fields and the
 * overview's scenes and shots are read; nothing here talks to the server.
 */

export const ROLE_FILTERS = ["all", "keyframe", "clip", "voice", "music", "upload", "export"] as const;
export type RoleFilter = (typeof ROLE_FILTERS)[number];
/** "all", "film" (whole film only) or a scene id. */
export type SceneFilter = string;
export interface AssetFilters {
  role: RoleFilter;
  scene: SceneFilter;
}
export const ALL_ASSETS: AssetFilters = { role: "all", scene: "all" };

const ROLE_ORDER: Record<AssetRole, number> = { keyframe: 0, clip: 1, voice: 2, music: 3, upload: 4, export: 5 };

/** Unique per stored file. Artifact ids alone are not enough: a take can reuse its id with new bytes. */
export const assetKey = (item: Pick<AssetItem, "artifact">): string => `${item.artifact.kind}:${item.artifact.artifactId}:${item.artifact.sha256}`;

/** Where an asset sits in the library. "former": its shot or scene is no longer in the film. */
export type Placement =
  | { kind: "shot"; shotId: string; sceneId: string }
  | { kind: "scene"; sceneId: string }
  | { kind: "film" }
  | { kind: "former" };

export function placement(item: AssetItem, overview: GenerationOverview): Placement {
  if (item.shotId) {
    const shot = overview.shots[item.shotId];
    return shot ? { kind: "shot", shotId: shot.shotId, sceneId: shot.sceneId } : { kind: "former" };
  }
  if (item.sceneId) return overview.scenes.some((scene) => scene.sceneId === item.sceneId) ? { kind: "scene", sceneId: item.sceneId } : { kind: "former" };
  return { kind: "film" };
}

function matchesScene(item: AssetItem, where: Placement, scene: SceneFilter): boolean {
  if (scene === "all") return true;
  if (scene === "film") return where.kind === "film";
  return where.kind === "shot" || where.kind === "scene" ? where.sceneId === scene : item.sceneId === scene;
}

export const matches = (item: AssetItem, where: Placement, filters: AssetFilters): boolean =>
  (filters.role === "all" || item.role === filters.role) && matchesScene(item, where, filters.scene);

// ---- tiles -------------------------------------------------------------------------------

export interface AssetTile {
  key: string;
  item: AssetItem;
  title: Msg;
  /** ✓ Current / Earlier, ✓ In use / Not in use, ✓ Latest / Earlier. `on` is drawn green. */
  use: { label: Msg; on: boolean };
  source: Msg;
  /** The kind tag over the picture: clips and audio only. */
  tag: { label: Msg; glyph: "play" | "note" } | null;
  duration: Msg | null;
  /** The picture to show: the image itself, or the keyframe a clip was most likely made from. */
  picture: StudioArtifactRef | null;
}

/** "6 s", "2.1 s"; a minute or more reads as a clock ("1:12"). */
export function durationMsg(seconds: number | undefined): Msg | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 60) return msg("assets.raw", { text: clock(seconds) });
  return msg("assets.seconds", { seconds: Math.round(seconds * 10) / 10 });
}

export const sourceMsg = (item: AssetItem): Msg => msg(`assets.source.${item.source}` as const);
export const kindMsg = (role: AssetRole): Msg => msg(`assets.kind.${role}` as const);

/** Server fallbacks for audio without a name; the view says it in the interface language instead. */
const UNNAMED_AUDIO = new Set(["Uploaded audio", "Uploaded recording", "Voice line", "Generated narration"]);

/** The tile and detail title. Shot assets are named by role, shot and take; imported audio keeps its file name. */
export function titleMsg(item: AssetItem, overview: GenerationOverview): Msg {
  const shot = item.shotId ? overview.shots[item.shotId] : undefined;
  const take = item.takeIndex;
  switch (item.role) {
    case "keyframe":
      if (!shot) return take ? msg("assets.label.keyframe_former", { take }) : msg("assets.kind.keyframe");
      return take ? msg("assets.label.keyframe", { shot: shot.label, take }) : msg("assets.label.keyframe_plain", { shot: shot.label });
    case "clip":
      if (!shot) return take ? msg("assets.label.clip_former", { take }) : msg("assets.kind.clip");
      return take ? msg("assets.label.clip", { shot: shot.label, take }) : msg("assets.label.clip_plain", { shot: shot.label });
    case "voice":
      return shot ? msg("assets.label.voice", { shot: shot.label }) : msg("assets.kind.voice");
    case "export":
      return msg(item.source === "demo" ? "assets.label.demo_export" : "assets.label.export");
    default:
      // Music and uploads. Imported audio carries the name it was imported with; image and video imports keep none.
      if (item.artifact.kind === "audio") {
        const name = item.label.trim();
        return name && !UNNAMED_AUDIO.has(name) ? msg("assets.raw", { text: name }) : msg("assets.label.audio_upload");
      }
      return msg(item.artifact.kind === "video" ? "assets.label.video_upload" : "assets.label.image_upload");
  }
}

export function useMsg(item: AssetItem): { label: Msg; on: boolean } {
  switch (item.role) {
    case "keyframe":
    case "clip":
    case "voice":
      return { label: msg(item.current ? "assets.use.current" : "assets.use.earlier"), on: item.current };
    case "export":
      return { label: msg(item.current ? "assets.use.latest" : "assets.use.earlier"), on: item.current };
    default:
      return { label: msg(item.current ? "assets.use.in_use" : "assets.use.not_in_use"), on: item.current };
  }
}

function tagFor(item: AssetItem): AssetTile["tag"] {
  if (item.artifact.kind === "video") return { label: msg(item.role === "clip" ? "assets.kind.clip" : item.role === "export" ? "assets.kind.export" : "assets.tag.video"), glyph: "play" };
  if (item.artifact.kind === "audio") return { label: item.role === "music" || item.role === "voice" ? kindMsg(item.role) : msg("assets.tag.audio"), glyph: "note" };
  return null;
}

const time = (iso: string) => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The keyframe a clip shows on its tile: the latest keyframe of its shot made before the clip, else the
 * shot's current keyframe. Loading every clip just for a thumbnail would be wasteful.
 */
export function stillFor(clip: AssetItem, items: readonly AssetItem[], overview: GenerationOverview): StudioArtifactRef | null {
  if (!clip.shotId) return null;
  const made = time(clip.createdAt);
  const before = items
    .filter((item) => item.role === "keyframe" && item.shotId === clip.shotId && time(item.createdAt) <= made)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt) || (b.takeIndex ?? 0) - (a.takeIndex ?? 0))[0];
  if (before) return before.artifact;
  const keyframe = overview.shots[clip.shotId]?.keyframe;
  return keyframe?.state === "ready" ? keyframe.artifact ?? null : null;
}

export function pictureFor(item: AssetItem, items: readonly AssetItem[], overview: GenerationOverview): StudioArtifactRef | null {
  if (item.artifact.kind === "image") return item.artifact;
  if (item.artifact.kind === "video") return stillFor(item, items, overview);
  return null;
}

export function tileFor(item: AssetItem, items: readonly AssetItem[], overview: GenerationOverview): AssetTile {
  return {
    key: assetKey(item),
    item,
    title: titleMsg(item, overview),
    use: useMsg(item),
    source: sourceMsg(item),
    tag: tagFor(item),
    duration: durationMsg(item.durationSeconds),
    picture: pictureFor(item, items, overview),
  };
}

/** Role order; music, uploads and exports in use first; then oldest first, so takes read 1, 2, 3. */
export function compareAssets(a: AssetItem, b: AssetItem): number {
  const role = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  if (role) return role;
  if (!a.shotId && !b.shotId && a.current !== b.current) return a.current ? -1 : 1;
  return time(a.createdAt) - time(b.createdAt) || (a.takeIndex ?? 0) - (b.takeIndex ?? 0);
}

// ---- the library -------------------------------------------------------------------------

export interface ShotSetView {
  shotId: string;
  label: string;
  framing: string;
  purpose: string;
  tiles: AssetTile[];
}

export interface SceneGroupView {
  sceneId: string;
  ordinal: number;
  title: string;
  /** Assets that belong to the scene but no shot (rare). */
  sceneTiles: AssetTile[];
  sets: ShotSetView[];
}

export interface AssetLibraryView {
  total: number;
  shown: number;
  counts: Record<RoleFilter, number>;
  /** The whole-film group, or null when the filters leave nothing to show in it. */
  film: { tiles: AssetTile[]; noExports: boolean } | null;
  scenes: SceneGroupView[];
  /** Assets of shots or scenes that were deleted (the server keeps their history). */
  former: AssetTile[];
  nothingMatches: boolean;
}

export function roleCounts(items: readonly AssetItem[]): Record<RoleFilter, number> {
  const counts = Object.fromEntries(ROLE_FILTERS.map((role) => [role, 0])) as Record<RoleFilter, number>;
  counts.all = items.length;
  for (const item of items) counts[item.role]++;
  return counts;
}

export function assetLibrary(items: readonly AssetItem[], overview: GenerationOverview, filters: AssetFilters): AssetLibraryView {
  const placed = items.map((item) => ({ item, where: placement(item, overview) }));
  const shown = placed.filter(({ item, where }) => matches(item, where, filters));
  const tiles = (list: { item: AssetItem }[]) => list.map(({ item }) => item).sort(compareAssets).map((item) => tileFor(item, items, overview));

  let film: AssetLibraryView["film"] = null;
  if (filters.scene === "all" || filters.scene === "film") {
    const filmTiles = tiles(shown.filter(({ where }) => where.kind === "film"));
    const noExports = (filters.role === "all" || filters.role === "export") && !items.some((item) => item.role === "export");
    if (filmTiles.length || noExports) film = { tiles: filmTiles, noExports };
  }

  const scenes: SceneGroupView[] = [];
  if (filters.scene !== "film") {
    for (const scene of overview.scenes) {
      if (filters.scene !== "all" && filters.scene !== scene.sceneId) continue;
      const sets: ShotSetView[] = [];
      for (const shotId of scene.shotIds) {
        const shot = overview.shots[shotId];
        if (!shot) continue;
        const own = tiles(shown.filter(({ where }) => where.kind === "shot" && where.shotId === shotId));
        if (!own.length && filters.role !== "all") continue;
        sets.push({ shotId, label: shot.label, framing: shot.framing, purpose: shot.purpose, tiles: own });
      }
      const sceneTiles = tiles(shown.filter(({ where }) => where.kind === "scene" && where.sceneId === scene.sceneId));
      if (!sets.length && !sceneTiles.length) continue;
      scenes.push({ sceneId: scene.sceneId, ordinal: scene.ordinal, title: scene.title || scene.purpose, sceneTiles, sets });
    }
  }

  const former = filters.scene === "film" ? [] : tiles(shown.filter(({ where }) => where.kind === "former"));
  return {
    total: items.length,
    shown: shown.length,
    counts: roleCounts(items),
    film,
    scenes,
    former,
    nothingMatches: !film && !scenes.length && !former.length,
  };
}

/** The scene filter falls back to every scene once the chosen scene is gone (deleted, or another film). */
export function validFilters(filters: AssetFilters, overview: GenerationOverview): AssetFilters {
  if (filters.scene === "all" || filters.scene === "film" || overview.scenes.some((scene) => scene.sceneId === filters.scene)) return filters;
  return { ...filters, scene: "all" };
}

// ---- detail ------------------------------------------------------------------------------

export interface DetailRow {
  label: Msg;
  value: Msg;
  sub?: Msg;
}

export interface AssetDetailView {
  key: string;
  item: AssetItem;
  title: Msg;
  rows: DetailRow[];
  /** The Director is pointed at the asset's shot, else its scene; assets cannot be named in a message yet. */
  point: { target: Target; name: Msg } | null;
  open: { view: "keyframes" | "film"; shotId: string | null; label: Msg } | null;
  /** Clips and audio play; pictures do not. */
  playable: boolean;
  picture: StudioArtifactRef | null;
  /** The shot's motion, for the sample film's keyframe motion preview. */
  motion: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Today 10:20", or "14 Oct 10:20" ("10月14日 10:20"); the year shows when it is not this year. */
export function madeMsg(createdAt: string, now: Date, locale: string): Msg {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return msg("assets.raw", { text: createdAt });
  const hm = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()) return msg("assets.made.today", { time: hm });
  const zh = locale === "zh-CN";
  const date = new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { day: "numeric", month: zh ? "long" : "short", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(at);
  return msg("assets.made.date", { date, time: hm });
}

function inUseMsg(item: AssetItem): Msg {
  switch (item.role) {
    case "keyframe":
    case "clip":
    case "voice":
      return msg(item.current ? "assets.inuse.current_take" : "assets.inuse.earlier_take");
    case "music":
      return msg(item.current ? "assets.inuse.music" : "assets.inuse.no");
    case "export":
      return msg(item.current ? "assets.inuse.latest_export" : "assets.inuse.earlier_export");
    default:
      return msg(item.current ? "assets.inuse.yes" : "assets.inuse.no");
  }
}

export function assetDetail(item: AssetItem, items: readonly AssetItem[], overview: GenerationOverview, now: Date, locale: string): AssetDetailView {
  const where = placement(item, overview);
  const shot = where.kind === "shot" ? overview.shots[where.shotId] : undefined;
  const sceneId = where.kind === "shot" || where.kind === "scene" ? where.sceneId : item.sceneId;
  const scene = sceneId ? overview.scenes.find((s) => s.sceneId === sceneId) : undefined;

  const rows: DetailRow[] = [{ label: msg("assets.row.kind"), value: kindMsg(item.role) }];
  if (shot) rows.push({ label: msg("assets.row.shot"), value: msg("assets.row.shot_value", { shot: shot.label, framing: shot.framing }), ...(scene ? { sub: msg("assets.raw", { text: scene.title || scene.purpose }) } : {}) });
  else if (where.kind === "scene" && scene) rows.push({ label: msg("assets.row.shot"), value: msg("assets.scene.whole"), sub: msg("assets.raw", { text: scene.title || scene.purpose }) });
  else rows.push({ label: msg("assets.row.shot"), value: msg(where.kind === "former" ? "assets.row.former_shot" : "assets.row.not_on_shot") });
  if (item.takeIndex) rows.push({ label: msg("assets.row.take"), value: msg("assets.raw", { text: String(item.takeIndex) }) });
  rows.push({ label: msg("assets.row.in_use"), value: inUseMsg(item) });
  rows.push({ label: msg("assets.row.source"), value: sourceMsg(item) });
  rows.push({ label: msg("assets.row.made"), value: madeMsg(item.createdAt, now, locale) });
  const length = durationMsg(item.durationSeconds);
  if (length) rows.push({ label: msg("assets.row.length"), value: length });

  const point: AssetDetailView["point"] = shot ? { target: { kind: "shot", id: shot.shotId }, name: msg("assets.raw", { text: shot.label }) }
    : scene ? { target: { kind: "scene", id: scene.sceneId }, name: msg("assets.target.scene", { n: scene.ordinal }) }
    : null;

  let open: AssetDetailView["open"] = null;
  if (shot && item.role === "keyframe") open = { view: "keyframes", shotId: shot.shotId, label: msg("assets.open.keyframes", { shot: shot.label }) };
  else if (shot && (item.role === "clip" || item.role === "voice")) open = { view: "film", shotId: shot.shotId, label: msg("assets.open.film", { shot: shot.label }) };
  else if (item.role === "music") open = { view: "film", shotId: null, label: msg("assets.open.music") };
  else if (item.role === "export") open = { view: "film", shotId: null, label: msg("assets.open.export") };

  return {
    key: assetKey(item),
    item,
    title: titleMsg(item, overview),
    rows,
    point,
    open,
    playable: item.artifact.kind !== "image",
    picture: pictureFor(item, items, overview),
    motion: shot ? shot.motion : null,
  };
}

// ---- reading every page ------------------------------------------------------------------

/** GET /api/projects/:projectId/assets */
export interface AssetPage {
  assets: AssetItem[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

/** The library groups everything, so every page is read, up to this many items (newest first). */
export const ASSET_READ_LIMIT = 1000;

export async function readAllAssets(readPage: (offset: number) => Promise<AssetPage>, limit = ASSET_READ_LIMIT): Promise<{ items: AssetItem[]; total: number; truncated: boolean }> {
  const seen = new Set<string>();
  const items: AssetItem[] = [];
  let offset = 0;
  let total = 0;
  for (;;) {
    const page = await readPage(offset);
    total = page.total;
    // Pages can shift when something new arrives between reads; a file is listed once.
    for (const item of page.assets) {
      const key = assetKey(item);
      if (seen.has(key) || items.length >= limit) continue;
      seen.add(key);
      items.push(item);
    }
    if (page.nextOffset === null || page.nextOffset <= offset || items.length >= limit) break;
    offset = page.nextOffset;
  }
  return { items, total, truncated: total > items.length && items.length >= limit };
}

// ---- small helpers for the view ------------------------------------------------------------

/** A decorative, deterministic waveform: bar heights in percent from the asset's id. */
export function waveHeights(seed: string, count: number): number[] {
  let x = 0;
  for (const char of seed) x = (x * 31 + char.charCodeAt(0)) % 997;
  const out: number[] = [];
  for (let index = 0; index < count; index++) {
    x = (x * 73 + 41) % 997;
    out.push(18 + (x % 70));
  }
  return out;
}

/** Extensions of the files people import; only these are taken off an imported file's name ("Voice line 2.10" keeps its ".10"). */
const MEDIA_EXTENSION = /\.(?:png|jpe?g|gif|webp|mp4|m4v|mov|webm|mkv|avi|wav|mp3|m4a|aac|flac|ogg|oga|opus|aiff?|weba)$/i;

/** A file name for Download: the title made safe, with the stored file's extension. */
export function downloadName(title: string, kind: StudioArtifactRef["kind"]): string {
  const base = title.replace(MEDIA_EXTENSION, "").replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s*·\s*/g, " - ").replace(/\s+/g, " ").trim().slice(0, 100) || "openslate-asset";
  return `${base}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "wav"}`;
}

// ---- reading and loading at a measured pace ------------------------------------------------------

/**
 * How long the library waits after the studio's event cursor moves before reading every page again. Events
 * come in bursts while jobs run; one read per burst is enough. A reload the person asks for is not delayed.
 */
export const ASSET_REREAD_DELAY_MS = 500;

/** How many tile pictures load at once; the rest wait their turn (and only tiles near the screen ask). */
export const PICTURE_LOADS_AT_ONCE = 6;

/**
 * A small first-come queue of slots. `take` calls `grant` when a slot is free (at once if one is) and returns
 * `release`, which frees the slot, or leaves the queue if it was still waiting. Releasing twice does nothing.
 */
export class SlotQueue {
  #free: number;
  readonly #waiting: (() => void)[] = [];

  constructor(size: number) {
    this.#free = Math.max(1, size);
  }

  get waiting(): number {
    return this.#waiting.length;
  }

  take(grant: () => void): () => void {
    let state: "waiting" | "held" | "done" = "waiting";
    const start = () => { state = "held"; grant(); };
    if (this.#free > 0) { this.#free--; start(); }
    else this.#waiting.push(start);
    return () => {
      if (state === "done") return;
      if (state === "waiting") {
        const index = this.#waiting.indexOf(start);
        if (index >= 0) this.#waiting.splice(index, 1);
        state = "done";
        return;
      }
      state = "done";
      const next = this.#waiting.shift();
      if (next) next();
      else this.#free++;
    };
  }
}
