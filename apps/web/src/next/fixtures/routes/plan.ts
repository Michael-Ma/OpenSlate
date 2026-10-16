import type { GenerationOverview, KeyframeSlot, MediaSlot, SceneOverview, ShotOverview } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { estimateNarrationSeconds, MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "../../model/checks.ts";
import type { PendingImport } from "../../model/plan-import.ts";
import type { ConversationEntry, ProjectSnapshot } from "../../model/types.ts";
import { canonicalJson } from "../../store/press-keys.ts";
import { fixtureCommand, recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { DECLINE, type FixtureRoute } from "./types.ts";

/**
 * Simulated routes for the Plan view in the sample film (?ui=next&fixture=last-ferry). Nothing is generated,
 * charged or saved.
 *
 * - POST /storyboard handles the storyboard kinds the Plan view makes (treatment, scene, sceneTitle, addScene,
 *   deleteScene, moveScene, shotFields, addShot, deleteShot, moveShot, narration, undo), and `shot`. Single shot
 *   fields the Keyframes view edits (prompt, motion, length, narration text) and their undo go to the shared
 *   Keyframes fixture so both views behave the same; the rest is simulated here, with one-step undo that restores
 *   the outline and its media. `shotFields` (the Plan editor's save) applies several fields as one command, as the
 *   server does (card B12): one head version, one Undo that restores them all.
 *   This route owns the endpoint: it checks what every storyboard command must pass (a known kind, the head
 *   version, a pending written plan) and declines what other views own (the Film view's soundtrack) and the Undo
 *   of commands it never answered, which go to the next /storyboard route, then the Keyframes commands. While a
 *   written plan is pending, only treatment, scene, shot and narration edits are taken (IMPORT_PENDING), as on
 *   the server.
 * - /plan-imports: create, read, confirm and discard a written plan. The Director "reads" it for 2.6 s and proposes
 *   the sample outline (a new story and narration script, 2.3 gets a shorter line, a new 2.4). The fixture stands in
 *   for a Codex Director.
 *
 * Presets (`?plan=`): `lost` loses the reply to the first storyboard command (it is applied; the same request sent
 * again is answered with the same receipt, as the server's request identity does). `director-edits` has the
 * Director working alongside: 3 s after the Plan opens it rewrites 1.2's purpose and motion and the story, as if it
 * had changed them while the person had a draft open.
 */

export const IMPORT_READ_MS = 2600;
/** How long after the Plan opens the Director's alongside edit lands in the `director-edits` preset. */
export const DIRECTOR_EDIT_MS = 3000;

/** The `?plan=` preset of the page (null in tests and normal use). */
function planPreset(): string | null {
  try { return new URLSearchParams(globalThis.location?.search ?? "").get("plan"); } catch { return null; }
}

type Project = ProjectSnapshot["project"];
type ProjectShot = Project["shots"][number];

interface Latest {
  commandId: string;
  owner: "keyframes" | "plan";
  headAfter: number;
  media: string;
  before: { overview: GenerationOverview; project: Project } | null;
}

interface Pending {
  id: string;
  name: string;
  text: string;
  baseVersion: number;
  ready: boolean;
  draft: { preparedId: string; proposalDigest: string; project: Project } | null;
}

interface PlanState {
  serial: number;
  latest: Latest | null;
  /** Every storyboard command this route answered, so a stale Undo is refused rather than passed on. */
  known: Set<string>;
  pending: Pending | null;
  /** The next storyboard command is applied but its reply is lost. */
  loseNext: boolean;
  /** Receipts of lost replies, by the exact request, so sending it again is answered, not applied twice. */
  replies: Map<string, unknown>;
  /** The Director's alongside edit: not scheduled, scheduled, or done. */
  directorEdit: "off" | "armed" | "scheduled";
}

const states = new WeakMap<FixtureWorld, PlanState>();
function state(world: FixtureWorld): PlanState {
  let value = states.get(world);
  if (!value) {
    const preset = planPreset();
    value = { serial: 0, latest: null, known: new Set(), pending: null, loseNext: preset === "lost", replies: new Map(), directorEdit: preset === "director-edits" ? "armed" : "off" };
    states.set(world, value);
  }
  return value;
}

/** Lose the reply to the next storyboard command (the `lost` preset; tests call it directly). */
export function loseNextReply(world: FixtureWorld): void {
  state(world).loseNext = true;
}
const nextId = (world: FixtureWorld, prefix: string) => `${prefix}-plan-${++state(world).serial}`;

const head = (world: FixtureWorld) => world.snapshot.project.headVersion;

/** The media every shot shows; Undo is refused once any of it changed since the command (paid work used it). */
function mediaSignature(overview: GenerationOverview): string {
  return JSON.stringify(Object.values(overview.shots).map((shot) => [shot.shotId, shot.keyframe.state, shot.keyframe.artifact?.sha256 ?? null, shot.video.state, shot.video.artifact?.sha256 ?? null, shot.narration.state]).sort());
}

/** Scene ordinals, shot labels and the snapshot's shot order follow the outline's order. */
function relabel(overview: GenerationOverview, notes: Parameters<typeof recompute>[1]): GenerationOverview {
  const shots: Record<string, ShotOverview> = {};
  const scenes = overview.scenes.map((scene, index) => {
    scene.shotIds.forEach((id, position) => {
      const shot = overview.shots[id];
      if (shot) shots[id] = { ...shot, sceneId: scene.sceneId, label: `${index + 1}.${position + 1}` };
    });
    return { ...scene, ordinal: index + 1 };
  });
  // The Director's open notes still gate their scenes' video (DC-9).
  return recompute({ ...overview, scenes, shots }, notes);
}

function orderedShots(overview: GenerationOverview, project: Project): ProjectShot[] {
  const byId = new Map(project.shots.map((shot) => [shot.id, shot]));
  return overview.scenes.flatMap((scene) => scene.shotIds.map((id) => byId.get(id)).filter((shot): shot is ProjectShot => !!shot).map((shot) => ({ ...shot, sceneId: scene.sceneId })));
}

const sceneTitle = (purpose: string, title?: string) => title?.trim() || purpose;

function emptyScene(id: string, purpose: string, ordinal: number): SceneOverview {
  return {
    sceneId: id, ordinal, title: purpose, purpose, state: "not_started", shotIds: [],
    counts: { shots: 0, keyframesReady: 0, opened: 0, videosReady: 0 },
    videoTargets: [], keyframeTargets: [], quotes: {}, blockers: [], confirmationDigest: null,
  };
}

const outdateKeyframe = (keyframe: KeyframeSlot, field: string | string[]): KeyframeSlot => {
  if (keyframe.state !== "ready" || !keyframe.artifact) return keyframe;
  const { artifact, ...rest } = keyframe;
  return { ...rest, state: "outdated", previous: artifact, opened: false, outdatedFields: typeof field === "string" ? [field] : field };
};
const outdateClip = (video: MediaSlot, field: string | string[]): MediaSlot => {
  if (video.state !== "ready" || !video.artifact) return video;
  const { artifact, ...rest } = video;
  return { ...rest, state: "outdated", previous: artifact, outdatedFields: typeof field === "string" ? [field] : field };
};

const isWorking = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";

/** A written direction lifts a new shot out of "needs direction" (the server's promptState becomes ready). */
const directed = (shot: ShotOverview): ShotOverview => (shot.keyframe.state === "direction_required" ? { ...shot, keyframe: { ...shot.keyframe, state: "none" } } : shot);

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16000) throw new ApiError("VALIDATION_ERROR", 400);
  return value.trim();
}

// ---- storyboard -------------------------------------------------------------------------------------

interface Body {
  kind?: string;
  expectedHeadVersion?: number;
  id?: string;
  sceneId?: string;
  beforeId?: string;
  field?: string;
  value?: string;
  commandId?: string;
  withShots?: boolean;
  fields?: Record<string, unknown>;
}

/** Shot fields whose behaviour the Keyframes fixture already simulates. */
const KEYFRAMES_FIELDS = new Set(["imagePrompt", "motion", "desiredFrames", "videoPrompt"]);
/** Shot fields the server writes into both prompts (storyboard.ts editedPrompt). */
const DIRECTION_FIELDS = new Set(["purpose", "action", "framing"]);

/** The storyboard kinds the server has (its body schema); the Plan view makes all of them but soundtrack. */
const SERVER_KINDS = new Set(["treatment", "scene", "sceneTitle", "deleteScene", "moveScene", "addScene", "shot", "shotFields", "addShot", "deleteShot", "moveShot", "narration", "undo", "soundtrack"]);
const OTHER_VIEWS_KINDS = new Set(["soundtrack"]);
/** What the server still takes while a written plan is pending (storyboard.ts, IMPORT_PENDING). */
const DURING_IMPORT = new Set(["treatment", "scene", "shot", "shotFields", "narration"]);
/** The fields one shotFields command may carry (storyboard.ts). */
const SHOT_FIELDS = new Set(["purpose", "action", "framing", "motion", "desiredFrames", "imagePrompt", "videoPrompt"]);

const DIRECTION_HEADER = "OpenSlate current direction:\n";
const DIRECTION_SEPARATOR = "\nReference details (retain only where consistent):\n";

/** The server's rewrite of a prompt after a purpose, action or framing edit: its direction in front, the words kept. */
function directedPrompt(previous: string, direction: string): string {
  const split = previous.startsWith(DIRECTION_HEADER) ? previous.indexOf(DIRECTION_SEPARATOR) : -1;
  const original = split >= 0 ? previous.slice(split + DIRECTION_SEPARATOR.length) : previous;
  return `${DIRECTION_HEADER}${direction}${DIRECTION_SEPARATOR}${original}`;
}

/** The server refuses a shot shorter than its accepted voice line (SB-8). */
function assertLength(shot: ShotOverview, frames: number, fps: number): void {
  const line = shot.narration;
  if (line.state !== "ready" || line.measuredSeconds === undefined) return;
  const lineFrames = Math.ceil(line.measuredSeconds * fps - 1e-6);
  const accepted = line.fit === "cut_to_shot" ? shot.durationFrames : line.fits === true || line.fit === "extend_shot" ? lineFrames : null;
  if (accepted !== null && frames < accepted) throw new ApiError("SHOT_SHORTER_THAN_NARRATION", 409, { shotId: shot.shotId, narrationFrames: accepted, requestedFrames: frames });
}

function commit(world: FixtureWorld, owner: Latest["owner"], commandId: string, before: Latest["before"]): { commandId: string; headVersion: number } {
  const plan = state(world);
  plan.known.add(commandId);
  plan.latest = { commandId, owner, headAfter: head(world), media: mediaSignature(world.overview), before };
  return { commandId, headVersion: head(world) };
}

/** Apply a change to the outline with a new head version, as one server event. */
function change(world: FixtureWorld, edit: (overview: GenerationOverview, project: Project) => { overview: GenerationOverview; project: Project }): void {
  world.update((w) => {
    const next = edit(w.overview, w.snapshot.project);
    const headVersion = w.snapshot.project.headVersion + 1;
    const revisionId = `rev-plan-${headVersion}`;
    const overview = relabel(next.overview, w.snapshot.notes ?? []);
    w.overview = { ...overview, headVersion, revisionId };
    w.snapshot = { ...w.snapshot, project: { ...next.project, shots: orderedShots(overview, next.project), headVersion, revisionId } };
  });
}

/**
 * Several shot fields as one change, as the server's shotFields does: explicit prompts win; otherwise purpose,
 * action and framing are written into both prompts and motion into the video prompt. Purpose, action, framing or
 * the picture prompt outdate the keyframe and the clip; motion, length or the video prompt only the clip.
 */
function applyShotFields(world: FixtureWorld, shot: ShotOverview, fields: Record<string, unknown>): void {
  const fps = world.overview.fps;
  const names = Object.keys(fields);
  if (!names.length || names.some((name) => !SHOT_FIELDS.has(name))) throw new ApiError("VALIDATION_ERROR", 400);
  const values: Record<string, string> = {};
  let frames: number | null = null;
  for (const name of names) {
    if (name === "desiredFrames") {
      const value = fields[name];
      if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_SHOT_SECONDS * fps || value > MAX_SHOT_SECONDS * fps) throw new ApiError("VALIDATION_ERROR", 400);
      frames = value;
    } else values[name] = text(fields[name]);
  }
  // Refused whole before anything changes: a shot shorter than its accepted voice line.
  if (frames !== null) assertLength(shot, frames, fps);
  change(world, (overview, project) => {
    const row = project.shots.find((s) => s.id === shot.shotId) as (ProjectShot & { action?: string }) | undefined;
    const purpose = values.purpose ?? shot.purpose;
    const action = values.action ?? row?.action ?? "";
    const framing = values.framing ?? shot.framing;
    const motion = values.motion ?? shot.motion;
    const direction = [purpose, action, framing].filter(Boolean).join(". ");
    const directs = names.some((name) => DIRECTION_FIELDS.has(name));
    const imagePrompt = values.imagePrompt ?? (directs ? directedPrompt(shot.imagePrompt, direction) : shot.imagePrompt);
    const priorVideo = row?.videoPrompt ?? shot.imagePrompt;
    const videoPrompt = values.videoPrompt ?? (directs || "motion" in values ? directedPrompt(priorVideo, `${direction}. Camera movement: ${motion}`) : priorVideo);
    const keyframeToo = directs || "imagePrompt" in values;
    let narration = shot.narration;
    const durationFrames = frames ?? shot.durationFrames;
    if (frames !== null) {
      // A line settled by lengthening the shot is unsettled again once the shot is too short for it.
      const length = narration.measuredSeconds ?? narration.estimatedSeconds;
      if (narration.fit === "extend_shot" && length !== undefined && length > frames / fps + 1e-9) { const { fit: _fit, ...rest } = narration; narration = rest; }
    }
    const edited: ShotOverview = {
      ...shot, purpose, framing, motion, imagePrompt, durationFrames, narration,
      keyframe: keyframeToo ? outdateKeyframe(shot.keyframe, names) : shot.keyframe,
      video: outdateClip(shot.video, names),
    };
    // As on the server (promptState "ready"), a written action, framing or prompt lifts "needs direction".
    const lifts = names.some((name) => ["action", "framing", "imagePrompt", "videoPrompt"].includes(name));
    return {
      overview: { ...overview, shots: { ...overview.shots, [shot.shotId]: lifts ? directed(edited) : edited } },
      project: { ...project, shots: project.shots.map((s) => (s.id === shot.shotId ? { ...s, purpose, framing, motion, imagePrompt, videoPrompt, desiredFrames: durationFrames, ...(values.action ? { action } : {}) } : s)) },
    };
  });
}

/** The storyboard route: a lost reply's request sent again is answered with its receipt; the next one may be lost. */
function storyboardAnswer(world: FixtureWorld, raw: unknown): unknown {
  const plan = state(world);
  const key = canonicalJson(raw);
  if (plan.replies.has(key)) return plan.replies.get(key);
  const receipt = storyboard(world, raw);
  if (receipt !== DECLINE && plan.loseNext) {
    plan.loseNext = false;
    plan.replies.set(key, receipt);
    throw new ApiError("NETWORK_ERROR");
  }
  return receipt;
}

function storyboard(world: FixtureWorld, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") throw new ApiError("VALIDATION_ERROR", 400);
  const body = raw as Body;
  if (!SERVER_KINDS.has(body.kind ?? "")) throw new ApiError("VALIDATION_ERROR", 400);
  if (body.expectedHeadVersion !== undefined && body.expectedHeadVersion !== head(world)) throw new ApiError("REVISION_CONFLICT", 409);
  const plan = state(world);
  if (plan.pending && !DURING_IMPORT.has(body.kind ?? "")) throw new ApiError("IMPORT_PENDING", 409);
  // Another view's command (the Film view's music): the next /storyboard route answers it.
  if (OTHER_VIEWS_KINDS.has(body.kind ?? "")) return DECLINE;
  if (body.kind === "undo") return undo(world, body);

  const fps = world.overview.fps;
  if (body.kind === "shot" && KEYFRAMES_FIELDS.has(body.field ?? "")) {
    const shot = world.overview.shots[body.id ?? ""];
    if (!shot) throw new ApiError("NOT_FOUND", 404);
    if (body.field === "desiredFrames") {
      const frames = Number(body.value);
      if (!Number.isInteger(frames) || frames < MIN_SHOT_SECONDS * fps || frames > MAX_SHOT_SECONDS * fps) throw new ApiError("VALIDATION_ERROR", 400);
      assertLength(shot, frames, fps);
    }
    const receipt = fixtureCommand(world, "POST", "/storyboard", body) as { commandId: string };
    // A written picture prompt lifts a new shot out of "needs direction".
    if (body.field === "imagePrompt" && shot.keyframe.state === "direction_required")
      world.update((w) => { w.overview = recompute({ ...w.overview, shots: { ...w.overview.shots, [shot.shotId]: directed(w.overview.shots[shot.shotId]!) } }); });
    return commit(world, "keyframes", receipt.commandId, null);
  }
  if (body.kind === "narration" && body.field === "text") {
    const receipt = fixtureCommand(world, "POST", "/storyboard", body) as { commandId: string };
    return commit(world, "keyframes", receipt.commandId, null);
  }

  const before = { overview: structuredClone(world.overview), project: structuredClone(world.snapshot.project) };
  const commandId = nextId(world, "command");
  switch (body.kind) {
    case "shotFields": {
      const shot = world.overview.shots[body.id ?? ""];
      if (!shot) throw new ApiError("NOT_FOUND", 404);
      if (!body.fields || typeof body.fields !== "object" || Array.isArray(body.fields) || body.field !== undefined || body.value !== undefined) throw new ApiError("VALIDATION_ERROR", 400);
      applyShotFields(world, shot, body.fields);
      break;
    }
    case "treatment": {
      if (body.field !== "brief" && body.field !== "story") throw new ApiError("VALIDATION_ERROR", 400);
      const value = text(body.value);
      const field = body.field;
      change(world, (overview, project) => ({ overview, project: { ...project, [field]: value } }));
      break;
    }
    case "scene":
    case "sceneTitle": {
      const value = text(body.value);
      const scene = world.overview.scenes.find((s) => s.sceneId === body.id);
      if (!scene) throw new ApiError("NOT_FOUND", 404);
      change(world, (overview, project) => {
        const scenes = project.scenes.map((row) => (row.id !== scene.sceneId ? row : body.kind === "scene" ? { ...row, purpose: value } : { ...row, title: value }));
        const row = scenes.find((s) => s.id === scene.sceneId)!;
        return {
          overview: { ...overview, scenes: overview.scenes.map((s) => (s.sceneId === scene.sceneId ? { ...s, purpose: row.purpose, title: sceneTitle(row.purpose, row.title) } : s)) },
          project: { ...project, scenes },
        };
      });
      break;
    }
    case "addScene": {
      const purpose = typeof body.value === "string" && body.value.trim() ? body.value.trim() : "New scene";
      if (world.overview.scenes.length >= 64) throw new ApiError("VALIDATION_ERROR", 400);
      const id = nextId(world, "scene");
      change(world, (overview, project) => ({
        overview: { ...overview, scenes: [...overview.scenes, emptyScene(id, purpose, overview.scenes.length + 1)] },
        project: { ...project, scenes: [...project.scenes, { id, revisionId: `${id}-rev`, purpose }] },
      }));
      break;
    }
    case "deleteScene": {
      const scene = world.overview.scenes.find((s) => s.sceneId === body.id);
      if (!scene) throw new ApiError("NOT_FOUND", 404);
      if (scene.shotIds.length && body.withShots !== true) throw new ApiError("SCENE_HAS_SHOTS", 409);
      if (scene.shotIds.some((id) => { const shot = world.overview.shots[id]; return !!shot && (isWorking(shot.keyframe) || isWorking(shot.video)); })) throw new ApiError("ATTEMPTS_RUNNING", 409);
      change(world, (overview, project) => {
        const shots = { ...overview.shots };
        for (const id of scene.shotIds) delete shots[id];
        return {
          overview: { ...overview, shots, scenes: overview.scenes.filter((s) => s.sceneId !== scene.sceneId) },
          project: { ...project, scenes: project.scenes.filter((s) => s.id !== scene.sceneId), shots: project.shots.filter((s) => s.sceneId !== scene.sceneId) },
        };
      });
      break;
    }
    case "moveScene": {
      const scene = world.overview.scenes.find((s) => s.sceneId === body.id);
      if (!scene) throw new ApiError("NOT_FOUND", 404);
      if (body.beforeId && (body.beforeId === scene.sceneId || !world.overview.scenes.some((s) => s.sceneId === body.beforeId))) throw new ApiError("VALIDATION_ERROR", 400);
      const reorder = <T>(list: T[], idOf: (item: T) => string): T[] => {
        const moving = list.find((item) => idOf(item) === scene.sceneId)!;
        const rest = list.filter((item) => idOf(item) !== scene.sceneId);
        const at = body.beforeId ? rest.findIndex((item) => idOf(item) === body.beforeId) : rest.length;
        rest.splice(at, 0, moving);
        return rest;
      };
      change(world, (overview, project) => ({
        overview: { ...overview, scenes: reorder(overview.scenes, (s) => s.sceneId) },
        project: { ...project, scenes: reorder(project.scenes, (s) => s.id) },
      }));
      break;
    }
    case "addShot": {
      const scene = world.overview.scenes.find((s) => s.sceneId === body.sceneId);
      if (!scene) throw new ApiError("NOT_FOUND", 404);
      if (Object.keys(world.overview.shots).length >= 64) throw new ApiError("VALIDATION_ERROR", 400);
      const id = nextId(world, "shot");
      // The server's placeholders (storyboard.ts addShot): the shot needs direction before anything can be made.
      const shot: ShotOverview = {
        shotId: id, sceneId: scene.sceneId, label: "", framing: "Describe the visual direction", purpose: "New shot", imagePrompt: "Pending direction",
        motion: "Describe the camera movement", durationFrames: 6 * fps,
        keyframe: { state: "direction_required", takeCount: 0, opened: false }, video: { state: "none", takeCount: 0 }, narration: { state: "none", text: "", fits: true },
      };
      change(world, (overview, project) => ({
        overview: { ...overview, shots: { ...overview.shots, [id]: shot }, scenes: overview.scenes.map((s) => (s.sceneId === scene.sceneId ? { ...s, shotIds: [...s.shotIds, id] } : s)) },
        project: { ...project, shots: [...project.shots, { id, sceneId: scene.sceneId, purpose: shot.purpose, framing: shot.framing, motion: shot.motion, desiredFrames: shot.durationFrames, imagePrompt: shot.imagePrompt, videoPrompt: "Pending direction" }] },
      }));
      break;
    }
    case "deleteShot": {
      const shot = world.overview.shots[body.id ?? ""];
      if (!shot) throw new ApiError("NOT_FOUND", 404);
      change(world, (overview, project) => {
        const shots = { ...overview.shots };
        delete shots[shot.shotId];
        return {
          overview: { ...overview, shots, scenes: overview.scenes.map((s) => ({ ...s, shotIds: s.shotIds.filter((id) => id !== shot.shotId) })) },
          project: { ...project, shots: project.shots.filter((s) => s.id !== shot.shotId) },
        };
      });
      break;
    }
    case "moveShot": {
      const shot = world.overview.shots[body.id ?? ""];
      const target = world.overview.scenes.find((s) => s.sceneId === body.sceneId);
      if (!shot || !target) throw new ApiError("NOT_FOUND", 404);
      if (body.beforeId && (body.beforeId === shot.shotId || !target.shotIds.includes(body.beforeId))) throw new ApiError("VALIDATION_ERROR", 400);
      change(world, (overview, project) => ({
        overview: {
          ...overview,
          scenes: overview.scenes.map((s) => {
            const ids = s.shotIds.filter((id) => id !== shot.shotId);
            if (s.sceneId !== target.sceneId) return { ...s, shotIds: ids };
            const at = body.beforeId ? ids.indexOf(body.beforeId) : ids.length;
            ids.splice(at, 0, shot.shotId);
            return { ...s, shotIds: ids };
          }),
        },
        project,
      }));
      break;
    }
    case "shot": {
      // Purpose, action and framing are written into both prompts on the server (a "current direction" header in
      // front of the words), so they outdate the keyframe and the clip. Work in flight is not refused: what it
      // makes is out of date, as on the server.
      if (!DIRECTION_FIELDS.has(body.field ?? "")) throw new ApiError("VALIDATION_ERROR", 400);
      const shot = world.overview.shots[body.id ?? ""];
      if (!shot) throw new ApiError("NOT_FOUND", 404);
      const value = text(body.value);
      const field = body.field as "purpose" | "action" | "framing";
      change(world, (overview, project) => {
        const row = project.shots.find((s) => s.id === shot.shotId);
        const purpose = field === "purpose" ? value : shot.purpose;
        const action = field === "action" ? value : (row as { action?: string } | undefined)?.action ?? "";
        const framing = field === "framing" ? value : shot.framing;
        const direction = [purpose, action, framing].filter(Boolean).join(". ");
        const imagePrompt = directedPrompt(shot.imagePrompt, direction);
        const videoPrompt = directedPrompt(row?.videoPrompt ?? shot.imagePrompt, `${direction}. Camera movement: ${shot.motion}`);
        // The overview has no action; the stored shot keeps it.
        const content = field === "action" ? {} : { [field]: value };
        const edited: ShotOverview = { ...shot, ...content, imagePrompt, keyframe: outdateKeyframe(shot.keyframe, field), video: outdateClip(shot.video, field) };
        return {
          // As on the server (promptState "ready"), a written action or framing lifts "needs direction"; a purpose does not.
          overview: { ...overview, shots: { ...overview.shots, [shot.shotId]: field === "purpose" ? edited : directed(edited) } },
          project: { ...project, shots: project.shots.map((s) => (s.id === shot.shotId ? { ...s, [field]: value, imagePrompt, videoPrompt } : s)) },
        };
      });
      break;
    }
    case "narration": {
      if (body.field !== "mode" || !["none", "generated", "uploaded"].includes(body.value ?? "")) throw new ApiError("VALIDATION_ERROR", 400);
      const shot = world.overview.shots[body.id ?? ""];
      if (!shot) throw new ApiError("NOT_FOUND", 404);
      const mode = body.value as "none" | "generated" | "uploaded";
      change(world, (overview, project) => {
        const row = project.shots.find((s) => s.id === shot.shotId);
        const line = row?.narration?.text ?? shot.narration.text;
        const narration: ShotOverview["narration"] = mode === "none" ? { state: "none", text: line, fits: true }
          : shot.narration.state !== "none" ? shot.narration
          : line.trim() ? { state: "text_only", text: line, estimatedSeconds: estimateNarrationSeconds(line), fits: null } : { state: "none", text: "", fits: true };
        return {
          overview: { ...overview, shots: { ...overview.shots, [shot.shotId]: { ...shot, narration } } },
          project: { ...project, shots: project.shots.map((s) => (s.id === shot.shotId ? { ...s, narration: { mode, text: line, voice: s.narration?.voice ?? "stock" } } : s)) },
        };
      });
      break;
    }
    default:
      throw new ApiError("VALIDATION_ERROR", 400);
  }
  return commit(world, "plan", commandId, before);
}

/** One-step Undo: only the latest command, only while nothing changed since (no new edit, no paid work). */
function undo(world: FixtureWorld, body: Body): unknown {
  const plan = state(world);
  const commandId = body.commandId ?? "";
  // Commands this route never answered (the Keyframes narration fit, another view's music) are undone where they were made.
  if (!plan.known.has(commandId)) return DECLINE;
  const latest = plan.latest;
  if (!latest || latest.commandId !== commandId || latest.headAfter !== head(world) || latest.media !== mediaSignature(world.overview)) throw new ApiError("UNDO_UNAVAILABLE", 409);
  plan.latest = null;
  if (latest.owner === "keyframes") {
    const receipt = fixtureCommand(world, "POST", "/storyboard", body) as { commandId: string };
    return { commandId: receipt.commandId, headVersion: head(world) };
  }
  const before = latest.before!;
  change(world, (overview) => ({
    // The outline and its media as they were; the Director's activity and the stop state stay as they are now.
    overview: { ...overview, scenes: before.overview.scenes, shots: before.overview.shots },
    project: before.project,
  }));
  const id = nextId(world, "command");
  plan.known.add(id);
  return { commandId: id, headVersion: head(world) };
}

// ---- written plans ------------------------------------------------------------------------------------

const DIRECTOR_NOTES = "I kept your wording and proposed the outline beside it: 2.3 has the shorter line from your draft, and 2.4 is new (the gangway). Two suggestions I left out of the outline: a two-second hold on the empty pier after Mara boards would let the horn land, and the draft never names the season, which the ticket date already carries.";

/** The sample proposal: 2.3's line from the draft, and a new shot after it in the same scene. */
function proposal(world: FixtureWorld, id: string): Project {
  const project: Project & { narration?: { script: string; source: string } } = structuredClone(world.snapshot.project);
  const overview = world.overview;
  // The draft's story and its lines as one narration script; the brief stays as it is.
  project.story = "At closing time Mara buys the last ticket; at dawn she boards the last ferry of the season, and it leaves the harbour in the fog.";
  project.narration = { script: "One for the morning boat. It was the last boat of the season. I didn't look back.", source: "generated" };
  const scene = overview.scenes[1] ?? overview.scenes[overview.scenes.length - 1];
  if (!scene) return project;
  const third = scene.shotIds[2] ?? scene.shotIds[scene.shotIds.length - 1];
  project.shots = project.shots.map((shot) => (shot.id === third && shot.narration ? { ...shot, narration: { ...shot.narration, text: "It was the last boat of the season." } } : shot));
  const shot: ProjectShot & { action: string } = {
    id: `${id}-gangway`, sceneId: scene.sceneId, purpose: "The gangway is lowered; Mara steps aboard.", action: "A deckhand lowers the gangway; Mara crosses it without looking back.", framing: "Wide", motion: "Static", desiredFrames: 4 * overview.fps,
    imagePrompt: "The ferry's gangway lowered onto the pier; Mara steps aboard in her red coat.", videoPrompt: "The ferry's gangway lowered onto the pier; Mara steps aboard in her red coat. Static.",
    narration: { mode: "none", text: "", voice: "stock" },
  };
  const last = project.shots.map((row) => row.sceneId).lastIndexOf(scene.sceneId);
  project.shots.splice(last + 1, 0, shot);
  return project;
}

/**
 * The `director-edits` preset: the Director, working alongside, rewrites 1.2's purpose and motion and the story a
 * moment after the Plan opens (its first read of /plan-imports), as a new head version with a line in the thread.
 */
function armDirectorEdit(world: FixtureWorld): void {
  const plan = state(world);
  if (plan.directorEdit !== "armed") return;
  plan.directorEdit = "scheduled";
  world.later(DIRECTOR_EDIT_MS, (w) => {
    const shot = Object.values(w.overview.shots).find((item) => item.label === "1.2");
    if (shot) applyShotFields(w, shot, { purpose: "Mara counts out her coins for the last ticket.", motion: "Slow push-in" });
    change(w, (overview, project) => ({ overview, project: { ...project, story: "Mara leaves her town on the season's last ferry: the ticket office, the harbour at dawn, the departure." } }));
    // Not marked scripted: the thread would say nothing in the film changed, and here it did.
    const note: ConversationEntry = { id: "director-alongside", role: "assistant", text: "I tightened 1.2 (purpose and a slow push-in) and the story while you were in the Plan.", requestId: "director-alongside", at: new Date().toISOString() };
    w.snapshot = { ...w.snapshot, conversation: [...(w.snapshot.conversation ?? []), note] };
  });
}

function pendingView(world: FixtureWorld): { pending: PendingImport | null } {
  armDirectorEdit(world);
  const pending = state(world).pending;
  if (!pending) return { pending: null };
  const stale = pending.ready && (pending.baseVersion !== head(world) || !!world.overview.stopped);
  return {
    pending: {
      id: pending.id, name: pending.name, text: pending.text, sourceDigest: "a".repeat(64), stale, running: !pending.ready,
      draft: pending.ready ? structuredClone(pending.draft) : null,
    },
  };
}

function createImport(world: FixtureWorld, raw: unknown): unknown {
  const body = (raw && typeof raw === "object" ? raw : {}) as { name?: unknown; text?: unknown; expectedHeadVersion?: unknown };
  const name = typeof body.name === "string" ? body.name : "";
  const source = typeof body.text === "string" ? body.text : "";
  if (!/\.(txt|md)$/i.test(name) || name.length > 160 || !source.trim() || source.length > 12000 || source.includes("\0")) throw new ApiError("VALIDATION_ERROR", 400);
  if (body.expectedHeadVersion !== head(world)) throw new ApiError("REVISION_CONFLICT", 409);
  if (world.overview.stopped) throw new ApiError("IMPORT_STALE", 409);
  const plan = state(world);
  if (plan.pending) throw new ApiError("IMPORT_PENDING", 409);
  const id = nextId(world, "import");
  plan.pending = { id, name, text: source, baseVersion: head(world), ready: false, draft: null };
  world.update((w) => {
    w.director = { ...w.director, status: "running", activeRequestId: id };
    w.overview = recompute({ ...w.overview, director: { state: "working", scopeIds: [], requestId: id } });
  });
  world.later(IMPORT_READ_MS, (w) => {
    const current = state(w).pending;
    if (current?.id !== id) return;
    current.ready = true;
    current.draft = { preparedId: `${id}-prepared`, proposalDigest: "b".repeat(64), project: proposal(w, id) };
    const note: ConversationEntry = { id: `${id}-note`, role: "assistant", text: DIRECTOR_NOTES, requestId: id, at: new Date().toISOString(), runtime: "scripted" };
    w.snapshot = { ...w.snapshot, conversation: [...(w.snapshot.conversation ?? []), note] };
    w.director = { ...w.director, status: "idle", activeRequestId: null };
    w.overview = recompute({ ...w.overview, director: { state: "idle", scopeIds: [] } });
  });
  return { requestId: id };
}

function settle(world: FixtureWorld, requestId: string): Pending {
  const pending = state(world).pending;
  if (!pending || pending.id !== requestId) throw new ApiError("IMPORT_STALE", 409);
  return pending;
}

function confirmImport(world: FixtureWorld, requestId: string, raw: unknown): unknown {
  const pending = settle(world, requestId);
  const body = (raw ?? {}) as { preparedId?: unknown; proposalDigest?: unknown };
  if (!pending.ready || !pending.draft) throw new ApiError("IMPORT_NOT_READY", 409);
  if (body.preparedId !== pending.draft.preparedId || body.proposalDigest !== pending.draft.proposalDigest || world.overview.stopped) throw new ApiError("IMPORT_STALE", 409);
  if (pending.baseVersion !== head(world)) throw new ApiError("REVISION_CONFLICT", 409);
  const proposed = pending.draft.project;
  state(world).pending = null;
  state(world).latest = null;
  change(world, (overview) => {
    const shots: Record<string, ShotOverview> = {};
    for (const row of proposed.shots) {
      const now = overview.shots[row.id];
      const line = row.narration && row.narration.mode !== "none" ? row.narration.text : "";
      if (now) {
        const lineChanged = line.trim() !== (now.narration.state === "none" ? "" : now.narration.text.trim());
        shots[row.id] = { ...now, purpose: row.purpose, framing: row.framing, motion: row.motion, imagePrompt: row.imagePrompt, durationFrames: row.desiredFrames,
          narration: !lineChanged ? now.narration : line ? { state: "text_only", text: line, estimatedSeconds: estimateNarrationSeconds(line), fits: null } : { state: "none", text: "", fits: true } };
      } else {
        shots[row.id] = { shotId: row.id, sceneId: row.sceneId, label: "", framing: row.framing, purpose: row.purpose, imagePrompt: row.imagePrompt, motion: row.motion, durationFrames: row.desiredFrames,
          keyframe: { state: "none", takeCount: 0, opened: false }, video: { state: "none", takeCount: 0 },
          narration: line ? { state: "text_only", text: line, estimatedSeconds: estimateNarrationSeconds(line), fits: null } : { state: "none", text: "", fits: true } };
      }
    }
    const scenes = proposed.scenes.map((scene, index) => {
      const now = overview.scenes.find((s) => s.sceneId === scene.id) ?? emptyScene(scene.id, scene.purpose, index + 1);
      return { ...now, purpose: scene.purpose, title: sceneTitle(scene.purpose, scene.title), shotIds: proposed.shots.filter((shot) => shot.sceneId === scene.id).map((shot) => shot.id) };
    });
    return { overview: { ...overview, shots, scenes }, project: { ...proposed } };
  });
  return { applied: true, headVersion: head(world) };
}

function discardImport(world: FixtureWorld, requestId: string): unknown {
  settle(world, requestId);
  state(world).pending = null;
  world.update((w) => {
    if (w.director.activeRequestId === requestId) w.director = { ...w.director, status: "idle", activeRequestId: null };
    if (w.overview.director.requestId === requestId) w.overview = recompute({ ...w.overview, director: { state: "idle", scopeIds: [] } });
  });
  return { discarded: true };
}

/** Simulated server routes the Plan view needs in the sample film. */
export const planRoutes: FixtureRoute[] = [
  { method: "POST", match: /^\/storyboard$/, handle: (world, _params, body) => storyboardAnswer(world, body) },
  { method: "GET", match: /^\/plan-imports$/, handle: (world) => pendingView(world) },
  { method: "POST", match: /^\/plan-imports$/, handle: (world, _params, body) => createImport(world, body) },
  { method: "POST", match: /^\/plan-imports\/([^/]+)\/confirm$/, handle: (world, [id], body) => confirmImport(world, decodeURIComponent(id ?? ""), body) },
  { method: "POST", match: /^\/plan-imports\/([^/]+)\/discard$/, handle: (world, [id]) => discardImport(world, decodeURIComponent(id ?? "")) },
];
