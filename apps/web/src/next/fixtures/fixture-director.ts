import type { DirectorNote, ShotOverview } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import type { ConversationEntry, DirectorStatus, TurnView } from "../model/types.ts";
import { FIXTURE_TIMING, fixtureAcceptOnWord, fixtureDirectorKeyframes, fixtureFailNextKeyframe, recompute } from "./fixture-commands.ts";
import type { MessageAttachmentView } from "@openslate/core/public";
import { fixtureAsset } from "./routes/assets.ts";
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
  attachments?: unknown;
}

/** Asking for keyframes ("make the keyframes", "生成关键帧"): the scripted Director starts them. */
const ASKS_FOR_KEYFRAMES = /(make|generate|create|start)\b[^.?!]*\bkeyframes?\b|keyframes?\b[^.?!]*\b(please|now)|(生成|做|出)[^。？！]*关键帧/i;

/** Accepting a proposal by its letter ("accept proposal c", "接受提案 c"): the scripted Director accepts it on that word. */
const ACCEPTS_PROPOSAL = /\b(?:accept|approve)\s+proposal\s+([a-z])\b|(?:接受|批准|采用)\s*提案\s*([a-z])(?![a-z])/i;

/** Asking for video ("make the video for Scene 2", "生成视频"): the scripted Director asks for the scene's confirm in the chat. */
const ASKS_FOR_VIDEO = /(make|generate|create|start)\b[^.?!]*\b(video|clips?)\b|(生成|做|出)[^。？！]*视频/i;

/** "a", …, "z", "aa": the next letter after every note in the film, so a new note never repeats one shown nearby. */
function nextLetter(notes: readonly DirectorNote[], offset: number): string {
  let n = notes.length + offset;
  let letter = "";
  do { letter = String.fromCharCode(97 + (n % 26)) + letter; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return letter;
}

/**
 * The scripted Director asking for video (card N1): for each scene with frames waiting for video (within what the
 * message pointed at), a note with that scene's "Confirm frames & generate video" choice and a reply choice. It
 * starts nothing; the person confirms in the chat or in Keyframes, and the first press settles the note.
 */
function fixtureVideoAsks(world: FixtureWorld, requestId: string, scope: readonly string[]): DirectorNote[] {
  const notes = world.snapshot.notes ?? [];
  const inScope = (sceneId: string, shotIds: readonly string[]) => !scope.length || scope.includes(sceneId) || shotIds.some((id) => scope.includes(id));
  const at = new Date().toISOString();
  return world.overview.scenes
    .filter((scene) => scene.videoTargets.length > 0 && !!scene.confirmationDigest && inScope(scene.sceneId, scene.shotIds))
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((scene, index) => ({
      noteId: `${requestId}-note-${index + 1}`, requestId, turnId: `${requestId}-turn`, letter: nextLetter(notes, index),
      anchor: { sceneId: scene.sceneId }, kind: "recommendation", blocking: false,
      text: `Scene ${scene.ordinal} is ready for video once its frames are opened.`,
      choices: [{ kind: "confirm_video", sceneId: scene.sceneId }, { kind: "reply" }],
      state: "open", version: 1, createdAt: at,
    }));
}

/**
 * The server's checks on message attachments: one to eight distinct owned files saved in this film's Assets (the
 * sample's own and those imported in this tab). Each is listed on the message by name and kind.
 */
function checkAttachments(world: FixtureWorld, value: unknown): MessageAttachmentView[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) throw new ApiError("VALIDATION_ERROR", 400);
  const seen = new Set<string>();
  return value.map((item: unknown) => {
    const file = item as { artifactId?: unknown; sha256?: unknown } | null;
    if (!file || typeof file.artifactId !== "string" || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new ApiError("VALIDATION_ERROR", 400);
    if (seen.has(file.artifactId)) throw new ApiError("DIRECTOR_ATTACHMENTS_INVALID", 409);
    seen.add(file.artifactId);
    const asset = fixtureAsset(world, file.artifactId);
    if (!asset || asset.artifact.sha256 !== file.sha256) throw new ApiError("DIRECTOR_ATTACHMENT_SCOPE", 409);
    return { artifact: asset.artifact, name: asset.label, readable: true };
  });
}

/** "Scene 2" or "2.2" for a scope id, as the scripted reply names it; null for the whole film. */
function scopeName(world: FixtureWorld, id: string): string | null {
  const scene = world.overview.scenes.find((s) => s.sceneId === id);
  if (scene) return `Scene ${scene.ordinal}`;
  return world.overview.shots[id]?.label ?? null;
}

function acceptedReply(named: RegExpMatchArray | null, outcome: ReturnType<typeof fixtureAcceptOnWord> | null): string {
  if (!named || !outcome) return "";
  const letter = (named[1] ?? named[2])!.toLowerCase();
  if (outcome.ok) return `Accepted proposal ${letter} as you asked. You can undo it under the note. `;
  return outcome.code === "PROPOSAL_AMBIGUOUS" ? `More than one proposal is lettered ${letter}; which one do you mean? `
    : outcome.code === "NOT_FOUND" ? `I can't find a proposal ${letter}. `
    : `Proposal ${letter} is no longer open, so I didn't change anything. `;
}

/** Sample film content, like the fixture conversation: it stays English in both interface languages. */
function scriptedReply(names: string[], answer: boolean, pictures: number, files = 0, started = false, videoAsks: string[] = []): string {
  if (answer) return "Thanks, noted. I would carry that into the next keyframes.";
  if (videoAsks.length) return `${videoAsks.join(" and ")} ${videoAsks.length === 1 ? "is" : "are"} ready for video. Confirm below, or in Keyframes.`;
  const pointed = names.length ? ` for ${names.join(", ")}` : "";
  const looked = pictures ? ` I looked at ${pictures === 1 ? "the picture" : `the ${pictures} pictures`} you showed me.` : "";
  const read = files ? ` I went through ${files === 1 ? "the file" : `the ${files} files`} you sent.` : "";
  if (started) return `Starting the keyframes now${pointed}.${read} Open each frame when it is back; video waits for your confirm in each scene.`;
  return `Noted${pointed}.${looked}${read} I would make that change in the prompts and show you new keyframes.`;
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
  if (questionId && (input.images !== undefined || input.attachments !== undefined)) throw new ApiError("DIRECTOR_IMAGES_UNAVAILABLE", 409);
  const attachments = checkAttachments(world, input.attachments);
  // Imported pictures come as images; keyframes through their shots. Both lead the text as picture links.
  const pictures = Math.max(checkImages(world, input.images), (text.match(/\]\(#openslate-ref\/[^/)]+\/image\//g) ?? []).length);
  const scopeIds = !questionId && Array.isArray(input.scopeIds) ? input.scopeIds.filter((id): id is string => typeof id === "string") : [];
  const filmScope = scopeIds.filter((id) => id !== world.snapshot.project.id);
  const requestId = `fixture-request-${(world.snapshot.conversation?.length ?? 0) + 1}`;
  const names = filmScope.map((id) => scopeName(world, id)).filter((name): name is string => name !== null);

  world.update((w) => {
    const entry: ConversationEntry = { id: requestId, role: "user", text, requestId, at: new Date().toISOString(), ...(questionId || !filmScope.length ? {} : { scopeIds: filmScope }), ...(attachments.length ? { attachments } : {}) };
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
    // Accepted a proposal by its letter: done first, as the person asked, then anything else in the same message.
    const named = !questionId ? text.match(ACCEPTS_PROPOSAL) : null;
    const accepted = named ? fixtureAcceptOnWord(w, (named[1] ?? named[2])!, requestId) : null;
    // Asked for keyframes: the scripted Director starts them as the person's press would, and says what and the price.
    const started = !questionId && ASKS_FOR_KEYFRAMES.test(text) ? fixtureDirectorKeyframes(w) : null;
    const asks = !questionId && !started && ASKS_FOR_VIDEO.test(text) ? fixtureVideoAsks(w, requestId, filmScope) : [];
    const askNames = asks.map((note) => `Scene ${w.overview.scenes.find((scene) => scene.sceneId === note.anchor.sceneId)?.ordinal}`);
    const reply: ConversationEntry = { id: `${requestId}-reply`, role: "assistant", text: acceptedReply(named, accepted) + scriptedReply(names, !!questionId, pictures, attachments.length, !!started?.sceneIds.length, askNames), requestId, at: new Date().toISOString(), runtime: "scripted" };
    const at = new Date().toISOString();
    const turn: TurnView | null = started || asks.length || accepted?.ok ? { id: `${requestId}-turn`, requestId, state: "completed", at, runtime: "scripted", action: "conversation",
      effects: { notesCreated: asks.length, proposalsHeld: 0, changesApplied: accepted?.ok ? 1 : 0,
        ...(started?.sceneIds.length ? { generation: [{ kind: "keyframes" as const, sceneIds: started.sceneIds, shotIds: started.shotIds, keyframes: started.keyframes, voiceLines: started.voiceLines, quote: started.quote, at }] } : {}),
        ...(started?.blocked.length ? { blocked: started.blocked } : {}) } } : null;
    w.snapshot = { ...w.snapshot, conversation: [...(w.snapshot.conversation ?? []), reply], ...(turn ? { turns: [...(w.snapshot.turns ?? []), turn] } : {}), ...(asks.length ? { notes: [...(w.snapshot.notes ?? []), ...asks] } : {}) };
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
 * - `jobs`: 1.2's clip waits for an answer the service never sent (so Scene 1's keyframes are refused, ATTEMPT_EXISTS),
 *   and the service refuses 3.2's next keyframe: the live progress, the blocked line and Needs attention all show.
 * - `lost`: the voice service never replied for 2.3's line, and the transcription of a recording the person sent got
 *   no reply either (both SUBMISSION_RESPONSE_LOST, counted as spent): the voice row, Needs attention and the thread
 *   say it may be charged and how it is made again.
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
  const order = ["codex", "no-ffmpeg", "markdown", "held", "failed", "jobs", "lost"];
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
    if (preset === "jobs") {
      // 1.2's clip was sent but the service never answered, and its keyframe is due a new take: Scene 1 waits on the
      // old job. The service will refuse 3.2's next keyframe (not charged).
      const shots = { ...world.overview.shots };
      const shot = shots[shotId("1.2")]!;
      const { artifact, ...keyframe } = shot.keyframe;
      shots[shot.shotId] = { ...shot, keyframe: { ...keyframe, state: "outdated", ...(artifact ? { previous: artifact } : {}), outdatedFields: ["imagePrompt"] },
        video: { state: "no_answer", takeCount: shot.video.takeCount, attemptId: "fixture-attempt-1-2-video", phase: "submission_unknown", startedAt: laterToday(1) } };
      world.overview = recompute({ ...world.overview, shots }, world.snapshot.notes ?? [], world.snapshot.project.shots);
      fixtureFailNextKeyframe(world, shotId("3.2"));
    }
    if (preset === "lost") {
      const lost = { code: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false, autoRetriesLeft: 0, charged: true, at: laterToday(4) };
      const shots = { ...world.overview.shots };
      const shot = shots[shotId("2.3")]!;
      shots[shot.shotId] = { ...shot, narration: { ...shot.narration, state: "failed", failure: lost } };
      world.overview = recompute({ ...world.overview, shots }, world.snapshot.notes ?? [], world.snapshot.project.shots);
      const requestId = "request-lost";
      const message: ConversationEntry = { id: requestId, role: "user", text: "Here is my reading of the opening line, can you write it down?", requestId, at: laterToday(4) };
      const reply: ConversationEntry = { id: "m-lost", role: "assistant", text: "I sent your recording to be transcribed.", requestId, at: laterToday(4), runtime: "scripted" };
      const turn: TurnView = { id: "turn-lost", requestId, state: "completed", runtime: "scripted", action: "conversation",
        effects: { notesCreated: 0, proposalsHeld: 0, changesApplied: 0, generation: [{ kind: "transcription", sceneIds: [], shotIds: [], keyframes: 0, voiceLines: 0,
          quote: { micros: "6000", units: 1, unitMicros: "6000", priceUnknown: false }, at: laterToday(4), transcription: { state: "failed", failure: lost } }] } };
      world.snapshot = { ...world.snapshot, conversation: [...(world.snapshot.conversation ?? []), message, reply], turns: [...(world.snapshot.turns ?? []), turn] };
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
