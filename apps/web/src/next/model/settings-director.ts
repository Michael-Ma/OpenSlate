import type { MessageId } from "../i18n/messages.ts";
import type { Request } from "./settings.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Settings view, Director section: the film's Director (Codex or the scripted demo), its setup, and the
 * "Director reviews new keyframes" switch (D4). Shapes follow apps/server/src/application/local-director.ts.
 */

export interface DirectorSelection {
  mode: "fake" | "native";
  binaryPath?: string;
  model?: string;
  codexHome?: string;
}

/** GET /director/setup (and /director/models, which first runs Codex's read-only setup check). */
export interface DirectorSetup {
  selection: DirectorSelection;
  selectionDigest: string;
  busy: boolean;
  changeAvailable: boolean;
  changeAppliesTo: "next_turn";
  defaults: { binaryPath: string; model: string; codexHome?: string };
  /** The film's first conversation happened: a change goes through /director/change. */
  locked: boolean;
  modelCalls: number;
  modelChoices: { id: string; label: string }[];
  modelCatalogStatus: "unchecked" | "ready" | "blocked";
  modelCatalogCheckedAt: string | null;
  /** Present after a save: the result of Codex's setup check for that selection. */
  readiness?: { status: "ready" | "blocked"; checks?: Record<string, string> } | null;
}

/** GET /settings/director-review (server card B10). */
export interface DirectorReview {
  enabled: boolean;
}

export const DEMO_VALUE = "fake";
const NATIVE_PREFIX = "native:";

export const directorValue = (selection: DirectorSelection): string =>
  selection.mode === "fake" ? DEMO_VALUE : `${NATIVE_PREFIX}${selection.model ?? ""}`;

/** The Codex program the Director would use: the saved one, else the one this computer found. */
export const codexProgram = (setup: DirectorSetup): string => setup.selection.binaryPath ?? setup.defaults.binaryPath ?? "";

export type CodexState = "ready" | "blocked" | "unchecked" | "missing";

/** Codex on this computer, from the last setup check. No program found at all is "missing". */
export function codexState(setup: DirectorSetup): CodexState {
  if (setup.readiness?.status === "ready") return "ready";
  if (setup.readiness?.status === "blocked") return "blocked";
  if (!codexProgram(setup)) return "missing";
  return setup.modelCatalogStatus;
}

export interface DirectorChoice {
  value: string;
  /** A Codex model id ("gpt-6-astra"), or null for the Demo Director. */
  model: string | null;
  ready: boolean;
  reason: Msg | null;
  estimate: Msg;
}

export interface DirectorRow {
  selected: string;
  choices: DirectorChoice[];
  /** Why the select is off (a conversation or setup is running). */
  locked: Msg | null;
}

/** The Models table's Director row: Codex with each model it offers, and the Demo Director. */
export function directorRow(setup: DirectorSetup): DirectorRow {
  const state = codexState(setup);
  const ids = setup.modelChoices.map((choice) => choice.id);
  const current = setup.selection.mode === "native" ? setup.selection.model : undefined;
  for (const id of [current, setup.defaults.model]) if (id && !ids.includes(id)) ids.push(id);
  const reason = state === "missing" ? msg("set.why.codex_missing") : state === "blocked" ? msg("set.why.codex_blocked") : null;
  const native = ids.map((model): DirectorChoice => ({ value: `${NATIVE_PREFIX}${model}`, model, ready: !reason, reason, estimate: msg("set.estimate.director_codex") }));
  return {
    selected: directorValue(setup.selection),
    choices: [...native, { value: DEMO_VALUE, model: null, ready: true, reason: null, estimate: msg("set.estimate.director_demo") }],
    locked: setup.busy || !setup.changeAvailable ? msg("set.director.busy") : null,
  };
}

/** The selection a Models-row switch saves: the demo, or Codex with the chosen model and the known program. */
export function selectionFor(setup: DirectorSetup, value: string): DirectorSelection {
  if (value === DEMO_VALUE) return { mode: "fake" };
  const model = value.startsWith(NATIVE_PREFIX) ? value.slice(NATIVE_PREFIX.length) : setup.defaults.model;
  const codexHome = setup.selection.codexHome ?? setup.defaults.codexHome;
  return { mode: "native", binaryPath: codexProgram(setup), model, ...(codexHome ? { codexHome } : {}) };
}

/**
 * Saving a Director choice. Before the film's first conversation it is the first setup (POST /director/setup);
 * after that it is a change for the next turn, bound to the selection shown (POST /director/change).
 * Both check that Codex runs before saving a Codex choice.
 */
export function directorRequest(setup: DirectorSetup, selection: DirectorSelection): Request {
  const clean: DirectorSelection = selection.mode === "fake" ? { mode: "fake" } : {
    mode: "native",
    binaryPath: selection.binaryPath?.trim() ?? "",
    model: selection.model?.trim() ?? "",
    ...(selection.codexHome?.trim() ? { codexHome: selection.codexHome.trim() } : {}),
  };
  return setup.locked
    ? { path: "/director/change", body: { expectedSelectionDigest: setup.selectionDigest, selection: clean } }
    : { path: "/director/setup", body: clean };
}

export interface DirectorDraft {
  binaryPath: string;
  model: string;
  codexHome: string;
}

export const draftFrom = (setup: DirectorSetup): DirectorDraft => ({
  binaryPath: codexProgram(setup),
  model: (setup.selection.mode === "native" ? setup.selection.model : undefined) ?? setup.defaults.model,
  codexHome: setup.selection.codexHome ?? setup.defaults.codexHome ?? "",
});

const absolute = (path: string) => path.startsWith("/") && !path.includes("\0") && path.length <= 4096;

/** What stops the Codex form from saving, as the server would refuse it. */
export function draftProblems(draft: DirectorDraft): { field: keyof DirectorDraft; problem: Msg }[] {
  const problems: { field: keyof DirectorDraft; problem: Msg }[] = [];
  if (!absolute(draft.binaryPath.trim())) problems.push({ field: "binaryPath", problem: msg("set.director.need_path") });
  if (!/^[A-Za-z0-9_.:/-]{1,120}$/.test(draft.model.trim())) problems.push({ field: "model", problem: msg("set.director.need_model") });
  if (draft.codexHome.trim() && !absolute(draft.codexHome.trim())) problems.push({ field: "codexHome", problem: msg("set.director.need_path") });
  return problems;
}

export interface ReviewSwitch {
  /** What the switch shows. */
  on: boolean;
  disabled: boolean;
  /** Why it is off, when it is. */
  reason: Msg | null;
}

/**
 * The "Director reviews new keyframes" switch (D4). The route arrives with server card B10: until then the
 * read answers 404 and the switch is off with a short reason. It also needs the Codex Director.
 */
export function reviewSwitch(read: { data: DirectorReview | null; status: number | null; error: string | null }, setup: DirectorSetup | null): ReviewSwitch {
  const off = (id: MessageId): ReviewSwitch => ({ on: false, disabled: true, reason: msg(id) });
  if (read.status === 404 || read.error === "NOT_FOUND") return off("set.review.unavailable");
  if (setup && setup.selection.mode !== "native") return off("set.review.needs_codex");
  if (read.error) return off("set.review.read_failed");
  if (!read.data || !setup) return { on: false, disabled: true, reason: null };
  return { on: read.data.enabled, disabled: false, reason: null };
}

export const reviewRequest = (enabled: boolean, headVersion: number): Request => ({ path: "/settings/director-review", body: { enabled, expectedHeadVersion: headVersion } });
