import type {
  CodePlanAnswerInput, CodePlanCeilingInput, CodePlanChoiceView, CodePlanDiff, CodePlanRunState, CodePlanSourceInput, CodePlanStepKind,
  CodePlanStepState, CodePlanStepView, CodePlanVersionItem, CodePlanView, Micros, StudioArtifactRef,
} from "@openslate/core/public";
import { canonicalJson } from "../store/press-keys.ts";
import { formatMicros, microsFromDollars } from "./price.ts";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * Code-plan projects (docs/ai/code-plan/DESIGN.md): the Director writes the film's plan as a program, the studio replays
 * it, and the web shows what the latest pass reached. Everything here is pure and works on the read model alone
 * (CodePlanView, CodePlanSourceView); graph projects never reach it. Statuses are codes mapped to message ids.
 */

// ---- the project switch --------------------------------------------------------------------

/** True for the open film when it was made as a code plan. Absent `planMode` (every older film) is graph. */
export const isCodeProject = (snapshot: Pick<ProjectSnapshot, "project"> | null | undefined, projectId: string | null): boolean =>
  !!snapshot && !!projectId && snapshot.project.id === projectId && snapshot.project.planMode === "code";

/** One dollar: what "Raise the limit" adds to the ceiling (CP-3's default ceiling is $1). */
export const CEILING_STEP_MICROS = 1_000_000n;

const micros = (value: Micros | undefined): bigint => (typeof value === "string" && /^\d{1,18}$/.test(value) ? BigInt(value) : 0n);

/** The top bar's title line for a code-plan film: "Code plan · experimental", and what its plan declared. */
export function codePlanHeading<T extends { title: string; meta: Msg | null; counts: Msg | null }>(heading: T, view: CodePlanView | null): T {
  const plan = view && view.planVersion !== null ? declaredPlan(view) : null;
  return { ...heading, meta: msg("codeplan.meta"), counts: plan ? msg("shell.counts", { scenes: plan.scenes.length, shots: plan.shotCount }) : null };
}

// ---- media in the plan's values ------------------------------------------------------------

const SHA256 = /^[a-f0-9]{64}$/;
const KINDS = new Set<StudioArtifactRef["kind"]>(["image", "video", "audio", "document"]);
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** A StudioArtifactRef exactly as the contract shapes it, or null. Nothing else is read as media. */
export function artifactRefOf(value: unknown): StudioArtifactRef | null {
  if (!isObject(value)) return null;
  const { artifactId, sha256, kind } = value;
  if (typeof artifactId !== "string" || !artifactId || artifactId.length > 200 || typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  if (typeof kind !== "string" || !KINDS.has(kind as StudioArtifactRef["kind"])) return null;
  return { artifactId, sha256, kind: kind as StudioArtifactRef["kind"] };
}

/** A choice option's media: the option itself, or its `artifact` (a ctx.image result or `{ label, artifact }`). */
export const optionArtifact = (value: unknown): StudioArtifactRef | null =>
  artifactRefOf(value) ?? (isObject(value) ? artifactRefOf(value.artifact) : null);

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const text = (value: unknown, max = 2000): string => (typeof value === "string" ? clip(value.trim(), max) : "");
/** The first of `keys` that holds non-empty text. */
const pick = (row: Record<string, unknown>, keys: readonly string[], max = 2000): string => {
  for (const key of keys) {
    const value = text(row[key], max);
    if (value) return value;
  }
  return "";
};

/** What an option says: its own words, a label it carries, or compact JSON; null for a media option without a label. */
export function optionLabel(value: unknown): string | null {
  if (typeof value === "string") return clip(value.trim(), 200) || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isObject(value)) {
    const own = pick(value, ["label", "title", "name"], 200);
    if (own) return own;
    if (optionArtifact(value)) return null;
  }
  if (value === null || value === undefined) return null;
  return clip(canonicalJson(value), 80);
}

// ---- the run strip ------------------------------------------------------------------------

/** busy: working. attention: waits for you. failed: went wrong. done: finished. */
export type RunTone = "busy" | "attention" | "failed" | "done" | "plain";

export const TONE_CLASS: Record<RunTone, string> = { busy: "status busy", attention: "status attn", failed: "status fail", done: "status ok", plain: "status" };
/** The mark beside a state's word, so colour never says it alone. Busy work spins instead. */
export const TONE_GLYPH: Partial<Record<RunTone, string>> = { done: "✓", failed: "!" };

/** The share of the ceiling from which the meter warns. */
export const HIGH_SPEND = 0.8;

/** A typed spend limit: whether it can be saved, and what is wrong with it if not. */
export function limitDraft(draft: string, view: Pick<CodePlanView, "ceilingMicros" | "spentMicros" | "reservedMicros">): { micros: string | null; problem: "invalid" | "below" | null; changed: boolean } {
  const micros = microsFromDollars(draft);
  if (micros === null) return { micros: null, problem: "invalid", changed: false };
  const floor = BigInt(view.spentMicros) + BigInt(view.reservedMicros);
  return { micros, problem: BigInt(micros) < floor ? "below" : null, changed: micros !== view.ceilingMicros };
}

export interface RunStrip {
  state: CodePlanRunState;
  status: Msg;
  tone: RunTone;
  /** A Director turn holds new paid work while it updates the plan. */
  held: boolean;
  spend: Msg;
  /** Shares of the ceiling, 0..1, for the meter: charged (or possibly charged), then dispatched and not yet known. */
  meter: { spent: number; reserved: number; level: "high" | "full" | null };
  /** paused_budget only: the next ceiling and its button, and the ceiling reached (as money). */
  raise: { body: CodePlanCeilingInput; label: Msg; ceiling: string } | null;
  /** state "error": the pass's message, as plain text. */
  error: string | null;
  /** Choices still waiting for the person; a retired card waits for nobody. */
  waiting: number;
  /** reviewing only: how many clips the Director is watching before it cuts. */
  reviewingClips: number | null;
}

const STATUS: Record<CodePlanRunState, Msg> = {
  empty: msg("codeplan.state.empty"),
  running: msg("codeplan.state.running"),
  waiting: msg("codeplan.state.waiting"),
  error: msg("codeplan.state.error"),
  paused_budget: msg("codeplan.state.paused_budget"),
  done: msg("codeplan.state.done"),
  done_with_failures: msg("codeplan.state.done_with_failures"),
  reviewing: msg("codeplan.state.reviewing"),
};

const share = (part: bigint, whole: bigint) => (whole <= 0n ? 0 : Math.max(0, Math.min(1, Number((part * 10000n) / whole) / 10000)));

export function runStrip(view: CodePlanView, locale: string): RunStrip {
  const ceiling = micros(view.ceilingMicros), spent = micros(view.spentMicros), reserved = micros(view.reservedMicros);
  const waiting = view.choices.filter((choice) => !answered(choice) && !choice.stale).length;
  const state = view.state;
  // The Director cleared the plan to talk about ideas: finished, but there is no film to call done.
  const nothing = state === "done" && !view.steps.some((step) => step.reached);
  const status = nothing ? msg("codeplan.state.no_direction") : state === "waiting" ? msg(waiting ? "codeplan.state.waiting_choice" : "codeplan.state.waiting") : STATUS[state] ?? msg("codeplan.state.unknown", { state: String(state) });
  const values = { spent: formatMicros(String(spent), locale), ceiling: formatMicros(String(ceiling), locale) };
  const spend = reserved > 0n
    ? msg("codeplan.run.spend_pending", { ...values, reserved: formatMicros(String(reserved), locale) })
    : msg("codeplan.run.spend", values);
  const next = ceiling + CEILING_STEP_MICROS;
  return {
    state,
    status,
    tone: state === "running" || state === "reviewing" ? "busy" : state === "error" || state === "done_with_failures" ? "failed" : state === "paused_budget" || (state === "waiting" && waiting > 0) ? "attention" : state === "done" && !nothing ? "done" : "plain",
    held: view.held,
    spend,
    meter: { spent: share(spent, ceiling), reserved: share(reserved, ceiling), level: share(spent, ceiling) >= 1 ? "full" : share(spent, ceiling) >= HIGH_SPEND ? "high" : null },
    raise: state === "paused_budget" ? { body: { ceilingMicros: String(next) }, label: msg("codeplan.run.raise", { ceiling: formatMicros(String(next), locale) }), ceiling: values.ceiling } : null,
    error: state === "error" ? (view.error?.message?.trim() || null) : null,
    waiting,
    reviewingClips: state === "reviewing" ? (view.reviews ?? []).filter((review) => review.state === "waiting" || review.state === "watching").reduce((sum, review) => sum + review.clipCount, 0) : null,
  };
}

// ---- choices ------------------------------------------------------------------------------

export const answered = (choice: Pick<CodePlanChoiceView, "answer" | "answeredAt">): boolean => choice.answeredAt !== undefined || choice.answer !== undefined;

/** How a shot's clip uses its keyframe (`ctx.keyframe`); the first the model allows is the default. */
export type KeyframeInput = "keyframe_and_references" | "references_only" | "first_frame";
const KEYFRAME_INPUTS: readonly string[] = ["keyframe_and_references", "references_only", "first_frame"];

/** An option of a keyframe to confirm: the plan's flat artifact plus how the clip would use it and what that costs. */
function keyframeOption(value: unknown): NonNullable<ChoiceOption["keyframe"]> | null {
  if (!isObject(value) || typeof value.keyframeInput !== "string" || !KEYFRAME_INPUTS.includes(value.keyframeInput)) return null;
  return { input: value.keyframeInput as KeyframeInput, priceMicros: typeof value.priceMicros === "string" ? value.priceMicros : null, references: Array.isArray(value.references) ? value.references.length : 0 };
}

export interface ChoiceOption {
  index: number;
  /** Exactly as the plan passed it; the answer sends this value back. */
  value: unknown;
  artifact: StudioArtifactRef | null;
  /** null: a media option without words (the card names it "Option n"). */
  label: string | null;
  /** A clip's still, for its thumbnail. */
  poster: StudioArtifactRef | null;
  /** The option's own `approved` field, when the plan asks to pass or reject something. */
  approved: boolean | null;
  /** A way for this shot's clip to use its keyframe. */
  keyframe: { input: KeyframeInput; priceMicros: string | null; references: number } | null;
  chosen: boolean;
}

export interface ChoiceCard {
  choiceId: string;
  optionsDigest: string;
  question: string;
  options: ChoiceOption[];
  answered: boolean;
  /** The option the answer equals; null when unanswered (or the answer matches none, which the server never stores). */
  chosen: number | null;
  /** Every option is media: the card lays them out as thumbnails. */
  media: boolean;
  /** Every option is the same clip: the card shows that one clip, and its options are what to do with it. */
  clip: { artifact: StudioArtifactRef; poster: StudioArtifactRef | null; stepKey: string | null } | null;
  /** Every option is a way to use one keyframe: the card shows that picture once, and pressing an option confirms it. */
  keyframe: StudioArtifactRef | null;
  /** Its place in the thread: when it was asked, so answering a card never moves it. Older rows only have their answer's time. */
  at: string | null;
  /** The latest plan no longer reaches it: it says so and asks nothing. */
  stale: boolean;
}

export function choiceCard(choice: CodePlanChoiceView, steps: readonly CodePlanStepView[] = []): ChoiceCard {
  const done = answered(choice);
  const answer = done ? canonicalJson(choice.answer) : null;
  const stepOf = (artifact: StudioArtifactRef | null) => (artifact ? steps.find((step) => step.artifact?.artifactId === artifact.artifactId) : undefined);
  const rows = (Array.isArray(choice.options) ? choice.options : []).slice(0, 24).map((value, index): ChoiceOption => {
    const artifact = optionArtifact(value);
    return { index, value, artifact, label: optionLabel(value), poster: artifactRefOf(stepOf(artifact)?.poster), approved: isObject(value) && typeof value.approved === "boolean" ? value.approved : null,
      keyframe: keyframeOption(value), chosen: answer !== null && canonicalJson(value) === answer };
  });
  // Two options on one clip are not two clips to compare: they are two answers about it.
  const first = rows[0]?.artifact ?? null;
  const oneClip = rows.length > 1 && first?.kind === "video" && rows.every((option) => option.artifact?.artifactId === first.artifactId);
  // One picture with ways to use it is a keyframe to confirm, not pictures to compare.
  const oneFrame = rows.length > 0 && first?.kind === "image" && rows.every((option) => option.keyframe && option.artifact?.artifactId === first.artifactId);
  const options = oneClip || oneFrame ? rows.map((option) => ({ ...option, artifact: null })) : rows;
  const chosen = options.find((option) => option.chosen)?.index ?? null;
  return {
    choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, question: text(choice.question, 500), options, answered: done, chosen,
    media: options.length > 0 && options.every((option) => option.artifact),
    clip: oneClip && first ? { artifact: first, poster: rows[0]!.poster, stepKey: stepOf(first)?.key ?? null } : null,
    keyframe: oneFrame ? first : null,
    at: choice.askedAt ?? (done && typeof choice.answeredAt === "string" ? choice.answeredAt : null),
    stale: choice.stale === true,
  };
}

/**
 * Where timed items (a film's choices) go among the thread's entries: before the first entry written after them.
 * `entryTimes` are the entries' times in thread order (null: unknown, never compared); an item with no time, or later
 * than every entry, comes after them. Returns the items before each entry and the rest.
 */
export function placeByTime<T extends { at: string | null }>(entryTimes: readonly (string | null)[], items: readonly T[]): { before: T[][]; after: T[] } {
  const before: T[][] = entryTimes.map(() => []);
  const after: T[] = [];
  const time = (value: string | null) => (value === null ? Number.NaN : Date.parse(value));
  for (const item of items) {
    const at = time(item.at);
    const index = Number.isNaN(at) ? -1 : entryTimes.findIndex((entry) => time(entry) > at);
    if (index < 0) after.push(item);
    else before[index]!.push(item);
  }
  return { before, after };
}

/**
 * The cards of the thread, in the order they were asked; a waiting card with no time comes last. A retired card that
 * was never answered and has no time has nowhere to sit, and nothing left to say.
 */
export function threadChoices(view: CodePlanView | null): ChoiceCard[] {
  if (!view) return [];
  const cards = view.choices.map((choice) => choiceCard(choice, view.steps)).filter((card) => card.at !== null || !card.stale);
  const time = (card: ChoiceCard) => (card.at === null ? Number.POSITIVE_INFINITY : Date.parse(card.at));
  return cards.map((card, index) => ({ card, index })).sort((a, b) => time(a.card) - time(b.card) || a.index - b.index).map(({ card }) => card);
}

/** The press for one answer: one per choice, and a different option is a different request. */
export function answerPress(choice: Pick<CodePlanChoiceView, "choiceId" | "optionsDigest">, answer: unknown): { pressId: string; logical: unknown; body: CodePlanAnswerInput } {
  return {
    pressId: `codeplan:choice:${choice.choiceId}`,
    logical: { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: canonicalJson(answer) },
    body: { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer },
  };
}

export const CEILING_PRESS = "codeplan:ceiling";

/** Raising from this ceiling to that one; a second press from the same ceiling resends the same request. */
export function ceilingPress(view: Pick<CodePlanView, "ceilingMicros">, body: CodePlanCeilingInput): { pressId: string; logical: unknown; body: CodePlanCeilingInput } {
  return { pressId: CEILING_PRESS, logical: { from: view.ceilingMicros, to: body.ceilingMicros }, body };
}

/** Retrying this step from its current attempt; a second press before the studio answers resends the same request. */
export function retryPress(step: Pick<StepRow, "key" | "attempts">): { pressId: string; logical: unknown } {
  return { pressId: `codeplan:retry:${step.key}`, logical: { stepKey: step.key, attempt: step.attempts } };
}

export const SOURCE_PRESS = "codeplan:source";

/** FNV-1a, hex: a short stand-in for the source in the press's logical identity (the body keeps the whole source). */
function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function sourcePress(input: CodePlanSourceInput): { pressId: string; logical: unknown; body: CodePlanSourceInput } {
  return { pressId: SOURCE_PRESS, logical: { basedOnVersion: input.basedOnVersion, length: input.source.length, digest: fnv(input.source) }, body: input };
}

// ---- steps (Keyframes and Film) -----------------------------------------------------------

export interface StepRow {
  key: string;
  kind: CodePlanStepKind;
  state: CodePlanStepState;
  status: Msg;
  tone: RunTone;
  label: string;
  model: string;
  price: Msg | null;
  artifact: StudioArtifactRef | null;
  /** The latest pass reached it; an unreached step is history. */
  reached: boolean;
  /** An answered choice picked this step's output. */
  chosen: boolean;
  error: string | null;
  /** A failed step (or one whose answer never came): what happened, in plain words, and what a retry would mean. */
  problem: StepProblem | null;
  /** Attempts so far, retries included (1 when the studio does not say). */
  attempts: number;
  /** A still of a made clip or render, for its thumbnail. */
  poster: StudioArtifactRef | null;
  /** A render that cropped clips of another shape: how many, and the least of a clip's picture that survived. */
  fitWarning: { clips: number; keptPercent: number } | null;
  updatedAt: string;
}

export type ProblemCause = "lost" | "refused" | "key" | "busy" | "timeout" | "media" | "input" | "limit" | "other";

export interface StepProblem {
  cause: ProblemCause;
  /** What happened. */
  what: Msg;
  /** "It may already have cost $0.10", when the vendor may have charged. */
  cost: Msg | null;
  /** The step's price as money ("$0.10"), for the retry confirm; null when it has none. */
  price: string | null;
  /** What a retry means: free of double charges ("safe"), may charge again ("consent"), or will not help ("none"). */
  retry: "safe" | "consent" | "none";
  retryNote: Msg;
}

const STEP_STATUS: Record<CodePlanStepState, Msg> = {
  absent: msg("codeplan.step.absent"),
  in_flight: msg("codeplan.step.in_flight"),
  unknown: msg("codeplan.step.unknown"),
  succeeded: msg("codeplan.step.succeeded"),
  failed: msg("codeplan.step.failed"),
  cancelled: msg("codeplan.step.cancelled"),
};

/** A step the person must see: it failed, or the run stopped waiting for the service's answer. */
export const needsAttention = (step: Pick<CodePlanStepView, "state" | "error" | "reached">): boolean =>
  step.reached && (step.state === "failed" || (step.state === "unknown" && !!step.error));

/** The tab that shows a step of this kind. */
export const viewOfStep = (kind: CodePlanStepKind): "assets" | "film" => (kind === "image" ? "assets" : "film");

/** The tabs holding a step that needs the person (their red dot). */
export function attentionViews(view: CodePlanView | null): Set<"assets" | "film"> {
  return new Set((view?.steps ?? []).filter(needsAttention).map((step) => viewOfStep(step.kind)));
}

/** A code-plan step in "Needs attention": what failed, in plain words, and the tab that shows it. */
export interface CodePlanAttentionItem { key: string; view: "assets" | "film"; badge: Msg; title: Msg; detail: Msg }

export function codePlanAttentionItems(view: CodePlanView | null, locale: string): CodePlanAttentionItem[] {
  if (!view) return [];
  return view.steps.filter(needsAttention).map((step) => {
    const kind = step.kind === "image" ? "image" : step.kind === "render" ? "render" : step.kind === "music" ? "music" : "clip";
    const label = stepName(step, view, 60);
    const problem = stepProblem(step, locale);
    return {
      key: step.key, view: viewOfStep(step.kind), badge: msg(`codeplan.attention.badge_${kind}`),
      title: kind === "render" ? msg("codeplan.attention.title_render") : msg(`codeplan.attention.title_${kind}`, { label }),
      detail: problem?.what ?? msg("codeplan.problem.other", { code: step.error?.code ?? "?" }),
    };
  });
}

/** Codes are the vendors' and the runtime's own; their words decide the cause, never the exact spelling. */
export function problemCause(code: string | null | undefined, state: CodePlanStepState): ProblemCause {
  const value = (code ?? "").toUpperCase();
  const has = (...parts: string[]) => parts.some((part) => value.includes(part));
  if (!value) return state === "unknown" ? "lost" : "other";
  if (has("RESPONSE_LOST", "RESPONSE_LOSS", "TRANSPORT", "NO_ANSWER")) return "lost";
  if (has("MODERAT", "CONTENT", "SAFETY", "POLICY", "REFUS", "FACE")) return "refused";
  if (has("CREDENTIAL", "AUTH", "UNAUTHORIZED", "FORBIDDEN", "API_KEY")) return "key";
  if (has("RATE", "QUOTA", "429", "BUSY", "OVERLOAD")) return "busy";
  if (has("TIMEOUT", "TIMED_OUT", "EXPIRED")) return "timeout";
  if (has("CEILING", "BUDGET", "LIMIT")) return "limit";
  if (has("MEDIA", "INGEST", "PROBE", "DOWNLOAD", "DECODE")) return "media";
  if (has("INPUT", "INVALID", "UNSUPPORTED", "VALIDATION")) return "input";
  return "other";
}

/** The plain account of a failed step; the runtime's own facts (N1) win over what the cause suggests. */
export function stepProblem(step: CodePlanStepView, locale: string): StepProblem | null {
  if (!(step.state === "failed" || (step.state === "unknown" && step.error))) return null;
  const code = step.error?.code ?? null;
  const cause = problemCause(code, step.state);
  const retry = step.error?.retry ?? (cause === "refused" || cause === "input" || cause === "limit" ? "none" : "consent");
  const charged = step.error?.mayHaveCharged ?? cause === "lost";
  const price = micros(step.priceMicros);
  return {
    cause,
    what: cause === "other" ? msg("codeplan.problem.other", { code: code ?? "?" }) : msg(`codeplan.problem.${cause}`),
    cost: charged && price > 0n ? msg("codeplan.problem.charged", { price: formatMicros(String(price), locale) }) : null,
    price: price > 0n ? formatMicros(String(price), locale) : null,
    retry,
    retryNote: msg(`codeplan.problem.retry_${retry}`),
  };
}

/** The artifact ids an answered choice picked. */
export function chosenArtifacts(view: CodePlanView): Set<string> {
  const ids = new Set<string>();
  for (const choice of view.choices) {
    if (!answered(choice) || choice.stale) continue;
    const artifact = optionArtifact(choice.answer);
    if (artifact) ids.add(artifact.artifactId);
  }
  return ids;
}

/** Past this, a step that is still "making" is called out: vendors can sit on a task with no sign of failure. */
export const SLOW_STEP_MS = 10 * 60 * 1000;

/** A step's name for the person: its shot's title, since prompts are written in English for the models. */
function stepName(step: Pick<CodePlanStepView, "label" | "shotId">, view: CodePlanView, max: number): string {
  const shot = step.shotId ? view.declarations.shots.find((row) => isObject(row) && row.id === step.shotId) : undefined;
  return (isObject(shot) ? pick(shot, ["title"], max) : "") || text(step.label, max);
}

export function stepRow(step: CodePlanStepView, view: CodePlanView, locale: string, chosen = chosenArtifacts(view), now = Date.now()): StepRow {
  const artifact = step.state === "succeeded" ? artifactRefOf(step.artifact) : null;
  const waited = step.state === "in_flight" ? now - new Date(step.updatedAt).getTime() : 0;
  // A reached step that was never sent while the run is paused at the ceiling is waiting for the limit.
  const budget = step.state === "absent" && step.reached && view.state === "paused_budget";
  const price = micros(step.priceMicros);
  return {
    key: step.key, kind: step.kind, state: step.state,
    status: budget ? msg("codeplan.step.budget") : waited >= SLOW_STEP_MS ? msg("codeplan.step.slow", { minutes: Math.floor(waited / 60000) })
      : STEP_STATUS[step.state] ?? msg("codeplan.state.unknown", { state: String(step.state) }),
    tone: step.state === "in_flight" ? waited >= SLOW_STEP_MS ? "attention" : "busy" : step.state === "failed" || step.state === "unknown" ? "failed" : budget ? "attention" : step.state === "succeeded" ? "done" : "plain",
    label: stepName(step, view, 200), model: text(step.model, 120),
    price: price > 0n ? msg("codeplan.step.price", { price: formatMicros(String(price), locale) }) : null,
    artifact, reached: step.reached, chosen: !!artifact && chosen.has(artifact.artifactId),
    error: step.state === "failed" ? text(step.error?.code, 120) || null : null,
    problem: step.reached ? stepProblem(step, locale) : null,
    attempts: Number.isSafeInteger(step.attempts) && step.attempts! > 0 ? step.attempts! : 1,
    poster: step.state === "succeeded" ? artifactRefOf(step.poster) : null,
    fitWarning: step.state === "succeeded" ? step.fitWarning ?? null : null,
    updatedAt: step.updatedAt,
  };
}

/** Reached steps of these kinds in journal order, then the history (unreached), newest first. */
export function stepRows(view: CodePlanView, kinds: readonly CodePlanStepKind[], locale: string): { current: StepRow[]; history: StepRow[] } {
  const chosen = chosenArtifacts(view);
  const rows = view.steps.filter((step) => kinds.includes(step.kind)).map((step) => stepRow(step, view, locale, chosen));
  return {
    current: rows.filter((row) => row.reached),
    history: rows.filter((row) => !row.reached).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

/** The film to play: the newest succeeded render the latest pass reached, else the newest succeeded one at all. */
export function latestRender(view: CodePlanView): CodePlanStepView | null {
  const renders = view.steps.filter((step) => step.kind === "render" && step.state === "succeeded" && artifactRefOf(step.artifact));
  const newest = (rows: CodePlanStepView[]) => rows.reduce<CodePlanStepView | null>((best, step) => (!best || step.updatedAt > best.updatedAt ? step : best), null);
  return newest(renders.filter((step) => step.reached)) ?? newest(renders);
}

// ---- declarations (Plan) ------------------------------------------------------------------

export interface DeclaredShot {
  key: string;
  /** "1.2": scene ordinal and shot ordinal, or the plan's own label. */
  label: string;
  purpose: string;
  framing: string;
  seconds: number | null;
  prompt: string;
  motion: string;
  narration: string;
  /** The shot's keyframe: one it names, else its chosen (or newest) image step, by shot then by prompt. */
  picture: StudioArtifactRef | null;
  /** The image step that made `picture`, when one did. */
  pictureStep: string | null;
  /** The shot's newest made clip, its step and, once it exists, the clip's still. */
  clip: { artifact: StudioArtifactRef; poster: StudioArtifactRef | null; stepKey: string } | null;
  /** What the run is making for this shot now: its keyframe and its clip. */
  making: { picture: Making | null; clip: Making | null };
}

/** A step the person is waiting for: being made, queued behind others, or held at the spend limit. */
export interface Making {
  /** unknown: sent, but the service never answered; it may still arrive, and it may have charged. */
  state: "making" | "queued" | "budget" | "unknown";
  /** Whole minutes since it was sent (making only). */
  minutes: number;
}

/** A shared picture of the current plan: uploads, character sheets, empty sets; made, or on its way. */
export interface DeclaredReference {
  key: string;
  /** The image step that makes it; null for an upload. */
  stepKey: string | null;
  label: string;
  artifact: StudioArtifactRef | null;
  making: Making | null;
}

export interface DeclaredScene {
  key: string;
  ordinal: number;
  title: string;
  purpose: string;
  shots: DeclaredShot[];
}

export interface DeclaredPlan {
  scenes: DeclaredScene[];
  /** Shots that name no declared scene (or every shot, when the plan declares no scenes). */
  loose: DeclaredShot[];
  /** The plan's shared pictures, made or on their way, in the order it asked for them. */
  references: DeclaredReference[];
  shotCount: number;
  seconds: number;
}

const idOf = (row: Record<string, unknown>, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = row[key];
    if ((typeof value === "string" && value.trim()) || typeof value === "number") return String(value).trim().slice(0, 200);
  }
  return "";
};

function secondsOf(row: Record<string, unknown>): number | null {
  for (const key of ["seconds", "durationSeconds", "duration"]) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 600) return Math.round(value * 10) / 10;
  }
  return null;
}

/** Image steps grouped by `keyOf`, keeping the chosen frame, else the newest. */
function bestPictures(view: CodePlanView, keyOf: (step: CodePlanStepView) => string | null): Map<string, StudioArtifactRef> {
  const chosen = chosenArtifacts(view);
  const best = new Map<string, { artifact: StudioArtifactRef; chosen: boolean; at: string }>();
  for (const step of view.steps) {
    const artifact = step.kind === "image" && step.state === "succeeded" ? artifactRefOf(step.artifact) : null;
    const key = artifact ? keyOf(step) : null;
    if (!artifact || !key) continue;
    const candidate = { artifact, chosen: chosen.has(artifact.artifactId), at: step.updatedAt };
    const current = best.get(key);
    if (!current || (candidate.chosen && !current.chosen) || (candidate.chosen === current.chosen && candidate.at > current.at)) best.set(key, candidate);
  }
  return new Map([...best].map(([key, value]) => [key, value.artifact]));
}

/** A reached step still to come, or null once it is made, failed or no longer in the plan. */
export function makingOf(step: CodePlanStepView, view: Pick<CodePlanView, "state">, now = Date.now()): Making | null {
  if (!step.reached) return null;
  if (step.state === "in_flight") return { state: "making", minutes: Math.max(0, Math.floor((now - Date.parse(step.updatedAt)) / 60000)) };
  // Unsent work waits only while the run is still going; after an error or the end nothing will send it.
  if (step.state === "absent" && view.state === "paused_budget") return { state: "budget", minutes: 0 };
  if (step.state === "absent" && (view.state === "running" || view.state === "waiting" || view.state === "reviewing")) return { state: "queued", minutes: 0 };
  // Lost in transit: say so where the picture or clip would be, instead of dropping the placeholder.
  if (step.state === "unknown" && !step.error) return { state: "unknown", minutes: 0 };
  return null;
}

/** The busiest of two: something being made says more than something queued. */
const busier = (a: Making | null, b: Making | null): Making | null => (!a ? b : !b ? a : a.state === "making" ? a : b.state === "making" ? b : a.state === "unknown" ? a : b.state === "unknown" ? b : a);

/** How a placeholder says it: making (with minutes, or slow), queued, or held at the limit. */
export function makingMsg(making: Making): Msg {
  if (making.state === "queued") return msg("codeplan.making.queued");
  if (making.state === "unknown") return msg("codeplan.making.unknown");
  if (making.state === "budget") return msg("codeplan.step.budget");
  if (making.minutes * 60000 >= SLOW_STEP_MS) return msg("codeplan.step.slow", { minutes: making.minutes });
  return making.minutes ? msg("codeplan.making.minutes", { minutes: making.minutes }) : msg("codeplan.step.in_flight");
}

/** What the run is making now, by what each thing is for, and how many more wait their turn. Null when nothing is on its way. */
export function makingNow(view: CodePlanView): { items: Msg[]; queued: number; unknown: number } | null {
  const counts = { reference: 0, keyframe: 0, clip: 0, voice: 0, music: 0, render: 0 };
  let queued = 0, unknown = 0;
  for (const step of view.steps) {
    const making = makingOf(step, view);
    if (!making || making.state === "budget") continue;
    if (making.state === "queued") { queued += 1; continue; }
    if (making.state === "unknown") { unknown += 1; continue; }
    const role = step.kind === "image" ? (step.shotId ? "keyframe" : "reference") : step.kind === "video" ? "clip" : step.kind === "speech" ? "voice" : step.kind;
    counts[role] += 1;
  }
  const items = (Object.keys(counts) as (keyof typeof counts)[]).filter((role) => counts[role] > 0).map((role) => msg(`codeplan.making.${role}`, { count: counts[role] }));
  return items.length || queued || unknown ? { items, queued, unknown } : null;
}

/** Each shot's newest made clip. */
function clipsByShot(view: CodePlanView): Map<string, NonNullable<DeclaredShot["clip"]>> {
  const newest = new Map<string, { clip: NonNullable<DeclaredShot["clip"]>; at: string }>();
  for (const step of view.steps) {
    const artifact = step.kind === "video" && step.state === "succeeded" && step.shotId ? artifactRefOf(step.artifact) : null;
    if (!artifact || !step.shotId) continue;
    const current = newest.get(step.shotId);
    if (!current || step.updatedAt > current.at) newest.set(step.shotId, { clip: { artifact, poster: artifactRefOf(step.poster), stepKey: step.key }, at: step.updatedAt });
  }
  return new Map([...newest].map(([shot, value]) => [shot, value.clip]));
}

export function declaredPlan(view: CodePlanView): DeclaredPlan {
  // Image steps carry their shot now; the prompt match keeps older plans working.
  const byShot = bestPictures(view, (step) => step.shotId ?? null), byPrompt = bestPictures(view, (step) => text(step.label, 200)), clips = clipsByShot(view);
  const making = new Map<string, Making | null>();
  for (const step of view.steps) {
    const now = step.shotId && (step.kind === "image" || step.kind === "video") ? makingOf(step, view) : null;
    if (now) making.set(`${step.shotId}:${step.kind}`, busier(making.get(`${step.shotId}:${step.kind}`) ?? null, now));
  }
  const sceneRows = (Array.isArray(view.declarations?.scenes) ? view.declarations.scenes : []).filter(isObject).slice(0, 200);
  const shotRows = (Array.isArray(view.declarations?.shots) ? view.declarations.shots : []).filter(isObject).slice(0, 200);
  const scenes: DeclaredScene[] = sceneRows.map((row, index) => ({
    key: idOf(row, ["id", "sceneId", "key"]) || `scene-${index + 1}`,
    ordinal: index + 1,
    title: pick(row, ["title", "name"], 300),
    purpose: pick(row, ["purpose", "description", "summary"]),
    shots: [],
  }));
  const byKey = new Map(scenes.map((scene) => [scene.key, scene]));
  const loose: DeclaredShot[] = [];
  let seconds = 0;
  shotRows.forEach((row, index) => {
    const sceneKey = idOf(row, ["scene", "sceneId"]);
    const scene = byKey.get(sceneKey) ?? null;
    const prompt = pick(row, ["prompt", "imagePrompt", "image"]);
    const own = artifactRefOf(row.keyframe) ?? artifactRefOf(row.picture);
    const key = idOf(row, ["id", "shotId", "key"]) || `shot-${index + 1}`;
    const picture = own ?? byShot.get(key) ?? (prompt ? byPrompt.get(clip(prompt, 200)) ?? byPrompt.get(prompt.slice(0, 200)) ?? null : null);
    const shot: DeclaredShot = {
      key,
      label: pick(row, ["label"], 12) || (scene ? `${scene.ordinal}.${scene.shots.length + 1}` : String(loose.length + 1)),
      purpose: pick(row, ["purpose", "title", "description", "action"], 500),
      framing: pick(row, ["framing", "shotSize"], 120),
      seconds: secondsOf(row),
      prompt,
      motion: pick(row, ["motion", "camera", "videoPrompt"], 500),
      narration: typeof row.narration === "string" ? text(row.narration) : isObject(row.narration) ? text(row.narration.text) : "",
      picture,
      pictureStep: picture ? view.steps.find((step) => step.artifact?.artifactId === picture.artifactId)?.key ?? null : null,
      clip: clips.get(key) ?? null,
      making: { picture: making.get(`${key}:image`) ?? null, clip: making.get(`${key}:video`) ?? null },
    };
    seconds += shot.seconds ?? 0;
    if (scene) scene.shots.push(shot);
    else loose.push(shot);
  });
  // A shot's own picture is never also listed as shared, even when an older plan left it without a shot.
  const shown = new Set([...scenes.flatMap((scene) => scene.shots), ...loose].flatMap((shot) => (shot.picture ? [shot.picture.artifactId] : [])));
  // What the plan's steps take as references (the server knows their inputs), then shared pictures it makes now.
  const references: DeclaredReference[] = [], listed = new Set<string>();
  for (const value of Array.isArray(view.references) ? view.references.slice(0, 24) : []) {
    const artifact = artifactRefOf(value);
    if (!artifact || artifact.kind !== "image" || shown.has(artifact.artifactId) || listed.has(artifact.artifactId)) continue;
    const step = view.steps.find((row) => row.artifact?.artifactId === artifact.artifactId);
    listed.add(artifact.artifactId);
    references.push({ key: artifact.artifactId, stepKey: step?.key ?? null, label: step ? text(step.label, 200) : "", artifact, making: null });
  }
  for (const step of view.steps) {
    if (step.kind !== "image" || step.shotId || !step.reached) continue;
    const artifact = step.state === "succeeded" ? artifactRefOf(step.artifact) : null;
    const now = makingOf(step, view);
    if (artifact ? shown.has(artifact.artifactId) || listed.has(artifact.artifactId) : !now) continue;
    if (artifact) listed.add(artifact.artifactId);
    references.push({ key: artifact?.artifactId ?? step.key, stepKey: step.key, label: text(step.label, 200), artifact, making: now });
  }
  return { scenes, loose, references, shotCount: shotRows.length, seconds: Math.round(seconds * 10) / 10 };
}

// ---- versions and their diffs (Code) ------------------------------------------------------

export interface FindingRow {
  code: string;
  text: Msg;
  detail: string | null;
}

export interface VersionRow {
  version: number;
  author: Msg;
  createdAt: string;
  sha256: string;
  reused: Msg;
  newSteps: { kind: Msg; model: string; label: string; price: Msg | null }[];
  newCost: Msg | null;
  cancelled: Msg | null;
  certain: Msg;
  dependsOnPending: boolean;
  findings: FindingRow[];
  current: boolean;
}

const FINDINGS = new Set(["SOURCE_SYNTAX", "RUNTIME_ERROR", "UNAWAITED_CALL", "STEP_LIMIT", "CEILING"]);
const KIND_LABEL: Record<CodePlanStepKind, Msg> = {
  image: msg("codeplan.kind.image"), video: msg("codeplan.kind.video"), speech: msg("codeplan.kind.speech"), music: msg("codeplan.kind.music"), render: msg("codeplan.kind.render"),
};

export function findingMsg(code: string): Msg {
  return FINDINGS.has(code) ? msg(`codeplan.finding.${code as "SOURCE_SYNTAX"}`) : msg("codeplan.finding.unknown", { code: clip(code, 60) });
}

export function diffSummary(diff: CodePlanDiff, locale: string) {
  const newSteps = (diff.newSteps ?? []).slice(0, 50).map((step) => {
    const price = micros(step.priceMicros);
    return { kind: KIND_LABEL[step.kind] ?? msg("codeplan.kind.other"), model: text(step.model, 120), label: text(step.label, 200), price: price > 0n ? msg("codeplan.step.price", { price: formatMicros(String(price), locale) }) : null };
  });
  const total = (diff.newSteps ?? []).reduce((sum, step) => sum + micros(step.priceMicros), 0n);
  return {
    reused: msg("codeplan.diff.reused", { count: diff.reusedSteps ?? 0 }),
    newSteps,
    newCost: newSteps.length ? msg("codeplan.diff.new", { count: (diff.newSteps ?? []).length, price: formatMicros(String(total), locale) }) : null,
    cancelled: diff.cancelledSteps ? msg("codeplan.diff.cancelled", { count: diff.cancelledSteps }) : null,
    certain: msg(diff.dependsOnPending ? "codeplan.diff.certain_more" : "codeplan.diff.certain", { price: formatMicros(String(micros(diff.certainMicros)), locale) }),
    dependsOnPending: !!diff.dependsOnPending,
    findings: (diff.findings ?? []).slice(0, 20).map((finding) => ({ code: text(finding.code, 60), text: findingMsg(finding.code), detail: text(finding.detail, 300) || null })),
  };
}

/** Newest first, as the server sends them; the version the run uses is marked. */
export function versionRows(view: CodePlanView, locale: string): VersionRow[] {
  return [...view.versions].sort((a, b) => b.version - a.version).map((item: CodePlanVersionItem) => ({
    version: item.version,
    author: msg(item.author === "user" ? "codeplan.author.user" : "codeplan.author.director"),
    createdAt: item.createdAt,
    sha256: item.sha256,
    ...diffSummary(item.diff, locale),
    current: item.version === view.planVersion,
  }));
}

/** The version listed just before this one (the diff's base), or null for the first. */
export function previousVersion(versions: readonly Pick<CodePlanVersionItem, "version">[], version: number | null): number | null {
  if (version === null) return null;
  const older = versions.map((item) => item.version).filter((value) => value < version);
  return older.length ? Math.max(...older) : null;
}

// ---- a simple line diff ---------------------------------------------------------------------

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
  /** Line number in the earlier version (same, removed). */
  before: number | null;
  /** Line number in this version (same, added). */
  after: number | null;
}

/** Above this many cells the middle is not aligned line by line; it is shown as removed, then added. */
const LCS_LIMIT = 4_000_000;

const splitLines = (source: string) => (source === "" ? [] : source.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"));

/**
 * The lines of `after` against `before` (null: a first version, every line is plain). Common lines at both ends are
 * matched directly; the middle by longest common subsequence while it is small enough.
 */
export function lineDiff(before: string | null, after: string): DiffLine[] {
  const b = before === null ? null : splitLines(before), a = splitLines(after);
  if (b === null) return a.map((line, index) => ({ kind: "same", text: line, before: null, after: index + 1 }));
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const out: DiffLine[] = [];
  for (let index = 0; index < start; index++) out.push({ kind: "same", text: a[index]!, before: index + 1, after: index + 1 });
  const midB = b.slice(start, endB), midA = a.slice(start, endA);
  if (midA.length * midB.length > LCS_LIMIT) {
    midB.forEach((line, index) => out.push({ kind: "removed", text: line, before: start + index + 1, after: null }));
    midA.forEach((line, index) => out.push({ kind: "added", text: line, before: null, after: start + index + 1 }));
  } else {
    // lengths[i][j]: the longest common run of midB[i..] and midA[j..].
    const width = midA.length + 1;
    const lengths = new Uint32Array((midB.length + 1) * width);
    for (let i = midB.length - 1; i >= 0; i--) {
      for (let j = midA.length - 1; j >= 0; j--) {
        lengths[i * width + j] = midB[i] === midA[j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
      }
    }
    let i = 0, j = 0;
    while (i < midB.length || j < midA.length) {
      if (i < midB.length && j < midA.length && midB[i] === midA[j]) {
        out.push({ kind: "same", text: midA[j]!, before: start + i + 1, after: start + j + 1 }); i++; j++;
      } else if (i < midB.length && (j >= midA.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
        out.push({ kind: "removed", text: midB[i]!, before: start + i + 1, after: null }); i++;
      } else {
        out.push({ kind: "added", text: midA[j]!, before: null, after: start + j + 1 }); j++;
      }
    }
  }
  const shift = endB - endA;
  for (let index = endA; index < a.length; index++) out.push({ kind: "same", text: a[index]!, before: index + shift + 1, after: index + 1 });
  return out;
}

export type DiffBlock = { kind: "lines"; lines: DiffLine[] } | { kind: "skip"; count: number };

/** Changed lines with `context` unchanged lines around each change; longer unchanged runs fold into one "n unchanged" row. */
export function changeBlocks(lines: readonly DiffLine[], context = 3): DiffBlock[] {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let at = Math.max(0, index - context); at <= Math.min(lines.length - 1, index + context); at++) keep[at] = true;
  });
  const blocks: DiffBlock[] = [];
  lines.forEach((line, index) => {
    const last = blocks.at(-1);
    if (keep[index]) {
      if (last?.kind === "lines") last.lines.push(line);
      else blocks.push({ kind: "lines", lines: [line] });
    } else if (last?.kind === "skip") last.count++;
    else blocks.push({ kind: "skip", count: 1 });
  });
  return blocks;
}

export const diffCounts = (lines: readonly DiffLine[]) => ({
  added: lines.filter((line) => line.kind === "added").length,
  removed: lines.filter((line) => line.kind === "removed").length,
});
