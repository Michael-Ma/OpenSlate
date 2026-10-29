import type { GenerationOverview, KeyframeSlot, MediaSlot, ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import type { CastCharacter, CastIssue, CastRead, CastSaveInput, CastTake, SheetState } from "../../model/cast.ts";
import { FIXTURE_TIMING, recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { CAST_SEED, sheetArtifact } from "../last-ferry-cast.ts";
import { fixtureAsset } from "./assets.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * Plan › Cast in the sample film: the character routes of apps/server/src/characters.ts, simulated. Codex image
 * sheets are "included in your plan" ($0); generating takes a few seconds; approving binds the sheet to every cast
 * shot in one change and puts their keyframes (and the clips made from them) out of date without remaking anything.
 *
 * `?cast=` presets (read once per sample studio):
 * - `on`: Mara has one take to review; Tomas has no sheet yet.
 * - `approved`: both sheets approved and bound (Mara has two takes, the second approved).
 * - `pending`: Mara's first sheet is being made.
 * - `outdated`: Mara's looks changed after her sheet was approved.
 * Without a preset the sample film has no characters (Plan shows an empty Cast).
 */

interface FixtureCharacter {
  id: string;
  revisionId: string;
  name: string;
  identity: string;
  baseOutfit?: string;
  wardrobe: { sceneId: string; outfit: string; notes?: string }[];
  /** The identity and base outfit the approved sheet was made from. */
  sheet: { takeId: string; artifact: StudioArtifactRef; promptDigest: string; approvedAt: string } | null;
}
interface FixtureTake extends CastTake { characterId: string }
interface CastState {
  characters: FixtureCharacter[];
  takes: FixtureTake[];
  /** Sheets being made, by character. */
  making: Map<string, string>;
  /** Shot ids whose prompt holds the approved sheet of each character (bound at approval). */
  bound: Map<string, string>;
  serial: number;
  failNext: boolean;
}

const states = new WeakMap<FixtureWorld, CastState>();
const state = (world: FixtureWorld): CastState => {
  let value = states.get(world);
  if (!value) { value = { characters: [], takes: [], making: new Map(), bound: new Map(), serial: 0, failNext: false }; states.set(world, value); }
  return value;
};

/** A stand-in for the sheet prompt digest: what the sheet is made from. */
const digestOf = (c: Pick<FixtureCharacter, "identity" | "baseOutfit">) => `d-${hash(`${c.identity}|${c.baseOutfit ?? ""}`)}`;
function hash(text: string): string {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}
const sheetPrompt = (c: FixtureCharacter) => [
  `Character reference sheet for ${c.name}.`,
  "Square canvas in four vertical panels, left to right: 1) full-body front view; 2) full-body side view, facing left, in profile; 3) full-body back view; 4) face close-up, head and shoulders, facing the camera.",
  "The same person in all four panels, at the same height and scale, standing relaxed with arms slightly away from the body.",
  `Person: ${c.identity}`,
  `Wearing: ${c.baseOutfit ?? "plain, close-fitting neutral grey clothes and simple shoes"}.`,
  "Neutral expression. Even, soft front light. Plain light-grey seamless background. No text, labels, logos, props, frames or other people.",
].join("\n");

const castOf = (world: FixtureWorld, shotIdValue: string): string[] =>
  (world.snapshot.project.shots.find((s) => s.id === shotIdValue)?.characterIds ?? []);
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function read(world: FixtureWorld): CastRead {
  const cast = state(world);
  const { shots } = world.snapshot.project;
  const appearances = (id: string) => {
    const shotIds = shots.filter((s) => (s.characterIds ?? []).includes(id)).map((s) => s.id);
    const sceneIds = [...new Set(shotIds.map((sid) => shots.find((s) => s.id === sid)!.sceneId))];
    return { shotIds, sceneIds };
  };
  const issues: CastIssue[] = [];
  const characters: CastCharacter[] = cast.characters.map((c) => {
    const seen = appearances(c.id), digest = digestOf(c);
    const own = cast.takes.filter((t) => t.characterId === c.id).map(({ characterId: _c, ...take }) => ({
      ...take, approved: !!c.sheet && c.sheet.takeId === take.takeId, outdated: take.promptDigest !== digest,
    }));
    const making = cast.making.has(c.id);
    const sheetState: SheetState = making ? "pending" : c.sheet ? (c.sheet.promptDigest === digest ? "approved" : "outdated") : own.length ? "review" : "none";
    const needsSheet = seen.shotIds.length > 1;
    for (const sceneIdValue of seen.sceneIds) if (!c.wardrobe.some((w) => w.sceneId === sceneIdValue) && !c.baseOutfit) issues.push({ code: "WARDROBE_MISSING", severity: "blocking", characterId: c.id, sceneId: sceneIdValue });
    if (needsSheet && !c.sheet) issues.push({ code: "SHEET_REQUIRED", severity: "blocking", characterId: c.id });
    if (c.sheet) for (const sid of seen.shotIds) if (cast.bound.get(`${c.id}:${sid}`) !== c.sheet.takeId) issues.push({ code: "SHEET_NOT_BOUND", severity: "blocking", characterId: c.id, shotId: sid });
    return {
      id: c.id, revisionId: c.revisionId, name: c.name, identity: c.identity, ...(c.baseOutfit ? { baseOutfit: c.baseOutfit } : {}), wardrobe: structuredClone(c.wardrobe),
      sheet: c.sheet ? { artifactId: c.sheet.artifact.artifactId, sha256: c.sheet.artifact.sha256, promptDigest: c.sheet.promptDigest, approvedAt: c.sheet.approvedAt } : null,
      appearances: seen, needsSheet, sheetPrompt: sheetPrompt(c), sheetPromptDigest: digest, sheetState, takes: own,
      job: making ? { nodeId: cast.making.get(c.id)!, state: "running", attemptId: `fixture-sheet-${c.id}` } : null,
    };
  });
  return {
    projectId: world.snapshot.project.id, headVersion: world.snapshot.project.headVersion, revisionId: world.snapshot.project.revisionId,
    imageProfile: { id: "codex-image", adapter: "codex-image" }, sheetSupported: true, canvas: { aspect: "1:1", width: 1024, height: 1024 },
    sheetQuote: { micros: "0", units: 1, unitMicros: "0", priceUnknown: false, subscription: "codex" },
    characters,
    casting: shots.map((s) => ({ shotId: s.id, sceneId: s.sceneId, characterIds: s.characterIds ?? [] })),
    issues,
  };
}

const outdateKeyframe = (keyframe: KeyframeSlot): KeyframeSlot => keyframe.state === "ready" && keyframe.artifact
  ? { state: "outdated", previous: keyframe.artifact, takeCount: keyframe.takeCount, opened: false, outdatedFields: ["characters"] } : keyframe;
const outdateClip = (video: MediaSlot): MediaSlot => video.state === "ready" && video.artifact
  ? { state: "outdated", previous: video.artifact, takeCount: video.takeCount, outdatedFields: ["characters"] } : video;

/** One change: bump the head, outdate the changed shots' keyframes and clips (never remade). */
function publish(world: FixtureWorld, changedShotIds: string[], change: (w: FixtureWorld) => void): { headVersion: number; revisionId: string; outdatedNodeIds: string[] } {
  const outdated: string[] = [];
  world.update((w) => {
    change(w);
    const headVersion = w.snapshot.project.headVersion + 1, revisionId = `rev-cast-${headVersion}`;
    const shots: Record<string, ShotOverview> = { ...w.overview.shots };
    for (const id of changedShotIds) {
      const shot = shots[id];
      if (!shot) continue;
      if (shot.keyframe.state === "ready") outdated.push(`${id}:image`);
      if (shot.video.state === "ready") outdated.push(`${id}:video`);
      shots[id] = { ...shot, keyframe: outdateKeyframe(shot.keyframe), video: outdateClip(shot.video) };
    }
    w.snapshot = { ...w.snapshot, project: { ...w.snapshot.project, headVersion, revisionId } };
    w.overview = recompute({ ...w.overview, shots, headVersion, revisionId } as GenerationOverview, w.snapshot.notes ?? [], w.snapshot.project.shots);
  });
  return { headVersion: world.snapshot.project.headVersion, revisionId: world.snapshot.project.revisionId, outdatedNodeIds: outdated };
}

/** Shots whose character block changes when this character's looks, outfit or sheet change. */
const shotsOf = (world: FixtureWorld, characterId: string, sceneIdValue?: string) =>
  world.snapshot.project.shots.filter((s) => (s.characterIds ?? []).includes(characterId) && (!sceneIdValue || s.sceneId === sceneIdValue)).map((s) => s.id);

function save(world: FixtureWorld, body: CastSaveInput) {
  const cast = state(world);
  if (!body || !Array.isArray(body.characters)) throw new ApiError("VALIDATION_ERROR", 400);
  if (body.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
  const names = new Set<string>();
  const keys: Record<string, string> = {};
  const next: FixtureCharacter[] = body.characters.map((input) => {
    if (!input.name?.trim() || !input.identity?.trim()) throw new ApiError("VALIDATION_ERROR", 400);
    const name = input.name.trim().toLocaleLowerCase();
    if (names.has(name)) throw new ApiError("CHARACTER_NAME_TAKEN", 409);
    names.add(name);
    const old = input.id ? cast.characters.find((c) => c.id === input.id) : undefined;
    if (input.id && !old) throw new ApiError("NOT_FOUND", 404);
    const sceneIds = new Set(world.snapshot.project.scenes.map((s) => s.id));
    if ((input.wardrobe ?? []).some((w) => !sceneIds.has(w.sceneId))) throw new ApiError("NOT_FOUND", 404);
    const id = old?.id ?? `char-new-${++cast.serial}`;
    if (!old && input.key) keys[input.key] = id;
    return { id, revisionId: `${id}-r${++cast.serial}`, name: input.name.trim(), identity: input.identity.trim(), ...(input.baseOutfit ? { baseOutfit: input.baseOutfit } : {}),
      wardrobe: (input.wardrobe ?? []).map((w) => ({ sceneId: w.sceneId, outfit: w.outfit, ...(w.notes ? { notes: w.notes } : {}) })), sheet: old?.sheet ?? null };
  });
  // The changed shots: every shot of a character whose looks, base outfit or name changed, of a scene whose outfit
  // changed, of a removed character, and every recast shot.
  const changed = new Set<string>();
  for (const before of cast.characters) {
    const after = next.find((c) => c.id === before.id);
    if (!after) { for (const id of shotsOf(world, before.id)) changed.add(id); continue; }
    if (after.name !== before.name || after.identity !== before.identity || after.baseOutfit !== before.baseOutfit) for (const id of shotsOf(world, before.id)) changed.add(id);
    const scenes = new Set([...before.wardrobe, ...after.wardrobe].map((w) => w.sceneId));
    for (const sid of scenes) {
      const a = before.wardrobe.find((w) => w.sceneId === sid), b = after.wardrobe.find((w) => w.sceneId === sid);
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) for (const id of shotsOf(world, before.id, sid)) changed.add(id);
    }
  }
  const casting = new Map<string, string[]>();
  for (const row of body.casting ?? []) {
    if (!world.snapshot.project.shots.some((s) => s.id === row.shotId)) throw new ApiError("NOT_FOUND", 404);
    const ids = row.characterIds.map((id) => keys[id] ?? id);
    if (ids.some((id) => !next.some((c) => c.id === id))) throw new ApiError("SCOPE_DENIED", 409);
    if (JSON.stringify(ids) !== JSON.stringify(castOf(world, row.shotId))) changed.add(row.shotId);
    casting.set(row.shotId, ids);
  }
  const kept = new Set(next.map((c) => c.id));
  const published = publish(world, [...changed], (w) => {
    cast.characters = next;
    w.snapshot = { ...w.snapshot, project: { ...w.snapshot.project, shots: w.snapshot.project.shots.map((s) => {
      const ids = (casting.get(s.id) ?? s.characterIds ?? []).filter((id) => kept.has(id));
      return ids.length ? { ...s, characterIds: ids } : (({ characterIds: _gone, ...rest }) => rest)(s);
    }) } };
    // A shot whose block changed keeps its binding only for sheets still approved.
    for (const key of [...cast.bound.keys()]) if (!kept.has(key.split(":")[0]!)) cast.bound.delete(key);
    for (const c of next) if (c.sheet) for (const id of shotsOf(w, c.id)) cast.bound.set(`${c.id}:${id}`, c.sheet.takeId);
  });
  return { ...published, requestId: `fixture-cast-${cast.serial}`, characterIds: next.map((c) => c.id), keys, changedShotIds: [...changed] };
}

function generate(world: FixtureWorld, characterId: string, body: { expectedHeadVersion?: number; expectedEstimateMicros?: string; regenerate?: boolean }) {
  const cast = state(world);
  const character = cast.characters.find((c) => c.id === characterId);
  if (!character) throw new ApiError("NOT_FOUND", 404);
  if (body?.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
  if (body.expectedEstimateMicros !== "0") throw new ApiError("ESTIMATE_CHANGED", 409);
  if (world.snapshot.control?.paused) throw new ApiError("EXECUTION_PAUSED", 409);
  if (cast.making.has(characterId)) throw new ApiError("ATTEMPT_EXISTS", 409);
  if (!body.regenerate && cast.takes.some((t) => t.characterId === characterId)) throw new ApiError("CHARACTER_SHEET_EXISTS", 409);
  const nodeId = `sheet-node-${++cast.serial}`;
  world.update(() => { cast.making.set(characterId, nodeId); });
  const fail = cast.failNext;
  cast.failNext = false;
  world.later(FIXTURE_TIMING.keyframeMs, () => {
    cast.making.delete(characterId);
    if (fail) return;
    const n = cast.takes.filter((t) => t.characterId === characterId).length + 1;
    // The sample has two drawings per character; later takes reuse the last one.
    const drawn = characterId === "char-mara" ? Math.min(n, 2) : 1;
    const base = characterId === "char-mara" || characterId === "char-clerk" ? sheetArtifact(characterId, drawn) : sheetArtifact("char-mara", 2);
    cast.takes.push({ characterId, takeId: nodeId, artifact: { ...base, artifactId: `${base.artifactId}~${n}` }, source: "generated", promptDigest: digestOf(character), createdAt: new Date().toISOString(), approved: false, outdated: false });
  });
  return { projectId: world.snapshot.project.id, requestId: `fixture-sheet-request-${cast.serial}`, quote: read(world).sheetQuote, started: [{ characterId, nodeId, takeId: nodeId, prompt: sheetPrompt(character) }] };
}

function importSheet(world: FixtureWorld, characterId: string, body: { artifactId?: string; sha256?: string }) {
  const cast = state(world);
  const character = cast.characters.find((c) => c.id === characterId);
  if (!character) throw new ApiError("NOT_FOUND", 404);
  const asset = typeof body?.artifactId === "string" ? fixtureAsset(world, body.artifactId) : null;
  if (!asset || asset.role !== "upload" || asset.artifact.kind !== "image" || asset.artifact.sha256 !== body.sha256) throw new ApiError("CHARACTER_SHEET_INVALID", 409);
  if (cast.takes.some((t) => t.characterId === characterId && t.artifact.artifactId === asset.artifact.artifactId)) throw new ApiError("CHARACTER_SHEET_EXISTS", 409);
  const takeId = `sheet-import-${++cast.serial}`;
  world.update(() => {
    cast.takes.push({ characterId, takeId, artifact: { ...asset.artifact }, source: "imported", promptDigest: digestOf(character), createdAt: new Date().toISOString(), approved: false, outdated: false });
  });
  return { characterId, takeId, artifact: asset.artifact, promptDigest: digestOf(character) };
}

function approve(world: FixtureWorld, characterId: string, body: { expectedHeadVersion?: number; takeId?: string }) {
  const cast = state(world);
  const character = cast.characters.find((c) => c.id === characterId);
  if (!character) throw new ApiError("NOT_FOUND", 404);
  if (body?.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
  const take = cast.takes.find((t) => t.takeId === body.takeId && t.characterId === characterId);
  if (!take) throw new ApiError("NOT_FOUND", 404);
  if (character.sheet?.takeId === take.takeId) throw new ApiError("CHARACTER_SHEET_ALREADY_APPROVED", 409);
  const changed = shotsOf(world, characterId);
  const sheet = { takeId: take.takeId, artifact: take.artifact, promptDigest: take.promptDigest, approvedAt: new Date().toISOString() };
  const published = publish(world, changed, () => {
    character.sheet = sheet;
    character.revisionId = `${character.id}-r${++cast.serial}`;
    for (const id of changed) cast.bound.set(`${characterId}:${id}`, take.takeId);
  });
  return { ...published, requestId: `fixture-approve-${cast.serial}`, characterId, takeId: take.takeId, sheet: { artifactId: take.artifact.artifactId, sha256: take.artifact.sha256, promptDigest: take.promptDigest, approvedAt: sheet.approvedAt }, changedShotIds: changed };
}

export const castRoutes: FixtureRoute[] = [
  { method: "GET", match: /^\/characters$/, handle: (world) => read(world) },
  { method: "PUT", match: /^\/characters$/, handle: (world, _params, body) => save(world, body as CastSaveInput) },
  { method: "POST", match: /^\/characters\/([^/]+)\/sheet\/generate$/, handle: (world, [id], body) => generate(world, decodeURIComponent(id!), body as never) },
  { method: "POST", match: /^\/characters\/([^/]+)\/sheet\/import$/, handle: (world, [id], body) => importSheet(world, decodeURIComponent(id!), body as never) },
  { method: "POST", match: /^\/characters\/([^/]+)\/sheet\/approve$/, handle: (world, [id], body) => approve(world, decodeURIComponent(id!), body as never) },
];

// ---- presets ------------------------------------------------------------------------------------

export function castPresets(): string[] {
  try { return (new URLSearchParams(globalThis.location?.search ?? "").get("cast") ?? "").split(",").map((part) => part.trim()).filter(Boolean); } catch { return []; }
}

/** Seed the sample cast (tests pass the presets themselves). */
export function applyCastPresets(world: FixtureWorld, presets: readonly string[] = castPresets()): void {
  const preset = ["on", "approved", "pending", "outdated", "fail"].find((name) => presets.includes(name));
  if (!preset) return;
  const cast = state(world);
  cast.characters = CAST_SEED.map((seed) => ({ id: seed.id, revisionId: `${seed.id}-r0`, name: seed.name, identity: seed.identity, ...(seed.baseOutfit ? { baseOutfit: seed.baseOutfit } : {}),
    wardrobe: structuredClone(seed.wardrobe), sheet: null }));
  world.snapshot = { ...world.snapshot, project: { ...world.snapshot.project, shots: world.snapshot.project.shots.map((s) => {
    const ids = CAST_SEED.filter((seed) => seed.shots.includes(s.id)).map((seed) => seed.id);
    return ids.length ? { ...s, characterIds: ids } : s;
  }) } };
  const mara = cast.characters[0]!, clerk = cast.characters[1]!;
  const take = (c: FixtureCharacter, n: number, minutesAgo: number, digest = digestOf(c)): FixtureTake =>
    ({ characterId: c.id, takeId: `take-${c.id}-${n}`, artifact: sheetArtifact(c.id, n), source: "generated", promptDigest: digest, createdAt: at(minutesAgo), approved: false, outdated: false });
  if (preset === "on" || preset === "fail") { cast.takes.push(take(mara, 1, 30)); cast.failNext = preset === "fail"; }
  if (preset === "pending") cast.making.set(mara.id, "sheet-node-pending");
  if (preset === "approved" || preset === "outdated") {
    cast.takes.push(take(mara, 1, 90), take(mara, 2, 60), take(clerk, 1, 50));
    for (const [c, t] of [[mara, cast.takes[1]!], [clerk, cast.takes[2]!]] as const) {
      c.sheet = { takeId: t.takeId, artifact: t.artifact, promptDigest: t.promptDigest, approvedAt: at(40) };
      for (const id of shotsOf(world, c.id)) cast.bound.set(`${c.id}:${id}`, t.takeId);
    }
    if (preset === "outdated") mara.identity = `${mara.identity} Short fringe cut just above the eyebrows.`;
  }
}
