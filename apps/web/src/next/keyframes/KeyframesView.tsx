import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { checkActions, lineEstimate, type AppCheck } from "../model/checks.ts";
import { inspectorView } from "../model/inspector.ts";
import { keyframesView } from "../model/keyframes.ts";
import { wordsOf } from "../model/narration.ts";
import { advance, playingShot, type Playback } from "../model/motion.ts";
import { msg } from "../model/types.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import type { EditDraft } from "../store/state.ts";
import { CheckBanner, type SettledCheck } from "./CheckBanner.tsx";
import { Inspector } from "./Inspector.tsx";
import { NoteBanner } from "./NoteBanner.tsx";
import { Preview, type OpenIntent } from "./Preview.tsx";
import { SceneHeader } from "./SceneHeader.tsx";
import { ShotCards } from "./ShotCards.tsx";
import { useDirectorNotes } from "./useDirectorNotes.ts";
import { VideoPanel } from "./VideoPanel.tsx";
import "./keyframes.css";

/**
 * The Keyframes view of the chosen design: scene header and pills, the banner (the Director's open notes in
 * amber first, else the app's own neutral checks), the preview with the shot inspector, and the shot cards with
 * the scene's video panel. Every state comes from the generation overview and the Director's notes through pure
 * view models; presses go to the store.
 */
export function KeyframesView() {
  const { t } = useI18n();
  const overview = useStudio((s) => s.overview);
  const loadError = useStudio((s) => s.loadErrors.overview);

  if (!overview) {
    if (loadError)
      return (
        <main className="work kf kf-state" data-view="keyframes" data-state="missing">
          <div className="kf-message" role="alert">
            <b>{t("kf.overview_missing.title")}</b>
            <span>{t("kf.overview_missing.body", { code: loadError })}</span>
          </div>
        </main>
      );
    return (
      <main className="work kf kf-state" data-view="keyframes" data-state="loading" aria-busy="true">
        <div className="kf-message" role="status">{t("kf.loading")}</div>
      </main>
    );
  }
  if (!overview.scenes.length)
    return (
      <main className="work kf kf-state" data-view="keyframes" data-state="empty">
        <div className="kf-message">
          <b>{t("kf.empty.title")}</b>
          <span>{t("kf.empty.body")}</span>
        </div>
      </main>
    );
  return <Workspace />;
}

function Workspace() {
  const store = useStore();
  const mode = useMode();
  const { locale } = useI18n();
  const overview = useStudio((s) => s.overview)!;
  const sceneId = useStudio((s) => s.sceneId);
  const shotId = useStudio((s) => s.shotId);
  const draft = useStudio((s) => s.edit);
  const pending = useStudio((s) => s.pending);
  const view = useMemo(() => keyframesView(overview, sceneId, shotId, locale), [overview, sceneId, shotId, locale]);

  const [settled, setSettled] = useState<SettledCheck | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [intent, setIntent] = useState<OpenIntent | null>(null);
  /** The narration editor was opened from a check, so a fitting save settles that check. */
  const narrationFromCheck = useRef<{ shotId: string; letter: string } | null>(null);
  const nonce = useRef(0);

  const selected = view?.selected ?? null;
  const selectedId = selected?.shotId ?? null;
  const currentSceneId = view?.scene.sceneId ?? null;
  // The stored narration mode, so the inspector reads a recording as one (the overview reports only the line).
  const narrationMode = useStudio((s) => (selectedId ? s.snapshot?.project.shots.find((row) => row.id === selectedId)?.narration?.mode : undefined));

  // Navigating to a shot (including the first one shown) arms "Opened" for its current frame.
  useEffect(() => {
    if (selectedId) setIntent((current) => (current?.shotId === selectedId ? current : { shotId: selectedId, nonce: ++nonce.current }));
  }, [selectedId]);

  // A settled check describes the film as the edit left it; once that changes (Undo from the toast,
  // another edit, a reload of an older state) the banner goes back to what the overview says.
  useEffect(() => {
    if (!settled || overview.cursor <= settled.cursor) return;
    const shot = overview.shots[settled.shotId];
    const still = settled.kind === "extended" ? shot?.narration.fit === "extend_shot"
      : settled.kind === "cut" ? shot?.narration.fit === "cut_to_shot"
      : shot?.narration.text === settled.text;
    if (!still) setSettled(null);
  }, [overview, settled]);

  // Leaving a scene stops its playback.
  useEffect(() => { setPlayback(null); }, [currentSceneId]);

  const openShot = useCallback((id: string) => {
    setPlayback((current) => (playingShot(current) === id ? current : null));
    store.selectShot(id);
    setIntent({ shotId: id, nonce: ++nonce.current });
  }, [store]);

  const onScene = useCallback((id: string) => store.selectScene(id), [store]);

  const notes = useDirectorNotes({ overview, sceneId: currentSceneId, locale, openShot });

  /**
   * Settle a too-long line with one free server command (SB-2, SB-3): lengthen the shot, or keep it and cut the
   * line with a fade. The toast and the banner both offer Undo with the command's id.
   */
  const fit = useCallback(async (check: AppCheck, letter: string, kind: "extended" | "cut") => {
    const actions = checkActions(check, overview.fps);
    const shot = overview.shots[check.shotId];
    if (!shot || !currentSceneId || (kind === "extended" && !actions.extend)) return;
    const ok = kind === "extended"
      ? await store.narrationFit(check.shotId, "extend_shot", msg("toast.fit_extended", { shot: check.label, seconds: actions.extend!.seconds }))
      : await store.narrationFit(check.shotId, "cut_to_shot", msg("toast.fit_cut", { shot: check.label, seconds: actions.keep.seconds }));
    if (!ok) return;
    setSettled({
      kind, sceneId: currentSceneId, shotId: check.shotId, label: check.label, letter,
      seconds: kind === "extended" ? actions.extend!.seconds : actions.keep.cutSeconds,
      shotSeconds: kind === "extended" ? actions.extend!.seconds : actions.keep.seconds,
      hadClip: shot.video.state === "ready",
      commandId: store.getState().toast?.undoCommandId ?? null,
      cursor: store.getState().overview?.cursor ?? 0,
    });
  }, [overview, store, currentSceneId]);

  const editNarration = useCallback((check: AppCheck, letter: string) => {
    const shot = overview.shots[check.shotId];
    if (!shot) return;
    narrationFromCheck.current = { shotId: check.shotId, letter };
    openShot(check.shotId);
    store.setEdit({ shotId: check.shotId, field: "narration", value: wordsOf(shot.narration.text) });
  }, [overview, store, openShot]);

  const saveDraft = useCallback(async (next: EditDraft) => {
    const shot = overview.shots[next.shotId];
    const fromCheck = narrationFromCheck.current;
    const estimate = shot && next.field === "narration" ? lineEstimate(next.value, shot, overview.fps) : null;
    const commandId = await store.saveEdit(next);
    if (!commandId || !shot || !currentSceneId) return;
    notes.editSaved(next.shotId, next.field, commandId);
    if (next.field === "narration" && fromCheck?.shotId === next.shotId && estimate?.fits) {
      narrationFromCheck.current = null;
      setSettled({
        kind: "edited", sceneId: currentSceneId, shotId: shot.shotId, label: shot.label, letter: fromCheck.letter,
        seconds: estimate.seconds, shotSeconds: estimate.shotSeconds, hadClip: false, text: next.value,
        commandId: store.getState().toast?.undoCommandId ?? null,
        cursor: store.getState().overview?.cursor ?? 0,
      });
    }
  }, [overview, store, currentSceneId, notes]);

  /** Motion and duration are two storyboard fields; each changed one is its own edit, saved in turn. */
  const saveMotion = useCallback(async (motion: string, secondsValue: number) => {
    if (!selected) return;
    const base: EditDraft = { shotId: selected.shotId, field: "motion", value: motion };
    const changes: { field: "motion" | "desiredFrames"; value: string }[] = [];
    if (motion !== selected.motion) changes.push({ field: "motion", value: motion });
    const frames = Math.round(secondsValue * overview.fps);
    if (frames !== selected.durationFrames) changes.push({ field: "desiredFrames", value: String(frames) });
    if (!changes.length) { store.setEdit(null); return; }
    store.setEdit({ ...base, saving: true });
    let motionCommand: string | null = null;
    for (const [index, change] of changes.entries()) {
      // The next edit must carry the head version the previous one produced.
      if (index > 0) await store.refresh();
      const commandId = await store.edit({ kind: "shot", id: selected.shotId, ...change }, msg("toast.saved"));
      if (!commandId) { store.setEdit({ ...base, saving: false }); return; }
      if (change.field === "motion") motionCommand = commandId;
    }
    store.setEdit(null);
    notes.editSaved(selected.shotId, "motion", motionCommand);
  }, [selected, overview.fps, store, notes]);

  const editDraft = useCallback((next: EditDraft | null) => {
    // Leaving the narration editor (cancel, or another form) forgets that it came from a check.
    if (!next || next.field !== "narration" || next.shotId !== narrationFromCheck.current?.shotId) narrationFromCheck.current = null;
    notes.editChanged(next);
    store.setEdit(next);
  }, [store, notes]);

  const regenerate = useCallback(() => {
    if (!selected) return;
    setPlayback(null);
    void store.regenerateKeyframe(selected.shotId);
  }, [selected, store]);

  const confirm = useCallback(() => {
    if (!currentSceneId) return;
    // A paid press uses the current state: the settled check or note can no longer be undone from here.
    setSettled(null);
    notes.forgetUndo();
    store.dismissToast();
    void store.confirmVideo(currentSceneId);
  }, [currentSceneId, store, notes]);

  const playScene = useCallback(() => {
    if (!view) return;
    if (playback && playback.queue.length > 1) { setPlayback(null); return; }
    const shots = view.scene.shotIds.map((id) => overview.shots[id]).filter((shot) => shot && shot.keyframe.state === "ready");
    const queue = shots.map((shot) => shot!.shotId);
    const first = queue[0];
    if (!first) return;
    // Fixture clips are not media, so the fixture plays each keyframe's motion preview instead.
    const clips = mode === "live" && shots.every((shot) => shot!.video.state === "ready" && shot!.video.artifact);
    store.selectShot(first);
    setPlayback({ queue, index: 0, kind: clips ? "clip" : "motion" });
  }, [view, playback, overview, mode, store]);

  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const ended = useCallback(() => {
    const current = playbackRef.current;
    const next = current ? advance(current) : null;
    const nextShot = playingShot(next);
    if (nextShot) store.selectShot(nextShot);
    setPlayback(next);
  }, [store]);

  if (!view) return null;
  const card = view.cards.find((c) => c.shotId === selectedId);
  const inspector = selected ? inspectorView(overview, selected, locale, narrationMode) : null;
  const playingHere = playingShot(playback) === selectedId ? playback!.kind : null;
  const sceneOrdinalChecks = view.checks;
  // A card already carrying a Director note for its shot does not repeat the app's check about it.
  const cards = view.cards.map((c) => {
    const callouts = notes.calloutsFor(c.shotId);
    return { card: callouts.length ? { ...c, callouts: [] } : c, notes: callouts };
  });
  const editBusy = selected ? !!pending[`edit:shot:${selected.shotId}`] || !!pending[`edit:narration:${selected.shotId}`] : false;

  return (
    <main className="work kf" data-view="keyframes" data-scene={view.scene.sceneId}>
      <SceneHeader view={view} onScene={onScene} />
      {notes.banner ? (
        <NoteBanner
          view={notes.banner}
          busy={notes.busy || Object.keys(pending).some((key) => key.startsWith("regenerate:"))}
          nextLetter={notes.nextLetter}
          canUndo={notes.canUndo}
          onChoose={notes.choose}
          onNext={notes.next}
          onUndo={notes.undo}
        />
      ) : (
      <CheckBanner
        overview={overview}
        sceneId={view.scene.sceneId}
        checks={sceneOrdinalChecks}
        settled={settled}
        quiet={notes.allSettled ? msg("note.all_settled") : null}
        busy={Object.keys(pending).some((key) => key.startsWith("edit:") || key.startsWith("fit:"))}
        onExtend={(check) => void fit(check, sceneOrdinalChecks.find((c) => c.check.shotId === check.shotId)?.letter ?? "a", "extended")}
        onKeep={(check) => void fit(check, sceneOrdinalChecks.find((c) => c.check.shotId === check.shotId)?.letter ?? "a", "cut")}
        onEditNarration={(check) => editNarration(check, sceneOrdinalChecks.find((c) => c.check.shotId === check.shotId)?.letter ?? "a")}
        onNext={() => setSettled(null)}
        onUndo={(commandId) => { setSettled(null); void store.undo(commandId); }}
      />
      )}
      <div className="stage">
        {selected && card && inspector ? (
          <>
            <Preview
              shot={selected}
              card={card}
              fps={overview.fps}
              playing={playingHere}
              intent={intent}
              onTogglePlay={() => setPlayback(playingHere ? null : { queue: [selected.shotId], index: 0, kind: "motion" })}
              onEnded={ended}
              onOpen={openShot}
            />
            <Inspector
              view={inspector}
              shot={selected}
              fps={overview.fps}
              draft={draft}
              busy={{
                regenerate: !!pending[`regenerate:${selected.shotId}`],
                edit: editBusy,
                release: Object.keys(pending).some((key) => key.startsWith("release:")),
                video: !!pending[`confirm:${selected.sceneId}`],
              }}
              onPoint={() => {
                store.pointAt({ kind: "shot", id: selected.shotId });
                // On narrow screens the Director is a drawer: open it so the pointer is seen (as in the prototype).
                if (window.matchMedia?.("(max-width: 899px)").matches) store.setDirectorOpen(true);
              }}
              onRegenerate={regenerate}
              onRetryVideo={confirm}
              onEdit={editDraft}
              onSaveDraft={(next) => void saveDraft(next)}
              onSaveMotion={(motion, secondsValue) => void saveMotion(motion, secondsValue)}
              onRelease={(attemptId) => void store.releaseAttempt(attemptId)}
            />
          </>
        ) : (
          <EmptyStage />
        )}
      </div>
      <div className="row kf-row">
        <ShotCards
          cards={cards.map((c) => c.card)}
          notes={Object.fromEntries(cards.map((c) => [c.card.shotId, c.notes]))}
          sceneOrdinal={view.scene.ordinal}
          busy={notes.busy}
          onOpen={openShot}
          onNoteChoice={notes.chooseOnCard}
        />
        <VideoPanel
          panel={view.panel}
          sceneId={view.scene.sceneId}
          pending={!!pending[`confirm:${view.scene.sceneId}`] || !!pending[`keyframes:${view.scene.sceneId}`]}
          playing={!!playback && playback.queue.length > 1}
          onConfirm={confirm}
          onMakeKeyframes={() => void store.makeKeyframes(view.scene.sceneId)}
          onPlay={playScene}
        />
      </div>
    </main>
  );
}

function EmptyStage() {
  const { t } = useI18n();
  return <div className="preview kf-empty-stage"><div className="dashed-frame"><div><b>{t("kf.empty_scene")}</b></div></div></div>;
}
