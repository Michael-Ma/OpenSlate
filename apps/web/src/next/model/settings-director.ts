import type { NativeDiagnostic } from "@openslate/core/public";
import { errorMsg, nativeDiagnosticMsg } from "../i18n/translate.ts";
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
  /** Historical local setup evidence for this exact program/model/configuration; does not start a turn. */
  lastSuccessfulCheck?: { binaryPath: string; version: string; checkedAt: string } | null;
  /** Current version-only inspection. Null means the selected program could not be found/verified. */
  codexVersion?: string | null;
  /** Present after a save: the result of Codex's setup check for that selection. */
  /** The most recent local version failure, including an attempted unsaved program. */
  codexDiagnostic?: { code: "DIRECTOR_CODEX_VERSION_MISMATCH"; expectedVersion: string; foundVersion: string | null; binaryPath: string; installPath: string } | null;
  nativeDiagnostic?: NativeDiagnostic | null;
  readiness?: { status: "ready" | "blocked"; checks?: Record<string, string>; nativeDiagnostic?: NativeDiagnostic } | null;
}

/** GET /settings/director-review (server card B10, apps/server/src/application/keyframe-review.ts). */
export interface DirectorReview {
  enabled: boolean;
}

export const DEMO_VALUE = "fake";
const NATIVE_PREFIX = "native:";

export const directorValue = (selection: DirectorSelection): string =>
  selection.mode === "fake" ? DEMO_VALUE : `${NATIVE_PREFIX}${selection.model ?? ""}`;

/** The Codex program the Director would use: the saved one, else the one this computer found. */
export const codexProgram = (setup: DirectorSetup): string => setup.selection.binaryPath ?? setup.defaults.binaryPath ?? "";

export const codexDiagnostic = (setup: DirectorSetup): Msg | null => setup.codexDiagnostic
  ? errorMsg(setup.codexDiagnostic.code, setup.codexDiagnostic) : nativeDiagnosticMsg(setup.nativeDiagnostic ?? setup.readiness?.nativeDiagnostic, "setup");

export type CodexState = "ready" | "found" | "blocked" | "unchecked" | "missing";

/** Codex on this computer, from the last setup check. No program found at all is "missing". */
export function codexState(setup: DirectorSetup): CodexState {
  if (setup.codexDiagnostic || setup.nativeDiagnostic || setup.readiness?.nativeDiagnostic) return "blocked";
  if (setup.codexVersion === null) return "missing";
  // A setup-command replay may still include its original ready result after a newer failed check.
  if (setup.modelCatalogStatus === "blocked") return "blocked";
  if (setup.readiness?.status === "ready") return "ready";
  if (setup.readiness?.status === "blocked") return "blocked";
  if (!codexProgram(setup)) return "missing";
  if (setup.lastSuccessfulCheck) return "ready";
  if (setup.modelCatalogStatus === "unchecked" && setup.codexVersion) return "found";
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
  const reason = state === "missing" ? msg("set.why.codex_missing") : state === "blocked" ? codexDiagnostic(setup) ?? msg("set.why.codex_blocked") : null;
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

/** The original setup is authority for this form, even after a background refresh. */
export interface DirectorForm {
  baseline: DirectorSetup;
  value: DirectorDraft;
}

export const directorForm = (setup: DirectorSetup): DirectorForm => ({ baseline: structuredClone(setup), value: draftFrom(setup) });
export const directorFormConflict = (form: DirectorForm, current: DirectorSetup): boolean =>
  form.baseline.selectionDigest !== current.selectionDigest || form.baseline.locked !== current.locked;
export const directorFormRequest = (form: DirectorForm): Request => directorRequest(form.baseline, { mode: "native", ...form.value });

/** A delayed success may rebase later typing only inside the form that originally sent it. */
export function afterDirectorSave(current: DirectorForm | null, submitted: DirectorForm, saved: DirectorSetup): DirectorForm | null {
  if (current === submitted) return null;
  return current && current.baseline === submitted.baseline ? { ...current, baseline: saved } : current;
}

const absolute = (path: string) => path.startsWith("/") && !path.includes("\0") && path.length <= 4096;

/** What stops the Codex form from saving, as the server would refuse it. */
export function draftProblems(draft: DirectorDraft): { field: keyof DirectorDraft; problem: Msg }[] {
  const problems: { field: keyof DirectorDraft; problem: Msg }[] = [];
  // An empty program field means this computer found no Codex: say so, not just "use the full path".
  if (!draft.binaryPath.trim()) problems.push({ field: "binaryPath", problem: msg("set.director.need_program") });
  else if (!absolute(draft.binaryPath.trim())) problems.push({ field: "binaryPath", problem: msg("set.director.need_path") });
  if (!/^[A-Za-z0-9_.:/-]{1,120}$/.test(draft.model.trim())) problems.push({ field: "model", problem: msg("set.director.need_model") });
  if (draft.codexHome.trim() && !absolute(draft.codexHome.trim())) problems.push({ field: "codexHome", problem: msg("set.director.need_path") });
  return problems;
}

export interface ReviewSwitch {
  /** What the switch shows: always the server's saved value once it is read. */
  on: boolean;
  disabled: boolean;
  /** Why it cannot be turned on (or why reviews will not work while it is on). */
  reason: Msg | null;
  /** What a review is with this Director: Codex use, or the scripted demo's free notes. */
  note: Msg;
}

/**
 * The "Director reviews new keyframes" switch (D4, server card B10). The server keeps the setting per film,
 * on by default, and starts a review turn after each finished keyframe batch whatever the Director is:
 * Codex reviews use the Codex plan; the Demo Director's are scripted notes, free, without looking at the
 * pictures. So the switch always shows the saved value and can always be turned off. Turning it on is
 * blocked only while the Director is Codex and Codex is missing or failed its check on this computer.
 * A 404 (a server older than B10) is kept as a fallback.
 */
export function reviewSwitch(read: { data: DirectorReview | null; status: number | null; error: string | null }, setup: DirectorSetup | null): ReviewSwitch {
  const native = setup?.selection.mode !== "fake";
  const note = msg(native ? "set.review.body" : "set.review.body_demo");
  const off = (id: MessageId): ReviewSwitch => ({ on: false, disabled: true, reason: msg(id), note });
  if (read.status === 404 || read.error === "NOT_FOUND") return off("set.review.unavailable");
  if (read.error) return off("set.review.read_failed");
  if (!read.data || !setup) return { on: false, disabled: true, reason: null, note };
  const on = read.data.enabled;
  const state = codexState(setup);
  if (native && (state === "missing" || state === "blocked")) return { on, disabled: !on, reason: msg("set.review.needs_codex"), note };
  return { on, disabled: false, reason: null, note };
}

export const reviewRequest = (enabled: boolean, headVersion: number): Request => ({ path: "/settings/director-review", body: { enabled, expectedHeadVersion: headVersion } });

/** The local Codex setup check can take well over the client's default 15 s the first time (lead: up to 90 s). */
export const CODEX_CHECK_TIMEOUT_MS = 120_000;
