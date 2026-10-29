import type { GenerationOverview } from "@openslate/core/public";
import type { Held, HeldFields } from "./plan-conflict.ts";
import type { Editing, LostNote, PlaceView } from "./plan-drafts.ts";
import type { ProjectSnapshot } from "./types.ts";

/** The film and head whose values were actually shown together. Never borrow authority from a newer read. */
export interface PlanBaseline {
  projectId: string;
  headVersion: number;
}

export function projectionBaseline(snapshot: ProjectSnapshot | null, overview: GenerationOverview | null): PlanBaseline | null {
  if (!snapshot || !overview || snapshot.project.id !== overview.projectId || snapshot.project.headVersion !== overview.headVersion || snapshot.project.revisionId !== overview.revisionId) return null;
  return { projectId: snapshot.project.id, headVersion: snapshot.project.headVersion };
}

/** Continue a multi-command save with authority produced by that same save, never by an unrelated refresh. */
export function receiptBaseline(baseline: PlanBaseline, receipt: { headVersion?: number }): PlanBaseline | null {
  return typeof receipt.headVersion === "number" ? { projectId: baseline.projectId, headVersion: receipt.headVersion } : null;
}

export interface PlanSessionState<TLost extends LostNote> {
  editing: Editing | null;
  drafts: Record<string, Held<HeldFields>>;
  lost: TLost[];
  importDraft: { name: string; text: string };
  importOpen: boolean;
  justSent: string | null;
  /** Names a deleted subject even after leaving Plan, switching films, or entering recovery review. */
  seen: { place: string; view: PlaceView } | null;
}

type Update<T> = T | ((current: T) => T);

/** Memory owned by the studio, above every workspace mount. Switching views never discards a draft. */
export class PlanSession<TLost extends LostNote = LostNote> {
  #state: PlanSessionState<TLost> = { editing: null, drafts: {}, lost: [], importDraft: { name: "", text: "" }, importOpen: false, justSent: null, seen: null };
  #listeners = new Set<() => void>();
  getSnapshot = (): PlanSessionState<TLost> => this.#state;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  set<K extends keyof PlanSessionState<TLost>>(key: K, update: Update<PlanSessionState<TLost>[K]>): void {
    const value = typeof update === "function" ? (update as (current: PlanSessionState<TLost>[K]) => PlanSessionState<TLost>[K])(this.#state[key]) : update;
    if (Object.is(value, this.#state[key])) return;
    this.#state = { ...this.#state, [key]: value };
    for (const listener of [...this.#listeners]) listener();
  }
}

// A replaced connection/store cannot reveal another installation's drafts. No text is written to shared storage.
const sessions = new WeakMap<object, Map<string, PlanSession>>();
export function planSession<TLost extends LostNote = LostNote>(owner: object, projectId: string): PlanSession<TLost> {
  let films = sessions.get(owner);
  if (!films) { films = new Map(); sessions.set(owner, films); }
  let session = films.get(projectId);
  if (!session) { session = new PlanSession(); films.set(projectId, session); }
  return session as PlanSession<TLost>;
}
