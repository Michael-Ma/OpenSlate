import type { GenerationOverview, ShotOverview } from "@openslate/core/public";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { useReducedMotion } from "../../keyframes/parts.tsx";
import { afterSave, editedKeys, touched, type Held, type HeldFields } from "../../model/plan-conflict.ts";
import { dropLost, dropLostAt, placeOf, placeView, putLost, sayLost, type Editing, type KeptField, type PlaceView } from "../../model/plan-drafts.ts";
import { DRAFT_FIELD, draftEdits, editChange, FIELD_LABEL, savedMessage, storedShot, unitPrices, type DraftCommand, type ShotDraft } from "../../model/plan-edit.ts";
import { importName, importNotes, importReview, importStage, type PlanImportsRead } from "../../model/plan-import.ts";
import { addedScene, addedShot, deleteSceneFacts, deleteShotFacts, locate, planOutline, sceneChoices, sceneMove, shotDrop, shotMove, type SceneView, type ShotMoveTarget, type ShotRowView, type SnapshotShot } from "../../model/plan.ts";
import { NARROW_QUERY } from "../../model/shell.ts";
import { msg, type Msg, type ProjectSnapshot, type Target } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { confirmImport, discardImport, headAfter, infoToast, refusal, sendImport, storyboardOutcome, takeRefusal, undoToast, type Outcome, type StoryboardReceipt } from "./commands.ts";
import { DeleteDialog } from "./DeleteDialog.tsx";
import { DiscardDialog } from "./DiscardDialog.tsx";
import { ImportSheet } from "./ImportSheet.tsx";
import { useLastChange } from "./last-change.ts";
import { PLAN_TITLE_ID } from "./Modal.tsx";
import { MoveDialog } from "./MoveDialog.tsx";
import { KeptDraft, UnconfirmedNotice, type Unconfirmed } from "./Notices.tsx";
import { ScenePanel, sceneElementId } from "./ScenePanel.tsx";
import { ShotEditor, type EditorFocus } from "./ShotEditor.tsx";
import { rowId, SHOT_DRAG_TYPE, ShotRow } from "./ShotRow.tsx";
import { TextPanel } from "./TextPanel.tsx";
import { useLatest, type DraftSlot } from "./useHeld.ts";
import "./plan.css";

type Confirming = { kind: "scene"; sceneId: string } | { kind: "shot"; shotId: string };
type Drafts = Record<string, Held<HeldFields>>;

/** A press whose reply was lost, with what to do once its outcome is known. Methods, so any receipt type fits. */
interface Lost extends Unconfirmed {
  resend(): Promise<Outcome<unknown>>;
  done(receipt: unknown): Promise<void> | void;
  refused?(): void;
}

/** Closing an editor with unsaved text waits for the person's answer. */
interface Asking {
  name: Msg;
  proceed(): void;
}

/** Where a dragged shot would land. */
interface DropAt {
  sceneId: string;
  beforeId: string | undefined;
}

const LOST_STRIP_ID = "plan-lost-reply";

const commandPress = (command: DraftCommand, shotId: string) => (command.edit.kind === "shotFields" ? `shotFields:${shotId}` : `narration:${shotId}:${command.edit.field}`);

const focusLater = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));

/** The drafts with this place's set (or removed, when undefined). */
function withDraft(all: Drafts, place: string, held: Held<HeldFields> | undefined): Drafts {
  const { [place]: _gone, ...rest } = all;
  return held ? { ...rest, [place]: held } : rest;
}

/**
 * The Plan view (plan items SB-20, SB-13, SB-9, SB-12, SB-10): the film's outline as a document. Brief and story on
 * top, then one panel per scene with its shots. Every edit is a free storyboard command with one-step Undo; the shot
 * editor says before saving what the change outdates. A written plan can be brought in and reviewed.
 */
export function PlanView() {
  const { t } = useI18n();
  const overview = useStudio((s) => s.overview);
  const snapshot = useStudio((s) => s.snapshot);
  const loadError = useStudio((s) => s.loadErrors.snapshot ?? s.loadErrors.overview);
  if (!overview || !snapshot) {
    return (
      <main className="work plan plan-state" data-view="plan" data-state={loadError ? "missing" : "loading"} aria-busy={!loadError}>
        <div className="plan-message" role={loadError ? "alert" : "status"}>
          {loadError ? <><b>{t("plan.missing.title")}</b><span>{t("plan.missing.body", { code: loadError })}</span></> : t("plan.loading")}
        </div>
      </main>
    );
  }
  // One film's drafts and notices never carry over to another.
  return <Workspace key={snapshot.project.id} overview={overview} snapshot={snapshot} />;
}

function Workspace({ overview, snapshot }: { overview: GenerationOverview; snapshot: ProjectSnapshot }) {
  const store = useStore();
  const mode = useMode();
  const { t, tm } = useI18n();
  const reduced = useReducedMotion();
  const proposals = useStudio((s) => s.proposals);
  const director = useStudio((s) => s.director);
  const connection = useStudio((s) => s.connection);
  const pending = useStudio((s) => s.pending);
  const focus = useStudio((s) => s.focus);
  const imports = useResource<PlanImportsRead>("/plan-imports");
  const outline = useMemo(() => planOutline(snapshot, overview, proposals), [snapshot, overview, proposals]);
  const storedById = useMemo(() => new Map<string, SnapshotShot>(snapshot.project.shots.map((row) => [row.id, row])), [snapshot.project.shots]);
  const fps = overview.fps;

  // What a press's outcome acts on is read through the `...Now` refs: it may arrive after an await, or from a retry
  // long after the press, when something else is open.
  const [editing, setEditing, editingNow] = useLatest<Editing | null>(null);
  /** Open drafts by place ("shot:<id>", "brief"): kept here, so a draft outlives its editor's mount. */
  const [drafts, setDrafts, draftsNow] = useLatest<Drafts>({});
  const [error, setError] = useState<{ place: string; message: Msg } | null>(null);
  const [confirming, setConfirmingState, confirmingNow] = useLatest<Confirming | null>(null);
  const [deleteError, setDeleteError] = useState<Msg | null>(null);
  const [moving, setMovingState, movingNow] = useLatest<string | null>(null);
  const [moveError, setMoveError] = useState<Msg | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [justSent, setJustSent] = useState<string | null>(null);
  const [noCodex, setNoCodex] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  /** Presses whose reply was lost, one notice each, until their own resend is answered or they are dismissed. */
  const [lost, setLost, lostNow] = useLatest<Lost[]>([]);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAtState] = useState<DropAt | null>(null);
  const [last, setLast] = useLastChange(snapshot.project.id);
  /** Where focus goes when the shot editor mounts (opened, or remounted in another scene after a move). */
  const editorFocus = useRef<EditorFocus | null>(null);
  /** The open editor's subject as last seen on screen, to name it once it is deleted. */
  const seen = useRef<{ place: string; view: PlaceView } | null>(null);
  const retrying = useRef(new Set<string>());

  // ---- guards ----------------------------------------------------------------------------------------
  const busy = Object.keys(pending).some((key) => key.startsWith("plan:") || key.startsWith("edit:"));
  const importPending = imports.data?.pending ?? null;
  const connected = connection === "connected";
  // While a change is unconfirmed the film's head version is unknown: a new edit would be refused as out of date,
  // and a second unanswered press would hide the first. It is retried or dismissed first.
  const guard = !connected ? t("plan.guard.offline") : importPending ? t("plan.guard.import") : lost.length ? t("plan.guard.unconfirmed") : undefined;
  const runGuard = overview.stopped ? t("plan.guard.stopped") : undefined;
  const codexReady = !noCodex && (mode === "fixture" || director?.mode === "native");
  const stage = importPending ? importStage(importPending, codexReady) : justSent ? "reading" : importStage(null, codexReady);
  const review = useMemo(() => (importPending?.draft ? importReview(snapshot.project, importPending.draft.project, fps) : null), [importPending, snapshot.project, fps]);
  const notes = useMemo(() => (importPending ? importNotes(snapshot.conversation, importPending.id) : []), [importPending, snapshot.conversation]);
  // One-step Undo while nothing has changed since (the server also refuses an older command: UNDO_UNAVAILABLE).
  const canUndo = !!last && last.headVersion === snapshot.project.headVersion;

  // ---- the open editor, and what became of its shot or scene ---------------------------------------------
  const editPlace = placeOf(editing);
  const editView = editing ? placeView(editing, outline) : null;
  const gone = !!editing && !editView;
  const goneDraft = gone && editPlace ? drafts[editPlace] : undefined;
  const kept = goneDraft && touched(goneDraft) ? goneDraft : null;
  useEffect(() => { if (editPlace && editView) seen.current = { place: editPlace, view: editView }; });
  // Deleted underneath with nothing typed: the editor simply goes with it. With text, KeptDraft keeps it on screen.
  useEffect(() => { if (gone && !kept) closeEditor(); });

  /** A lost reply is said where it happened when that is on screen; otherwise in the strip under the header. */
  const { byPlace, strip } = sayLost(lost, new Set([...(editView && editPlace ? [editPlace] : []), ...(importOpen ? ["import"] : [])]));
  const lostIn = (place: string) => byPlace.get(place) ?? null;

  useEffect(() => { if (importPending) setJustSent(null); }, [importPending]);
  // The strip sits at the top of the outline (sticky on wide screens); a phone scrolls the page, so bring it in sight.
  const stripShown = strip.length > 0;
  useEffect(() => {
    if (stripShown) document.getElementById(LOST_STRIP_ID)?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [stripShown, reduced]);
  const setConfirming = (next: Confirming | null) => { setDeleteError(null); setConfirmingState(next); };
  const setMoving = (next: string | null) => { setMoveError(null); setMovingState(next); };

  // ---- flash and scroll to a row or scene (after a move, an add, or the Director's "Open 2.2") ----------
  const flashed = useRef<string | null>(null);
  useEffect(() => {
    if (!flash || flashed.current === flash) return;
    const element = document.getElementById(flash);
    if (!element) return;
    flashed.current = flash;
    element.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    window.setTimeout(() => { flashed.current = null; setFlash((current) => (current === flash ? null : current)); }, 1600);
  }, [flash, outline, reduced]);

  // A shot or scene opened from elsewhere (the Director's "Open 2.3") stays in Plan: its row or panel comes into view.
  const seenFocus = useRef(focus?.nonce);
  useEffect(() => {
    if (!focus || focus.nonce === seenFocus.current) return;
    seenFocus.current = focus.nonce;
    setFlash(focus.kind === "shot" ? rowId(focus.id) : sceneElementId(focus.id));
  }, [focus]);

  // ---- editors and their drafts ----------------------------------------------------------------------------
  const isOpen = (place: string) => placeOf(editingNow.current) === place;
  const slotFor = (place: string): DraftSlot => ({ held: drafts[place], put: (update) => setDrafts((all) => withDraft(all, place, update(all[place]))) });
  const dropDraft = (place: string) => setDrafts((all) => (place in all ? withDraft(all, place, undefined) : all));
  const errorAt = (place: string) => (error?.place === place ? error.message : null);
  /** Nothing typed is open: a new editor may take its place without asking. */
  const free = () => {
    const place = placeOf(editingNow.current);
    return !place || !touched(draftsNow.current[place]);
  };

  const openEditor = (next: Editing) => {
    const before = placeOf(editingNow.current);
    if (before && before !== placeOf(next)) dropDraft(before);
    setError(null);
    editorFocus.current = next.kind === "shot" ? { selector: '[data-field="purpose"]', always: true } : null;
    setEditing(next);
  };
  function closeEditor(focusTo?: string) {
    const place = placeOf(editingNow.current);
    if (place) dropDraft(place);
    setEditing(null);
    setError(null);
    if (focusTo) focusLater(focusTo);
  }
  /**
   * Opening another editor, or adding a shot or scene (which opens one), closes the open editor: when it has unsaved
   * text the person is asked first (Keep editing / Discard changes).
   */
  const leaveEditor = (then: () => void) => {
    const current = editingNow.current;
    const place = placeOf(current);
    if (!current || !place || free()) { then(); return; }
    const view = placeView(current, outline) ?? (seen.current?.place === place ? seen.current.view : null);
    setAsking({ name: view?.name ?? msg("plan.place.shot", { shot: current.kind === "shot" ? current.openedAs : "" }), proceed: () => { closeEditor(); then(); } });
  };
  const requestEdit = (next: Editing) => leaveEditor(() => openEditor(next));

  /**
   * A save from the editor at `place` was answered. Only that editor closes, and only when it is still open with
   * nothing newer typed since `sent`: text typed while the reply was awaited stays open, held against what was saved.
   */
  const closeAt = (place: string, focusTo?: string, sent?: HeldFields) => {
    if (!isOpen(place)) return;
    const held = draftsNow.current[place];
    const newer = held && sent ? afterSave(held, sent) : null;
    if (newer) {
      setDrafts((all) => withDraft(all, place, newer));
      setError(null);
      return;
    }
    closeEditor(focusTo);
  };
  /** An open editor says why its save was refused (so the reason is not also a toast); a closed one leaves the toast. */
  const failedAt = (place: string) => () => {
    if (!isOpen(place)) return;
    const message = takeRefusal(store);
    setError(message ? { place, message } : null);
  };
  /** Cancel closes the editor; a lost reply said in it goes with it (the studio is read again to show what happened). */
  const cancelAt = (place: string, focusTo?: string) => {
    if (lostNow.current.some((note) => note.place === place)) {
      setLost((list) => dropLostAt(list, place));
      void store.refresh();
    }
    if (isOpen(place)) closeEditor(focusTo);
  };

  // ---- presses and their outcomes ---------------------------------------------------------------------------
  const record = async (receipt: StoryboardReceipt, change: Msg) => {
    const head = await headAfter(store, receipt);
    setLast(head === null ? null : { commandId: receipt.commandId, label: change, headVersion: head });
  };
  const finish = async (receipt: StoryboardReceipt, change: Msg, toast: Msg) => {
    await record(receipt, change);
    undoToast(store, toast, receipt.commandId);
  };

  /**
   * After a press: done runs its success path; a lost reply gets a notice of its own (said in `place`, else in the
   * strip) with "Retry the same request", whose answer runs the same path; a refusal runs `refused` (the store's
   * toast already says why, unless it moves it). Other presses' notices are left alone.
   */
  const after = async <T,>(out: Outcome<T>, change: Msg, place: string, done: (receipt: T) => Promise<void> | void, refused?: () => void): Promise<void> => {
    if (out.kind === "done") { await done(out.receipt); return; }
    if (out.kind === "lost") {
      setLost((list) => putLost(list, { pressId: out.pressId, change, place, still: false, resend: out.resend, done: done as Lost["done"], ...(refused ? { refused } : {}) }));
      return;
    }
    refused?.();
  };

  /** Resend one press: its notice goes only when this resend is answered. */
  const retry = async (pressId: string) => {
    const current = lostNow.current.find((note) => note.pressId === pressId);
    if (!current || retrying.current.has(pressId)) return;
    retrying.current.add(pressId);
    try {
      const out = await current.resend();
      if (out.kind === "lost") { setLost((list) => putLost(list, { ...current, resend: out.resend, still: true })); return; }
      setLost((list) => dropLost(list, pressId));
      if (out.kind === "done") await current.done(out.receipt);
      else current.refused?.();
    } finally {
      retrying.current.delete(pressId);
    }
  };
  const dismissLost = (pressId: string) => { setLost((list) => dropLost(list, pressId)); void store.refresh(); };
  const retryAt = (place: string) => { const note = lostIn(place); if (note) void retry(note.pressId); };
  const dismissAt = (place: string) => { const note = lostIn(place); if (note) dismissLost(note.pressId); };

  const point = (target: Target, name: string) => {
    store.pointAt(target);
    if (window.matchMedia?.(NARROW_QUERY).matches) store.setDirectorOpen(true);
    infoToast(store, msg("plan.toast.pointed", { target: name }));
  };

  // ---- brief, story, scene title and direction (nothing made goes out of date: SB-12) -----------------
  const saveText = async (field: "brief" | "story", value: string) => {
    const change = msg(field === "brief" ? "plan.change.brief" : "plan.change.story");
    const out = await storyboardOutcome(store, `treatment:${field}`, { kind: "treatment", field, value });
    await after(out, change, field, async (receipt) => {
      closeAt(field, `[data-act="edit-text"][data-field="${field}"]`, { text: value });
      await finish(receipt, change, msg(field === "brief" ? "plan.toast.brief_saved" : "plan.toast.story_saved"));
    }, failedAt(field));
  };

  const saveTitle = async (scene: SceneView, value: string) => {
    const change = msg("plan.change.rename", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `sceneTitle:${scene.sceneId}`, { kind: "sceneTitle", id: scene.sceneId, value });
    const place = `title:${scene.sceneId}`;
    await after(out, change, place, async (receipt) => {
      closeAt(place, `[data-act="scene-menu"][data-scene="${scene.sceneId}"]`, { text: value });
      await finish(receipt, change, msg("plan.toast.renamed", { scene: scene.ordinal, title: value }));
    }, failedAt(place));
  };

  const saveDirection = async (scene: SceneView, value: string) => {
    const change = msg("plan.change.direction", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `scene:${scene.sceneId}`, { kind: "scene", id: scene.sceneId, value });
    const place = `direction:${scene.sceneId}`;
    await after(out, change, place, async (receipt) => {
      closeAt(place, `[data-act="scene-menu"][data-scene="${scene.sceneId}"]`, { text: value });
      await finish(receipt, change, msg("plan.toast.direction", { scene: scene.ordinal }));
    }, failedAt(place));
  };

  // ---- structure: reorder, move to another scene, add, delete (SB-13) -------------------------------------
  const moveScene = async (scene: SceneView, direction: -1 | 1) => {
    const target = sceneMove(outline, scene.sceneId, direction);
    if (!target) return;
    const change = msg("plan.change.move_scene", { title: scene.title });
    const out = await storyboardOutcome(store, `moveScene:${scene.sceneId}`, { kind: "moveScene", id: scene.sceneId, beforeId: target.beforeId });
    await after(out, change, "view", async (receipt) => {
      setFlash(sceneElementId(scene.sceneId));
      const lands = target.ordinal === 1 || target.ordinal === outline.scenes.length;
      focusLater(`[data-act="${lands ? (direction < 0 ? "scene-down" : "scene-up") : direction < 0 ? "scene-up" : "scene-down"}"][data-scene="${scene.sceneId}"]`);
      await finish(receipt, change, msg("plan.toast.scene_moved", { title: scene.title, scene: target.ordinal }));
    });
  };

  /** moveShot to a place in any scene: ↑ ↓ in the menu, the Move dialog, or a drop. Free; nothing goes out of date. */
  const moveShotTo = async (shotId: string, target: ShotMoveTarget, fromDialog = false) => {
    const change = msg("plan.change.move_shot", { shot: target.from });
    const out = await storyboardOutcome(store, `moveShot:${shotId}`, { kind: "moveShot", id: shotId, sceneId: target.sceneId, beforeId: target.beforeId });
    if (fromDialog && out.kind !== "refused") setMoving(null);
    await after(out, change, "view", async (receipt) => {
      setFlash(rowId(shotId));
      focusLater(`[data-act="shot-menu"][data-shot="${shotId}"]`);
      await finish(receipt, change, msg("plan.toast.shot_moved", { from: target.from, to: target.to }));
    }, fromDialog ? () => { if (movingNow.current === shotId) setMoveError(takeRefusal(store)); } : undefined);
  };

  const moveShot = (row: ShotRowView, direction: -1 | 1) => {
    const target = shotMove(outline, row.shotId, direction);
    if (target) void moveShotTo(row.shotId, target);
  };

  const addShot = async (scene: SceneView) => {
    const before = store.getState().overview ?? overview;
    const change = msg("plan.change.add_shot", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `addShot:${scene.sceneId}`, { kind: "addShot", sceneId: scene.sceneId });
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      const after = store.getState().overview;
      const shot = after ? addedShot(before, after, scene.sceneId) : null;
      // Its editor opens unless one with unsaved text is open (a retried add can answer long after the press).
      if (shot) { if (free()) openEditor({ kind: "shot", shotId: shot.shotId, openedAs: shot.label }); setFlash(rowId(shot.shotId)); }
      await finish(receipt, change, msg("plan.toast.shot_added", { shot: shot?.label ?? "" }));
    });
  };

  const addScene = async () => {
    const before = store.getState().overview ?? overview;
    const change = msg("plan.change.add_scene");
    // No value: the server stores it as the scene's direction. The new scene is named in place right after.
    const out = await storyboardOutcome(store, "addScene", { kind: "addScene" });
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      const after = store.getState().overview;
      const scene = after ? addedScene(before, after) : null;
      if (scene) { if (free()) openEditor({ kind: "title", sceneId: scene.sceneId }); setFlash(sceneElementId(scene.sceneId)); }
      await finish(receipt, change, msg("plan.toast.scene_added", { scene: scene?.ordinal ?? outline.scenes.length + 1 }));
    });
  };

  // A refused delete (e.g. a job still running in the scene) keeps the confirm open and says why there; a refusal
  // that comes from a retry after the confirm closed stays a toast. An editor inside what was deleted goes with it,
  // or keeps its unsaved text on screen (KeptDraft).
  const deleteScene = async (scene: SceneView) => {
    const change = msg("plan.change.delete_scene", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `deleteScene:${scene.sceneId}`, { kind: "deleteScene", id: scene.sceneId, withShots: true });
    if (out.kind === "lost") setConfirming(null);
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      setConfirming(null);
      await finish(receipt, change, msg("plan.toast.scene_deleted", { scene: scene.ordinal, title: scene.title }));
    }, () => { const open = confirmingNow.current; if (open?.kind === "scene" && open.sceneId === scene.sceneId) setDeleteError(takeRefusal(store)); });
  };

  const deleteShot = async (row: ShotRowView) => {
    const change = msg("plan.change.delete_shot", { shot: row.label });
    const out = await storyboardOutcome(store, `deleteShot:${row.shotId}`, { kind: "deleteShot", id: row.shotId });
    if (out.kind === "lost") setConfirming(null);
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      setConfirming(null);
      await finish(receipt, change, msg("plan.toast.shot_deleted", { shot: row.label }));
    }, () => { const open = confirmingNow.current; if (open?.kind === "shot" && open.shotId === row.shotId) setDeleteError(takeRefusal(store)); });
  };

  // ---- dragging a shot onto another row or scene ---------------------------------------------------------
  const setDropAt = (next: DropAt | null) => setDropAtState((current) => (current?.sceneId === next?.sceneId && current?.beforeId === next?.beforeId ? current : next));
  const endDrag = () => { setDragging(null); setDropAt(null); };
  /** Over a row: its upper half drops before it, its lower half after it. */
  const rowDrop = (scene: SceneView, row: ShotRowView) => {
    const place = (event: DragEvent<HTMLElement>): DropAt => {
      const rect = event.currentTarget.getBoundingClientRect();
      const lower = event.clientY > rect.top + rect.height / 2;
      return { sceneId: scene.sceneId, beforeId: lower ? scene.shots[row.index + 1]?.shotId : row.shotId };
    };
    return dropHandlers(place);
  };
  /** Anywhere else on a scene: the end of that scene. */
  const sceneDrop = (scene: SceneView) => dropHandlers(() => ({ sceneId: scene.sceneId, beforeId: undefined }));
  function dropHandlers(place: (event: DragEvent<HTMLElement>) => DropAt) {
    if (!dragging) return {};
    const target = (event: DragEvent<HTMLElement>) => {
      const at = place(event);
      return { at, move: shotDrop(outline, dragging, at.sceneId, at.beforeId) };
    };
    // Entering a row or scene places the drop line too: some browsers send dragover only now and then.
    const over = (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const { at, move } = target(event);
      event.dataTransfer.dropEffect = move ? "move" : "none";
      setDropAt(move ? at : null);
    };
    return {
      onDragEnter: over,
      onDragOver: over,
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const shotId = event.dataTransfer.getData(SHOT_DRAG_TYPE) || dragging;
        const { move } = target(event);
        endDrag();
        if (move && shotId === dragging) void moveShotTo(shotId, move);
      },
    };
  }

  // ---- the shot editor: the shot's fields as one command, narration as its own ---------------------------
  const saveShot = async (shot: ShotOverview, live: ShotDraft, draft: ShotDraft) => {
    const stored = storedById.get(shot.shotId);
    const commands = draftEdits(live, draft, fps, stored?.narration?.mode, storedShot(shot, stored));
    if (!commands.length) return closeAt(`shot:${shot.shotId}`, `[data-act="edit-shot"][data-shot="${shot.shotId}"]`);
    setError(null);
    await runShot(shot, commands, 0, undefined, null, { summary: savedMessage(shot, live, draft), change: editChange(shot.label, commands.map((command) => command.fields)), sent: draft });
  };

  /**
   * The save's commands in turn, from `start`; each carries the head version the previous one produced. A refusal
   * keeps the editor open with the server's reason (anything saved before it can still be undone from the header);
   * a lost reply waits for "Retry the same request", and its answer carries on from the next command.
   */
  const runShot = async (shot: ShotOverview, commands: DraftCommand[], start: number, head: number | undefined, done: StoryboardReceipt | null, words: { summary: Msg; change: Msg; sent: ShotDraft }): Promise<void> => {
    const place = `shot:${shot.shotId}`;
    let last = done;
    let at = head;
    for (let index = start; index < commands.length; index++) {
      if (index > 0 && at === undefined) await store.refresh();
      const command = commands[index]!;
      const out = await storyboardOutcome(store, commandPress(command, shot.shotId), { ...command.edit, id: shot.shotId }, at);
      if (out.kind === "done") { last = out.receipt; at = out.receipt.headVersion; continue; }
      if (last) await record(last, editChange(shot.label, commands.slice(0, index).map((item) => item.fields)));
      await after(out, words.change, place, (receipt) => runShot(shot, commands, index + 1, receipt.headVersion, receipt, words), failedAt(place));
      return;
    }
    closeAt(place, `[data-act="edit-shot"][data-shot="${shot.shotId}"]`, words.sent);
    if (!last) return;
    // A save that also changes the narration is several commands, and Undo reverts only the last: the toast says which.
    const toast = commands.length > 1 ? msg("plan.toast.saved_undo_last", { saved: tm(words.summary), change: tm(words.change) }) : words.summary;
    await finish(last, words.change, toast);
  };

  const undo = async () => {
    if (!last) return;
    const named = last;
    const change = tm(named.label);
    store.dismissToast();
    const out = await storyboardOutcome(store, `undo:${named.commandId}`, { kind: "undo", commandId: named.commandId });
    await after(out, msg("plan.change.undo", { change }), "view", () => {
      setLast(null);
      infoToast(store, msg("plan.toast.undone", { change }));
      // The Undo button turns off; focus stays in the view instead of falling to the page.
      focusLater(`#${PLAN_TITLE_ID}`);
    }, () => {
      // Something changed since (a new edit elsewhere, paid work that used it): this Undo is gone for good.
      if (refusal(store)?.id === "error.UNDO_UNAVAILABLE") setLast(null);
    });
  };

  // ---- written plans -------------------------------------------------------------------------------------
  const send = async (name: string, text: string) => {
    const finalName = importName(name);
    const out = await sendImport(store, finalName, text);
    await after(out, msg("plan.change.import_send", { name: finalName }), "import", () => {
      setJustSent(finalName);
      imports.reload();
    }, () => {
      if (refusal(store)?.id === "error.DIRECTOR_REQUIRED") setNoCodex(true);
    });
  };
  const discard = async () => {
    if (!importPending) return;
    const out = await discardImport(store, importPending);
    await after(out, msg("plan.change.import_discard", { name: importPending.name }), "import", () => {
      setImportOpen(false);
      setJustSent(null);
      imports.reload();
    });
  };
  const confirmPlan = async () => {
    if (!importPending) return;
    const out = await confirmImport(store, importPending);
    await after(out, msg("plan.change.import_confirm", { name: importPending.name }), "import", () => {
      setImportOpen(false);
      setJustSent(null);
      setLast(null);
      imports.reload();
    });
  };

  // ---- a draft whose shot or scene was deleted underneath ---------------------------------------------------
  const keptNotice = (open: Editing): Msg =>
    seen.current?.place === placeOf(open) ? seen.current.view.gone : open.kind === "shot" ? msg("plan.kept.shot", { shot: open.openedAs }) : msg("plan.kept.scene", { scene: "—" });
  const keptFields = (held: Held<HeldFields>, open: Editing): KeptField[] =>
    editedKeys(held).map((key): KeptField => {
      const value = held.draft[key]!;
      if (open.kind !== "shot") return { key, label: t(open.kind === "title" ? "plan.scene.title_label" : open.kind === "direction" ? "plan.scene.direction_label" : open.kind === "brief" ? "plan.brief" : "plan.story"), value: String(value) };
      const name = key as keyof ShotDraft;
      const text = name === "seconds" ? t("plan.len.value", { seconds: value }) : name === "narration" ? t(value === "line" ? "plan.narr.choice_line" : "plan.narr.choice_none") : String(value);
      return { key, label: t(FIELD_LABEL[DRAFT_FIELD[name]]), value: text };
    });

  const confirmScene = confirming?.kind === "scene" ? outline.scenes.find((scene) => scene.sceneId === confirming.sceneId) : undefined;
  const confirmRow = confirming?.kind === "shot" ? outline.scenes.flatMap((scene) => scene.shots).find((row) => row.shotId === confirming.shotId) : undefined;
  const sceneFacts = confirmScene ? deleteSceneFacts(outline, overview, confirmScene.sceneId) : null;
  const shotFacts = confirmRow ? deleteShotFacts(outline, overview, confirmRow.shotId) : null;
  const moveWhere = moving ? locate(outline, moving) : null;
  const pendingTitle = stage === "review" ? "plan.pending.review" : stage === "stale" ? "plan.pending.stale" : stage === "waiting" ? "plan.pending.waiting" : "plan.pending.reading";
  const multipleScenes = outline.scenes.length > 1;

  return (
    <main className={`work plan${dragging ? " dragging" : ""}`} data-view="plan" data-head={snapshot.project.headVersion}>
      <div className="view-head">
        <h1 id={PLAN_TITLE_ID} tabIndex={-1}>{t("plan.title")}</h1>
        <span className="line">{tm(outline.line)}</span>
        <div className="actions">
          <button
            type="button"
            className="pill"
            data-act="plan-undo"
            disabled={!canUndo || busy || !!guard}
            title={canUndo ? guard : undefined}
            onClick={() => void undo()}
          >
            {canUndo && last ? t("plan.undo", { change: tm(last.label) }) : t("plan.undo.none")}
          </button>
          {/* Bringing a plan starts the Director's work, so Stop turns it off too (data-needs="run" in the study);
              a waiting review stays reachable from the strip below. */}
          <button
            type="button"
            className="pill"
            data-act="import-open"
            disabled={!connected || !!runGuard}
            title={!connected ? t("plan.guard.offline") : runGuard}
            onClick={() => setImportOpen(true)}
          >
            {t(importPending ? "plan.import.review_open" : "plan.import.open")}
          </button>
        </div>
      </div>

      {strip.length ? (
        <div id={LOST_STRIP_ID} className="lost-strip">
          {strip.map((note) => <UnconfirmedNotice key={note.pressId} notice={note} busy={busy} strip onRetry={() => void retry(note.pressId)} onDismiss={() => dismissLost(note.pressId)} />)}
        </div>
      ) : null}

      {kept && editing ? <KeptDraft notice={keptNotice(editing)} fields={keptFields(kept, editing)} onClose={() => closeEditor(`#${PLAN_TITLE_ID}`)} /> : null}

      {importPending ? (
        <div className="pending" role="status" data-import={stage}>
          <span className="txt"><b>{t(pendingTitle)}</b> <span>{t("plan.pending.body")}</span></span>
          <button type="button" className="pill sm primary" data-act="import-review" onClick={() => setImportOpen(true)}>{t("plan.pending.open")}</button>
        </div>
      ) : null}

      <div className="brief-grid">
        {(["brief", "story"] as const).map((field) => (
          <TextPanel
            key={field}
            field={field}
            text={field === "brief" ? outline.brief : outline.story}
            editing={editing?.kind === field}
            saving={busy}
            guard={guard}
            error={errorAt(field)}
            unconfirmed={lostIn(field)}
            slot={slotFor(field)}
            onRetry={() => retryAt(field)}
            onDismiss={() => dismissAt(field)}
            onEdit={() => requestEdit({ kind: field })}
            onCancel={() => cancelAt(field, `[data-act="edit-text"][data-field="${field}"]`)}
            onSave={(value) => void saveText(field, value)}
          />
        ))}
      </div>

      <div className="scenes" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null); }}>
        {outline.scenes.map((scene) => {
          const sceneEdit = editing && "sceneId" in editing && editing.sceneId === scene.sceneId ? editing.kind : null;
          const scenePlace = `${sceneEdit ?? "title"}:${scene.sceneId}`;
          return (
            <ScenePanel
              key={scene.sceneId}
              scene={scene}
              editing={sceneEdit === "title" || sceneEdit === "direction" ? sceneEdit : null}
              saving={busy}
              guard={guard}
              busy={busy}
              error={sceneEdit ? errorAt(scenePlace) : null}
              unconfirmed={sceneEdit ? lostIn(scenePlace) : null}
              slot={slotFor(scenePlace)}
              flash={flash === sceneElementId(scene.sceneId)}
              dropEnd={!!dragging && dropAt?.sceneId === scene.sceneId && dropAt.beforeId === undefined}
              drop={sceneDrop(scene)}
              onRetry={() => retryAt(scenePlace)}
              onDismiss={() => dismissAt(scenePlace)}
              onMove={(direction) => void moveScene(scene, direction)}
              onPoint={() => point({ kind: "scene", id: scene.sceneId }, t("plan.scene.label", { scene: scene.ordinal }))}
              onRename={() => requestEdit({ kind: "title", sceneId: scene.sceneId })}
              onEditDirection={() => requestEdit({ kind: "direction", sceneId: scene.sceneId })}
              onDelete={() => setConfirming({ kind: "scene", sceneId: scene.sceneId })}
              onCancel={() => cancelAt(scenePlace, `[data-act="scene-menu"][data-scene="${scene.sceneId}"]`)}
              onSaveTitle={(value) => void saveTitle(scene, value)}
              onSaveDirection={(value) => void saveDirection(scene, value)}
              onAddShot={() => leaveEditor(() => void addShot(scene))}
            >
              {scene.shots.map((row) => {
                const shot = overview.shots[row.shotId];
                const place = `shot:${row.shotId}`;
                if (shot && editing?.kind === "shot" && editing.shotId === row.shotId)
                  return (
                    <ShotEditor
                      key={row.shotId}
                      shot={shot}
                      row={row}
                      stored={storedById.get(row.shotId)}
                      fps={fps}
                      prices={unitPrices(overview, row.sceneId)}
                      saving={busy}
                      guard={guard}
                      error={errorAt(place)}
                      unconfirmed={lostIn(place)}
                      slot={slotFor(place)}
                      openedAs={editing.openedAs}
                      focusOnMount={() => editorFocus.current}
                      onFocusField={(selector) => { editorFocus.current = selector ? { selector, always: false } : null; }}
                      onRetry={() => retryAt(place)}
                      onDismiss={() => dismissAt(place)}
                      onCancel={() => cancelAt(place, `[data-act="edit-shot"][data-shot="${row.shotId}"]`)}
                      onSave={(live, draft) => void saveShot(shot, live, draft)}
                    />
                  );
                return (
                  <ShotRow
                    key={row.shotId}
                    row={row}
                    guard={guard}
                    busy={busy}
                    flash={flash === rowId(row.shotId)}
                    canMoveScene={multipleScenes}
                    dropBefore={!!dragging && dropAt?.beforeId === row.shotId}
                    drop={rowDrop(scene, row)}
                    onEdit={() => requestEdit({ kind: "shot", shotId: row.shotId, openedAs: row.label })}
                    onMove={(direction) => moveShot(row, direction)}
                    onMoveScene={() => setMoving(row.shotId)}
                    onDragStart={() => setDragging(row.shotId)}
                    onDragEnd={endDrag}
                    onPoint={() => point({ kind: "shot", id: row.shotId }, row.label)}
                    onOpenKeyframes={() => { store.selectShot(row.shotId); store.setView("keyframes"); }}
                    onDelete={() => setConfirming({ kind: "shot", shotId: row.shotId })}
                  />
                );
              })}
            </ScenePanel>
          );
        })}
      </div>

      <button type="button" className="pill add-scene" data-act="add-scene" disabled={!!guard || busy} title={guard} onClick={() => leaveEditor(() => void addScene())}>
        <span aria-hidden="true">+</span> {t("plan.add_scene")}
      </button>

      {confirmScene && sceneFacts ? (
        <DeleteDialog kind="scene" name={String(confirmScene.ordinal)} title={confirmScene.title} facts={sceneFacts} busy={busy} guard={guard} error={deleteError}
          onCancel={() => setConfirming(null)} onConfirm={() => void deleteScene(confirmScene)} />
      ) : null}
      {confirmRow && shotFacts ? (
        <DeleteDialog kind="shot" name={confirmRow.label} title={confirmRow.purpose} facts={shotFacts} busy={busy} guard={guard} error={deleteError}
          onCancel={() => setConfirming(null)} onConfirm={() => void deleteShot(confirmRow)} />
      ) : null}
      {moving && moveWhere ? (
        <MoveDialog label={moveWhere.row.label} ordinal={moveWhere.scene.ordinal} choices={sceneChoices(outline, moving)} busy={busy} guard={guard} error={moveError}
          onCancel={() => setMoving(null)} onMove={(target) => void moveShotTo(moving, target, true)} />
      ) : null}
      {importOpen ? (
        <ImportSheet
          stage={stage}
          pending={importPending}
          review={review}
          notes={notes}
          busy={busy}
          guard={connected ? undefined : t("plan.guard.offline")}
          runGuard={runGuard}
          unconfirmed={lostIn("import")}
          onRetry={() => retryAt("import")}
          onDismiss={() => dismissAt("import")}
          onClose={() => setImportOpen(false)}
          onSend={(name, text) => void send(name, text)}
          onDiscard={() => void discard()}
          onConfirm={() => void confirmPlan()}
          onSettings={() => { setImportOpen(false); store.setView("settings"); }}
        />
      ) : null}
      {asking ? <DiscardDialog name={asking.name} onKeep={() => setAsking(null)} onDiscard={() => { const go = asking.proceed; setAsking(null); go(); }} /> : null}
    </main>
  );
}
