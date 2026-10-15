import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { classicHref, connectionPill, filmHeading, otherLocale, searchWithLocale, showProjectPicker, tabKeyTarget, viewTabs } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useNarrow } from "./useNarrow.ts";

const CLASSIC_NOTE_ID = "shell-classic-note";

/** First control inside the Director drawer, so opening it puts the person where they will type. */
function focusIntoDirector() {
  const drawer = document.getElementById("director");
  const target = drawer?.querySelector<HTMLElement>("textarea, input, button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
  target?.focus({ preventScroll: true });
}

/** 52 px bar: brand, film, view tabs, counts, connection, language, classic link and (narrow) the Director toggle. */
export function TopBar({ inert = false }: { inert?: boolean }) {
  const store = useStore();
  const { t, tm, locale, setLocale } = useI18n();
  const name = useStudio((s) => s.snapshot?.project.name);
  const projects = useStudio((s) => s.projects);
  const projectId = useStudio((s) => s.projectId);
  const overview = useStudio((s) => s.overview);
  const connection = useStudio((s) => s.connection);
  const view = useStudio((s) => s.view);
  const directorOpen = useStudio((s) => s.directorOpen);
  const narrow = useNarrow();
  const heading = useMemo(() => filmHeading(name, projects, projectId, overview), [name, projects, projectId, overview]);
  const pill = connectionPill(connection);
  const tabs = viewTabs(view);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(directorOpen);
  const nextLocale = otherLocale(locale);

  useEffect(() => {
    document.title = heading.title ? t("shell.document_title", { film: heading.title }) : t("app.name");
  }, [heading.title, t]);

  // When the drawer closes (Esc, Close, a shot opened from a note), focus comes back to the toggle
  // unless the person already moved it somewhere else.
  useEffect(() => {
    if (wasOpen.current && !directorOpen && narrow) {
      const active = document.activeElement;
      if (!active || active === document.body || document.getElementById("director")?.contains(active)) toggleRef.current?.focus();
    }
    wasOpen.current = directorOpen;
  }, [directorOpen, narrow]);

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

  return (
    <header className="topbar" inert={inert}>
      <div className="brand">
        <span className="logo" aria-hidden="true"><i /></span>
        <span className="word">{t("app.name")}</span>
      </div>
      <div className="film">
        {showProjectPicker(projects) ? (
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
        {heading.meta && <span className="film-meta">{tm(heading.meta)}</span>}
      </div>
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
            tabIndex={tab.selected ? 0 : -1}
            aria-describedby={tab.classic ? CLASSIC_NOTE_ID : undefined}
            onClick={() => store.setView(tab.view)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
      <span id={CLASSIC_NOTE_ID} className="sr">{t("shell.tab.classic")}</span>
      <div className="top-right">
        {heading.counts && <span className="counts">{tm(heading.counts)}</span>}
        <span className={`saved ${pill.tone}`} role="status" data-connection={connection}>{tm(pill.label)}</span>
        <button type="button" className="lang" data-act="language" lang={nextLocale} title={t("shell.language_label")} onClick={switchLanguage}>
          {t("shell.language")}
        </button>
        <a className="classic-link" data-act="classic" href={classicHref(window.location.search, view)}>{t("shell.classic")}</a>
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
  );
}
