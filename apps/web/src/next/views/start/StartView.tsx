import { useEffect, useId, useMemo, useState } from "react";
import { useNarrow } from "../../app/useNarrow.ts";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { errorMsg } from "../../i18n/translate.ts";
import {
  demoRetryable, filmsView, livePendingDemo, parsePendingDemo, pickerProjects, runningJobs, sameProjects, PENDING_DEMO_KEY, type FilmRow as Row, type OpenView, type PendingDemo,
} from "../../model/start.ts";
import { openDemo, showDemoFilm, renameFilm, selectCreatedFilm, setArchived, DEMO_UNAVAILABLE, type Film } from "../../model/start-commands.ts";
import { createdMsg, planOffReason, setupStatus, type CreatedOutcome, type FirstStep } from "../../model/start-new.ts";
import { msg, type Msg } from "../../model/types.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import type { StudioStore } from "../../store/store.ts";
import { ArchiveDialog } from "./ArchiveDialog.tsx";
import { FilmRow } from "./FilmRow.tsx";
import { NewFilmSheet } from "./NewFilmSheet.tsx";
import { useCodex, useFilms, useProviders } from "./useStartData.ts";
import { Welcome } from "./Welcome.tsx";
import "./start.css";

/** Session storage may be missing or refuse (private windows, blocked site data); the demo then simply is not remembered. */
function readSession(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch { /* unavailable */ }
}

/** Focus the Director's composer once the new film is loaded and connected (the composer is off until then). */
function focusComposerWhenReady(store: StudioStore, filmId: string) {
  let stop = () => {};
  const ready = () => {
    const state = store.getState();
    if (state.snapshot?.project.id !== filmId || state.connection !== "connected") return false;
    stop();
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#director textarea:not(:disabled)")?.focus({ preventScroll: true }));
    return true;
  };
  if (ready()) return;
  const unsubscribe = store.subscribe(() => { ready(); });
  const timer = setTimeout(() => stop(), 10000);
  stop = () => { unsubscribe(); clearTimeout(timer); };
}

/**
 * Start: the films on this computer (SB-14, SB-22, decision D16). Each film shows only its list facts,
 * opens where it makes sense (Keyframes, or Plan while it has no shots), and can be renamed or archived;
 * archived films can be restored. With nothing in the list, the first run offers the free demo film
 * beside making your own. New film creates for free and opens the Plan.
 */
export function StartView() {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const narrow = useNarrow();
  const projectId = useStudio((s) => s.projectId);
  const connected = useStudio((s) => s.connection === "connected");
  const overview = useStudio((s) => s.overview);
  const pending = useStudio((s) => s.pending);
  const films = useFilms();
  const providers = useProviders();
  const codex = useCodex(films.data);
  const archivedId = useId();

  const [renaming, setRenaming] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<Film | null>(null);
  /** Why the archive dialog's last Archive was refused (its backdrop covers the toast). */
  const [archiveProblem, setArchiveProblem] = useState<Msg | null>(null);
  const [sheet, setSheet] = useState<{ step: FirstStep | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [savedDemo, setSavedDemo] = useState<PendingDemo | null>(() => parsePendingDemo(readSession(PENDING_DEMO_KEY)));
  const [demoBusy, setDemoBusy] = useState(false);

  // A restored studio in recovery review is read-only (app/useWriteGuard.ts): its reason replaces the offline one.
  const locked = useRecoveryLock();
  const offline = locked ?? (connected ? null : t("start.offline"));
  const view = useMemo(() => (films.data ? filmsView(films.data, projectId, new Date(), locale) : null), [films.data, projectId, locale]);
  const catalog = providers.catalog;
  const setup = useMemo(() => setupStatus(catalog && catalog !== "failed" ? catalog : null, codex), [catalog, codex]);
  const running = useMemo(() => runningJobs(overview), [overview]);
  const planWhy = planOffReason(codex);
  const pendingDemo = useMemo(() => livePendingDemo(savedDemo, films.data), [savedDemo, films.data]);
  // The studio has no stand-in Director: pressing again could only make another empty film.
  const demoOff = pendingDemo?.off ? t("start.demo.unavailable") : null;

  // The top bar's film picker follows the list (new, renamed, archived and restored films).
  useEffect(() => {
    if (!films.data) return;
    const next = pickerProjects(films.data, projectId);
    if (!sameProjects(store.getState().projects, next)) store.dispatch({ type: "projects", projects: next });
  }, [films.data, projectId, store]);

  const openFilm = (id: string, to: OpenView) => {
    if (store.getState().projectId !== id) void store.selectProject(id);
    store.setView(to);
  };

  /** A film made here joins the top bar's picker at once; the view is gone before the list is read again. */
  const remember = (film: Film) => {
    const projects = store.getState().projects;
    if (!projects.some((project) => project.id === film.id)) store.dispatch({ type: "projects", projects: [{ id: film.id, name: film.name }, ...projects] });
  };

  /**
   * The film exists as soon as Create answers, even if its Director setup or plan send then fails: list
   * and select it now while retaining Start and its sheet until the person opens it or closes the sheet.
   */
  const onMade = (film: Film) => {
    void selectCreatedFilm(store, film);
    void films.reload();
  };

  const onCreated = (film: Film, outcome: CreatedOutcome) => {
    setSheet(null);
    onMade(film);
    openFilm(film.id, "plan");
    store.dispatch({ type: "toast", message: createdMsg(outcome, film.name), tone: "info" });
    if (outcome === "director") {
      if (narrow) store.setDirectorOpen(true);
      focusComposerWhenReady(store, film.id);
    }
  };

  const saveDemo = (next: PendingDemo | null) => {
    setSavedDemo(next);
    writeSession(PENDING_DEMO_KEY, next ? JSON.stringify(next) : null);
  };

  const demo = async () => {
    if (demoBusy || offline || demoOff) return;
    const { projectId, projectEpoch } = store.getState();
    const origin = { projectId, projectEpoch };
    setDemoBusy(true);
    try {
      const { film, filled, code } = await openDemo(store, t("start.demo.film_name"), pendingDemo ? { id: pendingDemo.id, name: pendingDemo.name } : null);
      void films.reload();
      if (!film) return;
      if (!filled) {
        // The empty film stays listed. Another press fills it when that can help; with no stand-in Director here it cannot.
        const off = code === DEMO_UNAVAILABLE;
        saveDemo(off || demoRetryable(code) ? { id: film.id, name: film.name, off } : null);
        return;
      }
      saveDemo(null);
      remember(film);
      await showDemoFilm(store, film, origin);
    } finally {
      setDemoBusy(false);
    }
  };

  const rename = async (row: Row, name: string) => {
    const ok = await renameFilm(store, row.id, name);
    if (ok) { setRenaming(null); await films.reload(); }
    return ok;
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    setArchiveProblem(null);
    const done = await setArchived(store, archiving, true, true);
    await films.reload();
    if (done.ok) setArchiving(null);
    else setArchiveProblem(done.message);
  };

  const closeArchive = () => {
    setArchiving(null);
    setArchiveProblem(null);
  };

  const restore = async (film: Film) => {
    await setArchived(store, film, false);
    await films.reload();
  };

  const newFilm = (step: FirstStep | null) => setSheet({ step });

  const archivedRows = view?.archived ?? [];
  const head = view?.firstRun
    ? <div className="view-head"><h1 tabIndex={-1}>{t("start.welcome.title")}</h1><span className="line">{t(archivedRows.length ? "start.welcome.line_archived" : "start.welcome.line")}</span></div>
    : (
      <div className="view-head">
        <h1 tabIndex={-1}>{t("start.title")}</h1>
        {view && <span className="line">{tm(view.count)}</span>}
        <div className="actions">
          <button type="button" className="pill" data-act="open-demo" disabled={demoBusy || !!offline || !!demoOff} title={offline ?? demoOff ?? undefined} onClick={() => void demo()}>
            {demoBusy ? t("start.busy") : t("start.action.demo")}
          </button>
          <button type="button" className="pill" data-act="new-from-plan" disabled={!!planWhy || !!offline} title={offline ?? (planWhy ? t(planWhy) : undefined)} onClick={() => newFilm("plan")}>
            {t("start.action.from_plan")}
          </button>
          <button type="button" className="pill primary" data-act="new-film" disabled={!!offline} title={offline ?? undefined} onClick={() => newFilm(null)}>
            {t("start.action.new")}
          </button>
        </div>
      </div>
    );

  return (
    <main className="work start-view" data-view="start">
      {head}
      {!view && !films.error && <p className="start-note" role="status">{t("start.loading")}</p>}
      {!view && films.error && (
        <div className="start-note" role="alert">
          <span>{t("start.load_failed")} {tm(errorMsg(films.error))}</span>
          <button type="button" className="pill sm" data-act="reload-films" onClick={() => void films.reload()}>{t("start.retry")}</button>
        </div>
      )}
      {view?.firstRun && (
        <Welcome setup={setup} offline={offline} demoBusy={demoBusy} demoOff={demoOff} planWhy={planWhy} onDemo={() => void demo()} onNew={() => newFilm(null)} onFromPlan={() => newFilm("plan")} />
      )}
      {view && !view.firstRun && (
        <div className="films">
          {view.live.map((row) => (
            <FilmRow
              key={row.id}
              row={row}
              renaming={renaming === row.id}
              busy={!!pending[`start:rename:${row.id}`]}
              guard={{ offline }}
              onOpen={() => openFilm(row.id, row.openTo)}
              onStartRename={() => setRenaming(row.id)}
              onRename={(name) => rename(row, name)}
              onCancelRename={() => setRenaming(null)}
              onArchive={() => setArchiving({ id: row.id, name: row.name })}
            />
          ))}
        </div>
      )}
      {archivedRows.length > 0 && (
        <div className="archived">
          <button type="button" className="archived-toggle" data-act="toggle-archived" aria-expanded={showArchived} aria-controls={showArchived ? archivedId : undefined} onClick={() => setShowArchived((v) => !v)}>
            {t("start.archived.toggle", { count: archivedRows.length })}
          </button>
          {showArchived && (
            <ul id={archivedId} className="arch-list">
              {archivedRows.map((row) => (
                <li key={row.id} className="panel arch-row" data-film={row.id}>
                  <b>{row.name}</b>
                  <span>{tm(row.meta)}</span>
                  <button
                    type="button"
                    className="pill sm"
                    data-act="restore-film"
                    aria-label={t("start.archived.restore_label", { name: row.name })}
                    disabled={!!pending[`start:unarchive:${row.id}`] || !!offline}
                    title={offline ?? undefined}
                    onClick={() => void restore({ id: row.id, name: row.name })}
                  >
                    {t("start.archived.restore")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {archiving && (
        <ArchiveDialog
          film={archiving}
          current={archiving.id === projectId}
          running={archiving.id === projectId ? running : 0}
          busy={!!pending[`start:archive:${archiving.id}`]}
          offline={offline}
          problem={archiveProblem}
          onConfirm={() => void confirmArchive()}
          onCancel={closeArchive}
        />
      )}
      {sheet && (
        <NewFilmSheet
          initialStep={sheet.step}
          codex={codex}
          providers={catalog}
          offline={offline}
          onClose={() => setSheet(null)}
          onMade={onMade}
          onCreated={onCreated}
          onModelsChanged={providers.reload}
        />
      )}
    </main>
  );
}
