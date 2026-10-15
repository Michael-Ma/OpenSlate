import type {
  ControlInput,
  ControlReceipt,
  FrameViewInput,
  FrameViewReceipt,
  GenerationOverview,
  KeyframeSlot,
  MediaSlot,
  PriceQuote,
  ReleaseAttemptInput,
  ReleaseAttemptReceipt,
  SceneBlocker,
  SceneOverview,
  ShotNarration,
  ShotOverview,
  StudioArtifactRef,
} from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import { estimateNarrationSeconds, narrationPace } from "../model/checks.ts";
import type { GenerateBody, SceneGenerationRead, StoryboardEdit } from "../model/commands.ts";
import type { ProjectSnapshot } from "../model/types.ts";
import type { FixtureWorld } from "./fixture-port.ts";
import { artifactFor } from "./last-ferry.ts";

/**
 * Simulated commands for the fixture film: frame views, scene generation reads and presses,
 * storyboard edits with single-step undo, Stop / Continue and giving up on a job.
 * Nothing is generated, charged or saved. Every change goes through `recompute`, so blockers,
 * counts, targets and quotes always agree with the shots.
 */

/** Per-unit estimates in micro-dollars, as a host would configure them. */
export const FIXTURE_PRICES = { keyframe: 40000, clip: 500000 } as const;
/** Simulated provider time. */
export const FIXTURE_TIMING = { keyframeMs: 3000, clipMs: 2000 } as const;

const DIGEST = "f".repeat(64);
const isWorking = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";
const quote = (units: number, unit: number): PriceQuote => ({ micros: String(units * unit), units, unitMicros: String(unit), priceUnknown: false });

// ---- recompute ---------------------------------------------------------------------

function narrationFits(narration: ShotNarration, durationFrames: number, fps: number): ShotNarration {
  if (narration.state === "none" || !narration.text.trim()) return { ...narration, fits: true };
  const length = narration.measuredSeconds ?? narration.estimatedSeconds;
  const fits = length === undefined ? null : length <= durationFrames / fps + 1e-9;
  return { ...narration, fits };
}

function sceneState(scene: SceneOverview, shots: ShotOverview[]): SceneOverview["state"] {
  const ready = shots.filter((shot) => shot.keyframe.state === "ready").length;
  if (scene.confirmation?.state === "running" || shots.some((shot) => isWorking(shot.video))) return "making_video";
  if (shots.length && shots.every((shot) => shot.keyframe.state === "ready" && shot.video.state === "ready")) return "video_saved";
  const attention = shots.some((shot) => ["failed", "no_answer", "choose_take"].includes(shot.keyframe.state) || ["failed", "no_answer"].includes(shot.video.state));
  if (attention) return "needs_attention";
  if (ready === 0) return shots.some((shot) => isWorking(shot.keyframe)) ? "keyframes_partial" : "not_started";
  return ready < shots.length ? "keyframes_partial" : "keyframes_back";
}

function directorCovers(overview: GenerationOverview, scene: SceneOverview): boolean {
  const director = overview.director;
  if (director.state !== "working" && director.state !== "waiting_user") return false;
  return director.scopeIds.length === 0 || director.scopeIds.some((id) => id === scene.sceneId || scene.shotIds.includes(id));
}

function recomputeScene(overview: GenerationOverview, scene: SceneOverview): SceneOverview {
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const state = sceneState(scene, shots);
  const keyframesReady = shots.filter((shot) => shot.keyframe.state === "ready").length;
  const videoTargets = state === "making_video" || keyframesReady > 0 ? shots.filter((shot) => shot.video.state !== "ready").map((shot) => shot.shotId) : [];
  const keyframeTargets = shots
    .filter((shot) => shot.keyframe.state === "none" || shot.keyframe.state === "outdated" || (shot.keyframe.state === "failed" && shot.keyframe.failure?.retryAllowed !== false))
    .map((shot) => shot.shotId);
  const blockers: SceneBlocker[] = [];
  if (videoTargets.length) {
    const targets = videoTargets.map((id) => overview.shots[id]!);
    for (const shot of targets) {
      if (shot.keyframe.state !== "ready") blockers.push({ code: "keyframe_missing", shotId: shot.shotId });
      else if (!shot.keyframe.opened) blockers.push({ code: "frame_not_opened", shotId: shot.shotId });
    }
    for (const shot of targets) {
      if (shot.narration.fits === false && !shot.narration.fit) blockers.push({ code: "narration_too_long", shotId: shot.shotId });
      if (shot.narration.state === "making") blockers.push({ code: "narration_making", shotId: shot.shotId });
    }
    if (shots.some((shot) => shot.keyframe.state === "no_answer" || shot.video.state === "no_answer")) blockers.push({ code: "no_answer_in_scene" });
    if (overview.stopped) blockers.push({ code: "stopped" });
    if (directorCovers(overview, scene)) blockers.push({ code: "director_working" });
    if (state === "making_video") blockers.push({ code: "confirmation_running" });
  } else if (keyframeTargets.length) {
    if (overview.stopped) blockers.push({ code: "stopped" });
    if (directorCovers(overview, scene)) blockers.push({ code: "director_working" });
  }
  return {
    ...scene,
    state,
    counts: {
      shots: shots.length,
      keyframesReady,
      opened: shots.filter((shot) => shot.keyframe.state === "ready" && shot.keyframe.opened).length,
      videosReady: shots.filter((shot) => shot.video.state === "ready").length,
    },
    videoTargets,
    keyframeTargets,
    quotes: {
      regenerateKeyframe: quote(1, FIXTURE_PRICES.keyframe),
      ...(videoTargets.length && state !== "making_video" ? { confirmVideo: quote(videoTargets.length, FIXTURE_PRICES.clip) } : {}),
      ...(keyframeTargets.length ? { makeKeyframes: quote(keyframeTargets.length, FIXTURE_PRICES.keyframe) } : {}),
    },
    blockers,
    confirmationDigest: videoTargets.length ? DIGEST : null,
  };
}

/**
 * Pure. Derives every roll-up (narration fit, scene state, counts, targets, quotes, blockers) from the shots,
 * the stop state and the Director's activity, the way the server's overview read does.
 */
export function recompute(overview: GenerationOverview): GenerationOverview {
  const shots: Record<string, ShotOverview> = {};
  for (const [id, shot] of Object.entries(overview.shots)) {
    const keyframe: KeyframeSlot = shot.keyframe.state === "ready" ? shot.keyframe : { ...shot.keyframe, opened: false };
    shots[id] = { ...shot, keyframe, narration: narrationFits(shot.narration, shot.durationFrames, overview.fps) };
  }
  const withShots = { ...overview, shots };
  return { ...withShots, scenes: overview.scenes.map((scene) => recomputeScene(withShots, scene)) };
}

// ---- world helpers -----------------------------------------------------------------

interface UndoEntry {
  commandId: string;
  shotId: string;
  fields: (keyof ShotOverview)[];
  before: ShotOverview;
  beforeSnapshotShot: ProjectSnapshot["project"]["shots"][number] | undefined;
}

interface Extra {
  serial: number;
  undo: UndoEntry | null;
  takes: Record<string, number>;
}

const extras = new WeakMap<FixtureWorld, Extra>();
function extra(world: FixtureWorld): Extra {
  let value = extras.get(world);
  if (!value) { value = { serial: 0, undo: null, takes: {} }; extras.set(world, value); }
  return value;
}
const nextId = (world: FixtureWorld, prefix: string) => `${prefix}-${++extra(world).serial}`;
const now = () => new Date().toISOString();

function hexDigest(text: string): string {
  let out = "";
  for (const char of text) out += char.charCodeAt(0).toString(16);
  return out.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
}

/** The picture a new take shows: 2.2's remake has the red coat the Director asked for; other shots reuse theirs. */
function takeArtifact(label: string, take: number): StudioArtifactRef {
  const key = label === "2.2" && take >= 2 ? "2.2-red" : label;
  const base = artifactFor(key);
  return take <= 1 ? base : { ...base, sha256: hexDigest(`${key}#${take}`) };
}

const clipArtifact = (label: string, take: number): StudioArtifactRef => ({ artifactId: `art-${label}-clip`, sha256: hexDigest(`${label}-clip#${take}`), kind: "video" });

function commit(world: FixtureWorld, change: (overview: GenerationOverview, snapshot: ProjectSnapshot) => { overview: GenerationOverview; snapshot?: ProjectSnapshot }): void {
  world.update((w) => {
    const next = change(w.overview, w.snapshot);
    w.overview = recompute(next.overview);
    if (next.snapshot) w.snapshot = next.snapshot;
  });
}

const withShot = (overview: GenerationOverview, shotId: string, change: (shot: ShotOverview) => ShotOverview): GenerationOverview => {
  const shot = overview.shots[shotId];
  return shot ? { ...overview, shots: { ...overview.shots, [shotId]: change(shot) } } : overview;
};

const withScene = (overview: GenerationOverview, sceneId: string, change: (scene: SceneOverview) => SceneOverview): GenerationOverview =>
  ({ ...overview, scenes: overview.scenes.map((scene) => (scene.sceneId === sceneId ? change(scene) : scene)) });

function findScene(world: FixtureWorld, sceneId: string): SceneOverview {
  const scene = world.overview.scenes.find((s) => s.sceneId === sceneId);
  if (!scene) throw new ApiError("NOT_FOUND", 404);
  return scene;
}

function findShot(world: FixtureWorld, shotId: string): ShotOverview {
  const shot = world.overview.shots[shotId];
  if (!shot) throw new ApiError("NOT_FOUND", 404);
  return shot;
}

/** A finished clip that a change makes out of date keeps its picture as the previous take. */
const outdateClip = (video: MediaSlot, field: string): MediaSlot =>
  video.state === "ready" && video.artifact ? { state: "outdated", previous: video.artifact, takeCount: video.takeCount, outdatedFields: [field] } : video;

// ---- reads and presses -----------------------------------------------------------------

function sceneRead(world: FixtureWorld, sceneId: string): SceneGenerationRead {
  const scene = findScene(world, sceneId);
  return {
    headVersion: world.snapshot.project.headVersion,
    revisionId: world.overview.revisionId,
    reviewedHoldDigest: "fixture-holds",
    reviewedControlAuthorityId: world.overview.controlAuthorityId,
    currentRequestId: null,
    rows: scene.shotIds.map((id) => {
      const shot = world.overview.shots[id]!;
      const ready = shot.keyframe.state === "ready" && shot.keyframe.artifact;
      return {
        shotId: id,
        image: ready ? { artifactId: shot.keyframe.artifact!.artifactId, sha256: shot.keyframe.artifact!.sha256 } : null,
        imageComplete: !!ready,
        videoComplete: shot.video.state === "ready",
      };
    }),
  };
}

function frameView(world: FixtureWorld, shotId: string, body: FrameViewInput): FrameViewReceipt {
  const shot = findShot(world, shotId);
  const artifact = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
  if (!artifact || artifact.artifactId !== body?.artifactId || artifact.sha256 !== body?.sha256) throw new ApiError("FRAME_STALE", 409);
  if (!shot.keyframe.opened) commit(world, (overview) => ({ overview: withShot(overview, shotId, (s) => ({ ...s, keyframe: { ...s.keyframe, opened: true } })) }));
  return { shotId, artifactId: artifact.artifactId, sha256: artifact.sha256, at: now() };
}

type GenerateInput = GenerateBody & { expectedEstimateMicros?: string };

function assertFresh(world: FixtureWorld, body: GenerateInput): void {
  if (body?.headVersion !== world.snapshot.project.headVersion || body.revisionId !== world.overview.revisionId) throw new ApiError("SCENE_REVIEW_STALE", 409);
  if (world.overview.stopped) throw new ApiError("EXECUTION_PAUSED", 409);
}

function assertEstimate(body: GenerateInput, units: number, unit: number): void {
  if (body.expectedEstimateMicros !== undefined && body.expectedEstimateMicros !== String(units * unit)) throw new ApiError("ESTIMATE_CHANGED", 409);
}

function generate(world: FixtureWorld, sceneId: string, body: GenerateInput): { accepted: true; targetShotIds: string[] } {
  const scene = findScene(world, sceneId);
  assertFresh(world, body);
  return body.kind === "video" ? generateVideo(world, scene, body) : generateKeyframes(world, scene, body);
}

function generateKeyframes(world: FixtureWorld, scene: SceneOverview, body: GenerateInput): { accepted: true; targetShotIds: string[] } {
  if (body.regenerate && !body.targetShotIds?.length) throw new ApiError("VALIDATION_ERROR", 400);
  if (body.targetShotIds?.some((id) => !scene.shotIds.includes(id))) throw new ApiError("SCOPE_DENIED", 403);
  const candidates = body.targetShotIds ?? scene.shotIds;
  const targets = candidates.filter((id) => body.regenerate || world.overview.shots[id]!.keyframe.state !== "ready");
  if (!targets.length) throw new ApiError("ALREADY_COMPLETE", 409);
  if (targets.some((id) => { const shot = world.overview.shots[id]!; return isWorking(shot.keyframe) || isWorking(shot.video) || shot.keyframe.state === "no_answer"; }))
    throw new ApiError("ATTEMPT_EXISTS", 409);
  assertEstimate(body, targets.length, FIXTURE_PRICES.keyframe);
  extra(world).undo = null;
  const started = now();
  const attempts: Record<string, string> = {};
  for (const id of targets) attempts[id] = nextId(world, "attempt");
  commit(world, (overview) => {
    let next = overview;
    for (const id of targets)
      next = withShot(next, id, (shot) => {
        const previous = shot.keyframe.state === "ready" ? shot.keyframe.artifact : shot.keyframe.previous;
        return {
          ...shot,
          keyframe: { state: "running", phase: "running", startedAt: started, attemptId: attempts[id]!, takeCount: shot.keyframe.takeCount, opened: false, ...(previous ? { previous } : {}) },
          video: outdateClip(shot.video, "keyframe"),
        };
      });
    return { overview: next };
  });
  world.later(FIXTURE_TIMING.keyframeMs, (w) => {
    let next = w.overview;
    for (const id of targets)
      next = withShot(next, id, (shot) => {
        if (shot.keyframe.state !== "running" || shot.keyframe.attemptId !== attempts[id]) return shot;
        const take = shot.keyframe.takeCount + 1;
        return { ...shot, keyframe: { state: "ready", artifact: takeArtifact(shot.label, take), takeCount: take, opened: false } };
      });
    w.overview = recompute(next);
  });
  return { accepted: true, targetShotIds: targets };
}

function generateVideo(world: FixtureWorld, scene: SceneOverview, body: GenerateInput): { accepted: true; targetShotIds: string[] } {
  if (body.targetShotIds !== undefined || body.regenerate !== undefined) throw new ApiError("VALIDATION_ERROR", 400);
  const targets = scene.shotIds.filter((id) => world.overview.shots[id]!.video.state !== "ready");
  if (!targets.length) throw new ApiError("ALREADY_COMPLETE", 409);
  if (scene.state === "making_video") throw new ApiError("ATTEMPT_EXISTS", 409);
  for (const id of targets) {
    const shot = world.overview.shots[id]!;
    const reviewed = body.reviewedFrames?.find((frame) => frame.shotId === id);
    const artifact = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
    if (!reviewed || !artifact || reviewed.artifactId !== artifact.artifactId || reviewed.sha256 !== artifact.sha256) throw new ApiError("SCENE_REVIEW_STALE", 409);
  }
  const blocker = scene.blockers[0];
  if (blocker) throw new ApiError(blocker.code === "narration_too_long" ? "NARRATION_TOO_LONG" : "SCENE_NOT_READY", 409, { blocker: blocker.code });
  assertEstimate(body, targets.length, FIXTURE_PRICES.clip);
  extra(world).undo = null;
  const confirmationId = nextId(world, "confirmation");
  const since = now();
  commit(world, (overview) => {
    let next = withScene(overview, scene.sceneId, (s) => ({ ...s, confirmation: { confirmationId, state: "running", currentShotId: targets[0]!, currentStep: "video" } }));
    targets.forEach((id, index) => {
      next = withShot(next, id, (shot) => ({ ...shot, video: { state: "queued", takeCount: shot.video.takeCount, waiting: { code: "capacity", ahead: index, since }, ...(shot.video.previous ? { previous: shot.video.previous } : {}) } }));
    });
    return { overview: startNextClip(next, scene.sceneId, world) };
  });
  scheduleClip(world, scene.sceneId, confirmationId);
  return { accepted: true, targetShotIds: targets };
}

/** Send the first queued clip of the scene, unless the film is stopped. */
function startNextClip(overview: GenerationOverview, sceneId: string, world: FixtureWorld): GenerationOverview {
  if (overview.stopped) return overview;
  const scene = overview.scenes.find((s) => s.sceneId === sceneId);
  const queued = scene?.shotIds.filter((id) => overview.shots[id]!.video.state === "queued") ?? [];
  const first = queued[0];
  if (!first) return overview;
  let next = withShot(overview, first, (shot) => {
    const { waiting: _sent, ...video } = shot.video;
    return { ...shot, video: { ...video, state: "running", phase: "running", startedAt: now(), attemptId: nextId(world, "attempt") } };
  });
  queued.slice(1).forEach((id, index) => {
    next = withShot(next, id, (shot) => ({ ...shot, video: { ...shot.video, waiting: { code: "capacity", ahead: index, since: shot.video.waiting?.since ?? now() } } }));
  });
  return withScene(next, sceneId, (s) => (s.confirmation ? { ...s, confirmation: { ...s.confirmation, currentShotId: first } } : s));
}

/** One provider tick: the running clip lands, the next queued one is sent; the confirmation ends when none are left. */
function scheduleClip(world: FixtureWorld, sceneId: string, confirmationId: string): void {
  world.later(FIXTURE_TIMING.clipMs, (w) => {
    const scene = w.overview.scenes.find((s) => s.sceneId === sceneId);
    if (!scene || scene.confirmation?.confirmationId !== confirmationId) return;
    let next = w.overview;
    for (const id of scene.shotIds) {
      const shot = next.shots[id]!;
      if (shot.video.state !== "running") continue;
      const take = shot.video.takeCount + 1;
      next = withShot(next, id, (s) => ({ ...s, video: { state: "ready", artifact: clipArtifact(s.label, take), takeCount: take } }));
    }
    next = startNextClip(next, sceneId, world);
    const still = scene.shotIds.some((id) => isWorking(next.shots[id]!.video));
    if (!still) next = withScene(next, sceneId, (s) => (s.confirmation ? { ...s, confirmation: { confirmationId, state: next.stopped ? "cancelled" : "done" } } : s));
    w.overview = recompute(next);
    if (still) scheduleClip(w, sceneId, confirmationId);
  });
}

// ---- storyboard ------------------------------------------------------------------------

type StoryboardBody = StoryboardEdit & { expectedHeadVersion?: number };

const FIELDS_BY_EDIT: Record<string, (keyof ShotOverview)[]> = {
  desiredFrames: ["durationFrames", "video"],
  imagePrompt: ["imagePrompt", "keyframe", "video"],
  motion: ["motion", "video"],
  framing: ["framing"],
  purpose: ["purpose"],
  videoPrompt: ["video"],
  narration: ["narration"],
};

function bumpRevision(snapshot: ProjectSnapshot, overview: GenerationOverview, world: FixtureWorld): { snapshot: ProjectSnapshot; overview: GenerationOverview } {
  const revisionId = nextId(world, "rev");
  const headVersion = snapshot.project.headVersion + 1;
  return {
    snapshot: { ...snapshot, project: { ...snapshot.project, headVersion, revisionId } },
    overview: { ...overview, headVersion, revisionId },
  };
}

function editShot(shot: ShotOverview, edit: Extract<StoryboardEdit, { kind: "shot" }>, fps: number): ShotOverview {
  switch (edit.field) {
    case "desiredFrames": {
      const frames = Number(edit.value);
      if (!Number.isInteger(frames) || frames < 3 * fps || frames > 15 * fps) throw new ApiError("VALIDATION_ERROR", 400);
      return frames === shot.durationFrames ? shot : { ...shot, durationFrames: frames, video: outdateClip(shot.video, "desiredFrames") };
    }
    case "imagePrompt": {
      const prompt = edit.value.trim();
      if (!prompt) throw new ApiError("VALIDATION_ERROR", 400);
      if (prompt === shot.imagePrompt) return shot;
      const keyframe: KeyframeSlot = shot.keyframe.state === "ready" && shot.keyframe.artifact
        ? { state: "outdated", previous: shot.keyframe.artifact, takeCount: shot.keyframe.takeCount, opened: false, outdatedFields: ["imagePrompt"] }
        : shot.keyframe;
      return { ...shot, imagePrompt: prompt, keyframe, video: outdateClip(shot.video, "imagePrompt") };
    }
    case "motion": {
      const motion = edit.value.trim();
      if (!motion) throw new ApiError("VALIDATION_ERROR", 400);
      return motion === shot.motion ? shot : { ...shot, motion, video: outdateClip(shot.video, "motion") };
    }
    case "videoPrompt": return { ...shot, video: outdateClip(shot.video, "videoPrompt") };
    case "framing": return { ...shot, framing: edit.value.trim() || shot.framing };
    case "purpose": return { ...shot, purpose: edit.value.trim() || shot.purpose };
  }
}

function editNarration(shot: ShotOverview, text: string): ShotOverview {
  const line = text.trim();
  if (line === shot.narration.text) return shot;
  if (!line) return { ...shot, narration: { state: "none", text: "", fits: true } };
  // No voice exists for the new words yet; the length is an estimate at the old line's pace (labelled as such).
  const pace = narrationPace(shot.narration);
  return { ...shot, narration: { state: "text_only", text: line, estimatedSeconds: estimateNarrationSeconds(line, pace.secondsPerUnit), fits: null } };
}

function snapshotShot(snapshot: ProjectSnapshot, shot: ShotOverview, edit: StoryboardEdit): ProjectSnapshot {
  return {
    ...snapshot,
    project: {
      ...snapshot.project,
      shots: snapshot.project.shots.map((row) => {
        if (row.id !== shot.shotId) return row;
        if (edit.kind === "narration") {
          const { narration: _old, ...rest } = row;
          return shot.narration.state === "none" ? rest : { ...rest, narration: { mode: row.narration?.mode ?? "generated", voice: row.narration?.voice ?? "stock", text: shot.narration.text } };
        }
        return { ...row, imagePrompt: shot.imagePrompt, motion: shot.motion, desiredFrames: shot.durationFrames, framing: shot.framing, purpose: shot.purpose };
      }),
    },
  };
}

function storyboard(world: FixtureWorld, body: StoryboardBody): { commandId: string } {
  if (!body || typeof body !== "object") throw new ApiError("VALIDATION_ERROR", 400);
  if (body.expectedHeadVersion !== undefined && body.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
  const state = extra(world);
  const commandId = nextId(world, "command");
  if (body.kind === "undo") {
    const entry = state.undo;
    if (!entry || entry.commandId !== body.commandId) throw new ApiError("UNDO_UNAVAILABLE", 409);
    state.undo = null;
    commit(world, (overview, snapshot) => {
      const restored = withShot(overview, entry.shotId, (shot) => {
        const back: ShotOverview = { ...shot };
        for (const field of entry.fields) (back as unknown as Record<string, unknown>)[field] = entry.before[field];
        return back;
      });
      const shots = snapshot.project.shots.map((row) => (row.id === entry.shotId && entry.beforeSnapshotShot ? entry.beforeSnapshotShot : row));
      return bumpRevision({ ...snapshot, project: { ...snapshot.project, shots } }, restored, world);
    });
    return { commandId };
  }
  const shot = findShot(world, body.id);
  if (isWorking(shot.video) && body.kind === "shot") throw new ApiError("ATTEMPT_EXISTS", 409);
  const edited = body.kind === "narration" ? (body.field === "text" ? editNarration(shot, body.value) : shot) : editShot(shot, body, world.overview.fps);
  state.undo = {
    commandId,
    shotId: shot.shotId,
    fields: FIELDS_BY_EDIT[body.kind === "narration" ? "narration" : body.field] ?? [],
    before: shot,
    beforeSnapshotShot: world.snapshot.project.shots.find((row) => row.id === shot.shotId),
  };
  commit(world, (overview, snapshot) => bumpRevision(snapshotShot(snapshot, edited, body), withShot(overview, shot.shotId, () => edited), world));
  return { commandId };
}

// ---- controls and give-up -----------------------------------------------------------------

function control(world: FixtureWorld, body: ControlInput): ControlReceipt {
  if (body?.action === "stop") {
    if (world.overview.stopped) return { action: "stop", stopped: world.overview.stopped };
    let sentJobs = 0;
    let detachedJobs = 0;
    commit(world, (overview, snapshot) => {
      const shots: Record<string, ShotOverview> = {};
      for (const [id, shot] of Object.entries(overview.shots)) {
        const detach = <T extends MediaSlot>(slot: T): T => {
          if (slot.state === "running") sentJobs++;
          if (slot.state !== "queued") return slot;
          detachedJobs++;
          const { waiting: _held, ...rest } = slot;
          return { ...rest, state: "none" } as T;
        };
        shots[id] = { ...shot, keyframe: detach(shot.keyframe), video: detach(shot.video) };
      }
      const stopped = { stopId: nextId(world, "stop"), at: now(), sentJobs, detachedJobs };
      return {
        overview: { ...overview, shots, stopped, controlAuthorityId: nextId(world, "authority") },
        snapshot: { ...snapshot, control: { paused: true } },
      };
    });
    return { action: "stop", stopped: world.overview.stopped };
  }
  if (body?.action === "resume") {
    if (!world.overview.stopped) return { action: "resume", stopped: null };
    if (body.expectedAuthorityId !== world.overview.controlAuthorityId) throw new ApiError("CONTROL_STALE", 409);
    commit(world, (overview, snapshot) => ({ overview: { ...overview, stopped: null, controlAuthorityId: null }, snapshot: { ...snapshot, control: { paused: false } } }));
    return { action: "resume", stopped: null };
  }
  throw new ApiError("VALIDATION_ERROR", 400);
}

function release(world: FixtureWorld, attemptId: string, body: ReleaseAttemptInput): ReleaseAttemptReceipt {
  if (body?.acknowledgeDoubleCharge !== true) throw new ApiError("DOUBLE_CHARGE_NOT_ACKNOWLEDGED", 400);
  if (body.expectedPhase !== "submission_unknown") throw new ApiError("VALIDATION_ERROR", 400);
  const entry = Object.values(world.overview.shots).flatMap((shot) => (["keyframe", "video"] as const).map((slot) => ({ shot, slot })))
    .find(({ shot, slot }) => shot[slot].state === "no_answer" && shot[slot].attemptId === attemptId);
  if (!entry) throw new ApiError("ATTEMPT_NOT_RELEASABLE", 409);
  commit(world, (overview) => ({
    overview: withShot(overview, entry.shot.shotId, (shot) => {
      const slot = shot[entry.slot];
      const released: MediaSlot = { state: "none", takeCount: slot.takeCount, releasedAttemptIds: [...(slot.releasedAttemptIds ?? []), attemptId], ...(slot.previous ? { previous: slot.previous } : {}) };
      return entry.slot === "keyframe" ? { ...shot, keyframe: { ...released, opened: false } } : { ...shot, video: released };
    }),
  }));
  return { attemptId, shotId: entry.shot.shotId, releasedAt: now() };
}

// ---- routing ---------------------------------------------------------------------------

export function fixtureCommand(world: FixtureWorld, method: "GET" | "POST", path: string, body: unknown): unknown {
  const match = (pattern: RegExp) => { const m = path.match(pattern); return m ? decodeURIComponent(m[1]!) : null; };
  let id: string | null;
  if (method === "GET") {
    if ((id = match(/^\/scenes\/([^/]+)\/generation$/))) return sceneRead(world, id);
  } else {
    if ((id = match(/^\/shots\/([^/]+)\/frame-views$/))) return frameView(world, id, body as FrameViewInput);
    if ((id = match(/^\/scenes\/([^/]+)\/generate$/))) return generate(world, id, body as GenerateInput);
    if (path === "/storyboard") return storyboard(world, body as StoryboardBody);
    if (path === "/controls") return control(world, body as ControlInput);
    if ((id = match(/^\/attempts\/([^/]+)\/release$/))) return release(world, id, body as ReleaseAttemptInput);
  }
  throw new ApiError("FIXTURE_UNSUPPORTED", 400, { path });
}
