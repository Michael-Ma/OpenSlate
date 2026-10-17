import type { ProjectListItem } from "@openslate/core/public";
import { ApiError } from "../api/client.ts";
import type { MessageId } from "../i18n/messages.ts";
import { errorMsg } from "../i18n/translate.ts";
import type { Action } from "../store/reducer.ts";
import type { StudioState, Toast } from "../store/state.ts";
import { CommandRefused } from "./commands.ts";
import { CODEX_CHECK_TIMEOUT_MS } from "./settings-director.ts";
import { CODEX_NOT_FOUND, SETUP_BUSY, directorSetupBody, type Codex, type CreateBody, type CreationStep, type DirectorSetupRead } from "./start-new.ts";
import { msg, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * The Start view's commands (SB-14, SB-22), written against the store's generic primitives so they
 * run the same with the studio and in fixture mode. Each press has a stable identity: a lost reply
 * resends the same body and key, so the server replays its receipt instead of making a second film.
 */

/** The parts of StudioStore the Start view uses. */
export interface StartStore {
  command<T>(
    pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }> | { path: string; body: unknown }, toast?: Msg, options?: { timeoutMs?: number },
  ): Promise<T | undefined>;
  read<T>(path: string, signal?: AbortSignal): Promise<T>;
  dispatch(action: Action): void;
  getState(): Pick<StudioState, "toast">;
}

export const FILMS_PATH = "/api/projects?includeArchived=true";
export const PROVIDERS_PATH = "/api/providers";
export const projectPath = (projectId: string, rest = "") => `/api/projects/${encodeURIComponent(projectId)}${rest}`;
/** The server's Codex setup check can take about 90 s (local-director.ts prepare); the same allowance as Settings'. */
export const DIRECTOR_SETUP_TIMEOUT_MS = CODEX_CHECK_TIMEOUT_MS;

export interface Film {
  id: string;
  name: string;
}

/**
 * Creation can add the first film while Start was only being forced by the empty library. Pin Start
 * before publishing or selecting it, so its in-flight/failed sheet survives every store notification.
 * Selection starts now; opening Plan is still the person's explicit choice after a failed step.
 */
export function selectCreatedFilm(store: {
  dispatch(action: Action): void;
  getState(): Pick<StudioState, "projectId" | "projects">;
  selectProject(projectId: string): Promise<void>;
}, film: Film): Promise<void> {
  store.dispatch({ type: "view", view: "start" });
  const projects = store.getState().projects;
  if (!projects.some(project => project.id === film.id)) store.dispatch({ type: "projects", projects: [{ id: film.id, name: film.name }, ...projects] });
  return store.getState().projectId === film.id ? Promise.resolve() : store.selectProject(film.id);
}

export function readFilms(store: Pick<StartStore, "read">, signal?: AbortSignal): Promise<ProjectListItem[]> {
  return store.read<{ projects: ProjectListItem[] }>(FILMS_PATH, signal).then((result) => result.projects);
}

const codeOf = (error: unknown) => (error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR");

/**
 * The code of the refusal the store just showed for a press (a new error toast), or null when it
 * showed none (the press was not sent). Compared by object: toast ids restart after a dismiss.
 */
export function shownRefusal(store: Pick<StartStore, "getState">, toastBefore: Toast | null): string | null {
  const toast = store.getState().toast;
  if (!toast || toast === toastBefore || toast.tone !== "error") return null;
  const { id, values } = toast.message;
  if (id.startsWith("error.DIRECTOR_SETUP_native_")) return "DIRECTOR_SETUP_REQUIRED";
  if (id === "error.DIRECTOR_CODEX_VERSION_DETAILS" || id === "error.DIRECTOR_CODEX_VERSION_UNREADABLE") return "DIRECTOR_CODEX_VERSION_MISMATCH";
  if (id === "error.unknown") return typeof values?.code === "string" ? values.code : null;
  return id.startsWith("error.") ? id.slice("error.".length) : null;
}

/** A command's end: done, or refused with its code (null when nothing was sent) and the words for it. */
export type Done = { ok: true } | { ok: false; code: string | null; message: Msg };
type Pressed<T> = { ok: true; value: T } | { ok: false; code: string | null; message: Msg };

interface PressOptions {
  /** The success toast. */
  toast?: Msg;
  /** Start's own words for codes whose general text would mislead here. */
  restate?: Partial<Record<string, MessageId>>;
  /**
   * The caller words the refusal itself (inside a modal dialog, whose backdrop covers the toast, or for
   * a step the person did not ask for): the store's error toast is taken away again.
   */
  quiet?: boolean;
  timeoutMs?: number;
}

/** store.command, plus the code of its refusal and its words. A press that was not sent is said too, never silent. */
async function press<T>(
  store: StartStore, pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }> | { path: string; body: unknown }, options: PressOptions = {},
): Promise<Pressed<T>> {
  const before = store.getState().toast;
  const value = await store.command<T>(pressId, logical, build, options.toast, options.timeoutMs ? { timeoutMs: options.timeoutMs } : undefined);
  if (value !== undefined) return { ok: true, value };
  const shown = store.getState().toast;
  const code = shownRefusal(store, before);
  const own = code ? options.restate?.[code] : undefined;
  const message = own ? msg(own) : code && shown ? shown.message : msg("start.not_sent");
  if (options.quiet) {
    if (code && shown && store.getState().toast === shown) takeBack(store, shown, before);
  } else if (own || !code) store.dispatch({ type: "toast", message, tone: "error" });
  return { ok: false, code, message };
}

/**
 * Take a quiet press's refusal toast away again. When it replaced a toast that was still showing (a new
 * toast's id follows the one it replaced), that toast comes back, so a quiet step after a film opened
 * never wipes its "Created …" toast; a toast that had already left stays gone.
 */
function takeBack(store: Pick<StartStore, "dispatch">, shown: Toast, before: Toast | null) {
  if (before && shown.id === before.id + 1) {
    store.dispatch({ type: "toast", message: before.message, tone: before.tone, ...(before.undoCommandId ? { undoCommandId: before.undoCommandId } : {}), ...(before.undoKey ? { undoKey: before.undoKey } : {}) });
  } else store.dispatch({ type: "toastDismiss" });
}

const refused = (code: string, details?: Readonly<Record<string, unknown>>): Done => ({ ok: false, code, message: errorMsg(code, details) });

/** POST /rename needs the film's head version, which the list does not carry: read it when the press is built. */
export async function renameFilm(store: StartStore, id: string, name: string): Promise<boolean> {
  const result = await press<{ headVersion: number }>(store, `start:rename:${id}`, { id, name }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(id));
    return { path: projectPath(id, "/rename"), body: { name, expectedHeadVersion: snapshot.project.headVersion } };
  }, { toast: msg("start.rename.done", { name }) });
  return result.ok;
}

/**
 * Archive is soft and refused while jobs run (ATTEMPTS_RUNNING); restore brings the film back to the
 * list. `quiet`: the archive dialog says a refusal itself, since its backdrop covers the toast.
 */
export async function setArchived(store: StartStore, film: Film, archived: boolean, quiet = false): Promise<Done> {
  const action = archived ? "archive" : "unarchive";
  const result = await press<unknown>(store, `start:${action}:${film.id}`, { id: film.id, archived }, () => ({ path: projectPath(film.id, `/${action}`), body: {} }),
    { toast: msg(archived ? "start.archive.done" : "start.archived.restored", { name: film.name }), quiet });
  return result.ok ? { ok: true } : result;
}

export interface CreationInput {
  body: CreateBody;
  steps: CreationStep[];
  plan: { fileName: string; text: string } | null;
  /** What the sheet showed for Codex: a found Codex is the setup the film is sent. */
  codex: Codex;
}

export interface CreationResult {
  film: Film | null;
  /** The step that did not finish; null when every step did. */
  failedAt: CreationStep | null;
  /** The code that step was refused with; null when it finished, or when nothing was sent. */
  code: string | null;
  /** The words for that refusal (no toast is left behind: the sheet shows them). */
  message: Msg | null;
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
 * Every refusal comes back in the result instead of a toast: the sheet is a modal dialog.
 */
export async function runCreation(store: StartStore, input: CreationInput, events: CreationEvents, resume?: { film: Film; from: CreationStep }): Promise<CreationResult> {
  let film = resume?.film ?? null;
  // A resumed run never creates again: a step that no longer applies (the plan was cleared) is simply done.
  const start = !resume ? 0 : input.steps.includes(resume.from) ? input.steps.indexOf(resume.from) : input.steps.length;
  for (const step of input.steps.slice(start)) {
    events.onStep(step);
    if (step === "create") {
      // A model list that changed under the sheet is Start's to explain: the person checks the models and creates again.
      const created = await press<Film>(store, "start:create", { kind: "create", ...input.body }, () => ({ path: "/api/projects", body: input.body }),
        { quiet: true, restate: { PROVIDER_CATALOG_CHANGED: "start.new.models_changed" } });
      if (!created.ok) return { film: null, failedAt: "create", code: created.code, message: created.message };
      film = { id: created.value.id, name: created.value.name };
      events.onMade?.(film);
      continue;
    }
    if (!film) return { film: null, failedAt: step, code: null, message: msg("start.not_sent") };
    const done = step === "director" ? await setUpDirector(store, film, input.codex) : await sendPlan(store, film, input.plan);
    if (!done.ok) return { film, failedAt: step, code: done.code, message: done.message };
  }
  return { film, failedAt: null, code: null, message: null };
}

/**
 * Turn on the Codex Director: the setup the sheet showed when Codex was found, else this computer's
 * defaults as the new film reads them. No Codex here is CODEX_NOT_FOUND. Never toasts: the caller
 * words the outcome. A lost reply or a check still running is not taken as a failure until the film
 * has been asked what it has now (the server may have finished, or may still be checking).
 */
export async function setUpDirector(store: StartStore, film: Film, codex: Codex): Promise<Done> {
  const read = () => store.read<DirectorSetupRead>(projectPath(film.id, "/director/setup"));
  let setup: DirectorSetupRead;
  try {
    setup = await read();
  } catch (error) {
    return refused(codeOf(error), error instanceof ApiError ? error.details : undefined);
  }
  if (setup.selection.mode === "native") return { ok: true };
  const body = codex.state === "found" ? codex.setup : directorSetupBody(setup);
  if (!body) return refused(CODEX_NOT_FOUND);
  const result = await press<unknown>(store, `start:director:${film.id}`, { id: film.id, ...body }, () => ({ path: projectPath(film.id, "/director/setup"), body }),
    { quiet: true, timeoutMs: DIRECTOR_SETUP_TIMEOUT_MS });
  if (result.ok) return { ok: true };
  if (result.code === "NETWORK_ERROR" || result.code === SETUP_BUSY) {
    const now = await read().catch(() => null);
    if (now?.selection.mode === "native") return { ok: true };
    if (now?.busy) return refused(SETUP_BUSY);
  }
  return result;
}

/** POST /plan-imports: the Director reads the plan and proposes an outline; nothing changes until the person confirms in Plan. */
async function sendPlan(store: StartStore, film: Film, plan: CreationInput["plan"]): Promise<Done> {
  if (!plan) return { ok: true };
  const result = await press<{ requestId: string }>(store, `start:import:${film.id}`, { id: film.id, name: plan.fileName, text: plan.text }, async () => {
    const snapshot = await store.read<ProjectSnapshot>(projectPath(film.id));
    return { path: projectPath(film.id, "/plan-imports"), body: { name: plan.fileName, text: plan.text, expectedHeadVersion: snapshot.project.headVersion } };
  }, { quiet: true });
  return result.ok ? { ok: true } : result;
}

/**
 * The demo is its own film: created with the built-in stand-in models (no selection), then filled
 * by the stand-in Director (POST /demo, which lays out the scene and its shots before it answers and
 * queues the stand-in turn that makes their media). `pending` is a demo film whose filling did not
 * start, so a second press fills that film instead of making another. `code` is the refusal's.
 */
export async function openDemo(store: StartStore, name: string, pending: Film | null): Promise<{ film: Film | null; filled: boolean; code: string | null }> {
  let film = pending;
  if (!film) {
    const created = await press<Film>(store, "start:demo:create", { kind: "demo", name }, () => ({ path: "/api/projects", body: { name } }));
    if (!created.ok) return { film: null, filled: false, code: created.code };
    film = { id: created.value.id, name: created.value.name };
  }
  const target = film;
  // ACTOR_DENIED here means this studio has no stand-in Director to fill the demo (app.ts /demo); elsewhere it means other things.
  const filled = await press<unknown>(store, `start:demo:fill:${target.id}`, { id: target.id }, () => ({ path: projectPath(target.id, "/demo"), body: { action: "create" } }),
    { restate: { ACTOR_DENIED: "start.demo.unavailable" } });
  return { film: target, filled: filled.ok, code: filled.ok ? null : filled.code };
}

/** ACTOR_DENIED on the fill: this studio has no stand-in Director, so the demo cannot work here at all. */
export const DEMO_UNAVAILABLE = "ACTOR_DENIED";

/** Navigate to the newly filled demo and report success only in its exact destination selection. */
export async function showDemoFilm(store: {
  selectProject(projectId: string): Promise<void>;
  setView(view: "keyframes"): void;
  getState(): Pick<StudioState, "projectId" | "projectEpoch">;
  dispatch(action: Action): void;
}, film: Film, origin?: Pick<StudioState, "projectId" | "projectEpoch">): Promise<void> {
  const current = store.getState();
  if (origin && (current.projectId !== origin.projectId || current.projectEpoch !== origin.projectEpoch)) return;
  // selectProject clears the previous film's toast synchronously, before its reads await.
  const opening = store.selectProject(film.id);
  const projectEpoch = store.getState().projectEpoch;
  store.setView("keyframes");
  await opening;
  const destination = store.getState();
  if (destination.projectId !== film.id || destination.projectEpoch !== projectEpoch) return;
  store.dispatch({ type: "toast", message: msg("start.demo.opened", { name: film.name }), tone: "info" });
}
