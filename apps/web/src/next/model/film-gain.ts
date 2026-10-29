import type { GenerationOverview } from "@openslate/core/public";
import type { StudioStore } from "../store/store.ts";
import { displayedHead } from "./displayed-baseline.ts";
import { editPressId, musicGainEdit, soundtrackOf } from "./film.ts";
import { msg, type ProjectSnapshot } from "./types.ts";

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
  /** A lost reply must be reconciled with its exact original request before another level can save. */
  unconfirmed: boolean;
}

export type GainComparison = { kind: "none" } | { kind: "waiting" } | { kind: "changed"; saved: GainBaseline };
export type GainFailure = "refused" | "unconfirmed" | "waiting" | "changed";
export type GainResult = { kind: "saved"; receipt: GainReceipt; live: GainBaseline | null } | { kind: GainFailure };

/** Only the edited values conflict. An inconsistent/foreign projection supplies no comparison yet. */
export function gainComparison(draft: GainDraft, live: GainBaseline | null): GainComparison {
  if (!live || draft.baseline.projectId !== live.projectId) return { kind: "waiting" };
  return draft.baseline.audioId !== live.audioId || draft.baseline.gainDb !== live.gainDb
    ? { kind: "changed", saved: live } : { kind: "none" };
}

export const gainConflict = (draft: GainDraft, live: GainBaseline | null): boolean => gainComparison(draft, live).kind === "changed";

/** Music uses the same consistent projection as the timeline; cursor-only refreshes do not disable it. */
export function displayedGain(projectId: string | null, snapshot: ProjectSnapshot | null, overview: GenerationOverview | null): GainBaseline | null {
  const headVersion = displayedHead(projectId, snapshot, overview);
  const soundtrack = soundtrackOf(snapshot);
  return projectId && headVersion !== null && soundtrack
    ? { projectId, headVersion, audioId: soundtrack.audioId, gainDb: Math.round(soundtrack.gainMilliDb / 1000) } : null;
}

/** Rebase equal fields to the current displayed head. Reconciliation alone retains an unknown request's body. */
export function gainRequest(draft: GainDraft, live: GainBaseline | null, reconcile = false) {
  const comparison = gainComparison(draft, live);
  if (comparison.kind === "waiting" || (!reconcile && comparison.kind === "changed")) return null;
  return {
    path: `/api/projects/${encodeURIComponent(draft.baseline.projectId)}/storyboard`,
    body: { ...musicGainEdit(draft.value), expectedHeadVersion: reconcile ? draft.baseline.headVersion : live!.headVersion },
  };
}

/** One bounded save, with no retry loop and no toast for a projection that is still updating. */
export async function submitGain(store: Pick<StudioStore, "getState" | "command" | "dispatch" | "unconfirmed">, draft: GainDraft, session: GainSession): Promise<GainResult> {
  const { projectId, projectEpoch, snapshot, overview } = store.getState();
  const live = displayedGain(projectId, snapshot, overview);
  const comparison = gainComparison(draft, live);
  const reconcile = session.getSnapshot().unconfirmed;
  if (comparison.kind === "waiting") return { kind: "waiting" };
  if (!reconcile && comparison.kind === "changed") return { kind: "changed" };
  const sent = session.captureRequest(draft, live!);
  if (!sent) return { kind: "waiting" };
  const request = gainRequest(sent, live, reconcile)!;
  const pressId = editPressId(request.body);
  const receipt = await store.command<GainReceipt & { commandId: string }>(pressId, request.body, () => request);
  const now = store.getState();
  if (now.projectId !== projectId || now.projectEpoch !== projectEpoch) return { kind: "unconfirmed" };
  if (!receipt) return { kind: store.unconfirmed(pressId) ? "unconfirmed" : "refused" };
  store.dispatch({ type: "toast", message: msg("film.toast.music_volume", { db: Math.round(sent.value) }), tone: "info", undoCommandId: receipt.commandId });
  return { kind: "saved", receipt, live: displayedGain(now.projectId, now.snapshot, now.overview) };
}

/** Retained above the tools/view mounts, with completion fenced to its own submitted revision. */
export class GainSession {
  #state: GainState = { draft: null, saving: false, failed: false, ready: false, unconfirmed: false };
  #revision = 0;
  #submitted: GainDraft | null = null;
  #unknown: GainDraft | null = null;
  #sent: GainDraft | null = null;
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
    const draft = !this.#state.saving && !this.#unknown && value === baseline.gainDb && (!current || !gainConflict(current, live)) ? null : { baseline, value, revision: ++this.#revision };
    this.#put({ ...this.#state, draft, failed: !!this.#unknown, ready: false });
  }
  release(): void { if (this.#state.draft) this.#put({ ...this.#state, ready: true }); }
  resolve(live: GainBaseline, keep: boolean): void {
    if (this.#state.saving || this.#unknown || !this.#state.draft) return;
    this.#put({ draft: keep ? { ...this.#state.draft, baseline: { ...live }, revision: ++this.#revision } : null, saving: false, failed: false, ready: true, unconfirmed: false });
  }
  begin(live: GainBaseline | null): GainDraft | null {
    const current = this.#state.draft;
    const comparison = current ? gainComparison(current, live) : null;
    if (!current || this.#state.saving || comparison?.kind === "waiting" || (!this.#unknown && comparison?.kind === "changed")) return null;
    const submitted = this.#unknown ?? { ...current, baseline: { ...live! } };
    this.#submitted = submitted;
    this.#sent = null;
    this.#put({ ...this.#state, draft: this.#unknown ? current : submitted, saving: true, failed: false });
    return submitted;
  }
  /** Capture a last-moment equal-field rebase before dispatch, so a lost reply retains the actual sent head. */
  captureRequest(submitted: GainDraft, live: GainBaseline): GainDraft | null {
    if (this.#submitted !== submitted) return null;
    const sent = this.#unknown ?? { ...submitted, baseline: { ...live } };
    this.#sent = sent;
    const current = this.#state.draft;
    if (current?.baseline === submitted.baseline) this.#put({ ...this.#state, draft: { ...current, baseline: sent.baseline } });
    return sent;
  }
  complete(submitted: GainDraft | null, receipt: GainReceipt | null, failure: GainFailure = "refused", live?: GainBaseline | null): void {
    if (!submitted || this.#submitted !== submitted) return;
    this.#submitted = null;
    const sent = this.#sent ?? submitted;
    this.#sent = null;
    if (receipt || failure === "refused") this.#unknown = null;
    else if (failure === "unconfirmed") this.#unknown = sent;
    const current = this.#state.draft;
    const savedHead = receipt?.headVersion ?? sent.baseline.headVersion + 1;
    const newerSavedValue = !!receipt && live?.projectId === sent.baseline.projectId && live.headVersion > savedHead
      && (live.audioId !== sent.baseline.audioId || live.gainDb !== sent.value);
    // An old receipt confirms its own value; it cannot discard the draft against a later different saved level.
    const draft = receipt && current?.revision === submitted.revision && !newerSavedValue ? null
      : receipt && current?.baseline === sent.baseline
        ? { ...current, baseline: { ...sent.baseline, headVersion: savedHead, gainDb: sent.value } }
        : current;
    this.#put({ ...this.#state, draft, saving: false, failed: !receipt && (failure === "refused" || !!this.#unknown), unconfirmed: !!this.#unknown });
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
