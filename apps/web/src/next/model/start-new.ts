import type { Locale } from "../../shared/locale-preference.ts";
import type { MessageId } from "../i18n/messages.ts";
import { formatMicros } from "./price.ts";
import { msg, type Msg } from "./types.ts";

/**
 * The New film sheet and the first-run setup card (SB-22): which models a new film gets on this
 * computer, how ready each one is, and what creating the film sends. Keys are configured outside
 * the app; this only explains them (risk noted in SB-22).
 */

/** The server's plan-import limit (plan-imports.ts). */
export const PLAN_TEXT_MAX = 12000;

// ---- GET /api/providers (apps/server/src/application/provider-catalog.ts view()) ----

export type ProviderKind = "image" | "video" | "speech" | "transcription";

export interface ProviderRow {
  id: string;
  /** Host-configured label, e.g. "OpenAI gpt-image-2"; the built-in stand-ins are labelled by the server in English, so they are never shown. */
  label: string;
  profile: { kind: ProviderKind; adapter: string; configuration?: { model: string } } | null;
  estimatedCost: { unitMicros: string; basis: "fixture" | "host_configured" } | null;
  usage?: { kind: "codex_subscription" };
  readiness: {
    configurationValid: boolean;
    registered: boolean;
    mediaTools: { required: boolean; available: boolean };
    credential: { required: boolean; present: boolean | null; backendUnavailable: boolean };
    enabledByHost?: boolean;
    realExecutionEnabled: boolean;
  };
}

export interface ProviderCatalog {
  catalogDigest: string;
  /** The built-in stand-in profiles; a film created without a selection uses these. */
  defaults: string[];
  profiles: ProviderRow[];
  realExecutionEnabled: boolean;
}

// ---- GET /api/projects/:projectId/director/setup (local-director.ts settings()) ----

export interface DirectorSetupRead {
  selection: { mode: "fake" | "native"; binaryPath?: string; model?: string; codexHome?: string };
  /** The host's suggestion for this computer; binaryPath is "" when no Codex executable was found. */
  defaults: { binaryPath: string; model: string; codexHome?: string };
}

/**
 * Codex is per film on the server, but whether this computer has it is the same for every film.
 * "unknown" until a film's Director setup has been read: on a first run no film is open, so the
 * answer only comes once the new film exists (its Director step reads it).
 */
export type Codex = { state: "found"; model: string } | { state: "not_found" } | { state: "unknown" };

export function codexFrom(setup: DirectorSetupRead | null | undefined): Codex {
  if (!setup) return { state: "unknown" };
  if (setup.selection.mode === "native" && setup.selection.binaryPath) return { state: "found", model: setup.selection.model ?? setup.defaults.model };
  return setup.defaults.binaryPath ? { state: "found", model: setup.defaults.model } : { state: "not_found" };
}

/** POST /director/setup body that turns on the Codex Director with this computer's defaults; null without Codex. */
export function directorSetupBody(setup: DirectorSetupRead): { mode: "native"; binaryPath: string; model: string; codexHome?: string } | null {
  if (!setup.defaults.binaryPath) return null;
  return { mode: "native", binaryPath: setup.defaults.binaryPath, model: setup.defaults.model, ...(setup.defaults.codexHome ? { codexHome: setup.defaults.codexHome } : {}) };
}

// ---- models a new film gets ----

export type Job = "director" | "keyframes" | "video" | "narration" | "transcription";

export const JOB_LABEL: Record<Job, MessageId> = {
  director: "start.job.director", keyframes: "start.job.keyframes", video: "start.job.video", narration: "start.job.narration", transcription: "start.job.transcription",
};
/** The same jobs inside a sentence ("MiniMax H3 video (about $0.50 a clip)"). */
const JOB_INLINE: Record<Job, MessageId> = {
  director: "start.models.job.director", keyframes: "start.models.job.keyframes", video: "start.models.job.video", narration: "start.models.job.narration", transcription: "start.models.job.transcription",
};

/** Each media job, its provider kind, and the unit its price is per (a transcription is one per recording). */
const JOBS: readonly { job: Exclude<Job, "director">; kind: ProviderKind; price: MessageId }[] = [
  { job: "keyframes", kind: "image", price: "start.price.keyframe" },
  { job: "video", kind: "video", price: "start.price.clip" },
  { job: "narration", kind: "speech", price: "start.price.line" },
  { job: "transcription", kind: "transcription", price: "start.price.recording" },
];

export interface ModelRow {
  job: Job;
  /** The model's own label (content, not interface copy); null for the free stand-in. */
  model: string | null;
  price: Msg;
  /** Ready, or why not (for a stand-in: which real model is waiting, and for what). */
  status: Msg;
  ok: boolean;
}

export interface ModelPlan {
  rows: ModelRow[];
  /** POST /api/projects selection; null when the film gets the built-in stand-ins. */
  selection: { expectedCatalogDigest: string; profileIds: string[] } | null;
  /** Media jobs (keyframes, video, narration, transcription) with a ready real model. */
  ready: number;
  total: number;
}

const isStandIn = (row: ProviderRow) => row.profile?.adapter === "fake" || row.estimatedCost?.basis === "fixture";

export type NotReady = "key" | "tools" | "off" | "setup";

/** Why a real model is not ready yet, most actionable reason first. */
export function notReadyReason(row: ProviderRow): NotReady {
  const r = row.readiness;
  if (r.credential.required && r.credential.present !== true) return "key";
  if (r.mediaTools.required && !r.mediaTools.available) return "tools";
  if (r.enabledByHost === false) return "off";
  return "setup";
}

const WAITING: Record<NotReady, MessageId> = {
  key: "start.ready.waiting_key",
  tools: "start.ready.waiting_tools",
  off: "start.ready.waiting_off",
  setup: "start.ready.waiting_setup",
};

function priceOf(row: ProviderRow, unit: MessageId, locale: Locale): Msg {
  if (isStandIn(row)) return msg("start.price.stand_in");
  if (row.usage?.kind === "codex_subscription" || row.profile?.adapter === "codex-image") return msg("start.price.codex");
  const micros = row.estimatedCost?.unitMicros;
  // Never "$0.00": a model without a configured estimate says so.
  if (!micros || !/^\d+$/.test(micros) || Number(micros) === 0) return msg("start.price.unset");
  return msg(unit, { price: formatMicros(micros, locale) });
}

/**
 * This computer's defaults for a new film: per job, the first real model that is ready, else the
 * built-in stand-in. The Director row says whether the Codex Director will be set up.
 */
export function modelPlan(catalog: ProviderCatalog, codex: Codex, locale: Locale): ModelPlan {
  const rows: ModelRow[] = [];
  const chosen: string[] = [];
  let ready = 0;
  rows.push(codex.state === "found"
    ? { job: "director", model: `Codex · ${codex.model}`, price: msg("start.price.codex"), status: msg("start.ready.ready"), ok: true }
    : codex.state === "not_found"
      ? { job: "director", model: null, price: msg("start.price.stand_in"), status: msg("start.ready.codex_missing"), ok: false }
      : { job: "director", model: "Codex", price: msg("start.price.codex"), status: msg("start.ready.codex_unknown"), ok: false });
  for (const { job, kind, price } of JOBS) {
    const candidates = catalog.profiles.filter((row) => row.profile?.kind === kind);
    const real = candidates.filter((row) => !isStandIn(row));
    const usable = real.find((row) => row.readiness.realExecutionEnabled);
    const standIn = candidates.find((row) => catalog.defaults.includes(row.id)) ?? candidates.find(isStandIn);
    if (usable) {
      ready++;
      chosen.push(usable.id);
      rows.push({ job, model: usable.label, price: priceOf(usable, price, locale), status: msg("start.ready.ready"), ok: true });
      continue;
    }
    if (standIn) chosen.push(standIn.id);
    const waiting = real[0];
    rows.push({
      job,
      model: null,
      price: msg("start.price.stand_in"),
      status: waiting ? msg(WAITING[notReadyReason(waiting)], { model: waiting.label }) : msg("start.ready.none"),
      ok: false,
    });
  }
  const allDefaults = chosen.every((id) => catalog.defaults.includes(id));
  return {
    rows,
    selection: allDefaults || !chosen.length ? null : { expectedCatalogDigest: catalog.catalogDigest, profileIds: chosen },
    ready,
    total: JOBS.length,
  };
}

/**
 * The impact line above "See each model": which ready models the film gets, each with its price, so
 * the paid defaults are named before Create. `say` translates one message (the list is built from
 * translated parts, so it reads in the interface language).
 */
export function modelSummaryText(plan: ModelPlan, say: (message: Msg) => string): string {
  if (plan.ready === 0) return say(msg("start.models.none_ready"));
  const models = plan.rows
    .filter((row) => row.ok && row.model)
    .map((row) => say(msg("start.models.item", { job: say(msg(JOB_INLINE[row.job])), model: row.model!, price: say(row.price) })))
    .join(say(msg("start.models.sep")));
  if (plan.ready === plan.total) return say(msg("start.models.all_ready", { models }));
  return say(msg("start.models.some_ready", { ready: plan.ready, total: plan.total, models }));
}

// ---- the first-run "Make your own film" card ----

export interface SetupStatus {
  codex: Codex["state"];
  /** FFmpeg and ffprobe, as the media models report them; null when no model needs them. */
  tools: "found" | "not_found" | null;
  keys: { set: number; total: number };
  /** At least one real media model can run now. */
  realReady: boolean;
}

export function setupStatus(catalog: ProviderCatalog | null, codex: Codex): SetupStatus {
  const real = (catalog?.profiles ?? []).filter((row) => !isStandIn(row));
  const needTools = real.filter((row) => row.readiness.mediaTools.required);
  const needKeys = real.filter((row) => row.readiness.credential.required);
  return {
    codex: codex.state,
    tools: needTools.length ? (needTools.every((row) => row.readiness.mediaTools.available) ? "found" : "not_found") : null,
    keys: { set: needKeys.filter((row) => row.readiness.credential.present === true).length, total: needKeys.length },
    realReady: real.some((row) => row.readiness.realExecutionEnabled),
  };
}

export function keysMsg(keys: SetupStatus["keys"]): Msg {
  if (keys.set === 0) return msg("start.setup.keys_none");
  if (keys.set >= keys.total) return msg("start.setup.keys_all");
  return msg("start.setup.keys_some", { set: keys.set, total: keys.total });
}

// ---- the first step and what Create sends ----

export type FirstStep = "director" | "plan" | "empty";

/** Talking to the Director and reading a written plan need the Codex Director (plan-imports.ts: DIRECTOR_REQUIRED). */
export const stepNeedsCodex = (step: FirstStep): boolean => step !== "empty";
export const stepAvailable = (step: FirstStep, codex: Codex): boolean => !stepNeedsCodex(step) || codex.state !== "not_found";
/** Talk to the Director only when Codex is known to be here; while it is unknown the safe default is the empty outline. */
export const defaultStep = (codex: Codex): FirstStep => (codex.state === "found" ? "director" : "empty");

/**
 * The step the sheet shows: the one the person (or the button that opened the sheet) chose while it
 * is possible, else this computer's default. Derived, so a Codex check that answers after the sheet
 * opened moves an untouched choice to the right default and never leaves a step that is now off.
 */
export const effectiveStep = (chosen: FirstStep | null, codex: Codex): FirstStep => (chosen && stepAvailable(chosen, codex) ? chosen : defaultStep(codex));

export type CreationStep = "create" | "director" | "import";

/**
 * What Create runs, in order. The Codex Director is set up for every new film unless this computer is
 * known to have no Codex (it is this computer's default Director, and a film's Director locks at its
 * first conversation); while Codex is unknown, this step is where the new film finds out.
 * The written plan is sent only when one was given.
 */
export function creationSteps(step: FirstStep, codex: Codex, planText: string): CreationStep[] {
  const steps: CreationStep[] = ["create"];
  if (codex.state !== "not_found") steps.push("director");
  if (step === "plan" && planText.trim()) steps.push("import");
  return steps;
}

export interface CreateBody {
  name: string;
  expectedCatalogDigest?: string;
  profileIds?: string[];
}

export function createBody(name: string, plan: Pick<ModelPlan, "selection"> | null, untitled: string): CreateBody {
  const trimmed = name.trim().slice(0, 160) || untitled;
  const selection = plan?.selection;
  return selection ? { name: trimmed, expectedCatalogDigest: selection.expectedCatalogDigest, profileIds: [...selection.profileIds] } : { name: trimmed };
}

export type PlanTextProblem = "too_long" | "not_text" | null;

export function planTextProblem(text: string): PlanTextProblem {
  if (text.includes("\0")) return "not_text";
  if (text.length > PLAN_TEXT_MAX) return "too_long";
  return null;
}

export const isPlanFileName = (name: string): boolean => /\.(txt|md)$/i.test(name) && name.length <= 160;

/** The document name the import records: the chosen file's, else one made from the film name (the server wants .txt or .md). */
export function planFileName(filmName: string, chosen: string | null): string {
  if (chosen && isPlanFileName(chosen)) return chosen;
  const slug = filmName.trim().toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${slug || "plan"}.txt`;
}

// ---- after Create ----

/** How a creation run ended: the step that did not finish (null when all did) and the code it was refused with. */
export interface CreationEnd {
  failedAt: CreationStep | null;
  code: string | null;
}

/** Client-made: the new film's Director setup shows no Codex executable on this computer. Trying again cannot help. */
export const CODEX_NOT_FOUND = "CODEX_NOT_FOUND";

/**
 * What the sheet does when a step after Create did not finish (the film exists either way):
 * - "open": the step was optional (an empty outline does not need the Director): open the film now;
 * - "final": trying again cannot work (no Codex here): Open the film is the only way on;
 * - "retry": offer Try again, which finishes the same film.
 */
export type AfterFailure = "open" | "final" | "retry";

export function afterFailure(step: FirstStep, failedAt: Exclude<CreationStep, "create">, code: string | null): AfterFailure {
  if (failedAt === "director" && !stepNeedsCodex(step)) return "open";
  if (code === CODEX_NOT_FOUND) return "final";
  return "retry";
}

/** The sheet's explanation once a later step failed. */
export function failedMsg(step: FirstStep, failedAt: Exclude<CreationStep, "create">, code: string | null, name: string): Msg {
  if (code === CODEX_NOT_FOUND) return msg(step === "plan" ? "start.new.failed.no_codex_plan" : "start.new.failed.no_codex", { name });
  return msg(failedAt === "director" ? "start.new.failed.director" : "start.new.failed.import", { name });
}

export type CreatedOutcome = "director" | "plan" | "plan_later" | "empty" | "stand_in" | "setup_later";

/** What the toast says once the film opens: a step that did not finish says what the film has instead. */
export function createdOutcome(step: FirstStep, planText: string, end: CreationEnd): CreatedOutcome {
  if (end.failedAt === null) return step === "plan" ? (planText.trim() ? "plan" : "plan_later") : step;
  if (end.code === CODEX_NOT_FOUND) return "stand_in";
  if (end.failedAt === "director") return "setup_later";
  return "plan_later";
}

const CREATED: Record<CreatedOutcome, MessageId> = {
  director: "start.created.director",
  plan: "start.created.plan",
  plan_later: "start.created.plan_later",
  empty: "start.created.empty",
  stand_in: "start.created.stand_in",
  setup_later: "start.created.setup_later",
};

export const createdMsg = (outcome: CreatedOutcome, name: string): Msg => msg(CREATED[outcome], { name });

/** The sheet's foot: creating is free; reading a written plan uses the Codex plan and makes no media. */
export const sheetFootMsg = (step: FirstStep, planText: string): Msg => msg(step === "plan" && planText.trim() ? "start.new.free_plan" : "start.new.free");
