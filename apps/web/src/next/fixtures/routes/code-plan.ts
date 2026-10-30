import type {
  CodePlanChoiceView, CodePlanDiff, CodePlanReceipt, CodePlanSourceView, CodePlanStepKind, CodePlanStepState, CodePlanStepView, CodePlanVersionItem,
  CodePlanView, GenerationOverview, StudioArtifactRef,
} from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { canonicalJson } from "../../store/press-keys.ts";
import type { ConversationEntry, ProjectSnapshot } from "../../model/types.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { FPS } from "../last-ferry.ts";
import { bumpFilmCursor } from "./start.ts";
import type { FixtureRoute } from "./types.ts";

/**
 * A code-plan film in the sample studio (docs/ai/code-plan/DESIGN.md), so the code-plan screens can be looked at
 * without a server. Nothing is generated, charged or saved: the run moves through fixed stages on simulated time.
 *
 * `?codeplan=` opens "Harbour lights" first (the studio lists it before The Last Ferry):
 * - `waiting` (also `on`): version 2 waits on the opening keyframe, three thumbnails; version 1's frames are history.
 * - `budget`: both frames chosen; 1.2's clip would pass the $1 ceiling, so the run is paused (Raise the limit).
 * - `error`: version 3 threw after the first clip; the error is shown and the run stopped.
 * - `done`: everything made, the render plays in Film.
 * - `empty`: no plan yet; a message to the Director writes version 1.
 * A film made in Start as a code plan starts empty the same way. Choosing a frame, raising the limit and a message to
 * the Director move the run on, as the server would. The Last Ferry (a graph film) refuses these routes.
 */

export type CodePlanPreset = "waiting" | "budget" | "error" | "done" | "empty";
export const CODE_FILM_ID = "harbour-code";
export const CODE_FILM_NAME = "Harbour lights";
/** Simulated provider time for one stage of the run. */
export const CODE_STEP_MS = 1600;

export function codePlanPreset(): CodePlanPreset | null {
  let value: string | null = null;
  try { value = new URLSearchParams(globalThis.location?.search ?? "").get("codeplan"); } catch { return null; }
  if (value === null) return null;
  if (value === "" || value === "on") return "waiting";
  return (["waiting", "budget", "error", "done", "empty"] as const).find((preset) => preset === value) ?? "waiting";
}

// ---- the story's pieces ------------------------------------------------------------------------

/** Where the run is. The main path runs top to bottom; error branches off after the first clip, and its fix rejoins. */
type Stage = "empty" | "making_open" | "waiting" | "making_1_2" | "choose_1_2" | "budget" | "making_clip" | "rendering" | "done" | "error" | "fixed_making";

const IMAGE_MODEL = "flux-schnell", VIDEO_MODEL = "kling-2.1", IMAGE_MICROS = "40000", VIDEO_MICROS = "450000";
/** What the 1.2 clip would bring the spend to: $0.81 spent, $0.45 more. */
const NEEDED_FOR_PIER_CLIP = 1_260_000n;
const PROMPT_TERMINAL = "The ferry terminal at closing time, shutters half down, one lamp on.";
const PROMPT_OPEN = "The empty harbour at dawn, the ferry moored, fog over the water.";
const PROMPT_PIER = "Mara on the pier in her red coat, a ticket in her hand.";

const hex = (text: string) => Array.from(text, (char) => char.charCodeAt(0).toString(16)).join("").replace(/[^0-9a-f]/g, "a").padEnd(64, "0").slice(0, 64);
/** `picture` is a key of the sample illustrations (fixtures/last-ferry-pictures.ts); `n` keeps each artifact distinct. */
const artifact = (picture: string, n: number, kind: StudioArtifactRef["kind"] = "image"): StudioArtifactRef =>
  ({ artifactId: `art-${picture}~${n}`, sha256: hex(`cp-${picture}-${n}`), kind });

const FRAMES = {
  terminal: [artifact("1.1", 101), artifact("1.2", 102), artifact("1.3", 103)],
  open: [artifact("2.1", 111), artifact("3.1", 112), artifact("3.2", 113)],
  pier: [artifact("2.2", 121), artifact("2.2-red", 122), artifact("2.3", 123)],
};
const CLIP_OPEN = artifact("2.1", 301, "video"), CLIP_PIER = artifact("2.2-red", 302, "video"), RENDER = artifact("2.1", 401, "video");

interface CodeFilm {
  stage: Stage;
  /** The versions written so far (newest first) and the one in use. */
  versions: CodePlanVersionItem[];
  sources: Map<number, CodePlanSourceView>;
  current: number | null;
  /** Version 1 opened on the terminal; its frames stay as history once version 2 changed the prompt. */
  history: boolean;
  ceilingMicros: string;
  pickOpen: number;
  pickPier: number;
  held: boolean;
  /** When each step reached its state (the view's updatedAt), so history sorts like a real journal. */
  stamps: Map<string, string>;
}

/** A time today, never later than a few minutes ago (early in the morning, "10:31" has not happened yet). */
function todayAt(hours: number, minutes: number): string {
  const now = new Date();
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  return new Date(Math.min(at.getTime(), now.getTime() - (16 * 60 - (hours * 60 + minutes - 630)) * 1000)).toISOString();
}

// ---- the programs ------------------------------------------------------------------------------

type Draft = "terminal" | "harbour" | "bug" | "fix";

function program(draft: Draft): string {
  const open = draft === "terminal" ? PROMPT_TERMINAL : PROMPT_OPEN;
  const pierMotion = draft === "terminal" ? "Static" : "Slow push-in";
  const frame = draft === "bug"
    ? `    // Reuse the frame chosen for 1.1 in every later shot.
    const frame = firstFrame ?? await chooseFrame(ctx, shot);
    firstFrame = takes[0].artifact;`
    : draft === "fix"
      ? `    // Reuse the frame chosen for 1.1 in every later shot.
    const frame = firstFrame ?? await chooseFrame(ctx, shot);
    firstFrame ??= frame;`
      : `    const frame = await chooseFrame(ctx, shot);`;
  return `import type { Studio } from "./studio";

/** Harbour lights: Mara waits for the last ferry. Two shots, three frames each. */
export default async function film(ctx: Studio): Promise<void> {
  ctx.scene({ id: "harbour", title: "${draft === "terminal" ? "Closing time" : "Harbour at dawn"}", purpose: "Mara waits for the last ferry." });
  const shots = [
    { id: "1.1", scene: "harbour", purpose: "Where the film opens", framing: "Wide", seconds: 5,
      prompt: "${open}", motion: "Slow pan right across the water" },
    { id: "1.2", scene: "harbour", purpose: "Mara on the pier", framing: "Medium", seconds: 5,
      prompt: "${PROMPT_PIER}", motion: "${pierMotion}" },
  ];
  const clips = [];${draft === "bug" || draft === "fix" ? "\n  let firstFrame = null;" : ""}
  for (const shot of shots) {
    ctx.shot({ ...shot, label: shot.id });
${frame}
    const clip = await ctx.video({ model: "${VIDEO_MODEL}", firstFrame: frame, motion: shot.motion, seconds: shot.seconds });
    if (!clip.ok) {
      ctx.log(\`\${shot.id}: the clip failed (\${clip.error.code}); keeping the still\`);
      continue;
    }
    clips.push(clip.artifact);
  }
  ctx.log(\`Rendering \${clips.length} clips\`);
  await ctx.render({ clips });
}

async function chooseFrame(ctx: Studio, shot: { id: string; prompt: string }) {
  const takes = await Promise.all([1, 2, 3].map((variant) =>
    ctx.image({ model: "${IMAGE_MODEL}", prompt: shot.prompt, variant })));
  const frames = takes.filter((take) => take.ok).map((take) => take.artifact);
  return ctx.choose(\`frame-\${shot.id}\`, {
    question: \`Which frame should \${shot.id} start from?\`,
    options: frames,
  });
}
`;
}

const images = (prompt: string) => [1, 2, 3].map(() => ({ kind: "image" as const, model: IMAGE_MODEL, label: prompt, priceMicros: IMAGE_MICROS }));
/** Each draft's dry run, as the server would record it. */
const DIFFS: Record<Draft, CodePlanDiff> = {
  terminal: { reusedSteps: 0, newSteps: images(PROMPT_TERMINAL), cancelledSteps: 0, certainMicros: "120000", dependsOnPending: true, findings: [] },
  harbour: { reusedSteps: 0, newSteps: images(PROMPT_OPEN), cancelledSteps: 0, certainMicros: "120000", dependsOnPending: true, findings: [] },
  bug: { reusedSteps: 4, newSteps: [], cancelledSteps: 3, certainMicros: "0", dependsOnPending: true, findings: [{ code: "UNAWAITED_CALL", detail: "line 17: takes is read outside chooseFrame" }] },
  fix: { reusedSteps: 4, newSteps: images(PROMPT_PIER), cancelledSteps: 0, certainMicros: "120000", dependsOnPending: true, findings: [] },
};

function addVersion(film: CodeFilm, draft: Draft, at: [number, number] | null = null): void {
  const version = Math.max(0, ...film.versions.map((item) => item.version)) + 1;
  const createdAt = at ? todayAt(...at) : new Date().toISOString();
  const sha256 = hex(`source-${draft}-${version}`);
  film.versions = [{ version, author: "director", sha256, createdAt, diff: DIFFS[draft] }, ...film.versions];
  film.sources.set(version, { version, author: "director", sha256, source: program(draft), createdAt });
  film.current = version;
}

const PRESET_STAGE: Record<CodePlanPreset, Stage> = { waiting: "waiting", budget: "budget", error: "error", done: "done", empty: "empty" };

function newFilm(preset: CodePlanPreset): CodeFilm {
  const film: CodeFilm = { stage: PRESET_STAGE[preset], versions: [], sources: new Map(), current: null, history: preset !== "empty", ceilingMicros: preset === "done" ? "2000000" : "1000000", pickOpen: 0, pickPier: 1, held: false, stamps: new Map() };
  if (preset !== "empty") { addVersion(film, "terminal", [10, 31]); addVersion(film, "harbour", [10, 36]); }
  if (preset === "error") addVersion(film, "bug", [10, 41]);
  return film;
}

// ---- the view of a stage --------------------------------------------------------------------

const ONE_CHOSEN: readonly Stage[] = ["making_1_2", "choose_1_2", "budget", "making_clip", "rendering", "done", "error", "fixed_making"];
const PIER_FRAMES: readonly Stage[] = ["making_1_2", "fixed_making", "choose_1_2", "budget", "making_clip", "rendering", "done"];
const PIER_CHOSEN: readonly Stage[] = ["budget", "making_clip", "rendering", "done"];
const RUN_STATE: Record<Stage, CodePlanView["state"]> = {
  empty: "empty", making_open: "running", waiting: "waiting", making_1_2: "running", choose_1_2: "waiting", budget: "paused_budget",
  making_clip: "running", rendering: "running", done: "done", error: "error", fixed_making: "running",
};

function viewOf(film: CodeFilm, projectId: string): CodePlanView {
  const { stage } = film;
  const steps: CodePlanStepView[] = [];
  const add = (key: string, kind: CodePlanStepKind, label: string, model: string, priceMicros: string, state: CodePlanStepState, reached: boolean, made?: StudioArtifactRef) => {
    const seen = film.stamps.get(`${key}:${state}`) ?? new Date().toISOString();
    film.stamps.set(`${key}:${state}`, seen);
    steps.push({ key, kind, state, model, label, priceMicros, reached, updatedAt: seen, ...(state === "succeeded" && made ? { artifact: made } : {}) });
  };
  const started = stage !== "empty";
  // Version 1's terminal frames: made before version 2 moved the opening to the harbour, now history.
  if (started && film.history) FRAMES.terminal.forEach((frame, index) => add(`img-terminal-${index + 1}`, "image", PROMPT_TERMINAL, IMAGE_MODEL, IMAGE_MICROS, "succeeded", false, frame));
  if (started) FRAMES.open.forEach((frame, index) => add(`img-open-${index + 1}`, "image", PROMPT_OPEN, IMAGE_MODEL, IMAGE_MICROS, stage === "making_open" ? "in_flight" : "succeeded", true, frame));
  if (ONE_CHOSEN.includes(stage)) add("clip-open", "video", "Slow pan right across the water", VIDEO_MODEL, VIDEO_MICROS, stage === "making_1_2" ? "in_flight" : "succeeded", true, CLIP_OPEN);
  if (PIER_FRAMES.includes(stage)) {
    const making = stage === "making_1_2" || stage === "fixed_making";
    FRAMES.pier.forEach((frame, index) => add(`img-pier-${index + 1}`, "image", PROMPT_PIER, IMAGE_MODEL, IMAGE_MICROS, making ? "in_flight" : "succeeded", true, frame));
  }
  if (PIER_CHOSEN.includes(stage)) add("clip-pier", "video", "Slow push-in on Mara", VIDEO_MODEL, VIDEO_MICROS, stage === "budget" ? "absent" : stage === "making_clip" ? "in_flight" : "succeeded", true, CLIP_PIER);
  if (stage === "rendering" || stage === "done") add("render", "render", "Harbour lights · 2 clips", "ffmpeg", "0", stage === "rendering" ? "in_flight" : "succeeded", true, RENDER);

  const choices: CodePlanChoiceView[] = [];
  const choice = (choiceId: string, options: StudioArtifactRef[], pick: number | null, at: [number, number]) => {
    choices.push({ choiceId, optionsDigest: hex(`${choiceId}:${options.map((o) => o.artifactId).join(",")}`), question: `Which frame should ${choiceId.slice("frame-".length)} start from?`, options,
      ...(pick !== null ? { answer: options[pick], answeredAt: todayAt(...at) } : {}) });
  };
  if (started && stage !== "making_open") choice("frame-1.1", FRAMES.open, ONE_CHOSEN.includes(stage) ? film.pickOpen : null, [10, 38]);
  if (PIER_FRAMES.includes(stage) && stage !== "making_1_2" && stage !== "fixed_making") choice("frame-1.2", FRAMES.pier, PIER_CHOSEN.includes(stage) ? film.pickPier : null, [10, 39]);
  // Unanswered first, then answered, each in first-seen order (the contract's order).
  choices.sort((a, b) => Number(a.answer !== undefined) - Number(b.answer !== undefined));

  const sum = (rows: CodePlanStepView[]) => String(rows.reduce((total, step) => total + BigInt(step.priceMicros), 0n));
  const terminal = film.current !== null && film.sources.get(film.current)?.source.includes(PROMPT_TERMINAL);
  const shots = film.current === null ? [] : [
    { id: "1.1", scene: "harbour", label: "1.1", purpose: "Where the film opens", framing: "Wide", seconds: 5, prompt: terminal ? PROMPT_TERMINAL : PROMPT_OPEN, motion: "Slow pan right across the water" },
    { id: "1.2", scene: "harbour", label: "1.2", purpose: "Mara on the pier", framing: "Medium", seconds: 5, prompt: PROMPT_PIER, motion: terminal ? "Static" : "Slow push-in" },
  ];
  return {
    projectId,
    planVersion: film.current,
    state: RUN_STATE[stage],
    ...(stage === "error" ? { error: { message: "TypeError: Cannot read properties of undefined (reading '0')\n    at film (plan.ts:17:24)" } } : {}),
    held: film.held,
    ceilingMicros: film.ceilingMicros,
    // Charged plus possibly charged; then dispatched and not yet known.
    spentMicros: sum(steps.filter((step) => step.state === "succeeded" || step.state === "failed" || step.state === "unknown")),
    reservedMicros: sum(steps.filter((step) => step.state === "in_flight")),
    declarations: { scenes: film.current === null ? [] : [{ id: "harbour", title: terminal ? "Closing time" : "Harbour at dawn", purpose: "Mara waits for the last ferry." }], shots },
    steps,
    choices,
    versions: film.versions.slice(0, 50),
    logs: ONE_CHOSEN.includes(stage) ? ["1.1: frame chosen", ...(stage === "rendering" || stage === "done" ? ["Rendering 2 clips"] : [])] : [],
    lastPassAt: started ? new Date().toISOString() : null,
  };
}

// ---- the films and their state ---------------------------------------------------------------

const worlds = new WeakMap<FixtureWorld, Map<string, CodeFilm>>();

function films(world: FixtureWorld): Map<string, CodeFilm> {
  let map = worlds.get(world);
  if (!map) {
    map = new Map();
    const preset = codePlanPreset();
    if (preset) map.set(CODE_FILM_ID, newFilm(preset));
    worlds.set(world, map);
  }
  return map;
}

export const isCodeFilm = (world: FixtureWorld, projectId: string): boolean => films(world).has(projectId);

/** A code-plan film made in Start: no plan yet. */
export function addCodeFilm(world: FixtureWorld, projectId: string): void {
  films(world).set(projectId, newFilm("empty"));
}

function filmOf(world: FixtureWorld, projectId: string | undefined): CodeFilm {
  // The Last Ferry (no id in the path) and every other sample film plan as a graph.
  const film = projectId ? films(world).get(projectId) : undefined;
  if (!film) throw new ApiError("CODE_PLAN_MODE", 409);
  return film;
}

/** Move the run on: a new view, so the film's cursor moves and the studio reads it again. */
function moveTo(world: FixtureWorld, projectId: string, stage: Stage): void {
  const film = filmOf(world, projectId);
  film.stage = stage;
  bumpFilmCursor(world, projectId);
  // Work in flight comes back after a while, like a provider's result; the run then goes on by itself.
  const next: Partial<Record<Stage, Stage>> = { making_open: "waiting", making_1_2: "choose_1_2", making_clip: "rendering", rendering: "done", fixed_making: "choose_1_2" };
  const then = next[stage];
  if (!then) return;
  world.later(CODE_STEP_MS, (w) => { if (filmOf(w, projectId).stage === stage) moveTo(w, projectId, then); });
}

const receipt = (world: FixtureWorld, projectId: string): CodePlanReceipt => ({ view: viewOf(filmOf(world, projectId), projectId) });

// ---- the Director's messages in a code-plan film ------------------------------------------------

/** A message arrived: the Director holds new paid work while it reads it. */
export function holdCodeFilm(world: FixtureWorld, projectId: string): void {
  const film = films(world).get(projectId);
  if (!film) return;
  film.held = true;
  bumpFilmCursor(world, projectId);
}

/** The scripted Director's reply in a code-plan film, and what it does to the plan (runs inside a world update). */
export function codeFilmReply(world: FixtureWorld, projectId: string): string {
  const film = films(world).get(projectId);
  if (!film) return "";
  film.held = false;
  if (film.stage === "empty") {
    addVersion(film, "harbour");
    moveTo(world, projectId, "making_open");
    return "I wrote the plan as code: one scene, two shots, three frames for each. The first frames are being made; pick one in the card below when they are back.";
  }
  if (film.stage === "error") {
    addVersion(film, "fix");
    moveTo(world, projectId, "fixed_making");
    return "Fixed: version 3 read a value that only exists inside chooseFrame. Version 4 reuses the frame you chose properly; 1.2's frames are being made.";
  }
  bumpFilmCursor(world, projectId);
  return "I read your note. The plan already does that, so the code stays as it is.";
}

/** The sample film's opening state: its snapshot (planMode "code"), and a conversation that fits the preset. */
export function codeFilmData(projectId: string, name: string, preset: CodePlanPreset | "empty"): { snapshot: ProjectSnapshot; overview: GenerationOverview } {
  const revisionId = `rev-${projectId}-1`;
  const say = (id: string, role: "user" | "assistant", text: string, at: [number, number]): ConversationEntry =>
    ({ id: `${projectId}-${id}`, role, text, requestId: `${projectId}-${id.replace(/-reply$/, "")}`, at: todayAt(...at), ...(role === "assistant" ? { runtime: "scripted" as const } : { scopeIds: [] }) });
  const conversation: ConversationEntry[] = preset === "empty" ? [] : [
    say("m1", "user", "A short film: Mara waits for the last ferry. Two shots.", [10, 30]),
    say("m1-reply", "assistant", "I wrote the plan as code: one scene, two shots, three frames for each. Pick the frames in the cards below.", [10, 31]),
    say("m2", "user", "Open on the harbour at dawn instead, with fog. And push in slowly on Mara.", [10, 35]),
    say("m2-reply", "assistant", "Changed 1.1 to the harbour at dawn and 1.2 to a slow push-in. Three new frames for 1.1 are ready; the earlier ones stay in Keyframes as history.", [10, 36]),
    ...(preset === "error" ? [
      say("m3", "user", "Use the frame I picked for 1.1 in 1.2 as well.", [10, 40]),
      say("m3-reply", "assistant", "Done in version 3: 1.2 now starts from the frame chosen for 1.1.", [10, 41]),
    ] : []),
  ];
  return {
    snapshot: { project: { id: projectId, name, revisionId, headVersion: 1, planMode: "code", brief: "", story: "", scenes: [], shots: [] }, conversation, questions: [], notes: [], control: { paused: false }, cursor: 1 },
    overview: { projectId, revisionId, headVersion: 1, cursor: 1, fps: FPS, stopped: null, director: { state: "idle", scopeIds: [] }, controlAuthorityId: null, scenes: [], shots: {}, restartCasualties: [] },
  };
}

// ---- routes ----------------------------------------------------------------------------------

const asObject = (body: unknown): Record<string, unknown> => (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {});
/** The Last Ferry's own paths are relative (no id); the other films' are absolute. */
const own = (rest: string) => new RegExp(`^(?:/api/projects/([^/?]+))?/code-plan${rest}$`);

export const codePlanRoutes: FixtureRoute[] = [
  { method: "GET", match: own(""), handle: (world, [id]) => viewOf(filmOf(world, id), id!) },
  {
    method: "GET",
    match: own("/versions/(\\d+)"),
    handle(world, [id, version]) {
      const source = filmOf(world, id).sources.get(Number(version));
      if (!source) throw new ApiError("NOT_FOUND", 404);
      return structuredClone(source);
    },
  },
  {
    method: "POST",
    match: own("/choices"),
    handle(world, [id], body) {
      const film = filmOf(world, id);
      const input = asObject(body);
      const pending = viewOf(film, id!).choices.find((choice) => choice.answer === undefined && choice.choiceId === input.choiceId);
      if (!pending || pending.optionsDigest !== input.optionsDigest) throw new ApiError("CODE_PLAN_CHOICE_STALE", 409);
      const index = pending.options.findIndex((option) => canonicalJson(option) === canonicalJson(input.answer));
      if (index < 0) throw new ApiError("VALIDATION_ERROR", 400);
      if (pending.choiceId === "frame-1.1") { film.pickOpen = index; moveTo(world, id!, "making_1_2"); }
      else {
        film.pickPier = index;
        // 1.2's clip would pass a $1 ceiling, so the run pauses there.
        moveTo(world, id!, BigInt(film.ceilingMicros) >= NEEDED_FOR_PIER_CLIP ? "making_clip" : "budget");
      }
      return receipt(world, id!);
    },
  },
  {
    method: "POST",
    match: own("/ceiling"),
    handle(world, [id], body) {
      const film = filmOf(world, id);
      const next = asObject(body).ceilingMicros;
      if (typeof next !== "string" || !/^\d{1,18}$/.test(next) || BigInt(next) <= BigInt(film.ceilingMicros)) throw new ApiError("VALIDATION_ERROR", 400);
      film.ceilingMicros = next;
      if (film.stage === "budget" && BigInt(next) >= NEEDED_FOR_PIER_CLIP) moveTo(world, id!, "making_clip");
      else bumpFilmCursor(world, id!);
      return receipt(world, id!);
    },
  },
  {
    method: "POST",
    match: own("/source"),
    handle(world, [id], body) {
      const film = filmOf(world, id);
      const input = asObject(body);
      if (typeof input.source !== "string" || !input.source.trim() || input.source.length > 256 * 1024) throw new ApiError("VALIDATION_ERROR", 400);
      if (input.basedOnVersion !== film.current) throw new ApiError("REVISION_CONFLICT", 409);
      const version = Math.max(0, ...film.versions.map((item) => item.version)) + 1;
      const createdAt = new Date().toISOString(), sha256 = hex(`source-user-${version}`);
      const diff: CodePlanDiff = { reusedSteps: viewOf(film, id!).steps.filter((step) => step.reached).length, newSteps: [], cancelledSteps: 0, certainMicros: "0", dependsOnPending: false, findings: [] };
      film.versions = [{ version, author: "user", sha256, createdAt, diff }, ...film.versions];
      film.sources.set(version, { version, author: "user", sha256, source: input.source, createdAt });
      film.current = version;
      bumpFilmCursor(world, id!);
      return { ...receipt(world, id!), diff };
    },
  },
];
