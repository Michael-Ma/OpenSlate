import type { ProjectListItem } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import { errorMsg } from "../i18n/translate.ts";
import type { Action } from "../store/reducer.ts";
import { CommandRefused } from "./commands.ts";
import { directorSetupBody, type CreateBody, type CreationStep, type DirectorSetupRead } from "./start-new.ts";
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

function reportFailure(store: Pick<StartStore, "dispatch">, error: unknown): void {
  const code = error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR";
  store.dispatch({ type: "toast", message: errorMsg(code), tone: "error" });
}

/** POST /rename needs the film's head version, which the list does not carry: read it when the press is built. */
export async function renameFilm(store: StartStore, id: string, name: string): Promise<boolean> {
  const receipt = await store.command<{ headVersion: number }>(`start:rename:${id}`, { id, name }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(id));
    return { path: projectPath(id, "/rename"), body: { name, expectedHeadVersion: snapshot.project.headVersion } };
  }, msg("start.rename.done", { name }));
  return receipt !== undefined;
}

/** Archive is soft and refused while jobs run (ATTEMPTS_RUNNING); restore brings the film back to the list. */
export async function setArchived(store: StartStore, film: Film, archived: boolean): Promise<boolean> {
  const action = archived ? "archive" : "unarchive";
  const receipt = await store.command<unknown>(`start:${action}:${film.id}`, { id: film.id, archived }, () => ({ path: projectPath(film.id, `/${action}`), body: {} }),
    msg(archived ? "start.archive.done" : "start.archived.restored", { name: film.name }));
  return receipt !== undefined;
}

export interface CreationInput {
  body: CreateBody;
  steps: CreationStep[];
  /** Fail the director step when this computer has no Codex (Talk to the Director, Bring a written plan). */
  requireDirector: boolean;
  plan: { fileName: string; text: string } | null;
}

export interface CreationResult {
  film: Film | null;
  /** The step that did not finish; null when every step did. The store already showed why. */
  failedAt: CreationStep | null;
}

/**
 * Create a film and run its first steps. `resume` skips the steps already done for a film that
 * exists (after a failed Codex check or plan send), so Try again never makes a second film.
 */
export async function runCreation(store: StartStore, input: CreationInput, onStep: (step: CreationStep) => void, resume?: { film: Film; from: CreationStep }): Promise<CreationResult> {
  let film = resume?.film ?? null;
  // A resumed run never creates again: a step that no longer applies (the plan was cleared) is simply done.
  const start = !resume ? 0 : input.steps.includes(resume.from) ? input.steps.indexOf(resume.from) : input.steps.length;
  for (const step of input.steps.slice(start)) {
    onStep(step);
    if (step === "create") {
      const created = await store.command<Film>("start:create", { kind: "create", ...input.body }, () => ({ path: "/api/projects", body: input.body }));
      if (!created) return { film: null, failedAt: "create" };
      film = { id: created.id, name: created.name };
      continue;
    }
    if (!film) return { film: null, failedAt: step };
    const ok = step === "director" ? await setUpDirector(store, film, input.requireDirector) : await sendPlan(store, film, input.plan);
    if (!ok) return { film, failedAt: step };
  }
  return { film, failedAt: null };
}

/** Turn on the Codex Director with this computer's defaults (local-director.ts configure). */
async function setUpDirector(store: StartStore, film: Film, required: boolean): Promise<boolean> {
  let setup: DirectorSetupRead;
  try {
    setup = await store.read<DirectorSetupRead>(projectPath(film.id, "/director/setup"));
  } catch (error) {
    reportFailure(store, error);
    return false;
  }
  if (setup.selection.mode === "native") return true;
  const body = directorSetupBody(setup);
  if (!body) {
    if (!required) return true;
    reportFailure(store, new CommandRefused("CODEX_NOT_FOUND"));
    return false;
  }
  const receipt = await store.command<unknown>(`start:director:${film.id}`, { id: film.id, ...body }, () => ({ path: projectPath(film.id, "/director/setup"), body }));
  return receipt !== undefined;
}

/** POST /plan-imports: the Director reads the plan and proposes an outline; nothing changes until the person confirms in Plan. */
async function sendPlan(store: StartStore, film: Film, plan: CreationInput["plan"]): Promise<boolean> {
  if (!plan) return true;
  const receipt = await store.command<{ requestId: string }>(`start:import:${film.id}`, { id: film.id, name: plan.fileName, text: plan.text }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(film.id));
    return { path: projectPath(film.id, "/plan-imports"), body: { name: plan.fileName, text: plan.text, expectedHeadVersion: snapshot.project.headVersion } };
  });
  return receipt !== undefined;
}

/**
 * The demo is its own film: created with the built-in stand-in models (no selection), then filled
 * by the stand-in Director (POST /demo). `pending` is a demo film whose filling did not start, so a
 * second press fills that film instead of making another.
 */
export async function openDemo(store: StartStore, name: string, pending: Film | null): Promise<{ film: Film | null; filled: boolean }> {
  let film = pending;
  if (!film) {
    const created = await store.command<Film>("start:demo:create", { kind: "demo", name }, () => ({ path: "/api/projects", body: { name } }));
    if (!created) return { film: null, filled: false };
    film = { id: created.id, name: created.name };
  }
  const target = film;
  const receipt = await store.command<unknown>(`start:demo:fill:${target.id}`, { id: target.id }, () => ({ path: projectPath(target.id, "/demo"), body: { action: "create" } }));
  return { film: target, filled: receipt !== undefined };
}
