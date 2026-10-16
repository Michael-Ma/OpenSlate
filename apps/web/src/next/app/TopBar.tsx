import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { showStop } from "../model/shell-states.ts";
import { classicHref, connectionPill, filmHeading, otherLocale, searchWithLocale, shownView, showProjectPicker, tabKeyTarget, topBarMode, viewTabs } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { StopDialog } from "./StopDialog.tsx";
import { useNarrow } from "./useNarrow.ts";
import { useWriteGuard } from "./useWriteGuard.ts";

/** First control inside the Director drawer, so opening it puts the person where they will type. */
function focusIntoDirector() {
  const drawer = document.getElementById("director");
  const target = drawer?.querySelector<HTMLElement>("textarea, input, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
  target?.focus({ preventScroll: true });
}

function StopMark() {
  return <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><rect width="9" height="9" rx="1.5" fill="currentColor" /></svg>;
}

function Gear() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm6.1 3.6.1-.8-.1-.8 1.4-1.1-1.5-2.6-1.7.6a5.6 5.6 0 0 0-1.4-.8L10.6 1.5H7.6l-.3 1.8c-.5.2-1 .5-1.4.8l-1.7-.6-1.5 2.6L4 7.2 3.9 8l.1.8-1.4 1.1 1.5 2.6 1.7-.6c.4.3.9.6 1.4.8l.3 1.8h3l.3-1.8c.5-.2 1-.5 1.4-.8l1.7.6 1.5-2.6Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 52 px bar: the mark (all films), the film, view tabs, Stop while something runs, counts, connection (Synced,
 * Reconnecting, Offline), language, the classic studio, Settings and (narrow) the Director toggle. On Start no film
 * is open, so the bar names the films on this computer and drops the tabs, counts and Stop. `onNavigate` runs on
 * every tab, mark or Settings press, even for the view already shown (the shell puts the recovery review away so the
 * view shows).
 */
export function TopBar({ inert = false, expired = false, offline = false, onNavigate }: {
  inert?: boolean;
  expired?: boolean;
  /** The studio could not be reached (the shell's reachability check): the pill says Offline. */
  offline?: boolean;
  onNavigate?(): void;
}) {
  const store = useStore();
  const { t, tm, locale, setLocale } = useI18n();
  const name = useStudio((s) => s.snapshot?.project.name);
  const projects = useStudio((s) => s.projects);
  const projectId = useStudio((s) => s.projectId);
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const live = useStudio((s) => s.connection);
  const connection = expired ? "expired" : live;
  const view = useStudio(shownView);
  const directorOpen = useStudio((s) => s.directorOpen);
  const stopping = useStudio((s) => !!s.pending["control:stop"]);
  const narrow = useNarrow();
  const reachable = useWriteGuard().server;
  const heading = useMemo(() => filmHeading(name, projects, projectId, overview), [name, projects, projectId, overview]);
  const mode = topBarMode(view);
  const pill = connectionPill(connection, offline);
  const tabs = viewTabs(view);
  const stop = mode === "film" && showStop(overview, director, reachable, view);
  const [confirming, setConfirming] = useState(false);
  const go = (next: Parameters<typeof store.setView>[0]) => {
    onNavigate?.();
    store.setView(next);
  };
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(directorOpen);
  const nextLocale = otherLocale(locale);

  useEffect(() => {
    document.title = mode === "film" && heading.title ? t("shell.document_title", { film: heading.title }) : t("app.name");
  }, [mode, heading.title, t]);

  // When the drawer closes (Esc, Close, a shot opened from a note), focus comes back to the toggle
  // unless the person already moved it somewhere else.
  useEffect(() => {
    if (wasOpen.current && !directorOpen && narrow) {
      const active = document.activeElement;
      if (!active || active === document.body || document.getElementById("director")?.contains(active)) toggleRef.current?.focus();
    }
    wasOpen.current = directorOpen;
  }, [directorOpen, narrow]);

  // The work finished (or the studio went away) while the confirm was open: there is nothing left to stop.
  // After a confirmed Stop the pill goes away with the focus on it, so focus moves to the strip's Continue.
  const focusContinue = useRef(false);
  useEffect(() => {
    if (stop) return;
    setConfirming(false);
    if (!focusContinue.current) return;
    focusContinue.current = false;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      document.querySelector<HTMLElement>("[data-act='continue-film']")?.focus({ preventScroll: true });
    });
  }, [stop]);

  const toggleDirector = () => {
    const open = !directorOpen;
    store.setDirectorOpen(open);
    if (open) requestAnimationFrame(focusIntoDirector);
  };

  const switchLanguage = () => {
    const search = searchWithLocale(window.location.search, nextLocale);
    if (search !== null) {
      try { window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash); } catch { /* history unavailable */ }
    }
    setLocale(nextLocale);
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabRefs.current.findIndex((tab) => tab === event.target);
    const target = index < 0 ? null : tabKeyTarget(event.key, index, tabs.length);
    if (target === null) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
  };

  const confirmStop = () => {
    focusContinue.current = true;
    setConfirming(false);
    void store.stopFilm();
  };

  return (
    <>
    <header className="topbar" inert={inert} data-mode={mode}>
      <button type="button" className="brand" data-act="all-films" aria-label={t("shell.all_films")} aria-current={view === "start" ? "page" : undefined} onClick={() => go("start")}>
        <span className="logo" aria-hidden="true"><i /></span>
        <span className="word">{t("app.name")}</span>
      </button>
      <div className="film">
        {mode === "films" ? (
          <>
            <b>{t("shell.films")}</b>
            <span className="film-meta">{t("shell.films_meta")}</span>
          </>
        ) : showProjectPicker(projects) ? (
          <div className="film-pick-wrap">
            <select
              className="pill sm film-pick"
              data-act="project"
              aria-label={t("shell.project")}
              value={projectId ?? ""}
              onChange={(event) => void store.selectProject(event.target.value)}
            >
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </div>
        ) : (
          <b>{heading.title}</b>
        )}
        {mode === "film" && heading.meta && <span className="film-meta">{tm(heading.meta)}</span>}
      </div>
      {mode === "film" && (
        <div className="tabs" role="tablist" aria-label={t("shell.views")} onKeyDown={onTabKey}>
          {tabs.map((tab, index) => (
            <button
              key={tab.view}
              ref={(element) => { tabRefs.current[index] = element; }}
              type="button"
              role="tab"
              className="tab"
              data-act="tab"
              data-view={tab.view}
              aria-selected={tab.selected}
              tabIndex={tab.focusable ? 0 : -1}
              onClick={() => go(tab.view)}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
      )}
      <div className="top-right">
        {stop && (
          <button
            type="button"
            className="pill sm stop-btn"
            data-act="stop-film"
            data-needs="server"
            aria-haspopup="dialog"
            title={t("shell.stop_title")}
            disabled={stopping}
            onClick={() => setConfirming(true)}
          >
            <StopMark />
            {t("stop.button")}
          </button>
        )}
        {mode === "film" && heading.counts && <span className="counts">{tm(heading.counts)}</span>}
        <span className={`saved ${pill.tone}`} role="status" data-connection={connection}>{tm(pill.label)}</span>
        <button type="button" className="lang" data-act="language" lang={nextLocale} title={t("shell.language_label")} onClick={switchLanguage}>
          {t("shell.language")}
        </button>
        <a className="classic-link" data-act="classic" href={classicHref(window.location.search, view)}>{t("shell.classic")}</a>
        <button
          type="button"
          className="icon-btn settings-btn"
          data-act="settings"
          aria-label={t("shell.settings")}
          title={t("shell.settings")}
          aria-current={view === "settings" ? "page" : undefined}
          onClick={() => go("settings")}
        >
          <Gear />
        </button>
        <button
          ref={toggleRef}
          type="button"
          className="pill sm dir-toggle"
          data-act="toggle-director"
          aria-controls="director"
          aria-expanded={directorOpen}
          onClick={toggleDirector}
        >
          {t("shell.director_toggle")}
        </button>
      </div>
    </header>
    {confirming && <StopDialog onClose={() => setConfirming(false)} onStop={confirmStop} />}
    </>
  );
}
