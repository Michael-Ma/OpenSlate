import type { AcceptProposalInput, NarrationFitInput, NarrationFitReceipt, ControlInput, ControlReceipt, DirectorProposal, FrameViewInput, GenerationOverview, ProposalList, ProposalReceipt, ReleaseAttemptInput, ResolveNoteInput } from "@openslate/core/public";
import { ProjectSubscription } from "../../shared/project-subscription.ts";
import { ApiError, type EventOptions, type RequestOptions } from "../api/client.ts";
import { errorMsg } from "../i18n/translate.ts";
import type { RoleFilter } from "../model/assets.ts";
import { CommandRefused, confirmBody, keyframesBody, type SceneGenerationRead, type StoryboardEdit } from "../model/commands.ts";
import { msg, type DirectorStatus, type Msg, type ProjectSnapshot, type ProjectSummary, type Target, type ViewName } from "../model/types.ts";
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
const path = (projectId: string, rest = "") => `/api/projects/${encodeURIComponent(projectId)}${rest}`;

/** Definite refusals: the request was answered and will not succeed by resending it. */
const definite = (error: unknown) => error instanceof CommandRefused || (error instanceof ApiError && error.status >= 400 && error.status < 500);

export class StudioStore {
  #state: StudioState = initialState;
  readonly #listeners = new Set<() => void>();
  readonly #deps: StoreDeps;
  /** The open film's presses, or the library's while no film is open (Start on a first run). */
  #keys: PressKeys;
  #subscription: ProjectSubscription | null = null;
  #unsubscribe: (() => void) | null = null;
  #refreshing: Promise<void> | null = null;
  /** The Undo of the latest toastUndo, by its key (callbacks never go into state). */
  #toastUndo: { key: number; run: () => unknown } | null = null;
  #toastUndoKey = 0;
  #refreshAgain = false;

  constructor(deps: StoreDeps) {
    this.#deps = deps;
    this.#keys = new PressKeys(null, deps.storage, deps.newKey);
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
      const { projects } = await this.#deps.client.request<{ projects: ProjectSummary[] }>("/api/projects");
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
    this.#keys = new PressKeys(projectId, this.#deps.storage, this.#deps.newKey);
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
        const projectId = this.#state.projectId;
        if (!projectId) return;
        const client = this.#deps.client;
        await Promise.all([
          client.request<ProjectSnapshot>(path(projectId)).then(
            (snapshot) => this.dispatch({ type: "snapshot", snapshot }),
            (error) => this.#loadFailed("snapshot", error)),
          client.request<GenerationOverview>(path(projectId, "/generation")).then(
            (overview) => this.dispatch({ type: "overview", overview }),
            (error) => this.#loadFailed("overview", error)),
          client.request<DirectorStatus>(path(projectId, "/director")).then(
            (director) => this.dispatch({ type: "director", director }),
            (error) => this.#loadFailed("director", error)),
          // Proposals exist from phase P4 on; an older server answers 404 and the list stays empty.
          client.request<ProposalList>(path(projectId, "/director/proposals")).then(
            ({ proposals }) => this.dispatch({ type: "proposals", proposals }),
            () => this.dispatch({ type: "proposals", proposals: [] })),
        ]);
      } while (this.#refreshAgain);
    })().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
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
  async #press<T>(pressId: string, logical: unknown, build: () => Promise<{ path: string; body: unknown }>, toast?: Msg, timeoutMs?: number): Promise<T | undefined> {
    const keys = this.#keys;
    if (this.#state.pending[pressId]) return undefined;
    this.dispatch({ type: "pending", pressId, pending: true });
    try {
      const saved = keys.saved(pressId);
      const sent = saved && saved.logical === canonicalJson(logical) ? saved : keys.begin(pressId, logical, await build());
      const { path: target, body } = sent.body as { path: string; body: unknown };
      const result = await this.#deps.client.request<T>(target, { method: "POST", body, key: sent.key, ...(timeoutMs ? { timeoutMs } : {}) });
      keys.settle(pressId);
      if (toast) this.dispatch({ type: "toast", message: toast, tone: "info" });
      void this.refresh();
      return result;
    } catch (error) {
      if (definite(error)) keys.settle(pressId);
      this.#fail(error);
      if (definite(error)) void this.refresh();
      return undefined;
    } finally {
      this.dispatch({ type: "pending", pressId, pending: false });
    }
  }

  #fail(error: unknown): void {
    this.#deps.onError?.(error);
    const code = error instanceof ApiError || error instanceof CommandRefused ? error.code : "NETWORK_ERROR";
    this.dispatch({ type: "toast", message: errorMsg(code), tone: "error" });
  }

  async #sceneRead(sceneId: string): Promise<SceneGenerationRead> {
    return this.#deps.client.request<SceneGenerationRead>(path(this.#state.projectId!, `/scenes/${encodeURIComponent(sceneId)}/generation`));
  }

  /** Record that the person saw this exact frame. Not authority; it only lets the confirm button explain itself. */
  openFrame(shotId: string): Promise<unknown> {
    const shot = this.#state.overview?.shots[shotId];
    const artifact = shot?.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
    if (!this.#state.projectId || !artifact || shot?.keyframe.opened) return Promise.resolve(undefined);
    const body: FrameViewInput = { artifactId: artifact.artifactId, sha256: artifact.sha256 };
    return this.#press(`frame-view:${shotId}`, { shotId, ...body }, async () => ({ path: path(this.#state.projectId!, `/shots/${encodeURIComponent(shotId)}/frame-views`), body }));
  }

  makeKeyframes(sceneId: string, targetShotIds?: string[], regenerate?: boolean): Promise<unknown> {
    const overview = this.#state.overview;
    const scene = overview?.scenes.find((s) => s.sceneId === sceneId);
    if (!overview || !scene) return Promise.resolve(undefined);
    const expected = regenerate ? scene.quotes.regenerateKeyframe : scene.quotes.makeKeyframes;
    const logical = { kind: "image", sceneId, targets: targetShotIds ?? scene.keyframeTargets, regenerate: !!regenerate, previous: (targetShotIds ?? []).map((id) => overview.shots[id]?.keyframe.artifact?.artifactId ?? null) };
    return this.#press(regenerate ? `regenerate:${targetShotIds?.join(",")}` : `keyframes:${sceneId}`, logical, async () => {
      const read = await this.#sceneRead(sceneId);
      const body = { ...keyframesBody(read, targetShotIds, regenerate), ...(expected && !expected.priceUnknown ? { expectedEstimateMicros: expected.micros } : {}) };
      return { path: path(this.#state.projectId!, `/scenes/${encodeURIComponent(sceneId)}/generate`), body };
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
    const frames = scene.videoTargets.map((id) => ({ shotId: id, artifactId: overview.shots[id]?.keyframe.artifact?.artifactId ?? null }));
    // One durable server command (P3): it survives a closed tab or a restart and never buys a step twice.
    return this.#press(`confirm:${sceneId}`, { kind: "confirm", sceneId, frames }, async () => ({
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
  async edit(edit: StoryboardEdit, toast?: Msg): Promise<string | null> {
    const snapshot = this.#state.snapshot;
    if (!snapshot) return null;
    const body = { ...edit, expectedHeadVersion: snapshot.project.headVersion };
    const pressId = `edit:${edit.kind}:${"id" in edit ? edit.id : edit.commandId}`;
    const receipt = await this.#press<{ commandId: string }>(pressId, body, async () => ({ path: path(snapshot.project.id, "/storyboard"), body }));
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

  async saveEdit(draft: EditDraft): Promise<string | null> {
    this.dispatch({ type: "edit", edit: { ...draft, saving: true } });
    const ok = draft.field === "narration"
      ? await this.edit({ kind: "narration", id: draft.shotId, field: "text", value: draft.value }, msg("toast.saved"))
      : await this.edit({ kind: "shot", id: draft.shotId, field: draft.field, value: draft.value }, msg("toast.saved"));
    this.dispatch({ type: "edit", edit: ok ? null : { ...draft, saving: false } });
    return ok;
  }

  async sendMessage(): Promise<boolean> {
    const { composer, snapshot } = this.#state;
    const text = composer.text.trim();
    if (!snapshot || !text || composer.sending) return false;
    const scopeIds = composer.targets.length ? composer.targets.map((t) => t.id) : [snapshot.project.id];
    this.dispatch({ type: "composerSending", sending: true });
    const body = { text, scopeIds, editing: true };
    const receipt = await this.#press<unknown>(`message`, { text, scopeIds }, async () => ({ path: path(snapshot.project.id, "/messages"), body }));
    if (receipt === undefined) { this.dispatch({ type: "composerSending", sending: false }); return false; }
    this.dispatch({ type: "composerSent" });
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
    return this.#press<T>(pressId, logical, async () => {
      const request = await build();
      return { path: request.path.startsWith("/api/") ? request.path : path(this.#state.projectId ?? "", request.path), body: request.body };
    }, toast, options?.timeoutMs);
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
  /** Open Assets showing one kind of file (e.g. Film's earlier exports). */
  openAssets = (role: RoleFilter) => { this.dispatch({ type: "assetsFilter", role }); this.setView("assets"); };
  setDirectorOpen = (open: boolean) => this.dispatch({ type: "directorOpen", open });
  setComposerText = (text: string) => this.dispatch({ type: "composerText", text });
  pointAt = (target: Target, add = true) => this.dispatch({ type: "composerTarget", target, add });
  setEdit = (edit: EditDraft | null) => this.dispatch({ type: "edit", edit });
  dismissToast = () => this.dispatch({ type: "toastDismiss" });
}
