import type { GenerationOverview, ShotOverview } from "@openslate/core/public";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { useReducedMotion } from "../../keyframes/parts.tsx";
import { draftEdits, editChange, savedMessage, unitPrices, type ShotDraft } from "../../model/plan-edit.ts";
import { importName, importNotes, importReview, importStage, type PlanImportsRead } from "../../model/plan-import.ts";
import { addedScene, addedShot, deleteSceneFacts, deleteShotFacts, planOutline, sceneMove, shotMove, type SceneView, type ShotRowView } from "../../model/plan.ts";
import { NARROW_QUERY } from "../../model/shell.ts";
import { msg, type Msg, type ProjectSnapshot, type Target } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { confirmImport, discardImport, headAfter, infoToast, refusal, sendImport, storyboard, storyboardSequence, takeRefusal, undoToast, type StoryboardReceipt } from "./commands.ts";
import { DeleteDialog } from "./DeleteDialog.tsx";
import { ImportSheet } from "./ImportSheet.tsx";
import { useLastChange } from "./last-change.ts";
import { PLAN_TITLE_ID } from "./Modal.tsx";
import { ScenePanel, sceneElementId } from "./ScenePanel.tsx";
import { ShotEditor } from "./ShotEditor.tsx";
import { rowId, ShotRow } from "./ShotRow.tsx";
import { TextPanel } from "./TextPanel.tsx";
import "./plan.css";

type Editing = { kind: "brief" | "story" } | { kind: "title" | "direction"; sceneId: string } | { kind: "shot"; shotId: string };
type Confirming = { kind: "scene"; sceneId: string } | { kind: "shot"; shotId: string };

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
  const fps = overview.fps;

  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<Msg | null>(null);
  const [confirming, setConfirmingState] = useState<Confirming | null>(null);
  const [deleteError, setDeleteError] = useState<Msg | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [justSent, setJustSent] = useState<string | null>(null);
  const [noCodex, setNoCodex] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [last, setLast] = useLastChange(snapshot.project.id);

  // ---- guards ----------------------------------------------------------------------------------------
  const busy = Object.keys(pending).some((key) => key.startsWith("plan:") || key.startsWith("edit:"));
  const importPending = imports.data?.pending ?? null;
  // A restored studio in recovery review is read-only: its one reason comes first (app/useWriteGuard.ts).
  const locked = useRecoveryLock();
  const connected = connection === "connected" && !locked;
  const offlineWhy = locked ?? t("plan.guard.offline");
  const guard = !connected ? offlineWhy : importPending ? t("plan.guard.import") : undefined;
  const runGuard = overview.stopped ? t("plan.guard.stopped") : undefined;
  const codexReady = !noCodex && (mode === "fixture" || director?.mode === "native");
  const stage = importPending ? importStage(importPending, codexReady) : justSent ? "reading" : importStage(null, codexReady);
  const review = useMemo(() => (importPending?.draft ? importReview(snapshot.project, importPending.draft.project, fps) : null), [importPending, snapshot.project, fps]);
  const notes = useMemo(() => (importPending ? importNotes(snapshot.conversation, importPending.id) : []), [importPending, snapshot.conversation]);
  // One-step Undo while nothing has changed since (the server also refuses an older command: UNDO_UNAVAILABLE).
  const canUndo = !!last && last.headVersion === snapshot.project.headVersion;

  useEffect(() => { if (importPending) setJustSent(null); }, [importPending]);
  const setConfirming = (next: Confirming | null) => { setDeleteError(null); setConfirmingState(next); };

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

  const point = (target: Target, name: string) => {
    store.pointAt(target);
    if (window.matchMedia?.(NARROW_QUERY).matches) store.setDirectorOpen(true);
    infoToast(store, msg("plan.toast.pointed", { target: name }));
  };

  // ---- brief, story, scene title and direction (nothing made goes out of date: SB-12) -----------------
  const saveText = async (field: "brief" | "story", value: string) => {
    const receipt = await storyboard(store, `treatment:${field}`, { kind: "treatment", field, value });
    if (!receipt) return failed();
    stopEdit(`[data-act="edit-text"][data-field="${field}"]`);
    await finish(receipt, msg(field === "brief" ? "plan.change.brief" : "plan.change.story"), msg(field === "brief" ? "plan.toast.brief_saved" : "plan.toast.story_saved"));
  };

  const saveTitle = async (scene: SceneView, value: string) => {
    const receipt = await storyboard(store, `sceneTitle:${scene.sceneId}`, { kind: "sceneTitle", id: scene.sceneId, value });
    if (!receipt) return failed();
    stopEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`);
    await finish(receipt, msg("plan.change.rename", { scene: scene.ordinal }), msg("plan.toast.renamed", { scene: scene.ordinal, title: value }));
  };

  const saveDirection = async (scene: SceneView, value: string) => {
    const receipt = await storyboard(store, `scene:${scene.sceneId}`, { kind: "scene", id: scene.sceneId, value });
    if (!receipt) return failed();
    stopEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`);
    await finish(receipt, msg("plan.change.direction", { scene: scene.ordinal }), msg("plan.toast.direction", { scene: scene.ordinal }));
  };

  // ---- structure: reorder, add, delete (SB-13) -----------------------------------------------------------
  const moveScene = async (scene: SceneView, direction: -1 | 1) => {
    const target = sceneMove(outline, scene.sceneId, direction);
    if (!target) return;
    const receipt = await storyboard(store, `moveScene:${scene.sceneId}`, { kind: "moveScene", id: scene.sceneId, beforeId: target.beforeId });
    if (!receipt) return;
    setFlash(sceneElementId(scene.sceneId));
    const lands = target.ordinal === 1 || target.ordinal === outline.scenes.length;
    focusLater(`[data-act="${lands ? (direction < 0 ? "scene-down" : "scene-up") : direction < 0 ? "scene-up" : "scene-down"}"][data-scene="${scene.sceneId}"]`);
    await finish(receipt, msg("plan.change.move_scene", { title: scene.title }), msg("plan.toast.scene_moved", { title: scene.title, scene: target.ordinal }));
  };

  const moveShot = async (row: ShotRowView, direction: -1 | 1) => {
    const target = shotMove(outline, row.shotId, direction);
    if (!target) return;
    const receipt = await storyboard(store, `moveShot:${row.shotId}`, { kind: "moveShot", id: row.shotId, sceneId: target.sceneId, beforeId: target.beforeId });
    if (!receipt) return;
    setFlash(rowId(row.shotId));
    focusLater(`[data-act="shot-menu"][data-shot="${row.shotId}"]`);
    await finish(receipt, msg("plan.change.move_shot", { shot: target.from }), msg("plan.toast.shot_moved", { from: target.from, to: target.to }));
  };

  const addShot = async (scene: SceneView) => {
    const before = store.getState().overview ?? overview;
    const receipt = await storyboard(store, `addShot:${scene.sceneId}`, { kind: "addShot", sceneId: scene.sceneId });
    if (!receipt) return;
    await store.refresh();
    const after = store.getState().overview;
    const shot = after ? addedShot(before, after, scene.sceneId) : null;
    if (shot) { startEdit({ kind: "shot", shotId: shot.shotId }); setFlash(rowId(shot.shotId)); }
    await finish(receipt, msg("plan.change.add_shot", { scene: scene.ordinal }), msg("plan.toast.shot_added", { shot: shot?.label ?? "" }));
  };

  const addScene = async () => {
    const before = store.getState().overview ?? overview;
    // No value: the server stores it as the scene's direction. The new scene is named in place right after.
    const receipt = await storyboard(store, "addScene", { kind: "addScene" });
    if (!receipt) return;
    await store.refresh();
    const after = store.getState().overview;
    const scene = after ? addedScene(before, after) : null;
    if (scene) { startEdit({ kind: "title", sceneId: scene.sceneId }); setFlash(sceneElementId(scene.sceneId)); }
    await finish(receipt, msg("plan.change.add_scene"), msg("plan.toast.scene_added", { scene: scene?.ordinal ?? outline.scenes.length + 1 }));
  };

  // A refused delete (e.g. a job still running in the scene) keeps the confirm open and says why there.
  const deleteScene = async (scene: SceneView) => {
    const receipt = await storyboard(store, `deleteScene:${scene.sceneId}`, { kind: "deleteScene", id: scene.sceneId, withShots: true });
    if (!receipt) return setDeleteError(takeRefusal(store));
    await store.refresh();
    if (editing && "sceneId" in editing && editing.sceneId === scene.sceneId) stopEdit();
    setConfirming(null);
    await finish(receipt, msg("plan.change.delete_scene", { scene: scene.ordinal }), msg("plan.toast.scene_deleted", { scene: scene.ordinal, title: scene.title }));
  };

  const deleteShot = async (row: ShotRowView) => {
    const receipt = await storyboard(store, `deleteShot:${row.shotId}`, { kind: "deleteShot", id: row.shotId });
    if (!receipt) return setDeleteError(takeRefusal(store));
    await store.refresh();
    if (editing?.kind === "shot" && editing.shotId === row.shotId) stopEdit();
    setConfirming(null);
    await finish(receipt, msg("plan.change.delete_shot", { shot: row.label }), msg("plan.toast.shot_deleted", { shot: row.label }));
  };

  // ---- the shot editor: one command per changed field, in an order the server accepts --------------------
  const saveShot = async (shot: ShotOverview, base: ShotDraft, draft: ShotDraft) => {
    const narrationMode = snapshot.project.shots.find((row) => row.id === shot.shotId)?.narration?.mode;
    const items = draftEdits(base, draft, fps, narrationMode, shot.imagePrompt);
    if (!items.length) return stopEdit(`[data-act="edit-shot"][data-shot="${shot.shotId}"]`);
    const summary = savedMessage(shot, base, draft);
    setError(null);
    const result = await storyboardSequence(store, items.map((item) => ({ pressId: `${item.edit.kind}:${shot.shotId}:${item.edit.field}`, input: { ...item.edit, id: shot.shotId } })));
    const fields = items.slice(0, result.saved).map((item) => item.field);
    const change = editChange(shot.label, fields);
    if (result.saved < items.length) {
      // A refusal (e.g. shorter than the accepted voice line) keeps the editor open with the server's reason;
      // anything saved before it can still be undone from the header.
      setError(takeRefusal(store));
      if (result.last) await record(result.last, change);
      return;
    }
    stopEdit(`[data-act="edit-shot"][data-shot="${shot.shotId}"]`);
    if (!result.last) return;
    // Several fields are several commands, and Undo reverts only the last: the toast says which, as the header does.
    const toast = fields.length > 1 ? msg("plan.toast.saved_undo_last", { saved: tm(summary), change: tm(change) }) : summary;
    await finish(result.last, change, toast);
  };

  const undo = async () => {
    if (!last) return;
    const change = tm(last.label);
    store.dismissToast();
    const receipt = await storyboard(store, `undo:${last.commandId}`, { kind: "undo", commandId: last.commandId });
    if (!receipt) {
      // Something changed since (a new edit elsewhere, paid work that used it): this Undo is gone for good.
      if (refusal(store)?.id === "error.UNDO_UNAVAILABLE") setLast(null);
      return;
    }
    setLast(null);
    infoToast(store, msg("plan.toast.undone", { change }));
    // The Undo button turns off; focus stays in the view instead of falling to the page.
    focusLater(`#${PLAN_TITLE_ID}`);
  };

  // ---- written plans -------------------------------------------------------------------------------------
  const send = async (name: string, text: string) => {
    const finalName = importName(name);
    const receipt = await sendImport(store, finalName, text);
    if (!receipt) {
      if (refusal(store)?.id === "error.DIRECTOR_REQUIRED") setNoCodex(true);
      return;
    }
    setJustSent(finalName);
    imports.reload();
  };
  const discard = async () => {
    if (!importPending) return;
    const done = await discardImport(store, importPending);
    if (done === undefined) return;
    setImportOpen(false);
    setJustSent(null);
    imports.reload();
  };
  const confirmPlan = async () => {
    if (!importPending) return;
    const done = await confirmImport(store, importPending);
    if (done === undefined) return;
    setImportOpen(false);
    setJustSent(null);
    setLast(null);
    imports.reload();
  };

  const confirmScene = confirming?.kind === "scene" ? outline.scenes.find((scene) => scene.sceneId === confirming.sceneId) : undefined;
  const confirmRow = confirming?.kind === "shot" ? outline.scenes.flatMap((scene) => scene.shots).find((row) => row.shotId === confirming.shotId) : undefined;
  const sceneFacts = confirmScene ? deleteSceneFacts(outline, overview, confirmScene.sceneId) : null;
  const shotFacts = confirmRow ? deleteShotFacts(outline, overview, confirmRow.shotId) : null;
  const pendingTitle = stage === "review" ? "plan.pending.review" : stage === "stale" ? "plan.pending.stale" : stage === "waiting" ? "plan.pending.waiting" : "plan.pending.reading";

  return (
    <main className="work plan" data-view="plan" data-head={snapshot.project.headVersion}>
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
            title={!connected ? offlineWhy : runGuard}
            onClick={() => setImportOpen(true)}
          >
            {t(importPending ? "plan.import.review_open" : "plan.import.open")}
          </button>
        </div>
      </div>

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
            onEdit={() => startEdit({ kind: field })}
            onCancel={() => stopEdit(`[data-act="edit-text"][data-field="${field}"]`)}
            onSave={(value) => void saveText(field, value)}
          />
        ))}
      </div>

      <div className="scenes">
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
              flash={flash === sceneElementId(scene.sceneId)}
              onMove={(direction) => void moveScene(scene, direction)}
              onPoint={() => point({ kind: "scene", id: scene.sceneId }, t("plan.scene.label", { scene: scene.ordinal }))}
              onRename={() => startEdit({ kind: "title", sceneId: scene.sceneId })}
              onEditDirection={() => startEdit({ kind: "direction", sceneId: scene.sceneId })}
              onDelete={() => setConfirming({ kind: "scene", sceneId: scene.sceneId })}
              onCancel={() => stopEdit(`[data-act="scene-menu"][data-scene="${scene.sceneId}"]`)}
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
                      mode={snapshot.project.shots.find((item) => item.id === row.shotId)?.narration?.mode}
                      fps={fps}
                      prices={unitPrices(overview, row.sceneId)}
                      saving={busy}
                      guard={guard}
                      error={error}
                      onCancel={() => stopEdit(`[data-act="edit-shot"][data-shot="${row.shotId}"]`)}
                      onSave={(base, draft) => void saveShot(shot, base, draft)}
                    />
                  );
                return (
                  <ShotRow
                    key={row.shotId}
                    row={row}
                    guard={guard}
                    busy={busy}
                    flash={flash === rowId(row.shotId)}
                    onEdit={() => startEdit({ kind: "shot", shotId: row.shotId })}
                    onMove={(direction) => void moveShot(row, direction)}
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
      {importOpen ? (
        <ImportSheet
          stage={stage}
          pending={importPending}
          review={review}
          notes={notes}
          busy={busy}
          guard={connected ? undefined : offlineWhy}
          runGuard={runGuard}
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
