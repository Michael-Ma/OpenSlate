import { useI18n } from "../i18n/I18n.tsx";
import { currentScene } from "../model/keyframes.ts";
import { directorHasFilm, shownView } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { Composer } from "./Composer.tsx";
import { DirectorNotices } from "./DirectorNotices.tsx";
import { Thread } from "./Thread.tsx";
import { useComposerDraft } from "./useComposerDraft.ts";
import "./director.css";

/**
 * The 392 px Director column (a full-height drawer below 900 px): header with the current scene, the mode
 * notice, the bottom-anchored thread, and the composer. Stop, the stopped strip with Continue and the restart
 * strip belong to the shell (top bar and workspace), so the column does not repeat them.
 * On Start no film is open: the column says the Director works inside a film and the composer is off.
 * The shell owns the drawer: its toggle (aria-controls="director") moves focus in and back, and its
 * document Esc handler closes it. Close here is the only way out on phones, where the page behind is inert.
 */
export function DirectorColumn() {
  const { t } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const sceneId = useStudio((s) => s.sceneId);
  const view = useStudio(shownView);
  const hasFilm = useStudio(directorHasFilm);
  const scene = overview ? currentScene(overview, sceneId) : null;
  const restored = useComposerDraft();

  return (
    <aside className="director" id="director" aria-label={t("director.title")} data-film={hasFilm ? "open" : "none"}>
      <div className="dir-head">
        <span className="avatar" aria-hidden="true">{t("director.avatar")}</span>
        <b>{t("director.title")}</b>
        {/* The Director answers about what is on screen: the scene in Keyframes, the whole film elsewhere. */}
        <span className="scene">{!hasFilm ? t("director.scope.no_film") : view === "keyframes" && scene ? t("director.target.scene", { scene: scene.ordinal }) : t("director.scope.film")}</span>
        <button type="button" className="pill sm dir-close" data-act="close-director" onClick={() => store.setDirectorOpen(false)}>{t("shell.close")}</button>
      </div>
      {hasFilm ? (
        <>
          <DirectorNotices />
          <Thread />
        </>
      ) : (
        <div className="thread" role="log" aria-label={t("director.thread")}>
          <div className="thread-body">
            <p className="dir-no-film" data-entry="no-film">{t("director.no_film")}</p>
          </div>
        </div>
      )}
      <Composer hasFilm={hasFilm} restored={restored} />
    </aside>
  );
}
