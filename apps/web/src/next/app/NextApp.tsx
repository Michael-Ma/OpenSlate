import { useEffect } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { escClosesDrawer, NARROW_QUERY } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { NoFilms } from "./ClassicView.tsx";
import { Connect } from "./Connect.tsx";
import { TopBar } from "./TopBar.tsx";
import { Toast } from "./Toast.tsx";
import { useNarrow } from "./useNarrow.ts";
import { DirectorColumn } from "../director/DirectorColumn.tsx";
import { KeyframesView } from "../keyframes/KeyframesView.tsx";
import { AssetsView } from "../views/assets/AssetsView.tsx";
import { FilmView } from "../views/film/FilmView.tsx";
import { PlanView } from "../views/plan/PlanView.tsx";
import { SettingsView } from "../views/settings/SettingsView.tsx";
import { StartView } from "../views/start/StartView.tsx";
import "./shell.css";

/**
 * The shell from the chosen design: 52 px top bar, 392 px Director column, workspace.
 * Below 900 px the bar is sticky, the tabs take their own row and the Director becomes a drawer
 * that closes with Esc, Close or a tap beside it; while it is open the rest of the page is inert.
 */
export function NextApp({ onReconnect }: { onReconnect(): void }) {
  const store = useStore();
  const { locale } = useI18n();
  const connection = useStudio((s) => s.connection);
  const view = useStudio((s) => s.view);
  const directorOpen = useStudio((s) => s.directorOpen);
  const hasProject = useStudio((s) => !!s.projectId);
  const noFilms = useStudio((s) => s.connection !== "connecting" && s.projects.length === 0 && !s.projectId);
  const narrow = useNarrow();
  const drawer = narrow && directorOpen;

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => () => store.stop(), [store]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!escClosesDrawer(event, store.getState().directorOpen, window.matchMedia(NARROW_QUERY).matches)) return;
      event.preventDefault();
      store.setDirectorOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  if (connection === "expired" || connection === "failed" || (connection === "connecting" && !hasProject))
    return <Connect state={connection === "connecting" ? "connecting" : connection} onRetry={onReconnect} />;

  const workspace = noFilms ? <NoFilms />
    : view === "keyframes" ? <KeyframesView />
    : view === "plan" ? <PlanView />
    : view === "film" ? <FilmView />
    : view === "assets" ? <AssetsView />
    : view === "settings" ? <SettingsView />
    : <StartView />;
  return (
    <>
      <div className={`app${directorOpen ? " dir-open" : ""}`} data-ui="next">
        <TopBar inert={drawer} />
        <DirectorColumn />
        {/* display: contents, so the workspace stays the grid's second column. */}
        <div className="workspace-slot" inert={drawer}>{workspace}</div>
        {drawer && <div className="scrim" aria-hidden="true" onClick={() => store.setDirectorOpen(false)} />}
      </div>
      <Toast />
    </>
  );
}
