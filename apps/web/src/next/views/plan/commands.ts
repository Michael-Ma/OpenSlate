import { msg, type Msg } from "../../model/types.ts";
import type { PendingImport } from "../../model/plan-import.ts";
import type { StudioStore } from "../../store/store.ts";

/**
 * The Plan view's commands, through the store's generic press (request identity, refresh, error toasts).
 * Storyboard edits: POST /api/projects/:projectId/storyboard (apps/server/src/storyboard.ts); a shot's fields go as
 * one shotFields command. Written plans: /plan-imports (apps/server/src/plan-imports.ts).
 */

export interface StoryboardReceipt {
  commandId: string;
  headVersion?: number;
}

/** A storyboard command body without the head version, which is added when it is sent (shotFields nests its fields). */
export type StoryboardInput = { kind: string } & Record<string, string | boolean | undefined | Readonly<Record<string, string | number | undefined>>>;

const clean = (input: StoryboardInput) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

/**
 * The head version the latest receipt produced, per film. The studio is read again after each command, but that
 * read can land after the next press (a quick ↑ ↑ or Enter Enter); head versions only grow, so the next command
 * expects the larger of this and the studio's head instead of a stale one.
 */
const receiptHeads = new Map<string, number>();

/** The head version the next storyboard command expects. */
export function expectedHead(store: StudioStore): number | undefined {
  const project = store.getState().snapshot?.project;
  if (!project) return undefined;
  const receipt = receiptHeads.get(project.id);
  // Once the studio's read has caught up, it is the authority again.
  if (receipt === undefined || receipt <= project.headVersion) {
    receiptHeads.delete(project.id);
    return project.headVersion;
  }
  return receipt;
}

/** One storyboard command. Resolves undefined when it was refused; the store has already shown why. */
export async function storyboard(store: StudioStore, pressId: string, input: StoryboardInput, headVersion?: number): Promise<StoryboardReceipt | undefined> {
  const project = store.getState().snapshot?.project;
  const expected = headVersion ?? expectedHead(store);
  if (!project || expected === undefined) return undefined;
  const body = { ...clean(input), expectedHeadVersion: expected };
  const receipt = await store.command<StoryboardReceipt>(`plan:${pressId}`, body, () => ({ path: "/storyboard", body }));
  if (typeof receipt?.headVersion === "number") receiptHeads.set(project.id, Math.max(receipt.headVersion, receiptHeads.get(project.id) ?? -1));
  return receipt;
}

// ---- answered, refused, or not confirmed --------------------------------------------------------------

/**
 * How a press ended. `lost`: the studio never answered (no reply, a timeout, a server failure), so the change may or
 * may not have been made. Its `resend` sends the very same request again: the store keeps the key and body of an
 * unanswered press and resends them when the same press repeats with the same identity, so the server replays its
 * receipt instead of applying it twice.
 */
export type Outcome<T> =
  | { kind: "done"; receipt: T }
  | { kind: "refused" }
  | { kind: "lost"; resend(): Promise<Outcome<T>> };

/**
 * Run a press and say how it ended. `pressId` is the store's press id; `run` must build the same request each
 * time it is called (fixed inputs, a fixed head version). A lost reply's error toast is taken back: the view says
 * it in place, with the retry.
 */
export async function settle<T>(store: StudioStore, pressId: string, run: () => Promise<T | undefined>): Promise<Outcome<T>> {
  const receipt = await run();
  if (receipt !== undefined) return { kind: "done", receipt };
  if (!store.unconfirmed(pressId)) return { kind: "refused" };
  store.dismissToast();
  return { kind: "lost", resend: () => settle(store, pressId, run) };
}

/** One storyboard command, with the head version fixed now so a resend is the same request. */
export function storyboardOutcome(store: StudioStore, pressId: string, input: StoryboardInput, headVersion?: number): Promise<Outcome<StoryboardReceipt>> {
  const expected = headVersion ?? expectedHead(store);
  return settle(store, `plan:${pressId}`, () => storyboard(store, pressId, input, expected));
}

/** The head version a receipt produced, reading the studio again when the receipt does not say. */
export async function headAfter(store: StudioStore, receipt: StoryboardReceipt): Promise<number | null> {
  if (typeof receipt.headVersion === "number") return receipt.headVersion;
  await store.refresh();
  return store.getState().snapshot?.project.headVersion ?? null;
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

export function sendImport(store: StudioStore, name: string, text: string): Promise<Outcome<{ requestId: string }>> {
  const expected = expectedHead(store);
  const body = { name, text, expectedHeadVersion: expected };
  return settle(store, "plan:import:send", async () => (expected === undefined ? undefined : store.command<{ requestId: string }>("plan:import:send", body, () => ({ path: "/plan-imports", body }))));
}

export function confirmImport(store: StudioStore, pending: PendingImport): Promise<Outcome<unknown>> {
  const draft = pending.draft;
  const pressId = `plan:import:confirm:${pending.id}`;
  const body = draft ? { preparedId: draft.preparedId, proposalDigest: draft.proposalDigest } : null;
  return settle(store, pressId, async () => (body ? store.command(pressId, { requestId: pending.id, ...body }, () => ({ path: `/plan-imports/${encodeURIComponent(pending.id)}/confirm`, body }), msg("plan.toast.import_confirmed", { name: pending.name })) : undefined));
}

export function discardImport(store: StudioStore, pending: PendingImport): Promise<Outcome<unknown>> {
  const pressId = `plan:import:discard:${pending.id}`;
  return settle(store, pressId, () => store.command(pressId, { requestId: pending.id }, () => ({ path: `/plan-imports/${encodeURIComponent(pending.id)}/discard`, body: {} }), msg("plan.toast.import_discarded")));
}
