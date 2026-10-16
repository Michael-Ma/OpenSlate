import { musicGainEdit } from "./film.ts";

/** The exact film, soundtrack and displayed saved level where a volume edit began. */
export interface GainBaseline {
  projectId: string;
  headVersion: number;
  audioId: string;
  gainDb: number;
}

export interface GainDraft {
  baseline: GainBaseline;
  value: number;
  revision: number;
}

export interface GainReceipt { headVersion?: number }
interface GainState {
  draft: GainDraft | null;
  saving: boolean;
  /** A slider release (or explicit conflict choice), rather than an unfinished drag. */
  ready: boolean;
  /** A failed/unknown save waits for a fresh human retry instead of repeating from the debounce timer. */
  failed: boolean;
}

export const gainConflict = (draft: GainDraft, live: GainBaseline | null): boolean =>
  !live || draft.baseline.projectId !== live.projectId || draft.baseline.headVersion !== live.headVersion
  || draft.baseline.audioId !== live.audioId || draft.baseline.gainDb !== live.gainDb;

/** A delayed slider save still sends the head where the person authored that value. */
export function gainRequest(draft: GainDraft, live: GainBaseline | null) {
  if (gainConflict(draft, live)) return null;
  return {
    path: `/api/projects/${encodeURIComponent(draft.baseline.projectId)}/storyboard`,
    body: { ...musicGainEdit(draft.value), expectedHeadVersion: draft.baseline.headVersion },
  };
}

/** Retained above the tools/view mounts, with completion fenced to its own submitted revision. */
export class GainSession {
  #state: GainState = { draft: null, saving: false, failed: false, ready: false };
  #revision = 0;
  #submitted: GainDraft | null = null;
  #listeners = new Set<() => void>();
  getSnapshot = (): GainState => this.#state;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  #put(state: GainState): void {
    this.#state = state;
    for (const listener of [...this.#listeners]) listener();
  }
  edit(live: GainBaseline, value: number): void {
    const current = this.#state.draft;
    if (current?.value === value) return;
    const baseline = current?.baseline ?? { ...live };
    const draft = !this.#state.saving && value === baseline.gainDb && (!current || !gainConflict(current, live)) ? null : { baseline, value, revision: ++this.#revision };
    this.#put({ ...this.#state, draft, failed: false, ready: false });
  }
  release(): void { if (this.#state.draft) this.#put({ ...this.#state, ready: true }); }
  resolve(live: GainBaseline, keep: boolean): void {
    if (this.#state.saving || !this.#state.draft) return;
    this.#put({ draft: keep ? { ...this.#state.draft, baseline: { ...live }, revision: ++this.#revision } : null, saving: false, failed: false, ready: true });
  }
  begin(live: GainBaseline | null): GainDraft | null {
    const draft = this.#state.draft;
    if (!draft || this.#state.saving || gainConflict(draft, live)) return null;
    this.#submitted = draft;
    this.#put({ ...this.#state, saving: true, failed: false });
    return draft;
  }
  complete(submitted: GainDraft | null, receipt: GainReceipt | null): void {
    if (!submitted || this.#submitted !== submitted) return;
    this.#submitted = null;
    const current = this.#state.draft;
    const draft = receipt && current?.revision === submitted.revision ? null
      : receipt && current?.baseline === submitted.baseline && typeof receipt.headVersion === "number"
        ? { ...current, baseline: { ...submitted.baseline, headVersion: receipt.headVersion, gainDb: submitted.value } }
        : current;
    this.#put({ ...this.#state, draft, saving: false, failed: !receipt });
  }
}

const sessions = new WeakMap<object, Map<string, GainSession>>();
export function musicGainSession(owner: object, projectId: string): GainSession {
  let films = sessions.get(owner);
  if (!films) { films = new Map(); sessions.set(owner, films); }
  let session = films.get(projectId);
  if (!session) { session = new GainSession(); films.set(projectId, session); }
  return session;
}
