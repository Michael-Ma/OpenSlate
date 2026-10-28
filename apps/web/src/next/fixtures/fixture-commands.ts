import type {
  AcceptProposalInput,
  ConfirmSceneInput,
  ControlInput,
  DirectorNote,
  DirectorProposal,
  ControlReceipt,
  FrameViewInput,
  FrameViewReceipt,
  GenerationOverview,
  KeyframeSlot,
  MediaSlot,
  NarrationFitInput,
  NarrationFitReceipt,
  NoteChoice,
  PriceQuote,
  DirectorGenerationBlock,
  ProposalReceipt,
  ReleaseAttemptInput,
  ReleaseAttemptReceipt,
  ResolveNoteInput,
  SceneBlocker,
  SceneConfirmationView,
  SceneOverview,
  ShotNarration,
  ShotOverview,
  ShotTakes,
  StudioArtifactRef,
  UseTakeReceipt,
} from "@openslate/core/public";
import { joinPromptParts } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import { estimateNarrationSeconds, narrationPace } from "../model/checks.ts";
import type { GenerateBody, SceneGenerationRead, StoryboardEdit } from "../model/commands.ts";
import { isWorking as mediaWorking, shotHasNoAnswer, unresolvedQueue } from "../model/keyframes.ts";
import { pendingAutomaticRetry } from "../model/media-state.ts";
import type { ProjectSnapshot } from "../model/types.ts";
import type { FixtureWorld } from "./fixture-port.ts";
import { artifactFor } from "./last-ferry.ts";
import { fixtureFitSeconds, fixtureNarrationFitFrames } from "./narration-fit.ts";

/**
 * Simulated commands for the fixture film: frame views, scene generation reads and presses, the
 * durable scene confirm, narration fit, storyboard edits with single-step undo, Stop / Continue,
 * giving up on a job, and the Director's notes and held proposals (resolve, accept, reject, undo).
 * Nothing is generated, charged or saved. Every change goes through `recompute`, so blockers,
 * counts, targets and quotes always agree with the shots.
 */

/** Per-unit estimates in micro-dollars, as a host would configure them. */
export const FIXTURE_PRICES = { keyframe: 40000, clip: 500000, voice: 10000 } as const;
/** Simulated provider time; a scene confirm spends `voiceStepMs` on each voice step (make, save, fit) before its clips. */
export const FIXTURE_TIMING = { keyframeMs: 3000, clipMs: 2000, voiceStepMs: 900 } as const;
/**
 * A made voice line runs this much longer than its estimate (the estimate counts words; a voice adds pauses), so a
 * line estimated just under its shot's length comes back too long and stops the confirm at the fit step, as the
 * studio does (NARRATION_CUE_OUT_OF_RANGE).
 */
export const FIXTURE_VOICE_STRETCH = 1.1;

const DIGEST = "f".repeat(64);
const isWorking = (slot: MediaSlot) => slot.state === "running" || slot.state === "queued";
const quote = (units: number, unit: number): PriceQuote => ({ micros: String(units * unit), units, unitMicros: units ? String(unit) : "0", priceUnknown: false });
const generationQuote = (keyframes: number, voices: number, clips = 0): PriceQuote => {
  const units = keyframes + voices + clips;
  const micros = keyframes * FIXTURE_PRICES.keyframe + voices * FIXTURE_PRICES.voice + clips * FIXTURE_PRICES.clip;
  const kinds = [keyframes, voices, clips].filter((count) => count > 0).length;
  return { micros: String(micros), units, unitMicros: units && kinds === 1 ? String(micros / units) : "0", priceUnknown: false };
};

/** Missing generated lines only: choosing a recording or leaving the mode undecided never buys speech. */
function needsVoice(shot: ShotOverview, projectShots?: ProjectSnapshot["project"]["shots"]): boolean {
  const mode = projectShots ? projectShots.find((row) => row.id === shot.shotId)?.narration?.mode : "generated";
  return mode === "generated" && !!shot.narration.text.trim() && ["text_only", "failed"].includes(shot.narration.state);
}

// ---- recompute ---------------------------------------------------------------------

function narrationFits(narration: ShotNarration, durationFrames: number, fps: number): ShotNarration {
  const { fitSeconds: _fitSeconds, ...line } = narration;
  if (narration.state === "none" || !narration.text.trim()) return { ...line, fits: true };
  const length = narration.measuredSeconds ?? narration.estimatedSeconds;
  const fits = length === undefined ? null : length <= durationFrames / fps + 1e-9;
  const fitSeconds = fixtureFitSeconds(durationFrames, narration.measuredSeconds, fps);
  return { ...line, fits, ...(fitSeconds !== undefined ? { fitSeconds } : {}) };
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

/** Open blocking Director notes anchored to this scene (DC-9): each gates the scene's video confirm. */
function blockingNotes(notes: readonly DirectorNote[], scene: SceneOverview): DirectorNote[] {
  return notes.filter((note) => note.state === "open" && note.blocking
    && (note.anchor.sceneId === scene.sceneId || (note.anchor.shotIds ?? []).some((id) => scene.shotIds.includes(id))));
}

function recomputeScene(overview: GenerationOverview, scene: SceneOverview, notes: readonly DirectorNote[], projectShots?: ProjectSnapshot["project"]["shots"]): SceneOverview {
  const shots = scene.shotIds.map((id) => overview.shots[id]).filter((shot): shot is ShotOverview => !!shot);
  const state = sceneState(scene, shots);
  const keyframesReady = shots.filter((shot) => shot.keyframe.state === "ready").length;
  const videoTargets = state === "making_video" || keyframesReady > 0 ? shots.filter((shot) => shot.video.state !== "ready").map((shot) => shot.shotId) : [];
  const keyframeTargets = shots
    // Every incomplete keyframe, as the server's generationTargets: a refused one is made again by the next press.
    .filter((shot) => shot.keyframe.state === "none" || shot.keyframe.state === "outdated" || shot.keyframe.state === "failed" || needsVoice(shot, projectShots))
    .map((shot) => shot.shotId);
  // As the server: any unanswered keyframe, clip, voice line or new take blocks the scene, whatever it targets.
  const unanswered: SceneBlocker[] = shots
    .filter((shot) => [shot.keyframe.state, shot.video.state, shot.narration.state, shot.keyframe.replacement?.state, shot.video.replacement?.state].includes("no_answer"))
    .map((shot) => ({ code: "no_answer_in_scene", shotId: shot.shotId }));
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
    for (const note of blockingNotes(notes, scene)) {
      const shotId = note.anchor.shotIds?.[0];
      blockers.push({ code: "recommendation_open", ...(shotId ? { shotId } : {}) });
    }
    blockers.push(...unanswered);
    if (overview.stopped) blockers.push({ code: "stopped" });
    if (directorCovers(overview, scene)) blockers.push({ code: "director_working" });
  } else {
    blockers.push(...unanswered);
    if (keyframeTargets.length && overview.stopped) blockers.push({ code: "stopped" });
    if (keyframeTargets.length && directorCovers(overview, scene)) blockers.push({ code: "director_working" });
  }
  if (state === "making_video" || scene.keyframesRun?.state === "running") blockers.push({ code: "confirmation_running" });
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
      confirmVideo: generationQuote(0, videoTargets.filter((id) => needsVoice(overview.shots[id]!, projectShots)).length, videoTargets.length),
      voice: quote(shots.filter((shot) => needsVoice(shot, projectShots)).length, FIXTURE_PRICES.voice),
      oneClip: quote(1, FIXTURE_PRICES.clip),
      oneVoice: quote(1, FIXTURE_PRICES.voice),
      ...(keyframeTargets.length ? { makeKeyframes: generationQuote(keyframeTargets.filter((id) => overview.shots[id]!.keyframe.state !== "ready").length, keyframeTargets.filter((id) => needsVoice(overview.shots[id]!, projectShots)).length) } : {}),
    },
    blockers,
    confirmationDigest: videoTargets.length ? DIGEST : null,
  };
}

/**
 * Pure. Derives every roll-up (narration fit, scene state, counts, targets, quotes, blockers) from the shots,
 * the stop state, the Director's activity and its open blocking notes, the way the server's overview read does.
 */
export function recompute(overview: GenerationOverview, notes: readonly DirectorNote[] = [], projectShots?: ProjectSnapshot["project"]["shots"]): GenerationOverview {
  const shots: Record<string, ShotOverview> = {};
  for (const [id, shot] of Object.entries(overview.shots)) {
    const keyframe: KeyframeSlot = shot.keyframe.state === "ready" ? shot.keyframe : { ...shot.keyframe, opened: false };
    shots[id] = { ...shot, keyframe, narration: narrationFits(shot.narration, shot.durationFrames, overview.fps), quotes: { ...shot.quotes, regenerateKeyframe: generationQuote(1, needsVoice(shot, projectShots) ? 1 : 0) } };
  }
  const withShots = { ...overview, shots };
  return { ...withShots, scenes: overview.scenes.map((scene) => recomputeScene(withShots, scene, notes, projectShots)) };
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
  /** Every keyframe the person opened, as "artifactId:sha256": a take used again is opened if it was before. */
  opened: Set<string>;
  /** When each keyframe take was made, by "artifactId:sha256" (takes made before this tab are sample times). */
  madeAt: Record<string, string>;
  /** Keyframe presses by request id, so a note's regenerate choice can be linked to the press that did it. */
  requests: Record<string, { regenerate: boolean; shotIds: string[] }>;
  /** Storyboard edits by command id, so a note's edit choice can be linked to the edit that did it. */
  edits: Record<string, { shotId: string; field: string }>;
  /** What an accepted proposal changed, for its undo. */
  accepted: Record<string, { shotId: string; before: ShotOverview; after: number }>;
  /** Which voice run owns a shot's transient making marker. Later runs replace this ownership. */
  voiceOwners: Record<string, string>;
  /** Shots whose next keyframe the service refuses (the `jobs` Director preset), not charged. */
  failNext: Set<string>;
  /** Shots whose next voice line the service refuses (the `voices` Director preset), not charged. */
  failNextVoice: Set<string>;
}

const extras = new WeakMap<FixtureWorld, Extra>();
function extra(world: FixtureWorld): Extra {
  let value = extras.get(world);
  if (!value) { value = { serial: 0, undo: null, takes: {}, opened: new Set(), madeAt: {}, requests: {}, edits: {}, accepted: {}, voiceOwners: {}, failNext: new Set(), failNextVoice: new Set() }; extras.set(world, value); }
  return value;
}
const nextId = (world: FixtureWorld, prefix: string) => `${prefix}-${++extra(world).serial}`;
const now = () => new Date().toISOString();

function hexDigest(text: string): string {
  let out = "";
  for (const char of text) out += char.charCodeAt(0).toString(16);
  return out.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
}

/**
 * The picture a new take shows: 2.2's remake has the red coat the Director asked for; other shots reuse theirs. Each
 * take is its own artifact, as in the studio: a picture's first take keeps its id, later ones get "~n" (same picture).
 */
function takeArtifact(label: string, take: number): StudioArtifactRef {
  const key = label === "2.2" && take >= 2 ? "2.2-red" : label;
  const base = artifactFor(key);
  if (take <= 1) return base;
  const first = key === "2.2-red" ? 2 : 1;
  return { ...base, artifactId: take === first ? base.artifactId : `${base.artifactId}~${take}`, sha256: hexDigest(`${key}#${take}`) };
}

const clipArtifact = (label: string, take: number): StudioArtifactRef => ({ artifactId: `art-${label}-clip`, sha256: hexDigest(`${label}-clip#${take}`), kind: "video" });

/**
 * Notes and proposals follow the shots: an open note whose seen keyframe was replaced goes stale, and so does a
 * held proposal whose shot no longer has the value it was written against.
 */
function staleNotes(notes: readonly DirectorNote[], overview: GenerationOverview): DirectorNote[] | null {
  let changed = false;
  const next = notes.map((note) => {
    const seen = note.seenKeyframe;
    const current = seen ? overview.shots[seen.shotId]?.keyframe : undefined;
    if (note.state !== "open" || !seen || current?.state !== "ready" || !current.artifact) return note;
    if (current.artifact.artifactId === seen.artifactId && current.artifact.sha256 === seen.sha256) return note;
    changed = true;
    return { ...note, state: "stale" as const };
  });
  return changed ? next : null;
}

/** Staleness is derived, as the server's rebase does on every read: a shot that changes back makes the proposal held again. */
function staleProposals(proposals: readonly DirectorProposal[], overview: GenerationOverview): DirectorProposal[] {
  return proposals.map((proposal) => {
    if (proposal.state !== "held" && !(proposal.state === "stale" && proposal.staleReason === "SHOT_CHANGED")) return proposal;
    const moved = proposal.preview.changes.some((change) => change.field === "desiredFrames" && change.shotId && String(overview.shots[change.shotId]?.durationFrames) !== change.before);
    if (moved) return { ...proposal, state: "stale", staleReason: "SHOT_CHANGED" };
    const { staleReason: _reason, ...held } = proposal;
    return { ...held, state: "held" };
  });
}

const takeKey = (artifact: Pick<StudioArtifactRef, "artifactId" | "sha256">) => `${artifact.artifactId}:${artifact.sha256}`;

/** Every change ends here: notes and proposals follow the shots, then the roll-ups are derived again. */
function settle(w: FixtureWorld, overview: GenerationOverview): void {
  // Remember every opened take, from before the change too (the sample film's opened frames were never pressed).
  const opened = extra(w).opened;
  for (const state of [w.overview, overview])
    for (const shot of Object.values(state.shots)) if (shot.keyframe.opened && shot.keyframe.artifact) opened.add(takeKey(shot.keyframe.artifact));
  const notes = staleNotes(w.snapshot.notes ?? [], overview);
  if (notes) w.snapshot = { ...w.snapshot, notes };
  w.proposals = staleProposals(w.proposals ?? [], overview);
  w.overview = recompute(overview, w.snapshot.notes ?? [], w.snapshot.project.shots);
}

function commit(world: FixtureWorld, change: (overview: GenerationOverview, snapshot: ProjectSnapshot) => { overview: GenerationOverview; snapshot?: ProjectSnapshot }): void {
  world.update((w) => {
    const next = change(w.overview, w.snapshot);
    if (next.snapshot) w.snapshot = next.snapshot;
    settle(w, next.overview);
  });
}

const withNote = (snapshot: ProjectSnapshot, noteId: string, change: (note: DirectorNote) => DirectorNote): ProjectSnapshot =>
  ({ ...snapshot, notes: (snapshot.notes ?? []).map((note) => (note.noteId === noteId ? change(note) : note)) });

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

function generate(world: FixtureWorld, sceneId: string, body: GenerateInput): GenerateReceipt {
  const scene = findScene(world, sceneId);
  assertFresh(world, body);
  return body.kind === "video" ? generateVideo(world, scene, body) : generateKeyframes(world, scene, body);
}

interface GenerateReceipt { accepted: true; requestId?: string; sceneId?: string; kind?: "image"; shotIds?: string[]; targetShotIds: string[] }

function generateKeyframes(world: FixtureWorld, scene: SceneOverview, body: GenerateInput): GenerateReceipt {
  if (scene.blockers.some((blocker) => blocker.code === "confirmation_running")) throw new ApiError("CONFIRMATION_RUNNING", 409);
  if (body.regenerate && !body.targetShotIds?.length) throw new ApiError("VALIDATION_ERROR", 400);
  if (body.targetShotIds?.some((id) => !scene.shotIds.includes(id))) throw new ApiError("SCOPE_DENIED", 403);
  const candidates = body.targetShotIds ?? scene.shotIds;
  const targets = candidates.filter((id) => body.regenerate || world.overview.shots[id]!.keyframe.state !== "ready" || needsVoice(world.overview.shots[id]!, world.snapshot.project.shots));
  const images = targets.filter((id) => body.regenerate || world.overview.shots[id]!.keyframe.state !== "ready");
  const voices = targets.filter((id) => needsVoice(world.overview.shots[id]!, world.snapshot.project.shots));
  if (!targets.length) throw new ApiError("ALREADY_COMPLETE", 409);
  if (targets.some((id) => {
    const shot = world.overview.shots[id]!;
    return mediaWorking(shot.keyframe) || mediaWorking(shot.video) || shotHasNoAnswer(shot)
      || pendingAutomaticRetry(shot.keyframe) || unresolvedQueue(shot.keyframe) || unresolvedQueue(shot.video, true);
  }))
    throw new ApiError("ATTEMPT_EXISTS", 409);
  if (body.expectedEstimateMicros !== undefined && body.expectedEstimateMicros !== generationQuote(images.length, voices.length).micros) throw new ApiError("ESTIMATE_CHANGED", 409);
  extra(world).undo = null;
  const started = now();
  const attempts: Record<string, string> = {};
  for (const id of images) attempts[id] = nextId(world, "attempt");
  commit(world, (overview) => {
    let next = overview;
    for (const id of images)
      next = withShot(next, id, (shot) => {
        // A new take of a keyframe that is back runs as its replacement: the current one stays in use, as in the studio.
        if (shot.keyframe.state === "ready")
          return { ...shot, keyframe: { ...shot.keyframe, replacement: { state: "running", phase: "running", attemptId: attempts[id]! } } };
        const previous = shot.keyframe.previous;
        return {
          ...shot,
          keyframe: { state: "running", phase: "running", startedAt: started, attemptId: attempts[id]!, takeCount: shot.keyframe.takeCount, opened: false, ...(previous ? { previous } : {}) },
          video: outdateClip(shot.video, "keyframe"),
        };
      });
    return { overview: next };
  });
  if (images.length) world.later(FIXTURE_TIMING.keyframeMs, (w) => {
    let next = w.overview;
    for (const id of images)
      next = withShot(next, id, (shot) => {
        const replacing = shot.keyframe.state === "ready" && shot.keyframe.replacement?.state === "running" && shot.keyframe.replacement.attemptId === attempts[id];
        if (!replacing && (shot.keyframe.state !== "running" || shot.keyframe.attemptId !== attempts[id])) return shot;
        const take = shot.keyframe.takeCount + 1;
        const artifact = takeArtifact(shot.label, take);
        const refused = extra(w).failNext.delete(id);
        if (replacing) {
          // A refused new take leaves the current keyframe and clip; a new one becomes current and outdates the clip.
          if (refused) return { ...shot, keyframe: { ...shot.keyframe, replacement: { state: "failed", attemptId: attempts[id]!,
            failure: { code: "PROVIDER_REFUSED", technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: now() } } } };
          extra(w).madeAt[takeKey(artifact)] = localTime(new Date());
          return { ...shot, keyframe: { state: "ready", artifact, takeCount: take, opened: false }, video: outdateClip(shot.video, "keyframe") };
        }
        if (refused) return { ...shot, keyframe: { state: "failed", takeCount: shot.keyframe.takeCount, opened: false,
          ...(shot.keyframe.previous ? { previous: shot.keyframe.previous } : {}),
          failure: { code: "PROVIDER_REFUSED", technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: now() } } };
        extra(w).madeAt[takeKey(artifact)] = localTime(new Date());
        return { ...shot, keyframe: { state: "ready", artifact, takeCount: take, opened: false } };
      });
    settle(w, next);
  });
  if (voices.length) startVoices(world, scene, [], voices, "keyframes");
  const requestId = nextId(world, "request");
  extra(world).requests[requestId] = { regenerate: !!body.regenerate, shotIds: targets };
  if (body.regenerate) settleNotesElsewhere(world, (choice) => choice.kind === "regenerate_keyframe" && choice.shotIds.every((id) => targets.includes(id)), requestId);
  return { accepted: true, requestId, sceneId: scene.sceneId, kind: "image", shotIds: targets, targetShotIds: targets };
}

/**
 * The scripted Director starting keyframes (and their voice lines) because the person asked in the conversation:
 * each scene that still has keyframes to make starts the way its Make keyframes press would. Scenes that cannot
 * start (working, stopped, nothing to make) are left out. Returns what started per scene, with its estimate: the
 * studio records one generation effect for each scene it started.
 */
export interface FixtureSceneStart { sceneIds: [string]; shotIds: string[]; keyframes: number; voiceLines: number; quote: PriceQuote }
export function fixtureDirectorKeyframes(world: FixtureWorld): { started: FixtureSceneStart[]; blocked: DirectorGenerationBlock[] } | null {
  if (world.overview.stopped) return null;
  const started: FixtureSceneStart[] = [];
  const blocked: DirectorGenerationBlock[] = [];
  for (const scene of [...world.overview.scenes].sort((a, b) => a.ordinal - b.ordinal)) {
    if (!scene.keyframeTargets.length) continue;
    const images = scene.keyframeTargets.filter((id) => world.overview.shots[id]!.keyframe.state !== "ready").length;
    const voices = scene.keyframeTargets.filter((id) => needsVoice(world.overview.shots[id]!, world.snapshot.project.shots)).length;
    try { generateKeyframes(world, scene, { kind: "image" } as GenerateInput); }
    catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // As the studio records a refused scene for the chat (DirectorGenerationBlock); nothing to make is not a refusal.
      if (error.code !== "ALREADY_COMPLETE") blocked.push(sceneBlock(world, scene, error.code));
      continue;
    }
    started.push({ sceneIds: [scene.sceneId], shotIds: [...scene.keyframeTargets], keyframes: images, voiceLines: voices, quote: generationQuote(images, voices) });
  }
  return started.length || blocked.length ? { started, blocked } : null;
}

/** The jobs in a refused scene's way: unanswered or running keyframes and clips, as the studio's recovery lists them. */
function sceneBlock(world: FixtureWorld, scene: SceneOverview, code: string): DirectorGenerationBlock {
  const attempts = scene.shotIds.flatMap((id) => {
    const shot = world.overview.shots[id]!;
    return (["keyframe", "video"] as const).flatMap((media) => {
      const slot = shot[media];
      if ((slot.state !== "no_answer" && slot.state !== "running") || !slot.attemptId) return [];
      return [{ attemptId: slot.attemptId, shotId: id, kind: media === "keyframe" ? "image" as const : "video" as const,
        phase: slot.state === "no_answer" ? "submission_unknown" : "running", action: slot.state === "no_answer" ? "human_release" as const : "follow_existing_job" as const }];
    });
  });
  return { kind: "keyframes", sceneId: scene.sceneId, code, shotIds: [...new Set(attempts.map((a) => a.shotId))], ...(code === "ATTEMPT_EXISTS" ? { attempts } : {}), at: now() };
}

/** The `jobs` Director preset: the service will refuse this shot's next keyframe. */
export function fixtureFailNextKeyframe(world: FixtureWorld, shotId: string): void {
  extra(world).failNext.add(shotId);
}

/** The `voices` Director preset: the service will refuse this shot's next voice line. */
export function fixtureFailNextVoice(world: FixtureWorld, shotId: string): void {
  extra(world).failNextVoice.add(shotId);
}

/** The browser-run video press (before phase P3). Kept for older clients; new ones confirm through /confirm. */
function generateVideo(world: FixtureWorld, scene: SceneOverview, body: GenerateInput): { accepted: true; targetShotIds: string[] } {
  if (body.targetShotIds !== undefined || body.regenerate !== undefined) throw new ApiError("VALIDATION_ERROR", 400);
  const targets = clipTargets(world, scene, body.reviewedFrames);
  assertEstimate(body, targets.length, FIXTURE_PRICES.clip);
  startClips(world, scene, targets);
  return { accepted: true, targetShotIds: targets };
}

/** Every shot without a finished clip, each reviewed as the exact keyframe the person opened; no blocker left. */
function clipTargets(world: FixtureWorld, scene: SceneOverview, reviewedFrames: readonly { shotId: string; artifactId: string; sha256: string }[] | undefined): string[] {
  const targets = scene.shotIds.filter((id) => world.overview.shots[id]!.video.state !== "ready");
  if (!targets.length) throw new ApiError("ALREADY_COMPLETE", 409);
  if (scene.state === "making_video") throw new ApiError("ATTEMPT_EXISTS", 409);
  for (const id of targets) {
    const shot = world.overview.shots[id]!;
    const reviewed = reviewedFrames?.find((frame) => frame.shotId === id);
    const artifact = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
    if (!reviewed || !artifact || reviewed.artifactId !== artifact.artifactId || reviewed.sha256 !== artifact.sha256) throw new ApiError("SCENE_REVIEW_STALE", 409);
  }
  const blocker = scene.blockers[0];
  if (blocker) throw new ApiError(blocker.code === "narration_too_long" ? "NARRATION_TOO_LONG" : "SCENE_NOT_READY", 409, { blocker: blocker.code });
  return targets;
}

/**
 * The durable scene confirm (phase P3, GR-3): binds the opened frames, settles narration by its chosen fit,
 * then makes the clips one after another on the simulated clock.
 */
function confirmScene(world: FixtureWorld, sceneId: string, body: ConfirmSceneInput): SceneConfirmationView {
  const scene = findScene(world, sceneId);
  if (world.overview.stopped) throw new ApiError("EXECUTION_PAUSED", 409);
  if (!body?.confirmationDigest || body.confirmationDigest !== scene.confirmationDigest) throw new ApiError("SCENE_REVIEW_STALE", 409);
  const targets = clipTargets(world, scene, body.reviewedFrames);
  // Lines with words but no voice yet are voiced first, one shot at a time: make, save, fit (speech, attach, accept).
  const voices = targets.filter((id) => needsVoice(world.overview.shots[id]!, world.snapshot.project.shots));
  if (body.expectedEstimateMicros !== undefined && body.expectedEstimateMicros !== generationQuote(0, voices.length, targets.length).micros) throw new ApiError("ESTIMATE_CHANGED", 409);
  const view: SceneConfirmationView = voices.length ? startVoices(world, scene, targets, voices)
    : { confirmationId: startClips(world, scene, targets), state: "running", currentShotId: targets[0]!, currentStep: "video" };
  settleNotesElsewhere(world, (choice) => choice.kind === "confirm_video" && choice.sceneId === sceneId, view.confirmationId);
  return view;
}

/** One confirm's voice steps: its clips, the lines to voice first, and the frames it was confirmed with. */
interface VoiceRun {
  sceneId: string;
  confirmationId: string;
  targets: string[];
  voices: string[];
  /** The keyframe each clip was confirmed with; a frame that changes meanwhile stops the confirm. */
  frames: Record<string, string | undefined>;
  kind: "video" | "keyframes";
  texts: Record<string, string>;
  intents: Record<string, string>;
}

/**
 * The confirm's voice steps on the simulated clock: make, save and fit each line (speech, attach, accept), then the
 * clips. It stops (blocked) as the studio does, with the clips taken off: at the fit step when a line comes back
 * longer than its shot with no fit chosen (NARRATION_CUE_OUT_OF_RANGE; the fit measures the estimate, stretched a
 * little), and at any step when a confirmed frame changed meanwhile (SCENE_REVIEW_STALE).
 */
function startVoices(world: FixtureWorld, scene: SceneOverview, targets: string[], voices: string[], kind: VoiceRun["kind"] = "video"): SceneConfirmationView {
  extra(world).undo = null;
  const confirmationId = nextId(world, "confirmation");
  const since = now();
  const first = voices[0]!;
  const frames = Object.fromEntries(targets.map((id) => [id, world.overview.shots[id]!.keyframe.artifact?.artifactId]));
  const texts = Object.fromEntries(voices.map((id) => [id, world.overview.shots[id]!.narration.text]));
  const intents = Object.fromEntries(voices.map((id) => [id, JSON.stringify(world.snapshot.project.shots.find((row) => row.id === id)?.narration) ?? ""]));
  const field = kind === "keyframes" ? "keyframesRun" : "confirmation";
  extra(world).voiceOwners[first] = confirmationId;
  commit(world, (overview) => {
    let next = withScene(overview, scene.sceneId, (s) => ({ ...s, [field]: { confirmationId, state: "running", currentShotId: first, currentStep: "speech" } }));
    for (const id of targets)
      next = withShot(next, id, (shot) => ({ ...shot, video: { state: "queued", takeCount: shot.video.takeCount, waiting: { code: "voice", since }, ...(shot.video.previous ? { previous: shot.video.previous } : {}) } }));
    return { overview: withShot(next, first, (shot) => ({ ...shot, narration: makingLine(shot.narration, confirmationId, first) })) };
  });
  scheduleVoice(world, { sceneId: scene.sceneId, confirmationId, targets, voices, frames, kind, texts, intents }, 0, "speech");
  return { confirmationId, state: "running", currentShotId: first, currentStep: "speech" };
}

/** A voice line being made carries its attempt, as the server's overview does; the line's last failure is over. */
function makingLine(narration: ShotNarration, confirmationId: string, shotId: string): ShotNarration {
  const { failure: _failure, ...line } = narration;
  return { ...line, state: "making", attemptId: `voice-${confirmationId}-${shotId}` };
}

/** A settled voice line has no attempt or failure of its own any more. */
function settledLine(narration: ShotNarration, state: "text_only" | "ready"): ShotNarration {
  const { attemptId: _attemptId, failure: _failure, ...line } = narration;
  return { ...line, state };
}

/** Stop a confirm partway: its clips that were still waiting are taken off, and the scene says why and where. */
function blockConfirm(overview: GenerationOverview, run: VoiceRun, code: string, shotId: string): GenerationOverview {
  let next = overview;
  for (const id of run.targets)
    next = withShot(next, id, (s) => (s.video.state === "queued" ? { ...s, video: { state: "none", takeCount: s.video.takeCount, ...(s.video.previous ? { previous: s.video.previous } : {}) } } : s));
  const field = run.kind === "keyframes" ? "keyframesRun" : "confirmation";
  return withScene(next, run.sceneId, (s) => ({ ...s, [field]: { confirmationId: run.confirmationId, state: "blocked", blocker: { code, shotId } } }));
}

function scheduleVoice(world: FixtureWorld, run: VoiceRun, index: number, step: "speech" | "attach" | "accept"): void {
  const { sceneId, confirmationId, targets, voices } = run;
  const field = run.kind === "keyframes" ? "keyframesRun" : "confirmation";
  world.later(FIXTURE_TIMING.voiceStepMs, (w) => {
    const scene = w.overview.scenes.find((s) => s.sceneId === sceneId);
    const shotId = voices[index]!;
    let next = w.overview;
    const clearOwnedMaking = (overview: GenerationOverview): GenerationOverview => {
      if (extra(w).voiceOwners[shotId] !== confirmationId) return overview;
      delete extra(w).voiceOwners[shotId];
      return overview.shots[shotId]?.narration.state === "making"
        ? withShot(overview, shotId, (shot) => ({ ...shot, narration: settledLine(shot.narration, "text_only") })) : overview;
    };
    // Stop cancels the confirm; a cancelled or replaced one goes no further. A voice job already sent still finishes.
    if (!scene || scene[field]?.confirmationId !== confirmationId || scene[field]?.state !== "running") {
      const cleared = clearOwnedMaking(next);
      if (cleared !== next) settle(w, cleared);
      return;
    }
    if (extra(w).voiceOwners[shotId] !== confirmationId) return;
    if (next.shots[shotId]?.narration.text !== run.texts[shotId] || (JSON.stringify(w.snapshot.project.shots.find((row) => row.id === shotId)?.narration) ?? "") !== run.intents[shotId]) { settle(w, blockConfirm(clearOwnedMaking(next), run, "SCENE_REVIEW_STALE", shotId)); return; }
    // A refused voice line fails (not charged) and stops the run at its shot, as the studio's speech step does.
    if (step === "speech" && extra(w).failNextVoice.delete(shotId)) {
      delete extra(w).voiceOwners[shotId];
      next = withShot(next, shotId, (shot) => ({ ...shot, narration: { ...settledLine(shot.narration, "text_only"), state: "failed",
        failure: { code: "PROVIDER_REFUSED", technical: false, retryAllowed: false, autoRetriesLeft: 0, charged: false, at: now() } } }));
      settle(w, blockConfirm(next, run, "PROVIDER_REFUSED", shotId));
      return;
    }
    if (step === "speech") next = withShot(next, shotId, (shot) => ({ ...shot, narration: settledLine(shot.narration, "text_only") }));
    // A confirmed frame that changed meanwhile (a new take, an edited prompt) stops the confirm at its shot.
    const changed = targets.find((id) => { const keyframe = next.shots[id]?.keyframe; return keyframe?.state !== "ready" || keyframe.artifact?.artifactId !== run.frames[id]; });
    if (changed) { settle(w, blockConfirm(next, run, "SCENE_REVIEW_STALE", changed)); return; }
    const at = (currentShotId: string, currentStep: "speech" | "attach" | "accept") =>
      withScene(next, sceneId, (s) => ({ ...s, [field]: { confirmationId, state: "running", currentShotId, currentStep } }));
    if (step === "speech" || step === "attach") {
      const following = step === "speech" ? "attach" : "accept";
      settle(w, at(shotId, following));
      scheduleVoice(w, run, index, following);
      return;
    }
    // accept: the line is measured; one longer than its shot stops the confirm here.
    const shot = next.shots[shotId]!;
    const estimate = shot.narration.estimatedSeconds ?? estimateNarrationSeconds(shot.narration.text);
    const measured = Math.round(estimate * FIXTURE_VOICE_STRETCH * 10) / 10;
    const { estimatedSeconds: _estimate, ...line } = shot.narration;
    next = withShot(next, shotId, (s) => ({ ...s, narration: { ...settledLine(line as ShotNarration, "ready"), measuredSeconds: measured } }));
    delete extra(w).voiceOwners[shotId];
    if (measured > shot.durationFrames / w.overview.fps + 1e-9 && !shot.narration.fit) {
      settle(w, blockConfirm(next, run, "NARRATION_CUE_OUT_OF_RANGE", shotId));
      return;
    }
    const following = voices[index + 1];
    if (following) {
      extra(w).voiceOwners[following] = confirmationId;
      next = withShot(next, following, (s) => ({ ...s, narration: makingLine(s.narration, confirmationId, following) }));
      settle(w, at(following, "speech"));
      scheduleVoice(w, run, index + 1, "speech");
      return;
    }
    if (run.kind === "keyframes") {
      settle(w, withScene(next, sceneId, (s) => ({ ...s, keyframesRun: { confirmationId, state: "done" } })));
      return;
    }
    // Every line is voiced: the clips go out one after another, as without voice steps.
    next = withScene(next, sceneId, (s) => ({ ...s, confirmation: { confirmationId, state: "running", currentShotId: targets[0]!, currentStep: "video" } }));
    const since = now();
    targets.forEach((id, order) => {
      next = withShot(next, id, (s) => ({ ...s, video: { ...s.video, waiting: { code: "capacity", ahead: order, since } } }));
    });
    settle(w, startNextClip(next, sceneId, w));
    scheduleClip(w, sceneId, confirmationId);
  });
}

/** Queue the clips, send the first, and run the rest on the simulated clock. Paid work ends any pending Undo. */
function startClips(world: FixtureWorld, scene: SceneOverview, targets: string[]): string {
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
  return confirmationId;
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
    settle(w, next);
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
      if (frames === shot.durationFrames) return shot;
      // A line settled by lengthening the shot is unsettled again once the shot is too short for it.
      const length = shot.narration.measuredSeconds ?? shot.narration.estimatedSeconds;
      const { fit, ...rest } = shot.narration;
      const narration = fit === "extend_shot" && length !== undefined && length > frames / fps + 1e-9 ? rest : shot.narration;
      return { ...shot, durationFrames: frames, narration, video: outdateClip(shot.video, "desiredFrames") };
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

const DIRECTION_HEADER = "OpenSlate current direction:\n";
const DIRECTION_SEPARATOR = "\nReference details (retain only where consistent):\n";

/**
 * The server's rewrite of a prompt after a direction edit (storyboard.ts editedPrompt): the shot's direction in
 * front, the earlier words kept. Purpose and framing edits rewrite both prompts; a motion edit rewrites the video one.
 */
export function directedPrompt(previous: string, direction: string): string {
  const split = previous.startsWith(DIRECTION_HEADER) ? previous.indexOf(DIRECTION_SEPARATOR) : -1;
  const original = split >= 0 ? previous.slice(split + DIRECTION_SEPARATOR.length) : previous;
  return `${DIRECTION_HEADER}${direction}${DIRECTION_SEPARATOR}${original}`;
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
        // A changed motion rewrites the video prompt, as the server does; the picture prompt keeps its words.
        const videoPrompt = edit.kind === "shot" && edit.field === "motion" && shot.motion !== row.motion
          ? directedPrompt(row.videoPrompt, joinPromptParts([shot.purpose, shot.framing, `Camera movement: ${shot.motion}`]))
          : row.videoPrompt;
        return { ...row, imagePrompt: shot.imagePrompt, motion: shot.motion, desiredFrames: shot.durationFrames, framing: shot.framing, purpose: shot.purpose, videoPrompt };
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
      // A note settled by this edit is open again once the edit is undone.
      const reopened = { ...snapshot, notes: (snapshot.notes ?? []).map((note) => (note.state === "resolved" && note.resolution?.resultRef === entry.commandId ? reopen(note) : note)) };
      snapshot = reopened;
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
  state.edits[commandId] = { shotId: shot.shotId, field: body.kind === "narration" ? "narration" : body.field };
  commit(world, (overview, snapshot) => bumpRevision(snapshotShot(snapshot, edited, body), withShot(overview, shot.shotId, () => edited), world));
  return { commandId };
}

function reopen(note: DirectorNote): DirectorNote {
  const { resolution: _resolution, ...rest } = note;
  return { ...rest, state: "open", version: note.version + 1 };
}

/**
 * Settle a too-long line (SB-2, SB-3), free and undoable: extend_shot lengthens the shot to the whole second
 * that fits the line; cut_to_shot keeps the length and cuts the line at the end with a fade.
 */
function narrationFit(world: FixtureWorld, shotId: string, body: NarrationFitInput): NarrationFitReceipt {
  if (body?.fit !== "extend_shot" && body?.fit !== "cut_to_shot") throw new ApiError("VALIDATION_ERROR", 400);
  if (body.expectedHeadVersion !== world.snapshot.project.headVersion) throw new ApiError("REVISION_CONFLICT", 409);
  const shot = findShot(world, shotId);
  if (world.overview.scenes.find((scene) => scene.sceneId === shot.sceneId)?.blockers.some((blocker) => blocker.code === "confirmation_running")) throw new ApiError("CONFIRMATION_RUNNING", 409);
  const length = shot.narration.measuredSeconds;
  if (shot.narration.state !== "ready" || length === undefined) throw new ApiError("NARRATION_RECORDING_REQUIRED", 409);
  if (isWorking(shot.video)) throw new ApiError("ATTEMPT_EXISTS", 409);
  const fps = world.overview.fps;
  const frames = fixtureNarrationFitFrames(shot.durationFrames, length, fps, body.fit);
  let edited: ShotOverview;
  if (body.fit === "extend_shot") {
    edited = { ...shot, durationFrames: frames, narration: { ...shot.narration, fit: "extend_shot" }, video: frames === shot.durationFrames ? shot.video : outdateClip(shot.video, "desiredFrames") };
  } else {
    edited = { ...shot, narration: { ...shot.narration, fit: "cut_to_shot" } };
  }
  const commandId = nextId(world, "command");
  extra(world).undo = { commandId, shotId, fields: ["durationFrames", "narration", "video"], before: shot, beforeSnapshotShot: world.snapshot.project.shots.find((row) => row.id === shotId) };
  commit(world, (overview, snapshot) => bumpRevision(
    { ...snapshot, project: { ...snapshot.project, shots: snapshot.project.shots.map((row) => (row.id === shotId ? { ...row, desiredFrames: edited.durationFrames } : row)) } },
    withShot(overview, shotId, () => edited),
    world,
  ));
  return { shotId, fit: body.fit, durationFrames: edited.durationFrames, commandId };
}

// ---- Director notes and proposals (phase P4: DC-2, DC-4, DC-10) ----------------------------------

/**
 * The scripted Director's accept_proposal on the person's typed word ("accept proposal c"): the banner's accept with
 * the current preview, recorded as the Director acting on that message. A letter must name exactly one proposal.
 */
export function fixtureAcceptOnWord(world: FixtureWorld, letter: string, requestId: string): { ok: true; proposal: DirectorProposal } | { ok: false; code: string } {
  return fixtureDecideOnWord(world, letter, requestId, "accept");
}

/** Declining a proposal by its letter, the same way: set aside, recorded as the Director acting on that message. */
export function fixtureDeclineOnWord(world: FixtureWorld, letter: string, requestId: string): { ok: true; proposal: DirectorProposal } | { ok: false; code: string } {
  return fixtureDecideOnWord(world, letter, requestId, "reject");
}

function fixtureDecideOnWord(world: FixtureWorld, letter: string, requestId: string, action: "accept" | "reject"): { ok: true; proposal: DirectorProposal } | { ok: false; code: string } {
  const ids = new Set((world.snapshot.notes ?? []).filter((note) => note.letter.toLowerCase() === letter.toLowerCase())
    .flatMap((note) => note.choices.flatMap((choice) => (choice.kind === "proposal" ? [choice.proposalId] : []))));
  if (ids.size !== 1) return { ok: false, code: ids.size ? "PROPOSAL_AMBIGUOUS" : "NOT_FOUND" };
  const proposal = world.proposals.find((p) => ids.has(p.proposalId));
  if (!proposal) return { ok: false, code: "NOT_FOUND" };
  try {
    return { ok: true, proposal: proposalAction(world, proposal.proposalId, action, { previewDigest: proposal.previewDigest }, { actor: "director_on_user_request", requestId }).proposal };
  } catch (error) {
    return { ok: false, code: error instanceof ApiError ? error.code : "PROPOSAL_STALE" };
  }
}

/**
 * Whichever happens first settles a note (card N1): a press that carries out an open note's choice (the scene's
 * confirm, a regenerate) settles that note too, wherever it was pressed, naming the press. Resolving it again is
 * then refused as already settled (NOTE_ALREADY_SETTLED).
 */
function settleNotesElsewhere(world: FixtureWorld, matches: (choice: NoteChoice) => boolean, resultRef: string): void {
  const hits = new Set((world.snapshot.notes ?? []).filter((note) => note.state === "open" && note.choices.some(matches)).map((note) => note.noteId));
  if (!hits.size) return;
  commit(world, (overview, snapshot) => ({ overview, snapshot: { ...snapshot, notes: (snapshot.notes ?? []).map((note) => !hits.has(note.noteId) ? note : {
    ...note, state: "resolved" as const, version: note.version + 1, resolution: { choiceIndex: note.choices.findIndex(matches), at: now(), resultRef, elsewhere: true as const },
  }) } }));
}

/**
 * Settle a note with one of its choices. A paid or edit choice must name the press or edit that carried it
 * out; a proposal choice is carried out by accepting the proposal, and this route only acknowledges it.
 */
function resolveNote(world: FixtureWorld, noteId: string, body: ResolveNoteInput): DirectorNote {
  const note = (world.snapshot.notes ?? []).find((n) => n.noteId === noteId);
  if (!note) throw new ApiError("NOT_FOUND", 404);
  const choice = note.choices[body?.choiceIndex];
  if (!choice) throw new ApiError("VALIDATION_ERROR", 400);
  // Whichever happens first settles a note; a later resolve, from anywhere, is told so.
  if (note.state === "resolved") throw new ApiError("NOTE_ALREADY_SETTLED", 409);
  if (note.version !== body?.expectedVersion) throw new ApiError("REVISION_CONFLICT", 409);
  const state = extra(world);
  switch (choice.kind) {
    case "proposal": {
      const proposal = world.proposals.find((p) => p.proposalId === choice.proposalId);
      if (proposal?.state !== "accepted" || body.resultRef !== choice.proposalId) throw new ApiError("NOTE_RESULT_INVALID", 409);
      break;
    }
    case "accept":
    case "reply":
      if (note.state !== "open") throw new ApiError("NOTE_STALE", 409);
      if (choice.kind === "reply" && !body.resultRef) throw new ApiError("NOTE_RESULT_INVALID", 409);
      break;
    case "regenerate_keyframe": {
      const request = body.resultRef ? state.requests[body.resultRef] : undefined;
      if (!request?.regenerate || !choice.shotIds.every((id) => request.shotIds.includes(id))) throw new ApiError("NOTE_RESULT_INVALID", 409);
      break;
    }
    case "confirm_video":
      if (!body.resultRef || findScene(world, choice.sceneId).confirmation?.confirmationId !== body.resultRef) throw new ApiError("NOTE_RESULT_INVALID", 409);
      break;
    case "edit_field": {
      const edit = body.resultRef ? state.edits[body.resultRef] : undefined;
      if (edit?.shotId !== choice.shotId || edit.field !== choice.field) throw new ApiError("NOTE_RESULT_INVALID", 409);
      break;
    }
  }
  const resolution = { choiceIndex: body.choiceIndex, at: now(), ...(body.resultRef ? { resultRef: body.resultRef } : {}) };
  commit(world, (overview, snapshot) => ({ overview, snapshot: withNote(snapshot, noteId, (n) => ({ ...n, state: "resolved", version: n.version + 1, resolution })) }));
  return (world.snapshot.notes ?? []).find((n) => n.noteId === noteId)!;
}

/**
 * Accept a held proposal exactly as previewed: apply it and, atomically, resolve the note choice that carries it.
 * Reject sets it aside (its note stays open). Undo reverts the fields still at the accepted value and reopens the note.
 */
function proposalAction(world: FixtureWorld, proposalId: string, action: "accept" | "reject" | "undo", body: AcceptProposalInput | undefined,
  by: Pick<NonNullable<DirectorProposal["decision"]>, "actor" | "requestId"> = { actor: "human", requestId: "fixture-press" }): ProposalReceipt {
  const proposal = world.proposals.find((p) => p.proposalId === proposalId);
  if (!proposal) throw new ApiError("NOT_FOUND", 404);
  const state = extra(world);
  if (action === "undo" && proposal.state === "undone") return { proposal, leftAlone: [] };
  if (action === "undo" ? proposal.state !== "accepted" : proposal.state !== "held") throw new ApiError("PROPOSAL_STALE", 409);
  if (action === "accept" && body?.previewDigest !== proposal.previewDigest) throw new ApiError("PROPOSAL_PREVIEW_CHANGED", 409);
  const setState = (next: DirectorProposal["state"], extraFields: Partial<DirectorProposal> = {}) =>
    world.proposals.map((p) => (p.proposalId === proposalId ? { ...p, ...extraFields, state: next } : p));
  const decision = (decided: "accept" | "reject") => ({ decision: { action: decided, ...by, at: now() } });
  if (action === "reject") {
    world.update((w) => { w.proposals = setState("rejected", decision("reject")); });
    return { proposal: world.proposals.find((p) => p.proposalId === proposalId)! };
  }
  const change = proposal.preview.changes.find((c) => c.field === "desiredFrames" && c.shotId);
  if (action === "accept") {
    const shot = change?.shotId ? findShot(world, change.shotId) : undefined;
    if (!change || !shot) throw new ApiError("PROPOSAL_STALE", 409);
    const frames = Number(change.after);
    const edited = editShot(shot, { kind: "shot", id: shot.shotId, field: "desiredFrames", value: String(frames) }, world.overview.fps);
    state.accepted[proposalId] = { shotId: shot.shotId, before: shot, after: frames };
    state.undo = null;
    const accepted = { at: now(), touchedFields: [{ shotId: shot.shotId, field: "desiredFrames" }] };
    commit(world, (overview, snapshot) => {
      world.proposals = setState("accepted", { accepted, ...decision("accept") });
      const notes = (snapshot.notes ?? []).map((note) => {
        const index = note.choices.findIndex((c) => c.kind === "proposal" && c.proposalId === proposalId);
        if (index < 0 || note.state === "resolved") return note;
        return { ...note, state: "resolved" as const, version: note.version + 1, resolution: { choiceIndex: index, at: now(), resultRef: proposalId, elsewhere: true as const } };
      });
      return bumpRevision(
        { ...snapshot, notes, project: { ...snapshot.project, shots: snapshot.project.shots.map((row) => (row.id === shot.shotId ? { ...row, desiredFrames: frames } : row)) } },
        withShot(overview, shot.shotId, () => edited),
        world,
      );
    });
    return { proposal: world.proposals.find((p) => p.proposalId === proposalId)! };
  }
  // undo
  const record = state.accepted[proposalId];
  const shot = record ? world.overview.shots[record.shotId] : undefined;
  const untouched = !!record && !!shot && shot.durationFrames === record.after;
  commit(world, (overview, snapshot) => {
    world.proposals = setState("undone");
    const notes = (snapshot.notes ?? []).map((note) => (note.state === "resolved" && note.resolution?.resultRef === proposalId ? reopen(note) : note));
    const restored = untouched ? withShot(overview, record!.shotId, (s) => ({ ...s, durationFrames: record!.before.durationFrames, narration: record!.before.narration, video: record!.before.video })) : overview;
    return bumpRevision(
      { ...snapshot, notes, project: { ...snapshot.project, shots: snapshot.project.shots.map((row) => (untouched && row.id === record!.shotId ? { ...row, desiredFrames: record!.before.durationFrames } : row)) } },
      restored,
      world,
    );
  });
  return { proposal: world.proposals.find((p) => p.proposalId === proposalId)!, leftAlone: untouched || !record ? [] : [{ shotId: record.shotId, field: "desiredFrames" }] };
}

// ---- controls and give-up -----------------------------------------------------------------

function control(world: FixtureWorld, body: ControlInput): ControlReceipt {
  if (body?.action === "stop") {
    if (world.overview.stopped) return { action: "stop", stopped: world.overview.stopped };
    let sentJobs = 0;
    let detachedJobs = 0;
    commit(world, (overview, snapshot) => {
      // As the server's Stop (engine.detachUnsent): every attempt not finished yet counts as sent (running, no
      // answer, released and still polled); bound jobs not sent yet are taken off; running or blocked scene
      // confirmations are cancelled, so the sent clip finishes on its own and nothing after it is sent.
      const shots: Record<string, ShotOverview> = {};
      for (const [id, shot] of Object.entries(overview.shots)) {
        const detach = <T extends MediaSlot>(slot: T): T => {
          if (slot.state === "running" || slot.state === "no_answer") sentJobs++;
          sentJobs += (slot.releasedAttemptIds ?? []).length;
          if (slot.state !== "queued") return slot;
          detachedJobs++;
          const { waiting: _held, ...rest } = slot;
          return { ...rest, state: "none" } as T;
        };
        shots[id] = { ...shot, keyframe: detach(shot.keyframe), video: detach(shot.video) };
      }
      const scenes = overview.scenes.map((scene) => ({ ...scene,
        ...(scene.confirmation?.state === "running" || scene.confirmation?.state === "blocked" ? { confirmation: { confirmationId: scene.confirmation.confirmationId, state: "cancelled" as const } } : {}),
        ...(scene.keyframesRun?.state === "running" || scene.keyframesRun?.state === "blocked" ? { keyframesRun: { confirmationId: scene.keyframesRun.confirmationId, state: "cancelled" as const } } : {}),
      }));
      const stopped = { stopId: nextId(world, "stop"), at: now(), sentJobs, detachedJobs };
      return {
        overview: { ...overview, shots, scenes, stopped, controlAuthorityId: nextId(world, "authority") },
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
    .find(({ shot, slot }) => (shot[slot].state === "no_answer" && shot[slot].attemptId === attemptId)
      || (shot[slot].replacement?.state === "no_answer" && shot[slot].replacement?.attemptId === attemptId));
  // A transcription the service never answered: given up, it stays unanswered (a late reply may still arrive) but
  // offers no Give up again. (The studio's turn view still sends the released attempt's id; it should drop it too.)
  const transcribed = !entry && (world.snapshot.turns ?? []).some((turn) => turn.effects?.generation?.some((effect) => effect.transcription?.state === "no_answer" && effect.transcription.attemptId === attemptId));
  if (transcribed) {
    world.update((w) => {
      w.snapshot = { ...w.snapshot, turns: (w.snapshot.turns ?? []).map((turn) => !turn.effects?.generation ? turn : { ...turn, effects: { ...turn.effects,
        generation: turn.effects.generation.map((effect) => {
          if (effect.transcription?.attemptId !== attemptId) return effect;
          const { attemptId: _released, ...transcription } = effect.transcription;
          return { ...effect, transcription };
        }) } }) };
    });
    return { attemptId, shotId: null, releasedAt: now() };
  }
  if (!entry) {
    // A voice line with no answer goes back to its words, not voiced yet (the server keeps the old job's charge).
    const voiced = Object.values(world.overview.shots).find((shot) => shot.narration.state === "no_answer" && shot.narration.attemptId === attemptId);
    if (!voiced) throw new ApiError("ATTEMPT_NOT_RELEASABLE", 409);
    commit(world, (overview) => ({ overview: withShot(overview, voiced.shotId, (shot) => {
      const { attemptId: _released, failure: _failure, ...line } = shot.narration;
      return { ...shot, narration: { ...line, state: "text_only" } };
    }) }));
    return { attemptId, shotId: voiced.shotId, releasedAt: now() };
  }
  commit(world, (overview) => ({
    overview: withShot(overview, entry.shot.shotId, (shot) => {
      const slot = shot[entry.slot];
      const releasedAttemptIds = [...(slot.releasedAttemptIds ?? []), attemptId];
      // A new take given up: the current output stays (the server restores the retained take).
      if (slot.replacement?.attemptId === attemptId) {
        const { replacement: _given, ...kept } = slot;
        return { ...shot, [entry.slot]: { ...kept, releasedAttemptIds } };
      }
      const released: MediaSlot = { state: "none", takeCount: slot.takeCount, releasedAttemptIds, takenOff: "released", ...(slot.previous ? { previous: slot.previous } : {}) };
      return entry.slot === "keyframe" ? { ...shot, keyframe: { ...released, opened: false } } : { ...shot, video: released };
    }),
  }));
  return { attemptId, shotId: entry.shot.shotId, releasedAt: now() };
}

// ---- takes (card B8) ---------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
/** A local "YYYY-MM-DDTHH:MM:SS" time, like the studio's createdAt. */
function localTime(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** Every keyframe this shot ever had, newest first. Takes are numbered as they were made, so take n is takeArtifact(label, n). */
function shotTakes(world: FixtureWorld, shotId: string): ShotTakes {
  const shot = findShot(world, shotId);
  const state = extra(world);
  const current = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
  const keyframes: ShotTakes["keyframes"] = [];
  for (let take = shot.keyframe.takeCount; take >= 1; take--) {
    const artifact = takeArtifact(shot.label, take);
    // Takes from before this tab were made two hours ago, an hour apart (the sample film's history).
    const createdAt = state.madeAt[takeKey(artifact)] ?? localTime(new Date(Date.now() - (2 + shot.keyframe.takeCount - take) * 3_600_000));
    // These sample takes are generated for this shot; none uses an unsupported shared conditioning source.
    keyframes.push({ artifact, current: !!current && takeKey(current) === takeKey(artifact), createdAt, selectable: true });
  }
  return { shotId, keyframes };
}

/** Use an earlier take: free; it becomes the current keyframe (opened if it was before) and the clip goes out of date. Undoable. */
function useTake(world: FixtureWorld, shotId: string, artifactId: string): UseTakeReceipt {
  const shot = findShot(world, shotId);
  const take = shotTakes(world, shotId).keyframes.find((entry) => entry.artifact.artifactId === artifactId);
  if (!take) throw new ApiError("NOT_FOUND", 404);
  if (!take.selectable) throw new ApiError("TAKE_NOT_SELECTABLE", 409);
  // A new take in progress or unanswered is a job on this keyframe too.
  const newTake = shot.keyframe.replacement?.state;
  if (isWorking(shot.keyframe) || shot.keyframe.state === "no_answer" || newTake === "running" || newTake === "queued" || newTake === "no_answer" || isWorking(shot.video)) throw new ApiError("ATTEMPT_EXISTS", 409);
  if (take.current) throw new ApiError("ALREADY_COMPLETE", 409);
  const state = extra(world);
  const commandId = nextId(world, "command");
  state.undo = { commandId, shotId, fields: ["keyframe", "video"], before: shot, beforeSnapshotShot: world.snapshot.project.shots.find((row) => row.id === shotId) };
  const keyframe: KeyframeSlot = { state: "ready", artifact: take.artifact, takeCount: shot.keyframe.takeCount, opened: state.opened.has(takeKey(take.artifact)) };
  commit(world, (overview, snapshot) => bumpRevision(snapshot, withShot(overview, shotId, (s) => ({ ...s, keyframe, video: outdateClip(s.video, "keyframe") })), world));
  return { shotId, artifactId, commandId };
}

// ---- routing ---------------------------------------------------------------------------

export function fixtureCommand(world: FixtureWorld, method: "GET" | "POST", path: string, body: unknown): unknown {
  const match = (pattern: RegExp) => { const m = path.match(pattern); return m ? decodeURIComponent(m[1]!) : null; };
  let id: string | null;
  if (method === "GET") {
    if ((id = match(/^\/scenes\/([^/]+)\/generation$/))) return sceneRead(world, id);
    if ((id = match(/^\/shots\/([^/]+)\/takes$/))) return shotTakes(world, id);
  } else {
    const use = path.match(/^\/shots\/([^/]+)\/takes\/([^/]+)\/use$/);
    if (use) return useTake(world, decodeURIComponent(use[1]!), decodeURIComponent(use[2]!));
    if ((id = match(/^\/shots\/([^/]+)\/frame-views$/))) return frameView(world, id, body as FrameViewInput);
    if ((id = match(/^\/scenes\/([^/]+)\/generate$/))) return generate(world, id, body as GenerateInput);
    if ((id = match(/^\/scenes\/([^/]+)\/confirm$/))) return confirmScene(world, id, body as ConfirmSceneInput);
    if ((id = match(/^\/shots\/([^/]+)\/narration-fit$/))) return narrationFit(world, id, body as NarrationFitInput);
    if (path === "/storyboard") return storyboard(world, body as StoryboardBody);
    if (path === "/controls") return control(world, body as ControlInput);
    if ((id = match(/^\/attempts\/([^/]+)\/release$/))) return release(world, id, body as ReleaseAttemptInput);
    if ((id = match(/^\/director\/notes\/([^/]+)\/resolve$/))) return resolveNote(world, id, body as ResolveNoteInput);
    const proposal = path.match(/^\/director\/proposals\/([^/]+)\/(accept|reject|undo)$/);
    if (proposal) return proposalAction(world, decodeURIComponent(proposal[1]!), proposal[2] as "accept" | "reject" | "undo", body as AcceptProposalInput | undefined);
  }
  throw new ApiError("FIXTURE_UNSUPPORTED", 400, { path });
}
