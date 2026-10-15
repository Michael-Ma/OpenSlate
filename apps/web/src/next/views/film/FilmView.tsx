import type { ExportRecord, ExportView } from "@openslate/core/public";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNarrow } from "../../app/useNarrow.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { currentPlacements, type PlaybackView } from "../../model/film-audio.ts";
import { FilmClock } from "../../model/film-clock.ts";
import { changeMsg, lastExport, whenMsg, type MediaView } from "../../model/film-export.ts";
import {
  editPressId, filmMusic, filmTimeline, lengthEdit, lengthToast, moveEdit, musicChoiceEdit, musicGainEdit, musicMuteEdit, musicStartEdit,
  soundtrackOf, type FilmEdit,
} from "../../model/film.ts";
import { clock as formatClock } from "../../model/motion.ts";
import { msg, type Msg } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { useResource } from "../../store/useResource.ts";
import { ExportPanel } from "./ExportPanel.tsx";
import { MusicMenu } from "./MusicMenu.tsx";
import { Player } from "./Player.tsx";
import { Timeline, type Selection } from "./Timeline.tsx";
import { MusicTools, ShotTools } from "./Tools.tsx";
import { useLiveAudio } from "./useLiveAudio.ts";
import { useMusicLibrary } from "./useMusicLibrary.ts";
import "./film.css";

/** Phone width: the timeline scrolls sideways inside itself at 14 px a second. */
const PHONE_PIXELS_PER_SECOND = 14;
/** Starting an export freezes every input first, and Check again looks for the finished file: both can take a while. */
const EXPORT_COMMAND_TIMEOUT_MS = 60_000;

/**
 * The Film view (docs/ai/prototypes/last-ferry/film.html): the whole film on one clock in storyboard order,
 * the Export panel, and the timeline with scene, picture, narration and music lanes. Length, order within a
 * scene and the music are free edits with Undo; each one marks the last export as changed.
 */
export function FilmView() {
  const { t } = useI18n();
  const overview = useStudio((s) => s.overview);
  const loadError = useStudio((s) => s.loadErrors.overview);
  if (!overview) {
    return (
      <main className="work film-work film-state" data-view="film" data-state={loadError ? "missing" : "loading"} aria-busy={!loadError}>
        <div className="film-message" role={loadError ? "alert" : "status"}>
          {loadError ? <><b>{t("film.missing.title")}</b><span>{t("film.missing.body", { code: loadError })}</span></> : t("film.loading")}
        </div>
      </main>
    );
  }
  if (!Object.keys(overview.shots).length) {
    return (
      <main className="work film-work film-state" data-view="film" data-state="empty">
        <div className="film-message"><b>{t("film.empty.title")}</b><span>{t("film.empty.body")}</span></div>
      </main>
    );
  }
  return <FilmWorkspace />;
}

function FilmWorkspace() {
  const store = useStore();
  const mode = useMode();
  const { t, tm, locale } = useI18n();
  const overview = useStudio((s) => s.overview)!;
  const snapshot = useStudio((s) => s.snapshot);
  const projectId = useStudio((s) => s.projectId);
  const connection = useStudio((s) => s.connection);
  const pending = useStudio((s) => s.pending);
  const focus = useStudio((s) => s.focus);
  const narrow = useNarrow();
  const live = mode === "live";
  const writable = connection === "connected";

  const exportsRes = useResource<ExportView>("/exports");
  const mediaRes = useResource<MediaView>("/media");
  const playbackRes = useResource<PlaybackView>(live ? "/narration/playback" : null);

  const timeline = useMemo(() => filmTimeline(overview, snapshot?.notes), [overview, snapshot?.notes]);
  const soundtrack = soundtrackOf(snapshot);
  const recordings = useMusicLibrary();
  const music = useMemo(() => filmMusic(soundtrack, recordings ?? [], overview.fps), [soundtrack, recordings, overview.fps]);
  const demo = !!exportsRes.data?.readiness.demo;

  // ---- one clock --------------------------------------------------------------------------
  const clock = useMemo(() => new FilmClock(), []);
  useEffect(() => () => clock.dispose(), [clock]);
  useEffect(() => { clock.setTotal(timeline.total); }, [clock, timeline.total]);
  const placements = useMemo(() => currentPlacements(playbackRes.data, snapshot?.project.headVersion), [playbackRes.data, snapshot?.project.headVersion]);
  useLiveAudio(clock, projectId, placements, live);

  // ---- selection -----------------------------------------------------------------------------
  const [selection, setSelection] = useState<Selection>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const selectShot = useCallback((shotId: string, toggle = true) => {
    setSelection((current) => (toggle && current?.kind === "shot" && current.id === shotId ? null : { kind: "shot", id: shotId }));
    const shot = timeline.shots.find((s) => s.shotId === shotId);
    if (shot) clock.seek(shot.start);
  }, [timeline, clock]);
  const selectMusic = useCallback(() => {
    setSelection((current) => (current?.kind === "music" ? null : { kind: "music" }));
    if (music) clock.seek(Math.min(music.start, timeline.total));
  }, [music, clock, timeline.total]);
  // A selected shot that was deleted, or music that was removed, is no longer selected.
  useEffect(() => {
    if (selection?.kind === "shot" && !overview.shots[selection.id]) setSelection(null);
    if (selection?.kind === "music" && !soundtrack) setSelection(null);
  }, [selection, overview, soundtrack]);
  // On a short screen the workspace scrolls: a new selection brings its tool row into view.
  const main = useRef<HTMLElement>(null);
  const selectionKey = selection ? (selection.kind === "shot" ? selection.id : "music") : null;
  useEffect(() => {
    const work = main.current;
    const tools = work?.querySelector<HTMLElement>(".tl-tools");
    if (!selectionKey || !work || !tools) return;
    const box = tools.getBoundingClientRect();
    const view = work.getBoundingClientRect();
    if (box.bottom > view.bottom + 1 || box.top < view.top - 1) tools.scrollIntoView({ block: "nearest" });
  }, [selectionKey]);
  // "Open 2.2" from elsewhere (a Director note) selects and seeks the shot here, even when it is opened again;
  // a scene opens on its first shot.
  const seenFocus = useRef(focus?.nonce);
  useEffect(() => {
    if (!focus || focus.nonce === seenFocus.current) return;
    seenFocus.current = focus.nonce;
    const shotId = focus.kind === "shot" ? focus.id : overview.scenes.find((scene) => scene.sceneId === focus.id)?.shotIds[0];
    if (shotId && overview.shots[shotId]) selectShot(shotId, false);
  }, [focus, overview, selectShot]);

  // ---- free edits with Undo ---------------------------------------------------------------------
  const [editing, setEditing] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const runEdit = useCallback(async (edit: FilmEdit, toast: Msg) => {
    const current = store.getState().snapshot;
    const pressId = editPressId(edit);
    if (!current || editingRef.current) return false;
    editingRef.current = pressId;
    setEditing(pressId);
    try {
      const body = { ...edit, expectedHeadVersion: current.project.headVersion };
      const receipt = await store.command<{ commandId: string }>(pressId, body, () => ({ path: "/storyboard", body }));
      if (receipt) store.dispatch({ type: "toast", message: toast, tone: "info", undoCommandId: receipt.commandId });
      // The next edit must carry the head version this one produced.
      await store.refresh();
      return !!receipt;
    } finally {
      editingRef.current = null;
      setEditing(null);
    }
  }, [store]);

  const selectedShot = selection?.kind === "shot" ? timeline.shots.find((s) => s.shotId === selection.id) ?? null : null;
  const changeLength = (step: -1 | 1) => {
    const shot = selectedShot && overview.shots[selectedShot.shotId];
    const next = shot && lengthEdit(shot, overview.fps, step);
    if (!shot || !next || !selectedShot) return;
    const film = Math.round((timeline.total - selectedShot.seconds + next.seconds) * 10) / 10;
    void runEdit(next.edit, lengthToast(selectedShot.label, next.seconds, film, selectedShot.picture === "clip"));
  };
  // After a move the playhead follows the shot to its new place.
  const follow = useRef<{ shotId: string; start: number } | null>(null);
  const move = (direction: -1 | 1) => {
    if (!selectedShot) return;
    const next = moveEdit(overview, selectedShot.shotId, direction);
    if (!next) return;
    follow.current = { shotId: selectedShot.shotId, start: selectedShot.start };
    void runEdit(next.edit, msg("film.toast.moved", { from: selectedShot.label, to: next.label })).then((moved) => { if (!moved) follow.current = null; });
  };
  useEffect(() => {
    const target = follow.current;
    const shot = target && timeline.shots.find((s) => s.shotId === target.shotId);
    if (!target || !shot || shot.start === target.start) return;
    follow.current = null;
    clock.seek(shot.start);
  }, [timeline, clock]);
  const musicStart = (step: -1 | 1) => {
    const edit = music && musicStartEdit(music, overview.fps, step, timeline.total);
    if (edit) void runEdit(edit, msg("film.toast.music_start", { time: formatClock(Number(edit.kind === "soundtrack" ? edit.value : 0) / overview.fps) }));
  };
  const musicGain = async (db: number) => {
    if (!music || Math.round(db) === music.gainDb) return true;
    return runEdit(musicGainEdit(db), msg("film.toast.music_volume", { db: Math.round(db) }));
  };
  const toggleMute = () => {
    if (music) void runEdit(musicMuteEdit(!music.muted), msg(music.muted ? "film.toast.music_on" : "film.toast.music_muted"));
  };
  const pickMusic = (audioId: string | null) => {
    if (audioId === (music?.audioId ?? null)) return;
    const name = recordings?.find((r) => r.id === audioId)?.label ?? t("film.music.unnamed");
    void runEdit(musicChoiceEdit(audioId), audioId ? msg("film.toast.music_changed", { name }) : msg("film.toast.music_removed")).then(() => {
      // The menu gave focus back to its button; adding or removing the music can remove that button.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        main.current?.querySelector<HTMLElement>("[data-act='sel-music'], [data-act='choose-music']")?.focus();
      });
    });
  };
  const openInKeyframes = () => {
    if (!selectedShot) return;
    store.selectShot(selectedShot.shotId);
    store.setView("keyframes");
  };

  // ---- export ------------------------------------------------------------------------------------
  const startExport = async () => {
    const current = store.getState().snapshot;
    if (!current) return;
    const body = { expectedHeadVersion: current.project.headVersion };
    const record = await store.command<ExportRecord>("export:start", body, () => ({ path: "/exports", body }), msg("film.toast.export_started"), { timeoutMs: EXPORT_COMMAND_TIMEOUT_MS });
    if (record) { exportsRes.reload(); mediaRes.reload(); }
  };
  const cancelExport = async (exportId: string) => {
    const record = await store.command<ExportRecord>(`export:cancel:${exportId}`, { exportId }, () => ({ path: `/exports/${encodeURIComponent(exportId)}/cancel`, body: {} }), msg("film.toast.export_cancelled"));
    if (record) { exportsRes.reload(); mediaRes.reload(); }
  };
  const recoverExport = async (exportId: string) => {
    const record = await store.command<ExportRecord>(`export:recover:${exportId}`, { exportId }, () => ({ path: `/exports/${encodeURIComponent(exportId)}/recover`, body: {} }), undefined, { timeoutMs: EXPORT_COMMAND_TIMEOUT_MS });
    if (!record) return;
    seenDone.current.add(exportId);
    store.dispatch({ type: "toast", message: msg(record.state === "done" ? "film.toast.export_found" : "film.toast.export_missing"), tone: "info" });
    exportsRes.reload();
    mediaRes.reload();
  };
  // An export that finishes while the view is open says so once.
  const seenDone = useRef(new Set<string>());
  const renderingId = useRef<string | null>(null);
  useEffect(() => {
    const current = exportsRes.data?.current;
    if (!current) return;
    if (current.state === "rendering") { renderingId.current = current.exportId; return; }
    if (renderingId.current === current.exportId && current.state === "done" && !seenDone.current.has(current.exportId)) {
      seenDone.current.add(current.exportId);
      store.dispatch({ type: "toast", message: msg("film.toast.export_done"), tone: "info" });
    }
    renderingId.current = null;
  }, [exportsRes.data, store]);
  // While an export renders, the media read tells a restart's orphan apart from a live render.
  const rendering = exportsRes.data?.current?.state === "rendering";
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => { exportsRes.reload(); mediaRes.reload(); }, 5000);
    return () => clearInterval(timer);
  }, [rendering, exportsRes.reload, mediaRes.reload]);

  const last = lastExport(exportsRes.data, mediaRes.data);
  const fileName = `${(snapshot?.project.name ?? "film").trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "film"}.mp4`;

  // ---- keyboard ----------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && selection && !menuAnchor) { event.preventDefault(); setSelection(null); }
  };

  const selectedOverview = selectedShot ? overview.shots[selectedShot.shotId] : undefined;
  const changes = last?.outdatedBy.length ? last.outdatedBy.map((kind) => tm(changeMsg(kind))).join(t("film.list_sep")) : null;
  const when = last ? whenMsg(last.at, new Date(), locale) : null;

  return (
    <main ref={main} className="work film-work" data-view="film" onKeyDown={onKeyDown}>
      <div className="view-head">
        <h1>{t("film.title")}</h1>
        <span className="line" data-act="film-line">{t("film.line", { seconds: timeline.total, shots: timeline.shots.length, clips: timeline.clipsReady, total: timeline.shots.length })}</span>
        <div className="actions" data-act="last-export">
          {last ? (
            <>
              <span className="last-line">
                {t("film.last.label")}{when ? <> <b>{tm(when)}</b></> : null}
                {last.demo ? <> · {t("film.last.demo")}</> : null}
                {" · "}
                {changes ? <span data-act="changed-since">{t("film.last.changed", { changes })}</span> : <span className="ok-text" data-act="changed-since">{t("film.last.matches")}</span>}
              </span>
              {live && projectId ? (
                <a className="pill sm" data-act="download" href={`/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(last.artifact.artifactId)}/content`} download={fileName}>{t("film.last.download")}</a>
              ) : (
                <button type="button" className="pill sm" data-act="download" onClick={() => store.dispatch({ type: "toast", message: msg("film.download.fixture"), tone: "info" })}>{t("film.last.download")}</button>
              )}
              {last.earlier > 0 ? <button type="button" className="pill sm ghost" data-act="earlier-exports" onClick={() => store.setView("assets")}>{t("film.last.earlier", { count: last.earlier })}</button> : null}
            </>
          ) : (
            <span className="last-line dim">{t("film.last.none")}</span>
          )}
        </div>
      </div>
      <div className="film-stage">
        <Player timeline={timeline} clock={clock} music={music} demo={demo} live={live} />
        <ExportPanel
          overview={overview}
          view={exportsRes.data}
          media={mediaRes.data}
          error={exportsRes.error}
          writable={writable}
          stopped={!!overview.stopped}
          busy={{ start: !!pending["export:start"], cancel: Object.keys(pending).some((k) => k.startsWith("export:cancel:")), recover: Object.keys(pending).some((k) => k.startsWith("export:recover:")) }}
          onExport={() => void startExport()}
          onCancel={(id) => void cancelExport(id)}
          onRecover={(id) => void recoverExport(id)}
          onChangeMusic={setMenuAnchor}
        />
      </div>
      <Timeline
        timeline={timeline}
        music={music}
        clock={clock}
        selection={selection}
        pixelsPerSecond={narrow ? PHONE_PIXELS_PER_SECOND : null}
        writable={writable}
        saving={!!editing}
        onSelectShot={(id) => selectShot(id)}
        onSelectMusic={selectMusic}
        onToggleMute={toggleMute}
        onChooseMusic={setMenuAnchor}
      >
        {selectedShot && selectedOverview ? (
          <ShotTools
            shot={selectedShot}
            overview={selectedOverview}
            fps={overview.fps}
            writable={writable}
            onLength={changeLength}
            onMove={move}
            onOpen={openInKeyframes}
          />
        ) : selection?.kind === "music" && music ? (
          <MusicTools
            music={music}
            total={timeline.total}
            writable={writable}
            saving={!!editing}
            onStart={musicStart}
            onGain={musicGain}
            onMute={toggleMute}
            onChange={setMenuAnchor}
          />
        ) : (
          <span className="dim">{t("film.tools.hint")}</span>
        )}
      </Timeline>
      {menuAnchor ? (
        <MusicMenu
          anchor={menuAnchor}
          recordings={recordings}
          current={music?.audioId ?? null}
          onPick={pickMusic}
          onImport={() => store.setView("assets")}
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
    </main>
  );
}
