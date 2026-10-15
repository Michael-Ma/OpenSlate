import type { ProjectListItem } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import type { MessageId } from "../i18n/messages.ts";
import { errorMsg } from "../i18n/translate.ts";
import type { Action } from "../store/reducer.ts";
import type { StudioState } from "../store/state.ts";
import { CommandRefused } from "./commands.ts";
import { CODEX_NOT_FOUND, directorSetupBody, type CreateBody, type CreationStep, type DirectorSetupRead } from "./start-new.ts";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * The Start view's commands (SB-14, SB-22), written against the store's generic primitives so they
 * run the same with the studio and in fixture mode. Each press has a stable identity: a lost reply
 * resends the same body and key, so the server replays its receipt instead of making a second film.
 */

/** The parts of StudioStore the Start view uses. */
export interface StartStore {
  command<T>(pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }> | { path: string; body: unknown }, toast?: Msg): Promise<T | undefined>;
  read<T>(path: string, signal?: AbortSignal): Promise<T>;
  dispatch(action: Action): void;
  getState(): Pick<StudioState, "toast">;
}

export const FILMS_PATH = "/api/projects?includeArchived=true";
export const PROVIDERS_PATH = "/api/providers";
export const projectPath = (projectId: string, rest = "") => `/api/projects/${encodeURIComponent(projectId)}${rest}`;

export interface Film {
  id: string;
  name: string;
}

export function readFilms(store: Pick<StartStore, "read">, signal?: AbortSignal): Promise<ProjectListItem[]> {
  return store.read<{ projects: ProjectListItem[] }>(FILMS_PATH, signal).then((result) => result.projects);
}

const codeOf = (error: unknown) => (error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR");

function reportFailure(store: Pick<StartStore, "dispatch">, error: unknown): string {
  const code = codeOf(error);
  store.dispatch({ type: "toast", message: errorMsg(code), tone: "error" });
  return code;
}

/**
 * The code of the refusal the store just showed for a press (its new error toast), or null when it
 * showed none (the press was not sent). The store words a refusal with the code's general message.
 */
export function shownRefusal(store: Pick<StartStore, "getState">, toastBefore: number | undefined): string | null {
  const toast = store.getState().toast;
  if (!toast || toast.id === toastBefore || toast.tone !== "error") return null;
  const { id, values } = toast.message;
  if (id === "error.unknown") return typeof values?.code === "string" ? values.code : null;
  return id.startsWith("error.") ? id.slice("error.".length) : null;
}

type Pressed<T> = { ok: true; value: T } | { ok: false; code: string | null };

/** store.command, plus the code of its refusal; `restate` swaps the general text of a code for Start's own words. */
async function press<T>(
  store: StartStore, pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }> | { path: string; body: unknown },
  toast?: Msg, restate: Partial<Record<string, MessageId>> = {},
): Promise<Pressed<T>> {
  const before = store.getState().toast?.id;
  const value = await store.command<T>(pressId, logical, build, toast);
  if (value !== undefined) return { ok: true, value };
  const code = shownRefusal(store, before);
  const own = code ? restate[code] : undefined;
  if (own) store.dispatch({ type: "toast", message: msg(own), tone: "error" });
  return { ok: false, code };
}

/** POST /rename needs the film's head version, which the list does not carry: read it when the press is built. */
export async function renameFilm(store: StartStore, id: string, name: string): Promise<boolean> {
  const result = await press<{ headVersion: number }>(store, `start:rename:${id}`, { id, name }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(id));
    return { path: projectPath(id, "/rename"), body: { name, expectedHeadVersion: snapshot.project.headVersion } };
  }, msg("start.rename.done", { name }));
  return result.ok;
}

/** Archive is soft and refused while jobs run (ATTEMPTS_RUNNING); restore brings the film back to the list. */
export async function setArchived(store: StartStore, film: Film, archived: boolean): Promise<boolean> {
  const action = archived ? "archive" : "unarchive";
  const result = await press<unknown>(store, `start:${action}:${film.id}`, { id: film.id, archived }, () => ({ path: projectPath(film.id, `/${action}`), body: {} }),
    msg(archived ? "start.archive.done" : "start.archived.restored", { name: film.name }));
  return result.ok;
}

export interface CreationInput {
  body: CreateBody;
  steps: CreationStep[];
  plan: { fileName: string; text: string } | null;
}

export interface CreationResult {
  film: Film | null;
  /** The step that did not finish; null when every step did. The store, or this file, already showed why. */
  failedAt: CreationStep | null;
  /** The code that step was refused with; null when it finished, or when nothing was sent. */
  code: string | null;
}

export interface CreationEvents {
  /** Each step as it starts. */
  onStep(step: CreationStep): void;
  /** The film exists (called once, right after Create), whatever the later steps do. */
  onMade?(film: Film): void;
}

/**
 * Create a film and run its first steps. `resume` skips the steps already done for a film that
 * exists (after a failed Codex check or plan send), so Try again never makes a second film.
 * Stops at the first step that does not finish; the caller decides what that means (afterFailure).
 */
export async function runCreation(store: StartStore, input: CreationInput, events: CreationEvents, resume?: { film: Film; from: CreationStep }): Promise<CreationResult> {
  let film = resume?.film ?? null;
  // A resumed run never creates again: a step that no longer applies (the plan was cleared) is simply done.
  const start = !resume ? 0 : input.steps.includes(resume.from) ? input.steps.indexOf(resume.from) : input.steps.length;
  for (const step of input.steps.slice(start)) {
    events.onStep(step);
    if (step === "create") {
      // A model list that changed under the sheet is Start's to explain: the person checks the models and creates again.
      const created = await press<Film>(store, "start:create", { kind: "create", ...input.body }, () => ({ path: "/api/projects", body: input.body }), undefined,
        { PROVIDER_CATALOG_CHANGED: "start.new.models_changed" });
      if (!created.ok) return { film: null, failedAt: "create", code: created.code };
      film = { id: created.value.id, name: created.value.name };
      events.onMade?.(film);
      continue;
    }
    if (!film) return { film: null, failedAt: step, code: null };
    const done = step === "director" ? await setUpDirector(store, film) : await sendPlan(store, film, input.plan);
    if (!done.ok) return { film, failedAt: step, code: done.code };
  }
  return { film, failedAt: null, code: null };
}

type StepDone = { ok: true } | { ok: false; code: string | null };

/** Turn on the Codex Director with this computer's defaults (local-director.ts configure). No Codex here is CODEX_NOT_FOUND. */
async function setUpDirector(store: StartStore, film: Film): Promise<StepDone> {
  let setup: DirectorSetupRead;
  try {
    setup = await store.read<DirectorSetupRead>(projectPath(film.id, "/director/setup"));
  } catch (error) {
    return { ok: false, code: reportFailure(store, error) };
  }
  if (setup.selection.mode === "native") return { ok: true };
  const body = directorSetupBody(setup);
  if (!body) return { ok: false, code: reportFailure(store, new CommandRefused(CODEX_NOT_FOUND)) };
  const result = await press<unknown>(store, `start:director:${film.id}`, { id: film.id, ...body }, () => ({ path: projectPath(film.id, "/director/setup"), body }));
  return result.ok ? { ok: true } : result;
}

/** POST /plan-imports: the Director reads the plan and proposes an outline; nothing changes until the person confirms in Plan. */
async function sendPlan(store: StartStore, film: Film, plan: CreationInput["plan"]): Promise<StepDone> {
  if (!plan) return { ok: true };
  const result = await press<{ requestId: string }>(store, `start:import:${film.id}`, { id: film.id, name: plan.fileName, text: plan.text }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(film.id));
    return { path: projectPath(film.id, "/plan-imports"), body: { name: plan.fileName, text: plan.text, expectedHeadVersion: snapshot.project.headVersion } };
  });
  return result.ok ? { ok: true } : result;
}

/**
 * The demo is its own film: created with the built-in stand-in models (no selection), then filled
 * by the stand-in Director (POST /demo). `pending` is a demo film whose filling did not start, so a
 * second press fills that film instead of making another.
 */
export async function openDemo(store: StartStore, name: string, pending: Film | null): Promise<{ film: Film | null; filled: boolean }> {
  let film = pending;
  if (!film) {
    const created = await press<Film>(store, "start:demo:create", { kind: "demo", name }, () => ({ path: "/api/projects", body: { name } }));
    if (!created.ok) return { film: null, filled: false };
    film = { id: created.value.id, name: created.value.name };
  }
  const target = film;
  // ACTOR_DENIED here means this studio has no stand-in Director to fill the demo (app.ts /demo); elsewhere it means other things.
  const filled = await press<unknown>(store, `start:demo:fill:${target.id}`, { id: target.id }, () => ({ path: projectPath(target.id, "/demo"), body: { action: "create" } }), undefined,
    { ACTOR_DENIED: "start.demo.unavailable" });
  return { film: target, filled: filled.ok };
}
