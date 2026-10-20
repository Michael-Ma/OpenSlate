import type { ShotOverview } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import type { ConversationEntry, DirectorStatus, TurnView } from "../model/types.ts";
import { FIXTURE_TIMING, recompute } from "./fixture-commands.ts";
import type { FixtureWorld } from "./fixture-port.ts";
import { artifactFor, sceneId, shotId } from "./last-ferry.ts";
import { fixtureAssetPicture, isFixtureImport } from "./routes/assets.ts";
import type { FixtureRoute } from "./routes/types.ts";

/** How long the scripted Director "works" before it replies. */
export const FIXTURE_REPLY_MS = 1500;
const LIMIT = 16000;

/** Turns still to answer, per fixture world. The Director goes idle when the last one is answered. */
const turns = new WeakMap<FixtureWorld, number>();

interface MessageBody {
  text?: unknown;
  scopeIds?: unknown;
  replyToQuestionId?: unknown;
  images?: unknown;
}

/** "Scene 2" or "2.2" for a scope id, as the scripted reply names it; null for the whole film. */
function scopeName(world: FixtureWorld, id: string): string | null {
  const scene = world.overview.scenes.find((s) => s.sceneId === id);
  if (scene) return `Scene ${scene.ordinal}`;
  return world.overview.shots[id]?.label ?? null;
}

/** Sample film content, like the fixture conversation: it stays English in both interface languages. */
function scriptedReply(names: string[], answer: boolean, pictures: number): string {
  if (answer) return "Thanks, noted. I would carry that into the next keyframes.";
  const pointed = names.length ? ` for ${names.join(", ")}` : "";
  const looked = pictures ? ` I looked at ${pictures === 1 ? "the picture" : `the ${pictures} pictures`} you showed me.` : "";
  return `Noted${pointed}.${looked} I would make that change in the prompts and show you new keyframes.`;
}

/**
 * The server's checks on attached pictures (apps/server/src/app.ts and application/director-images.ts): one to
 * four distinct { artifactId, sha256 }, only for a Codex Director with FFmpeg, and only pictures imported into
 * this film (here: the two sample uploads and PNGs imported in this tab).
 */
function checkImages(world: FixtureWorld, value: unknown): number {
  if (value === undefined) return 0;
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new ApiError("VALIDATION_ERROR", 400);
  const ids = value.map((item: unknown) => {
    const image = item as { artifactId?: unknown; sha256?: unknown } | null;
    if (!image || typeof image.artifactId !== "string" || typeof image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(image.sha256)) throw new ApiError("VALIDATION_ERROR", 400);
    return image.artifactId;
  });
  if (new Set(ids).size !== ids.length) throw new ApiError("DIRECTOR_IMAGES_INVALID", 409);
  if (world.director.mode !== "native" || world.director.imageAttachmentsAvailable !== true) throw new ApiError("DIRECTOR_IMAGES_UNAVAILABLE", 409);
  if (ids.some((id) => !fixtureAssetPicture(id) && !isFixtureImport(id))) throw new ApiError("DIRECTOR_IMAGE_SCOPE", 409);
  return ids.length;
}

/**
 * Simulated POST /api/projects/:projectId/messages for the fixture film: records the user's message
 * (or answer), runs the scripted Director for about 1.5 s, then appends a short canned reply.
 * Never changes the film itself: no shot, scene or media slot is touched.
 */
export function fixtureMessage(world: FixtureWorld, body: unknown): unknown {
  const input = (body && typeof body === "object" ? body : {}) as MessageBody;
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > LIMIT) throw new ApiError("VALIDATION_ERROR", 400);
  const questionId = typeof input.replyToQuestionId === "string" ? input.replyToQuestionId : null;
  if (questionId && !world.snapshot.questions?.some((q) => q.id === questionId && q.state === "pending"))
    throw new ApiError("VALIDATION_ERROR", 400, { replyToQuestionId: questionId });
  if (questionId && input.images !== undefined) throw new ApiError("DIRECTOR_IMAGES_UNAVAILABLE", 409);
  // Imported pictures come as images; keyframes through their shots. Both lead the text as picture links.
  const pictures = Math.max(checkImages(world, input.images), (text.match(/\]\(#openslate-ref\/[^/)]+\/image\//g) ?? []).length);
  const scopeIds = !questionId && Array.isArray(input.scopeIds) ? input.scopeIds.filter((id): id is string => typeof id === "string") : [];
  const filmScope = scopeIds.filter((id) => id !== world.snapshot.project.id);
  const requestId = `fixture-request-${(world.snapshot.conversation?.length ?? 0) + 1}`;
  const names = filmScope.map((id) => scopeName(world, id)).filter((name): name is string => name !== null);

  world.update((w) => {
    const entry: ConversationEntry = { id: requestId, role: "user", text, requestId, at: new Date().toISOString(), ...(questionId || !filmScope.length ? {} : { scopeIds: filmScope }) };
    w.snapshot = {
      ...w.snapshot,
      conversation: [...(w.snapshot.conversation ?? []), entry],
      questions: (w.snapshot.questions ?? []).map((q) => (q.id === questionId ? { ...q, state: "answered" as const } : q)),
    };
    w.director = { ...w.director, status: "running", activeRequestId: requestId, turn: null, message: null };
    w.overview = { ...w.overview, director: { state: "working", scopeIds: filmScope, requestId } };
  });
  turns.set(world, (turns.get(world) ?? 0) + 1);

  world.later(FIXTURE_REPLY_MS, (w) => {
    const left = Math.max(0, (turns.get(w) ?? 1) - 1);
    turns.set(w, left);
    const reply: ConversationEntry = { id: `${requestId}-reply`, role: "assistant", text: scriptedReply(names, !!questionId, pictures), requestId, at: new Date().toISOString(), runtime: "scripted" };
    w.snapshot = { ...w.snapshot, conversation: [...(w.snapshot.conversation ?? []), reply] };
    if (left === 0) {
      w.director = { ...w.director, status: "idle", activeRequestId: null };
      w.overview = { ...w.overview, director: { state: "idle", scopeIds: [] } };
    }
  });
  return { requestId, status: "queued", director: world.director.mode };
}

// ---- Let it go (card B13) ---------------------------------------------------------------

/**
 * Simulated POST /requests/:requestId/release-holds: takes no body, refuses while the Director still works on that
 * request (DIRECTOR_WORKING), and otherwise ends it. The shots it held go ahead: their queued keyframes are made
 * (as in the studio, they were already paid for when the scene was pressed).
 */
function releaseHolds(world: FixtureWorld, requestId: string, body: unknown): { requestId: string; releasedHolds: number } {
  if (body !== undefined) throw new ApiError("VALIDATION_ERROR", 400);
  if (!world.snapshot.conversation?.some((entry) => entry.requestId === requestId)) throw new ApiError("NOT_FOUND", 404);
  const working = world.snapshot.turns?.some((turn) => turn.requestId === requestId && (turn.state === "queued" || turn.state === "running"))
    || (world.director.status === "running" && world.director.activeRequestId === requestId);
  if (working) throw new ApiError("DIRECTOR_WORKING", 409);
  const held = Object.values(world.overview.shots).filter((shot) => shot.keyframe.state === "queued" && shot.keyframe.waiting?.code === "edit_pending" && shot.keyframe.waiting.requestId === requestId);
  if (!held.length) return { requestId, releasedHolds: 0 };
  const started = new Date().toISOString();
  const withKeyframe = (shots: Record<string, ShotOverview>, change: (shot: ShotOverview) => ShotOverview) =>
    Object.fromEntries(Object.entries(shots).map(([id, shot]) => [id, held.some((h) => h.shotId === id) ? change(shot) : shot]));
  world.update((w) => {
    w.snapshot = { ...w.snapshot, conversation: (w.snapshot.conversation ?? []).map((entry) => (entry.requestId === requestId && entry.role === "user" ? { ...entry, state: "superseded" } : entry)) };
    w.overview = recompute({ ...w.overview, shots: withKeyframe(w.overview.shots, (shot) => ({ ...shot, keyframe: { state: "running", phase: "running", startedAt: started, attemptId: `release-${shot.shotId}`, takeCount: shot.keyframe.takeCount, opened: false } })) }, w.snapshot.notes ?? [], w.snapshot.project.shots);
  });
  world.later(FIXTURE_TIMING.keyframeMs, (w) => {
    w.overview = recompute({ ...w.overview, shots: withKeyframe(w.overview.shots, (shot) => (shot.keyframe.state === "running" && shot.keyframe.attemptId === `release-${shot.shotId}` ? { ...shot, keyframe: { state: "ready", artifact: artifactFor(shot.label), takeCount: shot.keyframe.takeCount + 1, opened: false } } : shot)) }, w.snapshot.notes ?? [], w.snapshot.project.shots);
  });
  return { requestId, releasedHolds: held.length };
}

/** The Director's simulated routes besides /messages (which the port answers directly). */
export const directorRoutes: FixtureRoute[] = [
  { method: "POST", match: /^\/requests\/([^/]+)\/release-holds$/, handle: (world, [requestId], body) => releaseHolds(world, decodeURIComponent(requestId!), body) },
];

// ---- presets ------------------------------------------------------------------------------

/**
 * `?director=` presets for the sample film (comma-separated; read once per sample studio):
 * - `codex`: the Codex Director with FFmpeg, so pictures can be shown to it (its replies stay scripted here).
 * - `no-ffmpeg`: the Codex Director on a computer without FFmpeg: pictures are refused with that reason.
 * - `held`: an unfinished Director edit (stopped before it finished) holds 3.1 and 3.2, so their keyframes wait
 *   on it; the thread offers Let it go.
 * - `failed`: the latest reply failed with a generic run failure (DIRECTOR_RUN_FAILED): like the server, the status
 *   carries no words of its own for it, so the thread says it in the interface language.
 * - `markdown`: one more reply that uses lists, a table, code, links and references.
 */
export function directorPresets(): string[] {
  try { return (new URLSearchParams(globalThis.location?.search ?? "").get("director") ?? "").split(",").map((part) => part.trim()).filter(Boolean); } catch { return []; }
}

/** Sample conversation times: today, a few minutes after the 10:44 reply, never in the future. */
function laterToday(minutes: number): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 44 + minutes);
  return new Date(Math.min(at.getTime(), now.getTime() - 60_000 * (10 - minutes))).toISOString();
}

const MARKDOWN_REPLY = [
  "Here is what I would change in **Scene 3**, shot by shot:",
  "",
  "1. [@3.1](#openslate-ref/last-ferry/shot/shot-3-1/): hold the wide a beat longer so the fog *swallows* the ferry.",
  "2. [@3.2](#openslate-ref/last-ferry/shot/shot-3-2/): keep Mara at the rail, but lower the camera.",
  "   - Her coat stays `#c8102e` red.",
  "",
  "| Shot | Now | After |",
  "| --- | ---: | ---: |",
  "| 3.1 | 8 s | 9 s |",
  "| 3.2 | 8 s | 8 s |",
  "",
  "```",
  "prompt: the ferry pulls away into the fog, seen from the harbour wall, early morning blue light",
  "```",
  "",
  "Reference: [the timetable style guide](https://example.com/ferry-timetables). <b>Raw tags</b> stay as text, and [this](javascript:alert(1)) is not a link.",
].join("\n");

/** Apply the `?director=` presets to a fresh sample world (tests pass the list themselves). */
export function applyDirectorPresets(world: FixtureWorld, presets: readonly string[] = directorPresets()): void {
  // In one order whatever the list's, so the sample conversation stays in time order.
  const order = ["codex", "no-ffmpeg", "markdown", "held", "failed"];
  for (const preset of order.filter((name) => presets.includes(name))) {
    if (preset === "codex") world.director = { ...world.director, mode: "native", imageAttachmentsAvailable: true };
    if (preset === "no-ffmpeg") world.director = { ...world.director, mode: "native", imageAttachmentsAvailable: false };
    if (preset === "held") {
      const requestId = "request-held";
      const message: ConversationEntry = { id: requestId, role: "user", text: "@Scene 3 make the departure feel lonelier.", scopeIds: [sceneId(3)], requestId, at: laterToday(2) };
      const turn: TurnView = { id: "turn-held", requestId, state: "interrupted", reason: "interrupted", runtime: "scripted", action: "conversation" };
      world.snapshot = { ...world.snapshot, conversation: [...(world.snapshot.conversation ?? []), message], turns: [...(world.snapshot.turns ?? []), turn] };
      const since = laterToday(2);
      const shots = { ...world.overview.shots };
      for (const label of ["3.1", "3.2"]) {
        const shot = shots[shotId(label)]!;
        shots[shot.shotId] = { ...shot, keyframe: { state: "queued", takeCount: 0, opened: false, waiting: { code: "edit_pending", since, requestId } } };
      }
      world.overview = recompute({ ...world.overview, shots }, world.snapshot.notes ?? [], world.snapshot.project.shots);
    }
    if (preset === "failed") {
      const requestId = "request-failed";
      const message: ConversationEntry = { id: requestId, role: "user", text: "Try a colder grade on the whole film.", requestId, at: laterToday(3) };
      const turn: TurnView = { id: "turn-failed", requestId, state: "failed", reason: "failed", runtime: "live", action: "conversation" };
      world.snapshot = { ...world.snapshot, conversation: [...(world.snapshot.conversation ?? []), message], turns: [...(world.snapshot.turns ?? []), turn] };
      const status: DirectorStatus = {
        ...world.director, status: "error", activeRequestId: requestId,
        turn: { requestId, state: "failed", errorCode: "DIRECTOR_RUN_FAILED" },
        message: null,
      };
      world.director = status;
    }
    if (preset === "markdown") {
      // Its own request, so the 10:44 reply keeps its notes a and b.
      const reply: ConversationEntry = { id: "m-markdown", role: "assistant", text: MARKDOWN_REPLY, requestId: "request-markdown", at: laterToday(1), runtime: "scripted" };
      world.snapshot = { ...world.snapshot, conversation: [...(world.snapshot.conversation ?? []), reply] };
    }
  }
}
