import { msg, type Msg } from "../../model/types.ts";
import type { PendingImport } from "../../model/plan-import.ts";
import type { StudioStore } from "../../store/store.ts";
import { projectionBaseline, type PlanBaseline } from "../../model/plan-session.ts";

/**
 * The Plan view's commands, through the store's generic press (request identity, refresh, error toasts).
 * Storyboard edits: POST /api/projects/:projectId/storyboard (apps/server/src/storyboard.ts); a shot's fields go as
 * one shotFields command. Written plans: /plan-imports (apps/server/src/plan-imports.ts).
 */

export interface StoryboardReceipt {
  commandId: string;
  headVersion?: number;
}

/** A storyboard command body without the head version, which comes from its displayed baseline (shotFields nests its fields). */
export type StoryboardInput = { kind: string } & Record<string, string | boolean | undefined | Readonly<Record<string, string | number | undefined>>>;

const clean = (input: StoryboardInput) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

/** Only a head whose two independently refreshed projections describe the same film may authorize new edits. */
export function expectedHead(store: StudioStore): number | undefined {
  const { snapshot, overview } = store.getState();
  return projectionBaseline(snapshot, overview)?.headVersion;
}

const projectPath = (projectId: string, rest: string) => `/api/projects/${encodeURIComponent(projectId)}${rest}`;

function baselineFor(store: StudioStore, baseline?: number | PlanBaseline): PlanBaseline | null {
  const state = store.getState();
  const projectId = state.projectId ?? state.snapshot?.project.id;
  if (typeof baseline === "object") return baseline.projectId === projectId ? baseline : null;
  if (typeof baseline === "number") return projectId ? { projectId, headVersion: baseline } : null;
  const shown = projectionBaseline(state.snapshot, state.overview);
  return shown?.projectId === projectId ? shown : null;
}

function projectionRefused(store: StudioStore): void {
  store.dispatch({ type: "toast", message: msg("error.PLAN_PROJECTION_CHANGED"), tone: "error" });
}

/** One storyboard command against the head that was shown, or the exact preceding receipt of a multi-command save. */
export async function storyboard(store: StudioStore, pressId: string, input: StoryboardInput, baseline?: number | PlanBaseline): Promise<StoryboardReceipt | undefined> {
  const scope = baselineFor(store, baseline);
  if (!scope) { projectionRefused(store); return undefined; }
  const body = { ...clean(input), expectedHeadVersion: scope.headVersion };
  return store.command<StoryboardReceipt>(`plan:${pressId}`, body, () => ({ path: projectPath(scope.projectId, "/storyboard"), body }));
}

// ---- answered, refused, or not confirmed --------------------------------------------------------------

/**
 * How a press ended. `lost`: the studio never answered (no reply, a timeout, a server failure), so the change may or
 * may not have been made. Its `resend` sends the very same request again: the store keeps the key and body of an
 * unanswered press and resends them when the same press repeats with the same identity, so the server replays its
 * receipt instead of applying it twice. `pressId` names the press, so its notice is its own. `superseded`: the film
 * selection changed while awaiting the answer; its completion must leave the current view and notices alone.
 */
export type Outcome<T> =
  | { kind: "done"; receipt: T }
  | { kind: "refused" }
  | { kind: "superseded" }
  | { kind: "lost"; pressId: string; resend(): Promise<Outcome<T>> };

/**
 * Run a press and say how it ended. `pressId` is the store's press id; `run` must build the same request each
 * time it is called (fixed inputs, a fixed head version). A lost reply's error toast is taken back: the view says
 * it in place, with the retry.
 */
export async function settle<T>(store: StudioStore, pressId: string, run: () => Promise<T | undefined>): Promise<Outcome<T>> {
  const { projectId, projectEpoch } = store.getState();
  const receipt = await run();
  const now = store.getState();
  if (now.projectId !== projectId || now.projectEpoch !== projectEpoch) return { kind: "superseded" };
  if (receipt !== undefined) return { kind: "done", receipt };
  if (!store.unconfirmed(pressId)) return { kind: "refused" };
  store.dismissToast();
  return { kind: "lost", pressId, resend: () => settle(store, pressId, run) };
}

/** One storyboard command, with the head version fixed now so a resend is the same request. */
export function storyboardOutcome(store: StudioStore, pressId: string, input: StoryboardInput, baseline?: number | PlanBaseline): Promise<Outcome<StoryboardReceipt>> {
  const scope = baselineFor(store, baseline);
  if (!scope) { projectionRefused(store); return Promise.resolve({ kind: "refused" }); }
  return settle(store, `plan:${pressId}`, () => storyboard(store, pressId, input, scope));
}

/** The head version a receipt produced, reading the studio again when the receipt does not say. */
export async function headAfter(store: StudioStore, receipt: StoryboardReceipt, projectId = store.getState().projectId): Promise<number | null> {
  if (typeof receipt.headVersion === "number") return receipt.headVersion;
  await store.refresh();
  const project = store.getState().snapshot?.project;
  return project?.id === projectId ? project.headVersion : null;
}

/** The reason the last press was refused, as the store's error toast says it. */
export function refusal(store: StudioStore): Msg | null {
  const toast = store.getState().toast;
  return toast?.tone === "error" ? toast.message : null;
}

/**
 * The refusal, moved from the toast to the place that shows it inline (an open editor or dialog), so the reason
 * is said once.
 */
export function takeRefusal(store: StudioStore): Msg | null {
  const reason = refusal(store);
  if (reason) store.dismissToast();
  return reason;
}

/** An info toast that offers Undo for a storyboard command. */
export function undoToast(store: StudioStore, message: Msg, commandId: string): void {
  store.dispatch({ type: "toast", message, tone: "info", undoCommandId: commandId });
}

export function infoToast(store: StudioStore, message: Msg): void {
  store.dispatch({ type: "toast", message, tone: "info" });
}

// ---- written plans ------------------------------------------------------------------------------------

export function sendImport(store: StudioStore, name: string, text: string, baseline?: PlanBaseline): Promise<Outcome<{ requestId: string }>> {
  const scope = baselineFor(store, baseline);
  if (!scope) { projectionRefused(store); return Promise.resolve({ kind: "refused" }); }
  const body = { name, text, expectedHeadVersion: scope.headVersion };
  return settle(store, "plan:import:send", () => store.command<{ requestId: string }>("plan:import:send", body, () => ({ path: projectPath(scope.projectId, "/plan-imports"), body })));
}

export function confirmImport(store: StudioStore, pending: PendingImport, projectId = store.getState().projectId): Promise<Outcome<unknown>> {
  const draft = pending.draft;
  const pressId = `plan:import:confirm:${pending.id}`;
  const body = draft ? { preparedId: draft.preparedId, proposalDigest: draft.proposalDigest } : null;
  return settle(store, pressId, async () => (body ? store.command(pressId, { requestId: pending.id, ...body }, () => ({ path: projectPath(projectId ?? "", `/plan-imports/${encodeURIComponent(pending.id)}/confirm`), body }), msg("plan.toast.import_confirmed", { name: pending.name })) : undefined));
}

export function discardImport(store: StudioStore, pending: PendingImport, projectId = store.getState().projectId): Promise<Outcome<unknown>> {
  const pressId = `plan:import:discard:${pending.id}`;
  return settle(store, pressId, () => store.command(pressId, { requestId: pending.id }, () => ({ path: projectPath(projectId ?? "", `/plan-imports/${encodeURIComponent(pending.id)}/discard`), body: {} }), msg("plan.toast.import_discarded")));
}
