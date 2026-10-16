import type { AssetItem } from "@openslate/core/public";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNarrow } from "../../app/useNarrow.ts";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { importDoneMsg } from "../../model/assets-import.ts";
import {
  ALL_ASSETS,
  assetDetail,
  assetKey,
  assetLibrary,
  ROLE_FILTERS,
  tileFor,
  validFilters,
  type AssetFilters,
  type AssetTile,
  type RoleFilter,
} from "../../model/assets.ts";
import { msg } from "../../model/types.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import { AssetDetail } from "./AssetDetail.tsx";
import { AssetTileButton } from "./AssetTile.tsx";
import { ImportSheet, type ImportResult } from "./ImportSheet.tsx";
import { Sheet } from "./Sheet.tsx";
import { useAssetList } from "./useAssetList.ts";
import "./assets.css";

const EMPTY: AssetItem[] = [];
const ROLE_LABEL = {
  all: "assets.role.all", keyframe: "assets.role.keyframe", clip: "assets.role.clip", voice: "assets.role.voice",
  music: "assets.role.music", upload: "assets.role.upload", export: "assets.role.export",
} as const satisfies Record<RoleFilter, string>;

/**
 * The Assets view (SB-21, docs/ai/prototypes/last-ferry/assets.html): everything the film has made or
 * been given, on the shot it belongs to, with role and scene filters, a detail panel (a sheet on a
 * phone) and Import. Reads GET /assets; imports go through the studio's upload routes.
 */
export function AssetsView() {
  const { t } = useI18n();
  const overview = useStudio((s) => s.overview);
  const loadError = useStudio((s) => s.loadErrors.overview);
  if (!overview)
    return (
      <main className="work assets-work av-state" id="workspace" data-view="assets" data-state={loadError ? "missing" : "loading"} aria-busy={!loadError}>
        <div className="av-message" role={loadError ? "alert" : "status"}>{loadError ? t("assets.overview_missing", { code: loadError }) : t("assets.loading")}</div>
      </main>
    );
  return <Library />;
}

/**
 * After pointing the Director, the message is written in its composer: focus moves there (on a phone once its
 * drawer has opened, so the next few frames are tried).
 */
function focusComposer(tries = 12): void {
  requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>("#director textarea[data-field='message']");
    composer?.focus({ preventScroll: true });
    if (document.activeElement !== composer && tries > 1) focusComposer(tries - 1);
  });
}

function Library() {
  const store = useStore();
  const { t, tm, locale } = useI18n();
  const overview = useStudio((s) => s.overview)!;
  // A restored studio in recovery review is read-only (app/useWriteGuard.ts): its reason replaces the offline one.
  const locked = useRecoveryLock();
  const connected = useStudio((s) => s.connection === "connected") && !locked;
  const focus = useStudio((s) => s.focus);
  const narrow = useNarrow();
  const list = useAssetList();
  const items = list.items ?? EMPTY;

  // Another view may have asked for one kind of file (Film's earlier exports); it applies once, then the tab opens on all.
  const asked = useStudio((s) => s.assetsFilter);
  const [filters, setFilters] = useState<AssetFilters>(() => (asked ? { ...ALL_ASSETS, role: asked.role } : ALL_ASSETS));
  useEffect(() => {
    if (!asked) return;
    setFilters({ ...ALL_ASSETS, role: asked.role });
    store.dispatch({ type: "assetsFilter", role: null });
  }, [asked, store]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const groups = useRef<HTMLDivElement>(null);
  const roles = useRef<HTMLDivElement>(null);
  /** After "Try again" succeeds, focus moves to the first group (the button it pressed is gone). */
  const focusAfterLoad = useRef(false);

  const active = validFilters(filters, overview);
  const library = useMemo(() => assetLibrary(items, overview, active), [items, overview, active]);
  const selectedItem = useMemo(() => (selected ? items.find((item) => assetKey(item) === selected) ?? null : null), [items, selected]);
  const selectedTile = useMemo(() => (selectedItem ? tileFor(selectedItem, items, overview) : null), [selectedItem, items, overview]);
  const detail = useMemo(() => (selectedItem ? assetDetail(selectedItem, items, overview, new Date(), locale) : null), [selectedItem, items, overview, locale]);

  const select = useCallback((key: string) => {
    setSelected(key);
    if (window.matchMedia("(max-width: 899px)").matches) setSheet(true);
  }, []);

  // A shot or scene opened elsewhere (a Director note's "Open 2.2") is scrolled to here, like the study does,
  // even when it is opened again.
  const seenFocus = useRef(focus?.nonce);
  useEffect(() => {
    if (!focus || focus.nonce === seenFocus.current) return;
    seenFocus.current = focus.nonce;
    setFilters(ALL_ASSETS);
    requestAnimationFrame(() => {
      const target = document.getElementById(focus.kind === "shot" ? `av-set-${focus.id}` : `av-g-${focus.id}`);
      const set = focus.kind === "shot" ? target : target?.closest<HTMLElement>(".group");
      if (!set) return;
      set.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      set.classList.add("flash");
      setTimeout(() => set.classList.remove("flash"), 1600);
    });
  }, [focus]);

  // After an import, the new file is selected once the library lists it.
  useEffect(() => {
    if (!pendingId) return;
    const item = items.find((candidate) => candidate.artifact.artifactId === pendingId);
    if (!item) return;
    const key = assetKey(item);
    setPendingId(null);
    setSelected(key);
    requestAnimationFrame(() => groups.current?.querySelector(`[data-asset="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }));
  }, [pendingId, items]);

  useEffect(() => {
    if (!focusAfterLoad.current || !list.items) return;
    focusAfterLoad.current = false;
    requestAnimationFrame(() => groups.current?.querySelector<HTMLElement>(".group > h2")?.focus());
  }, [list.items]);

  const retry = () => {
    focusAfterLoad.current = true;
    list.reload();
  };

  /** Clear the filters; the "Show everything" button goes away, so focus moves to the All filter. */
  const showAll = () => {
    setFilters(ALL_ASSETS);
    requestAnimationFrame(() => roles.current?.querySelector<HTMLElement>("[data-role='all']")?.focus());
  };

  const imported = (result: ImportResult) => {
    // An import that finished in the background must not close a sheet opened since.
    if (!result.background) setImporting(false);
    setFilters(ALL_ASSETS);
    if (result.artifactId) setPendingId(result.artifactId);
    list.reload();
    store.dispatch({ type: "toast", message: importDoneMsg(result.kind, result.use, result.name), tone: "info" });
  };

  const point = () => {
    if (!detail?.point) return;
    store.pointAt(detail.point.target);
    setSheet(false);
    // On a phone the Director is a drawer: open it so the pointer is seen.
    if (narrow) store.setDirectorOpen(true);
    store.dispatch({ type: "toast", message: msg("assets.point.toast", { target: tm(detail.point.name) }), tone: "info" });
    focusComposer();
  };

  const open = () => {
    if (!detail?.open) return;
    if (detail.open.shotId) store.selectShot(detail.open.shotId);
    store.setView(detail.open.view);
  };

  const tiles = (group: AssetTile[]) => group.map((tile) => <AssetTileButton key={tile.key} tile={tile} selected={tile.key === selected} onSelect={select} />);
  const setRole = (role: RoleFilter) => setFilters((current) => ({ ...current, role }));

  return (
    <main className="work assets-work" id="workspace" data-view="assets" data-state={list.items ? "ready" : list.error ? "failed" : "loading"}>
      <div className="view-head">
        <h1 tabIndex={-1}>{t("assets.title")}</h1>
        <span className="line">{list.items ? t("assets.line", { count: list.total }) : ""}</span>
        <div className="actions">
          <button type="button" className="pill" data-act="import" disabled={!connected} title={!connected ? locked ?? t("assets.import.offline") : undefined} onClick={() => setImporting(true)}>{t("assets.import")}</button>
        </div>
      </div>

      <div className="filters">
        <div className="segctl" role="group" aria-label={t("assets.filter.kind")} ref={roles}>
          {ROLE_FILTERS.map((role) => (
            <button key={role} type="button" data-act="role-filter" data-role={role} aria-pressed={active.role === role} onClick={() => setRole(role)}>
              {t(ROLE_LABEL[role])} <span className="n">{library.counts[role]}</span>
            </button>
          ))}
        </div>
        <label className="sr" htmlFor="av-scene">{t("assets.filter.scene")}</label>
        <select className="select" id="av-scene" data-act="scene-filter" value={active.scene} onChange={(event) => setFilters((current) => ({ ...current, scene: event.target.value }))}>
          <option value="all">{t("assets.scene.all")}</option>
          <option value="film">{t("assets.scene.film")}</option>
          {overview.scenes.map((scene) => <option key={scene.sceneId} value={scene.sceneId}>{t("assets.scene.option", { n: scene.ordinal, title: scene.title || scene.purpose })}</option>)}
        </select>
        <span className="count" role="status">{list.items ? t("assets.showing", { shown: library.shown, total: list.total }) : ""}</span>
      </div>

      <div className="lib">
        <div className="groups" ref={groups}>
          {!list.items ? (
            <div className="panel empty-state" role={list.error ? "alert" : "status"} data-state={list.error ? "failed" : "loading"}>
              {list.error ? <>{t("assets.load_failed", { code: list.error })} <button type="button" className="pill sm" data-act="retry" onClick={retry}>{t("assets.retry")}</button></> : t("assets.loading")}
            </div>
          ) : (
            <>
              {library.film && (
                <section className="panel group" aria-labelledby="av-g-film" data-group="film">
                  <h2 id="av-g-film" tabIndex={-1}>{t("assets.film.title")}<span className="meta">{t("assets.film.meta")}</span></h2>
                  {library.film.tiles.length > 0 && (
                    <div className="shotset">
                      <div className="who"><b>{t("assets.film.who")}</b><span>{t("assets.film.who_sub")}</span></div>
                      <div className="tiles">{tiles(library.film.tiles)}</div>
                    </div>
                  )}
                  {library.film.noExports && (
                    <div className="empty-state" data-empty="exports">
                      {t("assets.film.no_exports")} <button type="button" className="linkish" data-act="open-film" onClick={() => store.setView("film")}>{t("assets.film.open_film")}</button>
                    </div>
                  )}
                </section>
              )}
              {library.scenes.map((scene) => (
                <section key={scene.sceneId} className="panel group" aria-labelledby={`av-g-${scene.sceneId}`} data-group={scene.sceneId}>
                  <h2 id={`av-g-${scene.sceneId}`} tabIndex={-1}><span className="sno" aria-hidden="true">{scene.ordinal}</span>{scene.title}<span className="meta">{t("assets.scene.meta", { n: scene.ordinal })}</span></h2>
                  {scene.sceneTiles.length > 0 && (
                    <div className="shotset">
                      <div className="who"><b>{t("assets.scene.whole")}</b></div>
                      <div className="tiles">{tiles(scene.sceneTiles)}</div>
                    </div>
                  )}
                  {scene.sets.map((set) => (
                    <div key={set.shotId} className="shotset" id={`av-set-${set.shotId}`} data-shot={set.shotId}>
                      <div className="who"><b>{set.label} {set.framing}</b><span>{set.purpose}</span></div>
                      <div className="tiles">{set.tiles.length ? tiles(set.tiles) : <span className="nothing">{t("assets.nothing_yet")}</span>}</div>
                    </div>
                  ))}
                </section>
              ))}
              {library.former.length > 0 && (
                <section className="panel group" aria-labelledby="av-g-former" data-group="former">
                  <h2 id="av-g-former" tabIndex={-1}>{t("assets.former.title")}<span className="meta">{t("assets.former.meta")}</span></h2>
                  <div className="shotset av-former"><div className="tiles">{tiles(library.former)}</div></div>
                </section>
              )}
              {library.nothingMatches && (
                <div className="panel empty-state" data-empty="filters">
                  {t("assets.no_match")} <button type="button" className="pill sm" data-act="show-all" onClick={showAll}>{t("assets.show_all")}</button>
                </div>
              )}
              {list.truncated && <p className="hint av-truncated">{t("assets.truncated", { count: items.length })}</p>}
            </>
          )}
        </div>
        {!narrow && (
          <aside className="panel detail" aria-label={t("assets.detail.aria")} data-asset={selected ?? undefined}>
            {detail && selectedTile
              ? <AssetDetail detail={detail} tile={selectedTile} headingId="av-detail-title" onPoint={point} onOpen={open} />
              : <div className="empty-state av-pick">{t("assets.detail.empty")}</div>}
          </aside>
        )}
      </div>

      {narrow && sheet && detail && selectedTile && (
        <Sheet labelledBy="av-sheet-title" onClose={() => setSheet(false)} className="av-detail-sheet" act="asset-sheet">
          <div className="sheet-head">
            <h2 id="av-sheet-title">{t("assets.detail.sheet_title")}</h2>
            <button type="button" className="pill sm" data-act="close-asset" onClick={() => setSheet(false)}>{t("assets.close")}</button>
          </div>
          <div className="sheet-body detail" data-asset={selected ?? undefined}>
            <AssetDetail detail={detail} tile={selectedTile} headingId="av-sheet-detail-title" onPoint={point} onOpen={open} />
          </div>
        </Sheet>
      )}
      {importing && <ImportSheet onClose={() => setImporting(false)} onImported={imported} />}
    </main>
  );
}
