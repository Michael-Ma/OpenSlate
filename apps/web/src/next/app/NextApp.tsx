import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { carryFrom, carryReady, carryToApply, filmStrip, reconnectedToast, writeGuard, type Carry } from "../model/shell-states.ts";
import { msg } from "../model/types.ts";
import { connectScreen, escClosesDrawer, NARROW_QUERY, searchWithView, shownView } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import type { StudioStore } from "../store/store.ts";
import { Connect } from "./Connect.tsx";
import { ExpiredDialog } from "./ExpiredDialog.tsx";
import { FilmStrip } from "./FilmStrip.tsx";
import { TopBar } from "./TopBar.tsx";
import { Toast } from "./Toast.tsx";
import { useNarrow } from "./useNarrow.ts";
import { useOffline } from "./useOffline.ts";
import { WriteGuardContext } from "./useWriteGuard.ts";
import { DirectorColumn } from "../director/DirectorColumn.tsx";
import { KeyframesView } from "../keyframes/KeyframesView.tsx";
import { AssetsView } from "../views/assets/AssetsView.tsx";
import { FilmView } from "../views/film/FilmView.tsx";
import { PlanView } from "../views/plan/PlanView.tsx";
import { SettingsView } from "../views/settings/SettingsView.tsx";
import { StartView } from "../views/start/StartView.tsx";
import "./shell.css";

/**
 * Put the unsent message, its chips and the person's place back once the new session has the same film open.
 * Returns a cleanup that stops waiting.
 */
function restoreCarry(store: StudioStore, carry: Carry, done: () => void): () => void {
  const attempt = () => {
    const state = store.getState();
    const step = carryReady(carry, state);
    if (step === "wait") return;
    unsubscribe();
    done();
    if (step === "drop" || !state.overview) return;
    const keep = carryToApply(carry, state.overview);
    store.setView(keep.view);
    if (keep.sceneId) store.selectScene(keep.sceneId);
    if (keep.shotId) store.selectShot(keep.shotId);
    if (!store.getState().composer.text && keep.text) store.setComposerText(keep.text);
    for (const target of keep.targets) store.pointAt(target);
    store.dispatch({ type: "toast", message: reconnectedToast(keep), tone: "info" });
  };
  const unsubscribe = store.subscribe(attempt);
  attempt();
  return unsubscribe;
}

/**
 * The shell from the chosen design: 52 px top bar, 392 px Director column (320 px from 900 to 1279 px),
 * the film-wide strip and the workspace. Below 900 px the bar is sticky, the tabs take their own row and the
 * Director becomes a drawer that closes with Esc, Close or a tap beside it; while it is open the rest of the
 * page is inert. An expired session is a dialog over the page; only a window that never loaded a film list
 * gets the full Connect screen.
 *
 * The shell also owns the film-wide write guard (offline, expired, stopped) that every view reads through
 * useWriteGuard, and carries the unsent message and the person's place into whatever session replaces this one.
 * The view on screen is kept in the address (`?view=plan`), so a reload or a link reopens it.
 */
export function NextApp({ onReconnect }: { onReconnect(): Promise<boolean> }) {
  const store = useStore();
  const { locale } = useI18n();
  const screen = useStudio(connectScreen);
  const connection = useStudio((s) => s.connection);
  const view = useStudio(shownView);
  const directorOpen = useStudio((s) => s.directorOpen);
  const overview = useStudio((s) => s.overview);
  const narrow = useNarrow();
  const drawer = narrow && directorOpen;
  const { offline, check } = useOffline(store, connection === "reconnecting");
  const [dismissedRestart, setDismissedRestart] = useState<string | null>(null);
  const strip = filmStrip({ view, offline, overview, dismissedRestart });
  // An expired session stays expired for this store: the open event stream may still report "connected" for a
  // while and the store would flip back, but nothing works until a new session replaces the store.
  const [expiredFor, setExpiredFor] = useState<StudioStore | null>(null);
  useEffect(() => { if (connection === "expired") setExpiredFor(store); }, [connection, store]);
  const expired = screen === null && (connection === "expired" || expiredFor === store);
  const stopped = !!overview?.stopped;
  const guard = useMemo(() => writeGuard({ offline, expired, stopped }), [offline, expired, stopped]);
  /** The unsent message and place of the store that was replaced, and which store that was. */
  const carry = useRef<{ from: StudioStore; carry: Carry } | null>(null);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  // The view on screen goes into the address (`?view=plan`), so a reload or a shared link opens it again.
  useEffect(() => {
    if (screen) return;
    const search = searchWithView(window.location.search, view);
    if (search === window.location.search) return;
    try { window.history.replaceState(window.history.state, "", window.location.pathname + search + window.location.hash); } catch { /* history unavailable */ }
  }, [view, screen]);
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

  // Whatever replaces this store (Try again in the expired dialog, or a launcher reusing the window with a new
  // #connect= link) takes the unsent message and the person's place along; an earlier carry nobody took yet stays.
  useEffect(() => () => {
    const kept = carryFrom(store.getState());
    if (kept) carry.current = { from: store, carry: kept };
  }, [store]);

  // The new session gets them back once it has the same film open.
  useEffect(() => {
    const pending = carry.current;
    if (!pending) return;
    // React's development double effect saved this same store's state: nothing was replaced.
    if (pending.from === store) { carry.current = null; return; }
    return restoreCarry(store, pending.carry, () => { carry.current = null; });
  }, [store]);

  // Say so when the studio can be reached again after the offline strip was up.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) { wasOffline.current = true; return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    if (!expired) store.dispatch({ type: "toast", message: msg("strip.offline.back"), tone: "info" });
  }, [offline, expired, store]);

  const reconnect = useCallback(() => onReconnect(), [onReconnect]);

  // The event stream reconnects on its own with a growing delay; Try now asks it to try at once, and a plain read
  // asks whether the studio is there.
  const retryNow = useCallback(() => {
    store.reconnect();
    check();
  }, [store, check]);

  if (screen) return <Connect state={screen} onRetry={() => void onReconnect()} />;

  const workspace = view === "keyframes" ? <KeyframesView />
    : view === "plan" ? <PlanView />
    : view === "film" ? <FilmView />
    : view === "assets" ? <AssetsView />
    : view === "settings" ? <SettingsView />
    : <StartView />;
  return (
    <WriteGuardContext.Provider value={guard}>
      <div className={`app${directorOpen ? " dir-open" : ""}`} data-ui="next" data-view={view}>
        <TopBar inert={drawer} expired={expired} offline={offline} />
        <DirectorColumn />
        {/* display: contents, so the strip and the view are the grid's second column. */}
        <div className="workspace-slot" inert={drawer}>
          <div className="film-strip-slot" role="status" data-strip={strip?.kind ?? "none"}>
            {strip && <FilmStrip strip={strip} onRetry={retryNow} onDismissRestart={setDismissedRestart} />}
          </div>
          {workspace}
        </div>
        {drawer && <div className="scrim" aria-hidden="true" onClick={() => store.setDirectorOpen(false)} />}
      </div>
      <Toast />
      {expired && <ExpiredDialog onRetry={reconnect} />}
    </WriteGuardContext.Provider>
  );
}
