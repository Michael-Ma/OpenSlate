import type { AssetItem, AssetRole, StudioArtifactRef } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { artifactFor } from "../last-ferry.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * Simulated routes for the Assets view in the sample film: the asset library (GET /assets with its
 * filters and 40-item pages), the import capabilities (GET /images, GET /audio-library) and the three
 * upload routes. Nothing is stored or sent; an import adds a library entry in this tab only.
 *
 * Shot assets follow the fixture overview, so a keyframe or clip made in the Keyframes view shows up
 * here, and the take it replaced stays as an earlier take (once the library has seen it).
 */

const MIB = 1024 * 1024;
const PAGE = 40;

interface UploadBody {
  name?: string;
  size?: number;
  type?: string;
  durationSeconds?: number;
  /** A PNG data URL, so the sample film can show the picture that was imported. */
  preview?: string;
}

interface AssetsFixture {
  /** Every shot asset the library has listed, by artifact identity; the current ones come from the overview. */
  seen: Map<string, AssetItem>;
  /** Music, uploads and earlier voice takes that the overview does not describe. */
  extras: AssetItem[];
  serial: number;
}

const fixtures = new WeakMap<FixtureWorld, AssetsFixture>();

const pad = (n: number) => String(n).padStart(2, "0");
/** Local "YYYY-MM-DDTHH:MM:00" today, so the sample library always reads as made today. */
function todayAt(hours: number, minutes: number, now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(hours)}:${pad(minutes)}:00`;
}
const localNow = () => { const now = new Date(); return `${todayAt(now.getHours(), now.getMinutes(), now).slice(0, 17)}${pad(now.getSeconds())}`; };

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
      extras: [
        { artifact: ref("art-music-low-tide", "audio"), role: "music", current: true, source: "imported", label: "low-tide.mp3", createdAt: todayAt(10, 2), durationSeconds: 72 },
        { artifact: ref("art-music-foghorn", "audio"), role: "music", current: false, source: "imported", label: "foghorn-theme.wav", createdAt: todayAt(10, 3), durationSeconds: 58 },
        { artifact: { ...artifactFor("ref"), kind: "image" }, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: todayAt(9, 58) },
        { artifact: { ...artifactFor("timetable"), kind: "image" }, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: todayAt(9, 59) },
        ...(voice12 ? [{ artifact: ref("art-voice-1.2-first", "audio"), role: "voice" as const, shotId: voice12.shotId, sceneId: voice12.sceneId, current: false, source: "generated" as const, label: "Voice line", createdAt: todayAt(10, 20), durationSeconds: 2.6 }] : []),
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
      const at = (role: AssetRole, take: number) => { const made = take <= 1 ? base(role) : undefined; return made ? todayAt(made[0], made[1]) : localNow(); };
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
  return [...shots, ...fixture.extras].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function query(raw: string | undefined): URLSearchParams {
  return new URLSearchParams(raw ?? "");
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

// ---- pictures the sample library shows (the design study's reference and timetable) ----------------

const SAMPLE_PICTURES: Record<string, string> = {
  ref: `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Reference: Mara and her coat colours"><rect width="320" height="180" fill="#2a2f38"/><rect x="40" y="20" width="110" height="140" rx="4" fill="#d9d4cc"/><circle cx="95" cy="62" r="20" fill="#c9b3a6"/><path d="M75 58 q20-30 40 0 q-4-18-20-18 q-16 0-20 18z" fill="#2a2a33"/><path d="M62 160 L68 92 q27-12 54 0 L128 160z" fill="#c8302c"/><rect x="170" y="20" width="110" height="64" rx="4" fill="#c8302c"/><rect x="170" y="96" width="52" height="64" rx="4" fill="#6e1423"/><rect x="228" y="96" width="52" height="64" rx="4" fill="#9d1b2e"/></svg>`,
  timetable: `<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Reference: the winter ferry timetable"><rect width="320" height="180" fill="#e7e2d6"/><rect x="24" y="18" width="272" height="22" fill="#22303f"/><text x="160" y="33" text-anchor="middle" font-family="Inter,sans-serif" font-size="10" font-weight="700" letter-spacing="2" fill="#e7e2d6">HARBOUR FERRY · WINTER</text>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="24" y="${52 + i * 20}" width="272" height="1" fill="#b9b2a2"/><rect x="34" y="${58 + i * 20}" width="40" height="7" rx="2" fill="#8a8170"/><rect x="96" y="${58 + i * 20}" width="${80 + (i * 37) % 90}" height="7" rx="2" fill="#a59c89"/>`).join("")}<rect x="20" y="140" width="280" height="22" fill="none" stroke="#b8322c" stroke-width="2.5" transform="rotate(-1 160 150)"/></svg>`,
};

/**
 * The fixture's media source draws pictures from last-ferry-pictures.ts by key. The sample uploads and
 * pictures imported in this tab are added to that table (fixture only; nothing leaves the page).
 */
async function addPictures(entries: Record<string, string>): Promise<void> {
  const { pictures } = await import("../last-ferry-pictures.ts");
  for (const [key, svg] of Object.entries(entries)) if (!(key in pictures)) pictures[key] = svg;
}

// ---- imports --------------------------------------------------------------------------------

function bodyOf(body: unknown): UploadBody {
  return body && typeof body === "object" ? (body as UploadBody) : {};
}

function requireHead(world: FixtureWorld, raw: string | undefined): void {
  const expected = Number(query(raw).get("expectedHeadVersion"));
  if (!Number.isSafeInteger(expected)) throw new ApiError("VALIDATION_ERROR", 400);
  if (expected !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
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

async function importImage(world: FixtureWorld, raw: string | undefined, input: unknown) {
  requireHead(world, raw);
  const body = bodyOf(input);
  const size = Number(body.size ?? 0);
  // The studio refuses anything that is not a readable PNG (a PNG header alone is 33 bytes).
  if (body.type !== "image/png" || size <= 32) throw new ApiError("IMAGE_INPUT_INVALID", 409);
  if (size > 32 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const fixture = state(world);
  const key = `import-${++fixture.serial}`;
  const artifact: StudioArtifactRef = { ...artifactFor(key), kind: "image" };
  if (typeof body.preview === "string" && body.preview.startsWith("data:image/png;base64,") && body.preview.length < 8 * MIB)
    await addPictures({ [key]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><image href="${body.preview}" width="320" height="180" preserveAspectRatio="xMidYMid slice"/></svg>` });
  add(world, { artifact, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: localNow() }, true);
  return { artifact, revisionId: world.snapshot.project.revisionId, headVersion: world.snapshot.project.headVersion, width: 1600, height: 900, byteLength: size, requestId: `fixture-request-${key}` };
}

function importVideo(world: FixtureWorld, raw: string | undefined, input: unknown) {
  requireHead(world, raw);
  const body = bodyOf(input);
  const size = Number(body.size ?? 0);
  if (size <= 0) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (size > 128 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const fixture = state(world);
  const artifact = ref(`art-video-import-${++fixture.serial}`, "video");
  const seconds = Number(body.durationSeconds);
  add(world, { artifact, role: "upload", current: false, source: "imported", label: `${world.snapshot.project.name} · upload`, createdAt: localNow(), ...(seconds > 0 ? { durationSeconds: seconds } : {}) }, true);
  return { artifact, sourceId: `source-${fixture.serial}`, revisionId: world.snapshot.project.revisionId, headVersion: world.snapshot.project.headVersion, requestId: `fixture-request-${fixture.serial}` };
}

function importAudio(world: FixtureWorld, raw: string | undefined, input: unknown) {
  const q = query(raw);
  const role = q.get("role") ?? "upload";
  if (role !== "music" && role !== "upload" && role !== "voice") throw new ApiError("VALIDATION_ERROR", 400);
  const body = bodyOf(input);
  const size = Number(body.size ?? 0);
  if (size <= 0) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (size > 128 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const seconds = Number(body.durationSeconds);
  if (seconds > 360) throw new ApiError("MEDIA_TOO_LONG", 409);
  const fixture = state(world);
  const id = `art-audio-import-${++fixture.serial}`;
  const artifact = ref(id, "audio");
  const label = q.get("name")?.trim() || "Uploaded recording";
  add(world, { artifact, role, current: false, source: "imported", label, createdAt: localNow(), ...(seconds > 0 ? { durationSeconds: seconds } : {}) }, false);
  return { recording: { id, label, sha256: artifact.sha256, durationSeconds: seconds > 0 ? seconds : 0, samples: 0, byteLength: size, origin: "uploaded", role } };
}

/** Simulated server routes the Assets view needs in the sample film. */
export const assetsRoutes: FixtureRoute[] = [
  {
    method: "GET",
    match: /^\/assets(?:\?(.*))?$/,
    async handle(world, [raw]) {
      await addPictures(SAMPLE_PICTURES);
      return listAssets(world, raw);
    },
  },
  {
    method: "GET",
    match: /^\/images(?:\?.*)?$/,
    handle(world) {
      return { headVersion: world.snapshot.project.headVersion, revisionId: world.snapshot.project.revisionId, capabilities: { import: true, format: "image/png", maxBytes: 32 * MIB, unavailableReason: null }, images: [], coverage: { offset: 0, returned: 0, total: 0, nextOffset: null } };
    },
  },
  {
    method: "GET",
    match: /^\/audio-library(?:\?.*)?$/,
    handle() {
      return { recordings: [], coverage: { offset: 0, total: 0, nextOffset: null }, capabilities: { import: true, maxBytes: 128 * MIB, maxSeconds: 360 } };
    },
  },
  { method: "POST", match: /^\/images\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => importImage(world, raw, body) },
  { method: "POST", match: /^\/media\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => importVideo(world, raw, body) },
  { method: "POST", match: /^\/audio-library\/uploads(?:\?(.*))?$/, handle: (world, [raw], body) => importAudio(world, raw, body) },
];
