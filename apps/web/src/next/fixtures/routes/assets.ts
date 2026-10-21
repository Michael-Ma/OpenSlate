import type { AssetItem, AssetRole, StudioArtifactRef } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { artifactFor, pictureKey } from "../last-ferry.ts";
import { addMusicRecording, finishedExports } from "./film.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * Simulated routes for the Assets view in the sample film: the asset library (GET /assets with its
 * filters and 40-item pages), the picture import capabilities (GET /images; the audio ones come with the
 * film's music library, GET /audio-library in film.ts) and the three upload routes. Imported music joins
 * that library, so the Film view's Change music lists it. Nothing is stored or sent; an import adds a library entry in this tab only. Like the studio,
 * a request sent again with the same Idempotency-Key (here `key` in the body) replays its receipt. One more
 * route exists only here: the picture of a PNG imported into this sample film (FIXTURE_PICTURE_ROUTE).
 *
 * Shot assets follow the fixture overview, so a keyframe or clip made in the Keyframes view shows up
 * here, and the take it replaced stays as an earlier take (once the library has seen it). The Film view's
 * finished exports are listed too (the latest is current), so its "earlier in Assets" finds them.
 */

const MIB = 1024 * 1024;
const PAGE = 40;

/** What the sample film's uploader sends instead of the file's bytes. */
interface UploadBody {
  name?: string;
  size?: number;
  type?: string;
  durationSeconds?: number;
  /** The request's Idempotency-Key: the same key replays the first receipt. */
  key?: string;
  /**
   * Answer a refusal as `{ refused: { code } }` instead of throwing. The store turns thrown refusals into
   * toasts, and the import sheet says them in place instead.
   */
  refusalInBody?: boolean;
}

interface AssetsFixture {
  /** Every shot asset the library has listed, by artifact identity; the current ones come from the overview. */
  seen: Map<string, AssetItem>;
  /** Music, uploads and earlier voice takes that the overview does not describe. */
  extras: AssetItem[];
  serial: number;
  /** Makes this world's imported artifact ids unique, so their pictures never mix with another world's. */
  tag: string;
  /** Receipts by Idempotency-Key, with exact image/video import identities. */
  receipts: Map<string, { receipt: unknown; identity?: string }>;
  /** Pictures of the PNGs imported into this sample film, by artifact id (standalone SVGs). */
  pictures: Map<string, string>;
}

const fixtures = new WeakMap<FixtureWorld, AssetsFixture>();

const pad = (n: number) => String(n).padStart(2, "0");
/** A local "YYYY-MM-DDTHH:MM:SS" time, like the studio's createdAt. */
function localTime(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
const localNow = () => localTime(new Date());

/**
 * The design study's times ("10:44" for the latest sample take), placed so the latest one was made two hours
 * ago: the sample library is always in the past, and anything made or imported now is newer than all of it.
 */
const STUDY_LATEST = 10 * 60 + 44;
function sampleAt(hours: number, minutes: number, now = new Date()): string {
  const before = 2 * 60 + (STUDY_LATEST - (hours * 60 + minutes));
  const at = new Date(now.getTime() - before * 60_000);
  at.setSeconds(0, 0);
  return localTime(at);
}

function hexOf(text: string): string {
  let out = "";
  for (const char of text) out += char.charCodeAt(0).toString(16);
  return out.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
}
const ref = (artifactId: string, kind: StudioArtifactRef["kind"]): StudioArtifactRef => ({ artifactId, sha256: hexOf(artifactId), kind });
const keyOf = (artifact: StudioArtifactRef) => `${artifact.kind}:${artifact.artifactId}:${artifact.sha256}`;

/** When the sample film's first takes were made (the design study's times). */
const MADE: Record<string, [number, number]> = {
  "keyframe:1.1": [10, 8], "keyframe:1.2": [10, 8], "keyframe:1.3": [10, 9],
  "keyframe:2.1": [10, 44], "keyframe:2.2": [10, 44], "keyframe:2.3": [10, 44],
  "clip:1.1": [10, 31], "clip:1.2": [10, 32], "clip:1.3": [10, 33],
  "voice:1.2": [10, 24], "voice:2.3": [10, 44],
};

function state(world: FixtureWorld): AssetsFixture {
  let fixture = fixtures.get(world);
  if (!fixture) {
    const voice12 = world.overview.shots["shot-1-2"];
    fixture = {
      seen: new Map(),
      serial: 0,
      tag: Math.random().toString(36).slice(2, 8),
      receipts: new Map(),
      pictures: new Map(),
      extras: [
        { artifact: ref("art-music-low-tide", "audio"), role: "music", current: true, source: "imported", label: "low-tide.mp3", createdAt: sampleAt(10, 2), durationSeconds: 72 },
        { artifact: ref("art-music-foghorn", "audio"), role: "music", current: false, source: "imported", label: "foghorn-theme.wav", createdAt: sampleAt(10, 3), durationSeconds: 58 },
        { artifact: { ...artifactFor("ref"), kind: "image" }, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: sampleAt(9, 58) },
        { artifact: { ...artifactFor("timetable"), kind: "image" }, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: sampleAt(9, 59) },
        ...(voice12 ? [{ artifact: ref("art-voice-1.2-first", "audio"), role: "voice" as const, shotId: voice12.shotId, sceneId: voice12.sceneId, current: false, source: "generated" as const, label: "Voice line", createdAt: sampleAt(10, 20), durationSeconds: 2.6 }] : []),
      ],
    };
    fixtures.set(world, fixture);
  }
  return fixture;
}

/** The shot assets the overview says are current now. */
function currentShotAssets(world: FixtureWorld): { item: AssetItem; made: string }[] {
  const { overview } = world;
  const out: { item: AssetItem; made: string }[] = [];
  for (const scene of overview.scenes) {
    for (const shotId of scene.shotIds) {
      const shot = overview.shots[shotId];
      if (!shot) continue;
      const label = (role: AssetRole, take?: number) => `${scene.title} · ${shot.purpose} · ${role}${take ? ` ${take}` : ""}`;
      const base = (role: AssetRole) => MADE[`${role}:${shot.label}`];
      const at = (role: AssetRole, take: number) => { const made = take <= 1 ? base(role) : undefined; return made ? sampleAt(made[0], made[1]) : localNow(); };
      if (shot.keyframe.state === "ready" && shot.keyframe.artifact) {
        const take = shot.keyframe.takeCount;
        out.push({ made: at("keyframe", take), item: { artifact: shot.keyframe.artifact, role: "keyframe", shotId, sceneId: shot.sceneId, takeIndex: take, current: true, source: "generated", label: label("keyframe", take), createdAt: "" } });
      }
      if (shot.video.state === "ready" && shot.video.artifact) {
        const take = shot.video.takeCount;
        out.push({ made: at("clip", take), item: { artifact: shot.video.artifact, role: "clip", shotId, sceneId: shot.sceneId, takeIndex: take, current: true, source: "generated", label: label("clip", take), createdAt: "", durationSeconds: shot.durationFrames / overview.fps } });
      }
      const narration = shot.narration;
      if (narration.state === "ready" && narration.measuredSeconds) {
        const artifact = ref(`art-voice-${shot.label}-${hexOf(narration.text).slice(0, 12)}`, "audio");
        out.push({ made: at("voice", 1), item: { artifact, role: "voice", shotId, sceneId: shot.sceneId, current: true, source: "generated", label: "Voice line", createdAt: "", durationSeconds: narration.measuredSeconds } });
      }
    }
  }
  return out;
}

/** Everything in the sample film's library, newest first like the server. */
export function fixtureAssets(world: FixtureWorld): AssetItem[] {
  const fixture = state(world);
  const current = new Set<string>();
  for (const { item, made } of currentShotAssets(world)) {
    const key = keyOf(item.artifact);
    current.add(key);
    const known = fixture.seen.get(key);
    fixture.seen.set(key, { ...item, createdAt: known?.createdAt ?? made });
  }
  const shots = [...fixture.seen.entries()].map(([key, item]) => ({ ...item, current: current.has(key) }));
  const exports = finishedExports(world).map((record, index): AssetItem => ({
    artifact: record.artifact!, role: "export", current: index === 0, source: record.demo ? "demo" : "generated",
    label: "Export", createdAt: localTime(new Date(record.finishedAt ?? record.startedAt)),
  }));
  return [...shots, ...fixture.extras, ...exports].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function query(raw: string | undefined): URLSearchParams {
  return new URLSearchParams(raw ?? "");
}

/** One of this film's assets by artifact id (the sample's own or imported in this tab), or null. */
export function fixtureAsset(world: FixtureWorld, artifactId: string): AssetItem | null {
  return fixtureAssets(world).find((item) => item.artifact.artifactId === artifactId) ?? null;
}

function listAssets(world: FixtureWorld, raw: string | undefined) {
  const q = query(raw);
  const offset = Number(q.get("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError("VALIDATION_ERROR", 400);
  const role = q.get("role"), sceneId = q.get("sceneId"), shotId = q.get("shotId"), kind = q.get("kind"), search = q.get("search")?.toLowerCase();
  const items = fixtureAssets(world).filter((item) =>
    (!role || item.role === role) && (!sceneId || item.sceneId === sceneId) && (!shotId || item.shotId === shotId) &&
    (!kind || kind === "all" || item.artifact.kind === kind) && (!search || `${item.label} ${item.artifact.artifactId}`.toLowerCase().includes(search)));
  const assets = items.slice(offset, offset + PAGE);
  return { assets, total: items.length, offset, nextOffset: offset + assets.length < items.length ? offset + assets.length : null };
}

// ---- pictures the sample library shows that last-ferry-pictures.ts does not have -------------------

const SAMPLE_PICTURES: Record<string, string> = {
  ref: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Reference: Mara and her coat colours"><rect width="320" height="180" fill="#2a2f38"/><rect x="40" y="20" width="110" height="140" rx="4" fill="#d9d4cc"/><circle cx="95" cy="62" r="20" fill="#c9b3a6"/><path d="M75 58 q20-30 40 0 q-4-18-20-18 q-16 0-20 18z" fill="#2a2a33"/><path d="M62 160 L68 92 q27-12 54 0 L128 160z" fill="#c8302c"/><rect x="170" y="20" width="110" height="64" rx="4" fill="#c8302c"/><rect x="170" y="96" width="52" height="64" rx="4" fill="#6e1423"/><rect x="228" y="96" width="52" height="64" rx="4" fill="#9d1b2e"/></svg>`,
  timetable: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Reference: the winter ferry timetable"><rect width="320" height="180" fill="#e7e2d6"/><rect x="24" y="18" width="272" height="22" fill="#22303f"/><text x="160" y="33" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" font-weight="700" letter-spacing="2" fill="#e7e2d6">HARBOUR FERRY · WINTER</text>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="24" y="${52 + i * 20}" width="272" height="1" fill="#b9b2a2"/><rect x="34" y="${58 + i * 20}" width="40" height="7" rx="2" fill="#8a8170"/><rect x="96" y="${58 + i * 20}" width="${80 + (i * 37) % 90}" height="7" rx="2" fill="#a59c89"/>`).join("")}<rect x="20" y="140" width="280" height="22" fill="none" stroke="#b8322c" stroke-width="2.5" transform="rotate(-1 160 150)"/></svg>`,
};

/**
 * Previews staged by the sample uploader, by request key, until their request arrives (then they move into
 * that sample film's own pictures). Short-lived and bounded.
 */
const stagedPreviews = new Map<string, string>();
/** Each sample film keeps the pictures of its most recent few imports. */
const PICTURE_LIMIT = 24;

function remember(map: Map<string, string>, key: string, value: string, limit: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value!);
}

/**
 * The sample film's uploader stages the chosen PNG (as a data URL) under its request key, so the picture
 * stays out of the request body the store remembers.
 */
export function stageFixturePreview(key: string, dataUrl: string): void {
  if (dataUrl.startsWith("data:image/png;base64,") && dataUrl.length < 8 * MIB) remember(stagedPreviews, key, dataUrl, 4);
}

/** The sample uploads' pictures (standalone SVGs, the same in every sample film), or null. */
export function fixtureAssetPicture(artifactId: string): string | null {
  return SAMPLE_PICTURES[pictureKey(artifactId)] ?? null;
}

/** Simulated route for the picture of a PNG imported into this sample film: GET {FIXTURE_PICTURE_ROUTE}/:artifactId → { svg }. */
export const FIXTURE_PICTURE_ROUTE = "/assets/fixture-pictures";

/** Whether an artifact id is a PNG imported into a sample film (its picture is read through FIXTURE_PICTURE_ROUTE). */
export const isFixtureImport = (artifactId: string): boolean => pictureKey(artifactId).startsWith("import-");

// ---- imports --------------------------------------------------------------------------------

function bodyOf(body: unknown): UploadBody {
  return body && typeof body === "object" ? (body as UploadBody) : {};
}

function requireHead(world: FixtureWorld, raw: string | undefined): void {
  const expected = Number(query(raw).get("expectedHeadVersion"));
  if (!Number.isSafeInteger(expected)) throw new ApiError("VALIDATION_ERROR", 400);
  if (expected !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
}

/** The same optional name accepted by the studio's image and video upload routes. */
function uploadName(raw: string | undefined): string | undefined {
  const name = query(raw).get("name");
  if (name === null) return undefined;
  if (name.length < 1 || [...name].length > 120 || /[\u0000-\u001f\u007f/\\]/.test(name)) throw new ApiError("VALIDATION_ERROR", 400);
  return name;
}

/** Simulated file metadata stands in for the exact bytes a live upload binds to its key. */
function uploadIdentity(kind: "image" | "video", raw: string | undefined, input: unknown): string {
  const body = bodyOf(input);
  return JSON.stringify([kind, query(raw).get("expectedHeadVersion"), uploadName(raw), body.name, body.size, body.type, body.durationSeconds]);
}

/** The studio's replay and refusal behaviour around one upload: a known exact request replays its receipt. */
function upload(world: FixtureWorld, input: unknown, run: (body: UploadBody) => unknown, identify?: () => string): unknown {
  const body = bodyOf(input);
  const fixture = state(world);
  try {
    const identity = identify?.();
    const prior = body.key ? fixture.receipts.get(body.key) : undefined;
    if (prior) {
      if (identity !== undefined && identity !== prior.identity) throw new ApiError("IDEMPOTENCY_CONFLICT", 409);
      return prior.receipt;
    }
    const receipt = run(body);
    if (body.key) fixture.receipts.set(body.key, { receipt, ...(identity !== undefined ? { identity } : {}) });
    return receipt;
  } catch (error) {
    if (body.refusalInBody && error instanceof ApiError) return { refused: { code: error.code } };
    throw error;
  } finally {
    if (body.key) stagedPreviews.delete(body.key);
  }
}

function add(world: FixtureWorld, item: AssetItem, bumpHead: boolean): void {
  world.update((w) => {
    state(w).extras.push(item);
    if (!bumpHead) return;
    const headVersion = w.snapshot.project.headVersion + 1;
    w.snapshot = { ...w.snapshot, project: { ...w.snapshot.project, headVersion } };
    w.overview = { ...w.overview, headVersion };
  });
}

/** Video and audio up to 6 minutes, like the studio's media check (10 800 frames at 30 fps). */
function requireLength(body: UploadBody): number {
  const seconds = Number(body.durationSeconds);
  if (seconds > 360) throw new ApiError("MEDIA_DURATION_LIMIT", 409);
  return seconds > 0 ? seconds : 0;
}

function importImage(world: FixtureWorld, raw: string | undefined, body: UploadBody) {
  requireHead(world, raw);
  const name = uploadName(raw);
  const size = Number(body.size ?? 0);
  // The studio stores PNG, JPEG, WebP and HEIC pictures as PNG; anything else, or too small to hold a picture, is refused.
  if (!["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"].includes(String(body.type)) || size <= 32) throw new ApiError("IMAGE_INPUT_INVALID", 409);
  if (size > 32 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const fixture = state(world);
  const artifact: StudioArtifactRef = { ...artifactFor(`import-${fixture.tag}-${++fixture.serial}`), kind: "image" };
  const preview = body.key ? stagedPreviews.get(body.key) : undefined;
  if (preview)
    remember(fixture.pictures, artifact.artifactId, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><image href="${preview}" width="320" height="180" preserveAspectRatio="xMidYMid slice"/></svg>`, PICTURE_LIMIT);
  add(world, { artifact, role: "upload", current: false, source: "imported", label: name ?? `${world.snapshot.project.name} · upload`, createdAt: localNow() }, true);
  return { artifact, revisionId: world.snapshot.project.revisionId, headVersion: world.snapshot.project.headVersion, width: 1600, height: 900, byteLength: size, requestId: `fixture-request-${fixture.serial}` };
}

function importVideo(world: FixtureWorld, raw: string | undefined, body: UploadBody) {
  requireHead(world, raw);
  const name = uploadName(raw);
  const size = Number(body.size ?? 0);
  if (size <= 0) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (size > 128 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const seconds = requireLength(body);
  const fixture = state(world);
  const artifact = ref(`art-video-import-${fixture.tag}-${++fixture.serial}`, "video");
  add(world, { artifact, role: "upload", current: false, source: "imported", label: name ?? `${world.snapshot.project.name} · upload`, createdAt: localNow(), ...(seconds ? { durationSeconds: seconds } : {}) }, true);
  return { artifact, sourceId: `source-${fixture.serial}`, revisionId: world.snapshot.project.revisionId, headVersion: world.snapshot.project.headVersion, requestId: `fixture-request-${fixture.serial}` };
}

function importAudio(world: FixtureWorld, raw: string | undefined, body: UploadBody) {
  const q = query(raw);
  const role = q.get("role") ?? "upload";
  if (role !== "music" && role !== "upload" && role !== "voice") throw new ApiError("VALIDATION_ERROR", 400);
  const size = Number(body.size ?? 0);
  if (size <= 0) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (size > 128 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const seconds = requireLength(body);
  const fixture = state(world);
  const id = `art-audio-import-${fixture.tag}-${++fixture.serial}`;
  const artifact = ref(id, "audio");
  const label = q.get("name")?.trim() || "Uploaded recording";
  add(world, { artifact, role, current: false, source: "imported", label, createdAt: localNow(), ...(seconds ? { durationSeconds: seconds } : {}) }, false);
  if (role === "music") addMusicRecording(world, { id, label, sha256: artifact.sha256, durationSeconds: seconds, role: "music" });
  return { recording: { id, label, sha256: artifact.sha256, durationSeconds: seconds, samples: 0, byteLength: size, origin: "uploaded", role } };
}

/** PDF, TXT or MD up to 32 MiB; the sample film pretends to read a few pages of text from each. */
function importDocument(world: FixtureWorld, raw: string | undefined, body: UploadBody) {
  requireHead(world, raw);
  const size = Number(body.size ?? 0);
  if (size <= 0) throw new ApiError("DOCUMENT_INVALID", 409);
  if (size > 32 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const fixture = state(world);
  const artifact = ref(`art-document-import-${fixture.tag}-${++fixture.serial}`, "document");
  const name = query(raw).get("name")?.trim() || "Document";
  const pdf = body.type === "application/pdf" || /\.pdf$/i.test(name);
  add(world, { artifact, role: "document", current: false, source: "imported", label: name, createdAt: localNow() }, true);
  return { artifact, name, ...(pdf ? { pages: Math.max(1, Math.round(size / 40000)) } : {}), characters: Math.min(200000, Math.round(size / 2)), truncated: size / 2 > 200000 };
}

/** Simulated server routes the Assets view needs in the sample film. */
export const assetsRoutes: FixtureRoute[] = [
  {
    method: "GET",
    match: /^\/assets(?:\?(.*))?$/,
    handle: (world, [raw]) => listAssets(world, raw),
  },
  {
    method: "GET",
    match: /^\/assets\/fixture-pictures\/([^/?]+)$/,
    handle(world, [id]) {
      const svg = state(world).pictures.get(decodeURIComponent(id ?? ""));
      if (!svg) throw new ApiError("NOT_FOUND", 404);
      return { svg };
    },
  },
  {
    method: "GET",
    match: /^\/images(?:\?.*)?$/,
    handle(world) {
      return { headVersion: world.snapshot.project.headVersion, revisionId: world.snapshot.project.revisionId, capabilities: { import: true, format: "image/png", maxBytes: 32 * MIB, unavailableReason: null }, images: [], coverage: { offset: 0, returned: 0, total: 0, nextOffset: null } };
    },
  },
  { method: "POST", match: /^\/images\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => upload(world, body, (input) => importImage(world, raw, input), () => uploadIdentity("image", raw, body)) },
  { method: "POST", match: /^\/media\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => upload(world, body, (input) => importVideo(world, raw, input), () => uploadIdentity("video", raw, body)) },
  { method: "POST", match: /^\/documents\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => upload(world, body, (input) => importDocument(world, raw, input)) },
  { method: "POST", match: /^\/audio-library\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => upload(world, body, (input) => importAudio(world, raw, input)) },
];
