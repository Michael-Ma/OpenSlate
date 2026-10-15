import { msg, type Msg } from "../../model/types.ts";
import type { PendingImport } from "../../model/plan-import.ts";
import type { StudioStore } from "../../store/store.ts";

/**
 * The Plan view's commands, through the store's generic press (request identity, refresh, error toasts).
 * Storyboard edits: POST /api/projects/:projectId/storyboard (apps/server/src/storyboard.ts), one field per command.
 * Written plans: /plan-imports (apps/server/src/plan-imports.ts).
 */

export interface StoryboardReceipt {
  commandId: string;
  headVersion?: number;
}

/** A storyboard command body without the head version, which is added when it is sent. */
export type StoryboardInput = { kind: string } & Record<string, string | boolean | undefined>;

const clean = (input: StoryboardInput) => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

/** One storyboard command. Resolves undefined when it was refused; the store has already shown why. */
export function storyboard(store: StudioStore, pressId: string, input: StoryboardInput, headVersion?: number): Promise<StoryboardReceipt | undefined> {
  const snapshot = store.getState().snapshot;
  if (!snapshot) return Promise.resolve(undefined);
  const body = { ...clean(input), expectedHeadVersion: headVersion ?? snapshot.project.headVersion };
  return store.command<StoryboardReceipt>(`plan:${pressId}`, body, () => ({ path: "/storyboard", body }));
}

/**
 * Several commands in turn (the editor saves one field per command). Each carries the head version the previous
 * one produced. Stops at the first refusal and reports how many were saved.
 */
export async function storyboardSequence(store: StudioStore, items: readonly { pressId: string; input: StoryboardInput }[]): Promise<{ saved: number; last: StoryboardReceipt | null }> {
  let head: number | undefined;
  let last: StoryboardReceipt | null = null;
  for (const [index, item] of items.entries()) {
    if (index > 0 && head === undefined) await store.refresh();
    const receipt = await storyboard(store, item.pressId, item.input, head);
    if (!receipt) return { saved: index, last };
    last = receipt;
    head = receipt.headVersion;
  }
  return { saved: items.length, last };
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

/** An info toast that offers Undo for a storyboard command. */
export function undoToast(store: StudioStore, message: Msg, commandId: string): void {
  store.dispatch({ type: "toast", message, tone: "info", undoCommandId: commandId });
}

export function infoToast(store: StudioStore, message: Msg): void {
  store.dispatch({ type: "toast", message, tone: "info" });
}

// ---- written plans ------------------------------------------------------------------------------------

export function sendImport(store: StudioStore, name: string, text: string): Promise<{ requestId: string } | undefined> {
  const snapshot = store.getState().snapshot;
  if (!snapshot) return Promise.resolve(undefined);
  const body = { name, text, expectedHeadVersion: snapshot.project.headVersion };
  return store.command<{ requestId: string }>("plan:import:send", body, () => ({ path: "/plan-imports", body }));
}

export function confirmImport(store: StudioStore, pending: PendingImport): Promise<unknown> {
  const draft = pending.draft;
  if (!draft) return Promise.resolve(undefined);
  const body = { preparedId: draft.preparedId, proposalDigest: draft.proposalDigest };
  return store.command(`plan:import:confirm:${pending.id}`, { requestId: pending.id, ...body }, () => ({ path: `/plan-imports/${encodeURIComponent(pending.id)}/confirm`, body }), msg("plan.toast.import_confirmed", { name: pending.name }));
}

export function discardImport(store: StudioStore, pending: PendingImport): Promise<unknown> {
  return store.command(`plan:import:discard:${pending.id}`, { requestId: pending.id }, () => ({ path: `/plan-imports/${encodeURIComponent(pending.id)}/discard`, body: {} }), msg("plan.toast.import_discarded"));
}
