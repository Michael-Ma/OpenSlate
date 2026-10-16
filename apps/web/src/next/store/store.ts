import type { AcceptProposalInput, NarrationFitInput, NarrationFitReceipt, ControlInput, ControlReceipt, DirectorProposal, FrameViewInput, GenerationOverview, ProposalList, ProposalReceipt, ReleaseAttemptInput, ResolveNoteInput } from "@openslate/core/public";
import { ProjectSubscription } from "../../shared/project-subscription.ts";
import { ApiError, type EventOptions, type RequestOptions } from "../api/client.ts";
import { errorMsg } from "../i18n/translate.ts";
import type { RoleFilter } from "../model/assets.ts";
import { CommandRefused, confirmBody, keyframesBody, type SceneGenerationRead, type StoryboardEdit } from "../model/commands.ts";
import {
  isQuarantined, NO_RECOVERY, parseRecoveryStatus, parseSavedRelease, RECOVERY_LOCK, RECOVERY_PATH, recoveryReadOnly, RELEASE_PATH, RELEASE_PRESS, RELEASE_STORAGE_KEY,
  recoveryChange, releaseBody, releaseOutcome, unconfirmedStillApplies, type ReleaseOutcome, type SavedRelease,
} from "../model/recovery.ts";
import { addPicture, messageBody, pictureKey, type Draft, type PictureCandidate } from "../model/director.ts";
import { confirmPress, keyframesPress, PAID_PRESS } from "../model/keyframes-press.ts";
import { msg, type DirectorStatus, type Msg, type ProjectSnapshot, type ProjectSummary, type Target, type ViewName } from "../model/types.ts";
import { editConflict, editValues, motionForm, sameEditForm } from "../model/edit-conflict.ts";
import { displayedHead } from "../model/displayed-baseline.ts";
import { keyframeEstimate } from "../model/price.ts";
import { canonicalJson, PressKeys } from "./press-keys.ts";
import { reducer, type Action } from "./reducer.ts";
import { initialState, type EditDraft, type StudioState, type Toast } from "./state.ts";

/** The parts of StudioClient the store uses; tests and fixture mode inject their own. */
export interface StudioPort {
  readonly closed: boolean;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  events(projectId: string, options: EventOptions): Promise<void>;
}

export interface StoreDeps {
  client: StudioPort;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  newKey(): string;
  /** Overview reads may 404 on a server without the overview route; the store then reports it, never guesses. */
  onError?(error: unknown): void;
}

const LAST_PROJECT_KEY = "openslate.next.project";
/** The press id of Disconnect while the logout is being sent. */
export const DISCONNECT_PRESS = "session:disconnect";
/** A logout refused because the session had already ended: the window is disconnected all the same. */
const SESSION_GONE = new Set(["AUTH_REQUIRED", "SESSION_CLOSED"]);
const path = (projectId: string, rest = "") => `/api/projects/${encodeURIComponent(projectId)}${rest}`;

/** Feedback for a human save or an internal step of a larger action. */
export interface EditSaveFeedback {
  /** null suppresses success feedback; omitted keeps the ordinary Saved toast. */
  toast?: Msg | null;
  /** Internal recording preparation/rollback must not publish errors or successes of its own. */
  quiet?: boolean;
  /** A composite action can show the refusal in its own panel. Never retained with the request. */
  onRefused?: (message: Msg) => void;
}

interface PendingEditBody {
  kind: "shot" | "shotFields" | "narration";
  id: string;
  field?: string;
  value?: string;
  fields?: { motion: string; desiredFrames: number };
  expectedHeadVersion: number;
}

/** Definite refusals: the request was answered and will not succeed by resending it. */
const definite = (error: unknown) => error instanceof CommandRefused || (error instanceof ApiError && error.status >= 400 && error.status < 500);

export class StudioStore {
  #state: StudioState = initialState;
  readonly #listeners = new Set<() => void>();
  readonly #deps: StoreDeps;
  /** The open film's presses, or the library's while no film is open (Start on a first run). */
  #keys: PressKeys;
  readonly #projectKeys = new Map<string | null, PressKeys>();
  #subscription: ProjectSubscription | null = null;
  #unsubscribe: (() => void) | null = null;
  #refreshing: Promise<void> | null = null;
  /** The Undo of the latest toastUndo, by its key (callbacks never go into state). */
  #toastUndo: { key: number; run: () => unknown } | null = null;
  #toastUndoKey = 0;
  #refreshAgain = false;
  /** The latest recovery read (or release answer); an older read that answers later never replaces it. */
  #recoveryRead = 0;
  #editRevision = 0;
  /** The server has no recovery route (an older one): refreshes stop asking. */
  #recoveryMissing = false;

  constructor(deps: StoreDeps) {
    this.#deps = deps;
    this.#keys = new PressKeys(null, deps.storage, deps.newKey);
    this.#projectKeys.set(null, this.#keys);
    // A release whose reply was lost in an earlier page stays on offer as Retry with the same key and body.
    let saved: SavedRelease | null = null;
    try { saved = parseSavedRelease(deps.storage?.getItem(RELEASE_STORAGE_KEY) ?? null); } catch { /* unavailable */ }
    if (saved) this.#state = { ...this.#state, recovery: { ...NO_RECOVERY, unconfirmed: saved } };
  }

  getState = (): StudioState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispatch = (action: Action): void => {
    const next = reducer(this.#state, action);
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of [...this.#listeners]) listener();
  };

  // ---- loading -----------------------------------------------------------

  async start(preferredProjectId?: string | null): Promise<void> {
    try {
      // The recovery status comes with the film list, so a restored studio is read-only from its first screen.
      const [{ projects }] = await Promise.all([this.#deps.client.request<{ projects: ProjectSummary[] }>("/api/projects"), this.readRecovery()]);
      this.dispatch({ type: "projects", projects });
      this.dispatch({ type: "connection", connection: "connected" });
      let remembered: string | null = null;
      try { remembered = this.#deps.storage?.getItem(LAST_PROJECT_KEY) ?? null; } catch { /* unavailable */ }
      const choice = [preferredProjectId, remembered].find((id) => id && projects.some((p) => p.id === id)) ?? projects[0]?.id;
      if (choice) await this.selectProject(choice);
    } catch (error) {
      this.dispatch({ type: "connection", connection: error instanceof ApiError && error.code === "AUTH_REQUIRED" ? "expired" : "failed" });
      this.dispatch({ type: "loadError", source: "projects", code: error instanceof ApiError ? error.code : "NETWORK_ERROR" });
    }
  }

  async selectProject(projectId: string): Promise<void> {
    this.#unsubscribe?.();
    this.dispatch({ type: "project", projectId });
    try { this.#deps.storage?.setItem(LAST_PROJECT_KEY, projectId); } catch { /* unavailable */ }
    this.#keys = this.#projectKeys.get(projectId) ?? new PressKeys(projectId, this.#deps.storage, this.#deps.newKey);
    this.#projectKeys.set(projectId, this.#keys);
    const subscription = new ProjectSubscription(this.#deps.client, projectId);
    this.#subscription = subscription;
    let revision = -1;
    this.#unsubscribe = subscription.subscribe(() => {
      const state = subscription.getSnapshot();
      this.dispatch({ type: "connection", connection: state.connection === "connected" ? "connected" : state.connection === "connecting" ? "connecting" : "reconnecting" });
      if (state.revision !== revision) { revision = state.revision; void this.refresh(); }
    });
    await this.refresh();
  }

  /** Try the event stream now (the offline strip's Try now) and read the film again. */
  reconnect(): void {
    this.#subscription?.connectNow();
    void this.refresh();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#subscription = null;
  }

  /** Reads snapshot, overview and Director status. Coalesces overlapping refreshes into one follow-up. */
  refresh(): Promise<void> {
    if (this.#refreshing) { this.#refreshAgain = true; return this.#refreshing; }
    this.#refreshing = (async () => {
      do {
        this.#refreshAgain = false;
        const { projectId, projectEpoch } = this.#state;
        const current = () => projectId === this.#state.projectId && projectEpoch === this.#state.projectEpoch;
        if (!projectId) return;
        const client = this.#deps.client;
        await Promise.all([
          client.request<ProjectSnapshot>(path(projectId)).then(
            (snapshot) => { if (current()) this.dispatch({ type: "snapshot", snapshot }); },
            (error) => { if (current()) this.#loadFailed("snapshot", error); }),
          client.request<GenerationOverview>(path(projectId, "/generation")).then(
            (overview) => { if (current()) this.dispatch({ type: "overview", overview }); },
            (error) => { if (current()) this.#loadFailed("overview", error); }),
          client.request<DirectorStatus>(path(projectId, "/director")).then(
            (director) => this.dispatch({ type: "director", director, projectId, projectEpoch }),
            (error) => { if (current()) this.#loadFailed("director", error); }),
          // Proposals exist from phase P4 on; an older server answers 404 and the list stays empty.
          client.request<ProposalList>(path(projectId, "/director/proposals")).then(
            ({ proposals }) => this.dispatch({ type: "proposals", proposals, projectId, projectEpoch }),
            () => this.dispatch({ type: "proposals", proposals: [], projectId, projectEpoch })),
          // A release elsewhere reaches every film as an event; the status follows it while there is a review to finish.
          this.#recoveryOpen() ? this.readRecovery() : undefined,
        ]);
      } while (this.#refreshAgain);
    })().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  /**
   * Whether a film refresh reads the recovery status too: while the studio is in review, a release of this page's is
   * unconfirmed, or the status is not known yet (its first read failed). Once the review is finished nothing is left to
   * follow, and the status is not read again on every refresh: building it walks every restored film. A new restore
   * takes the studio offline and ends every session, so the next session's start() reads it.
   */
  #recoveryOpen(): boolean {
    const { status, unconfirmed } = this.#state.recovery;
    return (status === null && !this.#recoveryMissing) || isQuarantined(status) || unconfirmed !== null;
  }

  #loadFailed(source: "snapshot" | "overview" | "director", error: unknown): void {
    this.#deps.onError?.(error);
    this.dispatch({ type: "loadError", source, code: error instanceof ApiError ? error.code : "NETWORK_ERROR" });
  }

  // ---- presses -------------------------------------------------------------

  /**
   * Run one press with a stable request identity. A lost reply keeps the saved key and body, so the
   * next press of the same thing resends them and the server replays its receipt.
   */
  async #press<T>(pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }>, toast?: Msg, timeoutMs?: number, backgroundResult = false, quiet = false, onRefused?: (message: Msg) => void): Promise<T | undefined> {
    const keys = this.#keys;
    const { projectId, projectEpoch } = this.#state;
    const current = () => projectId === this.#state.projectId && projectEpoch === this.#state.projectEpoch;
    if (this.#state.pending[pressId]) return undefined;
    // A restored studio in recovery review is read-only: nothing is sent, and the one reason is said.
    if (recoveryReadOnly(this.#state)) {
      if (!quiet) this.dispatch({ type: "toast", message: RECOVERY_LOCK, tone: "error" });
      onRefused?.(RECOVERY_LOCK);
      return undefined;
    }
    this.dispatch({ type: "pending", pressId, pending: true });
    let requestKey: string | undefined;
    try {
      const saved = keys.saved(pressId);
      const sent = saved && saved.logical === canonicalJson(logical) ? saved : keys.begin(pressId, logical, await build());
      requestKey = sent.key;
      const { path: target, body } = sent.body as { path: string; body: unknown };
      const result = await this.#deps.client.request<T>(target, { method: "POST", body, key: sent.key, ...(timeoutMs ? { timeoutMs } : {}) });
      keys.settle(pressId, sent.key);
      if (current() && toast) this.dispatch({ type: "toast", message: toast, tone: "info" });
      if (current()) void this.refresh();
      return current() || backgroundResult ? result : undefined;
    } catch (error) {
      if (definite(error) && requestKey) keys.settle(pressId, requestKey);
      // Only a request that was sent can have lost its reply; one that failed before sending says why.
      if (current()) {
        const refusal = this.#fail(error, !definite(error) && PAID_PRESS.test(pressId) && keys.saved(pressId)?.logical === canonicalJson(logical), quiet);
        onRefused?.(refusal);
      }
      if (current() && definite(error)) void this.refresh();
      return undefined;
    } finally {
      if (current()) this.dispatch({ type: "pending", pressId, pending: false });
    }
  }

  /** `unconfirmedPaid`: a paid press whose reply was lost; pressing again resends its saved key and body. */
  #fail(error: unknown, unconfirmedPaid = false, quiet = false): Msg {
    this.#deps.onError?.(error);
    const code = error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR";
    const refusal = unconfirmedPaid ? msg("error.PAID_UNCONFIRMED") : errorMsg(code);
    if (!quiet) this.dispatch({ type: "toast", message: refusal, tone: "error" });
    // The studio says it is in recovery review while this page did not know: read the status, so the page turns read-only.
    if (code === "INSTALLATION_QUARANTINED") void this.readRecovery();
    return refusal;
  }

  /**
   * True when pressing `pressId` for `logical` now would resend a saved request whose reply was lost (or that is
   * still in flight): the same Idempotency-Key, so the studio replays its receipt and never charges twice.
   */
  wouldResend(pressId: string, logical: unknown): boolean {
    return this.#keys.saved(pressId)?.logical === canonicalJson(logical);
  }

  /** The presses of this film sent with no definite answer yet (a lost reply, or still in flight). */
  savedPressIds(): string[] {
    return this.#keys.ids();
  }

  async #sceneRead(projectId: string, sceneId: string): Promise<SceneGenerationRead> {
    return this.#deps.client.request<SceneGenerationRead>(path(projectId, `/scenes/${encodeURIComponent(sceneId)}/generation`));
  }

  /** Record that the person saw this exact frame. Not authority; it only lets the confirm button explain itself. */
  openFrame(shotId: string): Promise<unknown> {
    const shot = this.#state.overview?.shots[shotId];
    const artifact = shot?.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
    // Recorded on its own when a frame is shown; while the studio is read-only it is simply not recorded.
    if (!this.#state.projectId || !artifact || shot?.keyframe.opened || recoveryReadOnly(this.#state)) return Promise.resolve(undefined);
    const body: FrameViewInput = { artifactId: artifact.artifactId, sha256: artifact.sha256 };
    return this.#press(`frame-view:${shotId}`, { shotId, ...body }, async () => ({ path: path(this.#state.projectId!, `/shots/${encodeURIComponent(shotId)}/frame-views`), body }));
  }

  makeKeyframes(sceneId: string, targetShotIds?: string[], regenerate?: boolean): Promise<unknown> {
    const overview = this.#state.overview;
    const scene = overview?.scenes.find((s) => s.sceneId === sceneId);
    if (!overview || !scene) return Promise.resolve(undefined);
    const projectId = overview.projectId;
    const expected = regenerate ? keyframeEstimate(targetShotIds?.length ? targetShotIds : scene.shotIds, overview) : scene.quotes.makeKeyframes;
    if (regenerate && !expected) { this.#fail(new CommandRefused("ESTIMATE_CHANGED")); return Promise.resolve(undefined); }
    const { pressId, logical } = keyframesPress(overview, scene, targetShotIds, regenerate);
    return this.#press(pressId, logical, async () => {
      const read = await this.#sceneRead(projectId, sceneId);
      if (read.headVersion !== overview.headVersion || read.revisionId !== overview.revisionId) throw new CommandRefused("SCENE_REVIEW_STALE");
      const body = { ...keyframesBody(read, targetShotIds, regenerate), ...(expected && !expected.priceUnknown ? { expectedEstimateMicros: expected.micros } : {}) };
      return { path: path(projectId, `/scenes/${encodeURIComponent(sceneId)}/generate`), body };
    });
  }

  regenerateKeyframe(shotId: string): Promise<unknown> {
    const sceneId = this.#state.overview?.shots[shotId]?.sceneId;
    return sceneId ? this.makeKeyframes(sceneId, [shotId], true) : Promise.resolve(undefined);
  }

  /** Confirm the opened frames and make the scene's clips (WA-8: one interface; phase P3 moves the chain to the server). */
  confirmVideo(sceneId: string): Promise<unknown> {
    const overview = this.#state.overview;
    const scene = overview?.scenes.find((s) => s.sceneId === sceneId);
    if (!overview || !scene) return Promise.resolve(undefined);
    const { pressId, logical } = confirmPress(overview, scene);
    // One durable server command (P3): it survives a closed tab or a restart and never buys a step twice.
    return this.#press(pressId, logical, async () => ({
      path: path(this.#state.projectId!, `/scenes/${encodeURIComponent(sceneId)}/confirm`),
      body: confirmBody(overview, scene),
    }));
  }

  /** Settle a too-long voice line (SB-2, SB-3): lengthen the shot, or keep its length and cut the line with a fade. Free and undoable. */
  async narrationFit(shotId: string, fit: NarrationFitInput["fit"], toast?: Msg): Promise<boolean> {
    const snapshot = this.#state.snapshot;
    if (!snapshot) return false;
    const body: NarrationFitInput = { fit, expectedHeadVersion: snapshot.project.headVersion };
    const receipt = await this.#press<NarrationFitReceipt>(`fit:${shotId}`, { shotId, ...body }, async () => ({ path: path(snapshot.project.id, `/shots/${encodeURIComponent(shotId)}/narration-fit`), body }));
    if (!receipt) return false;
    if (toast) this.dispatch({ type: "toast", message: toast, tone: "info", undoCommandId: receipt.commandId });
    return true;
  }

  /**
   * Storyboard edits are free. The toast offers Undo with the returned command id. Resolves to the command id
   * (a Director note links its "edit" choice to it), or null when the edit was not saved.
   */
  async edit(edit: StoryboardEdit, toast?: Msg | null): Promise<string | null> {
    const snapshot = this.#state.snapshot;
    if (!snapshot) return null;
    const body = { ...edit, expectedHeadVersion: snapshot.project.headVersion };
    const pressId = `edit:${edit.kind}:${"id" in edit ? edit.id : edit.commandId}`;
    const receipt = await this.#press<{ commandId: string }>(pressId, body, async () => ({ path: path(snapshot.project.id, "/storyboard"), body }), undefined, undefined, false, toast === null);
    if (!receipt) return null;
    if (toast) this.dispatch({ type: "toast", message: toast, tone: "info", ...(edit.kind !== "undo" ? { undoCommandId: receipt.commandId } : {}) });
    return receipt.commandId || null;
  }

  undo(commandId: string): Promise<string | null> {
    this.dispatch({ type: "toastDismiss" });
    return this.edit({ kind: "undo", commandId }, msg("toast.undone"));
  }

  /**
   * An info toast whose Undo runs `run`, for changes that are not storyboard commands (the narrator voice in
   * Settings). Only the latest such toast's Undo is kept; storyboard commands use their command id instead.
   */
  toastUndo(message: Msg, run: () => unknown): void {
    const key = ++this.#toastUndoKey;
    this.#toastUndo = { key, run };
    this.dispatch({ type: "toast", message, tone: "info", undoKey: key });
  }

  /** The toast's Undo: its storyboard command, or the callback it carries. The toast goes away first. */
  undoToast(toast: Pick<Toast, "undoCommandId" | "undoKey">): void {
    if (toast.undoCommandId) { void this.undo(toast.undoCommandId); return; }
    const held = this.#toastUndo;
    this.dispatch({ type: "toastDismiss" });
    if (!held || held.key !== toast.undoKey) return;
    this.#toastUndo = null;
    void held.run();
  }

  /** An unanswered edit is a saved request to check, never fresh authority over a changed field. */
  #pendingEdit(draft: EditDraft): { pressId: string; path: string; body: PendingEditBody; feedback?: NonNullable<EditDraft["saveFeedback"]>; keepOpen?: boolean } | null {
    if (!draft.projectId || draft.projectId !== this.#state.projectId) return null;
    const kinds = motionForm(draft.field) ? ["shotFields", "shot"] : [draft.field === "narration" ? "narration" : "shot"];
    for (const kind of kinds) {
      const pressId = `edit:${kind}:${draft.shotId}`;
      const saved = this.#keys.saved(pressId);
      const request = saved?.body as { path?: string; body?: PendingEditBody; feedback?: NonNullable<EditDraft["saveFeedback"]>; keepOpen?: boolean } | undefined;
      const body = request?.body;
      if (!body || request!.path !== path(draft.projectId, "/storyboard") || body.id !== draft.shotId || body.kind !== kind
        || !Number.isSafeInteger(body.expectedHeadVersion) || saved!.logical !== canonicalJson(body)) continue;
      const valid = kind === "shotFields" ? body.fields && typeof body.fields.motion === "string" && Number.isSafeInteger(body.fields.desiredFrames)
        : typeof body.value === "string" && (kind === "narration" ? body.field === "text" : body.field === draft.field);
      if (valid) return { pressId, path: request!.path!, body, ...(request!.feedback ? { feedback: request!.feedback } : {}), ...(typeof request!.keepOpen === "boolean" ? { keepOpen: request!.keepOpen } : {}) };
    }
    return null;
  }

  canReconcileEdit = (draft: EditDraft | null): boolean => {
    const saved = draft && this.#pendingEdit(draft);
    return !!saved && !this.#state.pending[saved.pressId];
  };

  reconcileEdit = (): Promise<string | null> => {
    const draft = this.#state.edit;
    const saved = draft && this.#pendingEdit(draft);
    if (!draft || !saved) return Promise.resolve(null);
    const seconds = saved.body.kind === "shotFields" ? Number(draft.secondsText ?? saved.body.fields!.desiredFrames / (this.#state.overview?.fps ?? 24)) : undefined;
    return this.saveEdit(draft, seconds, false, true);
  };

  async saveEdit(draft: EditDraft, motionSeconds?: number, keepOpen = false, reconcile = false, feedback: EditSaveFeedback = {}): Promise<string | null> {
    const original = this.#state.edit;
    const { projectId, projectEpoch, snapshot, overview } = this.#state;
    if (!original || original.saving || !snapshot || draft.projectId !== projectId || original.projectId !== projectId
      || draft.shotId !== original.shotId || !sameEditForm(draft.field, original.field) || draft.revision !== original.revision) return null;
    const head = displayedHead(projectId, snapshot, overview);
    const conflict = editConflict(original, overview, head);
    if (conflict.kind === "waiting") return null;
    const edit = motionSeconds !== undefined
      ? { kind: "shotFields", id: draft.shotId, fields: { motion: draft.value, desiredFrames: Math.round(motionSeconds * overview!.fps) } }
      : draft.field === "narration"
        ? { kind: "narration", id: draft.shotId, field: "text", value: draft.value }
        : { kind: "shot", id: draft.shotId, field: draft.field, value: draft.value };
    const candidateBody = { ...edit, expectedHeadVersion: head! };
    const pressId = `edit:${edit.kind}:${draft.shotId}`;
    if (this.#state.pending[pressId]) return null;
    const target = path(projectId!, "/storyboard");
    const previous = this.#pendingEdit(draft);
    const sameInput = !!previous && canonicalJson({ ...previous.body, expectedHeadVersion: head }) === canonicalJson(candidateBody);
    const replay = previous && (sameInput || reconcile);
    if (previous && !sameInput && !reconcile) return null;
    const originalFeedback = replay ? previous.feedback ?? original.saveFeedback : undefined;
    const output = originalFeedback ?? { message: feedback.toast === undefined ? msg("toast.saved") : feedback.toast, quiet: feedback.quiet === true };
    if (conflict.kind === "changed" && !replay) {
      const refusal = msg("error.EDIT_BASELINE_CHANGED");
      if (!output.quiet) this.dispatch({ type: "toast", message: refusal, tone: "error" });
      feedback.onRefused?.(refusal);
      return null;
    }
    const body = replay ? previous.body : candidateBody;
    const savedValue = body.kind === "shotFields" ? body.fields!.motion : body.value!;
    const savedFrames = body.kind === "shotFields" ? body.fields!.desiredFrames : undefined;
    const retain = keepOpen || !!(replay && (previous.keepOpen ?? original.keepOpenAfterSave));
    const submitted = { ...original, ...draft, saving: true, expectedHeadVersion: body.expectedHeadVersion, keepOpenAfterSave: retain, saveFeedback: output };
    this.dispatch({ type: "edit", edit: submitted });
    const receipt = await this.#press<{ commandId: string; headVersion?: number }>(pressId, body, async () => ({ path: target, body, feedback: output, keepOpen: retain }), undefined, undefined, false, output.quiet, feedback.onRefused);
    if (projectEpoch !== this.#state.projectEpoch || projectId !== this.#state.projectId) return null;
    const current = this.#state.edit;
    // Only this form's submitted revision or its newer typing may be updated; Cancel/reopen is another owner.
    if (current?.shotId === original.shotId && sameEditForm(current.field, original.field) && current.projectId === projectId
      && (current.revision === original.revision || current.saving)) {
      const savedHead = receipt?.headVersion ?? body.expectedHeadVersion + 1;
      const now = this.#state;
      const shownHead = displayedHead(now.projectId, now.snapshot, now.overview);
      const shownShot = now.overview?.shots[current.shotId];
      const shown = shownShot && editValues(current.field, shownShot);
      const newerSavedValue = shownHead !== null && shownHead > savedHead && shown
        && (savedFrames !== undefined ? shown.motion !== savedValue || shown.durationFrames !== savedFrames : shown.value !== savedValue);
      const next = receipt ? { ...current, saving: false, expectedHeadVersion: savedHead,
        baselineValue: savedValue,
        ...(savedFrames !== undefined ? { baselineMotion: savedValue, baselineFrames: savedFrames } : {}) } : { ...current, saving: false };
      this.dispatch({ type: "edit", edit: receipt && current.revision === original.revision && !retain
        && (!replay || sameInput) && !newerSavedValue ? null : next });
    }
    if (receipt && output.message && !output.quiet) this.dispatch({ type: "toast", message: output.message, tone: "info", undoCommandId: receipt.commandId });
    return receipt?.commandId ?? null;
  }

  async sendMessage(): Promise<boolean> {
    const { composer, snapshot, overview, projectEpoch } = this.#state;
    if (!snapshot || composer.sending) return false;
    // The pictures' links lead the text; keyframes add their shots to the scope; imported pictures go as images.
    const body = messageBody(composer, overview ?? { projectId: snapshot.project.id, shots: {} });
    if (!body) return false;
    this.dispatch({ type: "composerSending", sending: true });
    const receipt = await this.#press<unknown>(`message`, { text: body.text, scopeIds: body.scopeIds, ...(body.images ? { images: body.images } : {}) }, async () => ({ path: path(snapshot.project.id, "/messages"), body }), undefined, undefined, true);
    // Another film opened while this was sending: its composer is that film's, not this message's.
    const same = this.#state.projectId === snapshot.project.id && this.#state.projectEpoch === projectEpoch;
    if (receipt === undefined) { if (same) this.dispatch({ type: "composerSending", sending: false }); return false; }
    if (same) this.dispatch({ type: "composerSent", sent: { text: composer.text, targets: composer.targets, images: composer.images } });
    return true;
  }

  /** Answer a pending Director question. The server takes exactly { text, replyToQuestionId }: no scope, no editing flag. */
  async answerQuestion(questionId: string, text: string, answers?: { questionId: string; optionIndex: number }[]): Promise<boolean> {
    const snapshot = this.#state.snapshot;
    // Structured answers (DC-17) carry the chosen option indexes next to the readable text.
    const body = { text: text.trim(), replyToQuestionId: questionId, ...(answers?.length ? { answers } : {}) };
    if (!snapshot || !body.text) return false;
    const receipt = await this.#press<unknown>(`answer:${questionId}`, body, async () => ({ path: path(snapshot.project.id, "/messages"), body }));
    return receipt !== undefined;
  }

  stopFilm(): Promise<unknown> {
    const body: ControlInput = { action: "stop" };
    return this.#press<ControlReceipt>("control:stop", { action: "stop", cursor: this.#state.overview?.cursor ?? 0 }, async () => ({ path: path(this.#state.projectId!, "/controls"), body }));
  }

  continueFilm(): Promise<unknown> {
    const body: ControlInput = { action: "resume", expectedAuthorityId: this.#state.overview?.controlAuthorityId ?? null };
    return this.#press<ControlReceipt>("control:resume", body, async () => ({ path: path(this.#state.projectId!, "/controls"), body }));
  }

  /** Give up on a job with no answer (plan decision D7); the person acknowledged the double-charge risk. */
  releaseAttempt(attemptId: string): Promise<unknown> {
    const body: ReleaseAttemptInput = { expectedPhase: "submission_unknown", acknowledgeDoubleCharge: true };
    return this.#press(`release:${attemptId}`, { attemptId }, async () => ({ path: path(this.#state.projectId!, `/attempts/${encodeURIComponent(attemptId)}/release`), body }));
  }

  /** Settle a Director note with one of its choices (DC-10). Paid and edit choices pass the request or edit that carried them out. */
  resolveNote(noteId: string, choiceIndex: number, resultRef?: string): Promise<unknown> {
    const note = this.#state.snapshot?.notes?.find((n) => n.noteId === noteId);
    if (!note || !this.#state.projectId) return Promise.resolve(undefined);
    const body: ResolveNoteInput = { choiceIndex, expectedVersion: note.version, ...(resultRef ? { resultRef } : {}) };
    return this.#press(`note:${noteId}`, { noteId, choiceIndex, version: note.version }, async () => ({ path: path(this.#state.projectId!, `/director/notes/${encodeURIComponent(noteId)}/resolve`), body }));
  }

  /** Accept a held Director proposal exactly as previewed (DC-2, DC-3). */
  acceptProposal(proposal: DirectorProposal, toast?: Msg): Promise<ProposalReceipt | undefined> {
    const body: AcceptProposalInput = { previewDigest: proposal.previewDigest };
    return this.#press<ProposalReceipt>(`proposal:accept:${proposal.proposalId}`, { proposalId: proposal.proposalId, ...body }, async () => ({ path: path(this.#state.projectId!, `/director/proposals/${encodeURIComponent(proposal.proposalId)}/accept`), body }), toast);
  }

  rejectProposal(proposalId: string): Promise<ProposalReceipt | undefined> {
    return this.#press<ProposalReceipt>(`proposal:reject:${proposalId}`, { proposalId }, async () => ({ path: path(this.#state.projectId!, `/director/proposals/${encodeURIComponent(proposalId)}/reject`), body: {} }));
  }

  /** Undo an accepted proposal; fields the person changed since are left alone (DC-4). */
  async undoProposal(proposalId: string): Promise<ProposalReceipt | undefined> {
    const receipt = await this.#press<ProposalReceipt>(`proposal:undo:${proposalId}`, { proposalId }, async () => ({ path: path(this.#state.projectId!, `/director/proposals/${encodeURIComponent(proposalId)}/undo`), body: {} }));
    if (receipt) this.dispatch({ type: "toast", message: receipt.leftAlone?.length ? msg("note.proposal.left_alone", { count: receipt.leftAlone.length }) : msg("note.proposal.undone"), tone: "info" });
    return receipt;
  }

  // ---- generic primitives for views (phase P5): views define their commands in their own model files ----

  /** GET a project-relative path (e.g. "/assets") or an absolute /api path. */
  read<T>(relativeOrApiPath: string, options?: AbortSignal | { signal?: AbortSignal; timeoutMs?: number }): Promise<T> {
    const target = relativeOrApiPath.startsWith("/api/") ? relativeOrApiPath : path(this.#state.projectId ?? "", relativeOrApiPath);
    const { signal, timeoutMs } = options instanceof AbortSignal ? { signal: options, timeoutMs: undefined } : options ?? {};
    return this.#deps.client.request<T>(target, { ...(signal ? { signal } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
  }

  /**
   * POST with request identity (see #press): one press id per control, a logical identity for resends,
   * and a builder for the path and body. Refreshes the studio afterwards. Errors become toasts.
   */
  /** `timeoutMs` for slow commands (e.g. Codex setup checks take up to 90 s); the default is 15 s. */
  command<T>(pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }> | { path: string; body: unknown }, toast?: Msg, options?: { timeoutMs?: number }): Promise<T | undefined> {
    const projectId = this.#state.projectId;
    return this.#press<T>(pressId, logical, async () => {
      const request = await build();
      return { path: request.path.startsWith("/api/") ? request.path : path(projectId ?? "", request.path), body: request.body };
    }, toast, options?.timeoutMs);
  }

  // ---- installation recovery and the session -------------------------------------------------

  /** Read the installation's recovery status. Never throws: an older server without the route, or a failed read, keeps what was known. */
  async readRecovery(): Promise<void> {
    const read = ++this.#recoveryRead;
    try {
      const status = parseRecoveryStatus(await this.#deps.client.request<unknown>(RECOVERY_PATH));
      if (!status || read !== this.#recoveryRead) return;
      const { recovery } = this.#state;
      const keep = unconfirmedStillApplies(recovery.unconfirmed, status);
      if (recovery.unconfirmed && !keep) this.#saveRelease(null);
      const same = recovery.status && canonicalJson(recovery.status) === canonicalJson(status);
      if (same && (keep || !recovery.unconfirmed)) return;
      this.dispatch({ type: "recovery", recovery: { status, ...(keep ? {} : { unconfirmed: null }), ...recoveryChange(recovery.status, status, recovery.unconfirmed) } });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.#recoveryMissing = true;
    }
  }

  #saveRelease(saved: SavedRelease | null): void {
    try {
      if (saved) this.#deps.storage?.setItem(RELEASE_STORAGE_KEY, JSON.stringify(saved));
      else this.#deps.storage?.removeItem(RELEASE_STORAGE_KEY);
    } catch { /* storage unavailable: the state still offers Retry in this page */ }
  }

  /**
   * Finish the recovery review: release exactly the receipt and summary the person saw, with an Idempotency-Key.
   * A lost reply keeps the decision (in state and storage) so Retry resends the same key and body; a changed summary
   * is refused by the server, and the review is read again for the person to look over before finishing.
   */
  async releaseRecovery(): Promise<ReleaseOutcome | undefined> {
    const { recovery, pending } = this.#state;
    if (pending[RELEASE_PRESS]) return undefined;
    const saved = unconfirmedStillApplies(recovery.unconfirmed, recovery.status) ? recovery.unconfirmed : null;
    const body = saved?.body ?? releaseBody(recovery.status);
    if (!body) return undefined;
    const request: SavedRelease = saved ?? { key: this.#deps.newKey(), body };
    this.#saveRelease(request);
    this.dispatch({ type: "recovery", recovery: { unconfirmed: request, stale: false } });
    this.dispatch({ type: "pending", pressId: RELEASE_PRESS, pending: true });
    try {
      const answer = await this.#deps.client.request<{ recovery?: unknown }>(RELEASE_PATH, { method: "POST", body: request.body, key: request.key });
      this.#saveRelease(null);
      const status = parseRecoveryStatus(answer?.recovery);
      this.#recoveryRead++;
      this.dispatch({ type: "recovery", recovery: { unconfirmed: null, stale: false, released: true, ...(status ? { status } : {}) } });
      if (!status) void this.readRecovery();
      void this.refresh();
      return "released";
    } catch (error) {
      const outcome = releaseOutcome(error instanceof ApiError ? error : { status: 0 });
      if (outcome === "unconfirmed") return outcome;
      this.#saveRelease(null);
      if (outcome === "stale") {
        this.dispatch({ type: "recovery", recovery: { unconfirmed: null, stale: true } });
        await this.readRecovery();
      } else if (outcome === "already") {
        this.dispatch({ type: "recovery", recovery: { unconfirmed: null, stale: false, released: true } });
        this.dispatch({ type: "toast", message: msg("recovery.toast.already"), tone: "info" });
        await this.readRecovery();
        void this.refresh();
      } else {
        this.dispatch({ type: "recovery", recovery: { unconfirmed: null } });
        this.#fail(error);
      }
      return outcome;
    } finally {
      this.dispatch({ type: "pending", pressId: RELEASE_PRESS, pending: false });
    }
  }

  /** Put away what the review said after it was finished. */
  dismissRecovery = () => this.dispatch({ type: "recovery", recovery: { released: false, stale: false } });

  /**
   * End this window's session (POST /api/session/logout). Resolves null once the studio confirmed it and the store
   * stopped (the page then shows Connect), or the error code when it refused or did not answer (the page stays and
   * the dialog that asked says why). A session that had already ended (AUTH_REQUIRED, or a client already closed) is
   * what the person asked for, so that counts as disconnected too. It is not a studio write, so a studio in recovery
   * review still allows it.
   */
  async disconnect(): Promise<string | null> {
    if (this.#state.pending[DISCONNECT_PRESS]) return "PENDING";
    this.dispatch({ type: "pending", pressId: DISCONNECT_PRESS, pending: true });
    try {
      await this.#deps.client.request("/api/session/logout", { method: "POST" });
      this.stop();
      return null;
    } catch (error) {
      if (error instanceof ApiError && SESSION_GONE.has(error.code)) { this.stop(); return null; }
      this.#deps.onError?.(error);
      return error instanceof ApiError ? error.code : "NETWORK_ERROR";
    } finally {
      this.dispatch({ type: "pending", pressId: DISCONNECT_PRESS, pending: false });
    }
  }

  /**
   * Whether this press's last attempt went unanswered (no reply, a timeout, a server failure): its key and body are
   * kept, so pressing it again with the same identity resends the very same request and the server replays its
   * outcome. False once the server has answered (or refused) it.
   */
  unconfirmed = (pressId: string): boolean => !this.#state.pending[pressId] && !!this.#keys.saved(pressId);

  // ---- plain UI state ----------------------------------------------------------

  setView = (view: ViewName) => this.dispatch({ type: "view", view });
  selectScene = (sceneId: string) => this.dispatch({ type: "scene", sceneId });
  selectShot = (shotId: string) => this.dispatch({ type: "shot", shotId });
  /** Open a shot from elsewhere (a Director note): selected, and the view on screen brings it into view, even again. */
  focusShot = (shotId: string) => this.dispatch({ type: "focus", kind: "shot", id: shotId });
  focusScene = (sceneId: string) => this.dispatch({ type: "focus", kind: "scene", id: sceneId });
  /** Switch to `view` with the shot focused there (Keyframes' "Edit 2.1 in Plan"): the view brings it into view when it opens. */
  openShotIn = (view: ViewName, shotId: string) => this.dispatch({ type: "focus", kind: "shot", id: shotId, view });
  /** Open Assets showing one kind of file (e.g. Film's earlier exports). */
  openAssets = (role: RoleFilter) => { this.dispatch({ type: "assetsFilter", role }); this.setView("assets"); };
  setDirectorOpen = (open: boolean) => this.dispatch({ type: "directorOpen", open });
  setComposerText = (text: string) => this.dispatch({ type: "composerText", text });
  pointAt = (target: Target, add = true) => this.dispatch({ type: "composerTarget", target, add });
  /** Add a picture for the Director to the message; returns why not when it cannot (said by the caller). */
  showPicture = (candidate: PictureCandidate): Msg | null => {
    const result = addPicture(this.#state.composer.images, candidate, this.#state.director);
    if ("refused" in result) return result.refused;
    this.dispatch({ type: "composerImages", images: result.images });
    return null;
  };
  removePicture = (key: string) => this.dispatch({ type: "composerImages", images: this.#state.composer.images.filter((image) => pictureKey(image) !== key) });
  restoreDraft = (draft: Draft) => this.dispatch({ type: "composerRestore", ...draft });
  /** Explicitly choose which text to keep after reviewing the current saved value. No command is sent. */
  resolveEditConflict = (keepText: boolean): void => {
    const { projectId, snapshot, overview, edit } = this.#state;
    const head = displayedHead(projectId, snapshot, overview);
    const shot = edit && overview?.shots[edit.shotId];
    if (!edit || !shot || head === null) return;
    const saved = editValues(edit.field, shot).value;
    this.dispatch({ type: "edit", edit: { ...edit, saving: false, value: keepText ? edit.value : saved,
      baselineValue: saved, baselineMotion: shot.motion, baselineFrames: shot.durationFrames, expectedHeadVersion: head,
      ...(!keepText ? { secondsText: String(Math.round(shot.durationFrames / overview!.fps)) } : {}), revision: ++this.#editRevision } });
  };
  setEdit = (edit: EditDraft | null) => {
    if (!edit) { this.dispatch({ type: "edit", edit: null }); return; }
    const current = this.#state.edit;
    if (current && current.shotId !== edit.shotId) return;
    const shot = this.#state.overview?.shots[edit.shotId];
    const same = current?.shotId === edit.shotId && sameEditForm(current.field, edit.field) && current.projectId === this.#state.projectId;
    const legacy = edit.expectedHeadVersion === -1;
    const baselineValue = edit.baselineValue ?? (!legacy && shot ? editValues(edit.field, shot).value : undefined);
    const baselineMotion = edit.baselineMotion ?? (!legacy ? shot?.motion : undefined);
    const baselineFrames = edit.baselineFrames ?? (!legacy ? shot?.durationFrames : undefined);
    const base = same ? current : { ...(this.#state.projectId ? { projectId: this.#state.projectId } : {}),
      ...((edit.expectedHeadVersion ?? this.#state.overview?.headVersion ?? this.#state.snapshot?.project.headVersion) !== undefined ? { expectedHeadVersion: (edit.expectedHeadVersion ?? this.#state.overview?.headVersion ?? this.#state.snapshot?.project.headVersion)! } : {}),
      ...(baselineValue !== undefined ? { baselineValue } : {}),
      ...(baselineMotion !== undefined ? { baselineMotion } : {}),
      ...(baselineFrames !== undefined ? { baselineFrames } : {}),
      ...(shot ? { secondsText: String(Math.round(shot.durationFrames / this.#state.overview!.fps)) } : {}) };
    this.dispatch({ type: "edit", edit: { ...edit, ...base, field: edit.field, value: edit.value, ...(edit.secondsText !== undefined ? { secondsText: edit.secondsText } : {}), revision: ++this.#editRevision } });
  };
  dismissToast = () => this.dispatch({ type: "toastDismiss" });
}
