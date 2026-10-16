import type { GenerationOverview, ShotOverview } from "@openslate/core/public";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { useReducedMotion } from "../../keyframes/parts.tsx";
import { draftEdits, editChange, savedMessage, storedShot, unitPrices, type DraftCommand, type ShotDraft } from "../../model/plan-edit.ts";
import { importName, importNotes, importReview, importStage, type PlanImportsRead } from "../../model/plan-import.ts";
import { addedScene, addedShot, deleteSceneFacts, deleteShotFacts, locate, planOutline, sceneChoices, sceneMove, shotDrop, shotMove, type SceneView, type ShotMoveTarget, type ShotRowView, type SnapshotShot } from "../../model/plan.ts";
import { NARROW_QUERY } from "../../model/shell.ts";
import { msg, type Msg, type ProjectSnapshot, type Target } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { confirmImport, discardImport, headAfter, infoToast, refusal, sendImport, storyboardOutcome, takeRefusal, undoToast, type Outcome, type StoryboardReceipt } from "./commands.ts";
import { DeleteDialog } from "./DeleteDialog.tsx";
import { ImportSheet } from "./ImportSheet.tsx";
import { useLastChange } from "./last-change.ts";
import { PLAN_TITLE_ID } from "./Modal.tsx";
import { MoveDialog } from "./MoveDialog.tsx";
import { UnconfirmedNotice, type Unconfirmed } from "./Notices.tsx";
import { ScenePanel, sceneElementId } from "./ScenePanel.tsx";
import { ShotEditor } from "./ShotEditor.tsx";
import { rowId, SHOT_DRAG_TYPE, ShotRow } from "./ShotRow.tsx";
import { TextPanel } from "./TextPanel.tsx";
import "./plan.css";

type Editing = { kind: "brief" | "story" } | { kind: "title" | "direction"; sceneId: string } | { kind: "shot"; shotId: string };
type Confirming = { kind: "scene"; sceneId: string } | { kind: "shot"; shotId: string };

/** Where an open editor says a lost reply: "brief", "title:<sceneId>", "shot:<shotId>". */
const placeOf = (editing: Editing | null): string | null =>
  !editing ? null : "sceneId" in editing ? `${editing.kind}:${editing.sceneId}` : "shotId" in editing ? `shot:${editing.shotId}` : editing.kind;

/** A press whose reply was lost, with what to do once its outcome is known. Methods, so any receipt type fits. */
interface Lost extends Unconfirmed {
  resend(): Promise<Outcome<unknown>>;
  done(receipt: unknown): Promise<void> | void;
  refused?(): void;
}

/** Where a dragged shot would land. */
interface DropAt {
  sceneId: string;
  beforeId: string | undefined;
}

const LOST_STRIP_ID = "plan-lost-reply";

const commandPress = (command: DraftCommand, shotId: string) => (command.edit.kind === "shotFields" ? `shotFields:${shotId}` : `narration:${shotId}:${command.edit.field}`);

const focusLater = (selector: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }));

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
  return <Workspace overview={overview} snapshot={snapshot} />;
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

  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<Msg | null>(null);
  const [confirming, setConfirmingState] = useState<Confirming | null>(null);
  const [deleteError, setDeleteError] = useState<Msg | null>(null);
  const [moving, setMovingState] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<Msg | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [justSent, setJustSent] = useState<string | null>(null);
  const [noCodex, setNoCodex] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [lost, setLost] = useState<Lost | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAtState] = useState<DropAt | null>(null);
  const [last, setLast] = useLastChange(snapshot.project.id);

  // ---- guards ----------------------------------------------------------------------------------------
  const busy = Object.keys(pending).some((key) => key.startsWith("plan:") || key.startsWith("edit:"));
  const importPending = imports.data?.pending ?? null;
  const connected = connection === "connected";
  const guard = !connected ? t("plan.guard.offline") : importPending ? t("plan.guard.import") : undefined;
  const runGuard = overview.stopped ? t("plan.guard.stopped") : undefined;
  const codexReady = !noCodex && (mode === "fixture" || director?.mode === "native");
  const stage = importPending ? importStage(importPending, codexReady) : justSent ? "reading" : importStage(null, codexReady);
  const review = useMemo(() => (importPending?.draft ? importReview(snapshot.project, importPending.draft.project, fps) : null), [importPending, snapshot.project, fps]);
  const notes = useMemo(() => (importPending ? importNotes(snapshot.conversation, importPending.id) : []), [importPending, snapshot.conversation]);
  // One-step Undo while nothing has changed since (the server also refuses an older command: UNDO_UNAVAILABLE).
  const canUndo = !!last && last.headVersion === snapshot.project.headVersion;
  const editPlace = placeOf(editing);
  /** A lost reply is said where it happened; when that place is not on screen, in a strip under the header. */
  const lostIn = (place: string) => (lost?.place === place ? lost : null);
  const lostInStrip = lost && lost.place !== editPlace && !(lost.place === "import" && importOpen) ? lost : null;

  useEffect(() => { if (importPending) setJustSent(null); }, [importPending]);
  // The strip sits at the top of the outline (sticky on wide screens); a phone scrolls the page, so bring it in sight.
  const stripShown = !!lostInStrip;
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

  // ---- helpers -----------------------------------------------------------------------------------------
  const startEdit = (next: Editing) => { setError(null); setEditing(next); };
  const stopEdit = (focus?: string) => { setEditing(null); setError(null); if (focus) focusLater(focus); };
  /** Cancel closes the editor; a lost reply said in it goes with it (the studio is read again to show what happened). */
  const cancelEdit = (focus?: string) => {
    if (lost && lost.place === editPlace) { setLost(null); void store.refresh(); }
    stopEdit(focus);
  };
  const record = async (receipt: StoryboardReceipt, change: Msg) => {
    const head = await headAfter(store, receipt);
    setLast(head === null ? null : { commandId: receipt.commandId, label: change, headVersion: head });
  };
  const finish = async (receipt: StoryboardReceipt, change: Msg, toast: Msg) => {
    await record(receipt, change);
    undoToast(store, toast, receipt.commandId);
  };
  // An open editor says why it was not saved, so the reason is not also a toast.
  const failed = () => setError(takeRefusal(store));

  /**
   * After a press: done runs its success path; a lost reply is said in `place` with "Retry the same request", whose
   * answer runs the same path; a refusal runs `refused` (the store's toast already says why, unless it moves it).
   */
  const after = async <T,>(out: Outcome<T>, change: Msg, place: string, done: (receipt: T) => Promise<void> | void, refused?: () => void): Promise<void> => {
    if (out.kind === "done") { setLost(null); await done(out.receipt); return; }
    if (out.kind === "lost") { setLost({ change, place, still: false, resend: out.resend, done: done as Lost["done"], ...(refused ? { refused } : {}) }); return; }
    setLost(null);
    refused?.();
  };

  const retry = async () => {
    const current = lost;
    if (!current) return;
    const out = await current.resend();
    if (out.kind === "lost") { setLost({ ...current, resend: out.resend, still: true }); return; }
    setLost(null);
    if (out.kind === "done") await current.done(out.receipt);
    else current.refused?.();
  };
  const dismissLost = () => { setLost(null); void store.refresh(); };

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
      stopEdit(`[data-act="edit-text"][data-field="${field}"]`);
      await finish(receipt, change, msg(field === "brief" ? "plan.toast.brief_saved" : "plan.toast.story_saved"));
    }, failed);
  };

  const saveTitle = async (scene: SceneView, value: string) => {
    const change = msg("plan.change.rename", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `sceneTitle:${scene.sceneId}`, { kind: "sceneTitle", id: scene.sceneId, value });
    await after(out, change, `title:${scene.sceneId}`, async (receipt) => {
      stopEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`);
      await finish(receipt, change, msg("plan.toast.renamed", { scene: scene.ordinal, title: value }));
    }, failed);
  };

  const saveDirection = async (scene: SceneView, value: string) => {
    const change = msg("plan.change.direction", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `scene:${scene.sceneId}`, { kind: "scene", id: scene.sceneId, value });
    await after(out, change, `direction:${scene.sceneId}`, async (receipt) => {
      stopEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`);
      await finish(receipt, change, msg("plan.toast.direction", { scene: scene.ordinal }));
    }, failed);
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
    }, fromDialog ? () => setMoveError(takeRefusal(store)) : undefined);
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
      if (shot) { startEdit({ kind: "shot", shotId: shot.shotId }); setFlash(rowId(shot.shotId)); }
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
      if (scene) { startEdit({ kind: "title", sceneId: scene.sceneId }); setFlash(sceneElementId(scene.sceneId)); }
      await finish(receipt, change, msg("plan.toast.scene_added", { scene: scene?.ordinal ?? outline.scenes.length + 1 }));
    });
  };

  // A refused delete (e.g. a job still running in the scene) keeps the confirm open and says why there.
  const deleteScene = async (scene: SceneView) => {
    const change = msg("plan.change.delete_scene", { scene: scene.ordinal });
    const out = await storyboardOutcome(store, `deleteScene:${scene.sceneId}`, { kind: "deleteScene", id: scene.sceneId, withShots: true });
    if (out.kind === "lost") setConfirming(null);
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      setEditing((current) => (current && "sceneId" in current && current.sceneId === scene.sceneId ? null : current));
      setConfirming(null);
      await finish(receipt, change, msg("plan.toast.scene_deleted", { scene: scene.ordinal, title: scene.title }));
    }, () => setDeleteError(takeRefusal(store)));
  };

  const deleteShot = async (row: ShotRowView) => {
    const change = msg("plan.change.delete_shot", { shot: row.label });
    const out = await storyboardOutcome(store, `deleteShot:${row.shotId}`, { kind: "deleteShot", id: row.shotId });
    if (out.kind === "lost") setConfirming(null);
    await after(out, change, "view", async (receipt) => {
      await store.refresh();
      setEditing((current) => (current?.kind === "shot" && current.shotId === row.shotId ? null : current));
      setConfirming(null);
      await finish(receipt, change, msg("plan.toast.shot_deleted", { shot: row.label }));
    }, () => setDeleteError(takeRefusal(store)));
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
    if (!commands.length) return stopEdit(`[data-act="edit-shot"][data-shot="${shot.shotId}"]`);
    setError(null);
    await runShot(shot, commands, 0, undefined, null, { summary: savedMessage(shot, live, draft), change: editChange(shot.label, commands.map((command) => command.fields)) });
  };

  /**
   * The save's commands in turn, from `start`; each carries the head version the previous one produced. A refusal
   * keeps the editor open with the server's reason (anything saved before it can still be undone from the header);
   * a lost reply waits for "Retry the same request", and its answer carries on from the next command.
   */
  const runShot = async (shot: ShotOverview, commands: DraftCommand[], start: number, head: number | undefined, done: StoryboardReceipt | null, words: { summary: Msg; change: Msg }): Promise<void> => {
    let last = done;
    let at = head;
    for (let index = start; index < commands.length; index++) {
      if (index > 0 && at === undefined) await store.refresh();
      const command = commands[index]!;
      const out = await storyboardOutcome(store, commandPress(command, shot.shotId), { ...command.edit, id: shot.shotId }, at);
      if (out.kind === "done") { last = out.receipt; at = out.receipt.headVersion; continue; }
      if (last) await record(last, editChange(shot.label, commands.slice(0, index).map((item) => item.fields)));
      await after(out, words.change, `shot:${shot.shotId}`, (receipt) => runShot(shot, commands, index + 1, receipt.headVersion, receipt, words), failed);
      return;
    }
    stopEdit(`[data-act="edit-shot"][data-shot="${shot.shotId}"]`);
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

      {lostInStrip ? <div id={LOST_STRIP_ID} className="lost-strip"><UnconfirmedNotice notice={lostInStrip} busy={busy} strip onRetry={() => void retry()} onDismiss={dismissLost} /></div> : null}

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
            error={editing?.kind === field ? error : null}
            unconfirmed={lostIn(field)}
            onRetry={() => void retry()}
            onEdit={() => startEdit({ kind: field })}
            onCancel={() => cancelEdit(`[data-act="edit-text"][data-field="${field}"]`)}
            onSave={(value) => void saveText(field, value)}
          />
        ))}
      </div>

      <div className="scenes" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null); }}>
        {outline.scenes.map((scene) => {
          const sceneEdit = editing && "sceneId" in editing && editing.sceneId === scene.sceneId ? editing.kind : null;
          return (
            <ScenePanel
              key={scene.sceneId}
              scene={scene}
              editing={sceneEdit === "title" || sceneEdit === "direction" ? sceneEdit : null}
              saving={busy}
              guard={guard}
              busy={busy}
              error={sceneEdit ? error : null}
              unconfirmed={sceneEdit === "title" || sceneEdit === "direction" ? lostIn(`${sceneEdit}:${scene.sceneId}`) : null}
              flash={flash === sceneElementId(scene.sceneId)}
              dropEnd={!!dragging && dropAt?.sceneId === scene.sceneId && dropAt.beforeId === undefined}
              drop={sceneDrop(scene)}
              onRetry={() => void retry()}
              onMove={(direction) => void moveScene(scene, direction)}
              onPoint={() => point({ kind: "scene", id: scene.sceneId }, t("plan.scene.label", { scene: scene.ordinal }))}
              onRename={() => startEdit({ kind: "title", sceneId: scene.sceneId })}
              onEditDirection={() => startEdit({ kind: "direction", sceneId: scene.sceneId })}
              onDelete={() => setConfirming({ kind: "scene", sceneId: scene.sceneId })}
              onCancel={() => cancelEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`)}
              onSaveTitle={(value) => void saveTitle(scene, value)}
              onSaveDirection={(value) => void saveDirection(scene, value)}
              onAddShot={() => void addShot(scene)}
            >
              {scene.shots.map((row) => {
                const shot = overview.shots[row.shotId];
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
                      error={error}
                      unconfirmed={lostIn(`shot:${row.shotId}`)}
                      onRetry={() => void retry()}
                      onCancel={() => cancelEdit(`[data-act="edit-shot"][data-shot="${row.shotId}"]`)}
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
                    onEdit={() => startEdit({ kind: "shot", shotId: row.shotId })}
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

      <button type="button" className="pill add-scene" data-act="add-scene" disabled={!!guard || busy} title={guard} onClick={() => void addScene()}>
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
          onRetry={() => void retry()}
          onClose={() => setImportOpen(false)}
          onSend={(name, text) => void send(name, text)}
          onDiscard={() => void discard()}
          onConfirm={() => void confirmPlan()}
          onSettings={() => { setImportOpen(false); store.setView("settings"); }}
        />
      ) : null}
    </main>
  );
}
