import { useI18n } from "../i18n/I18n.tsx";
import { canStop } from "../model/director.ts";
import { currentScene } from "../model/keyframes.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { Composer } from "./Composer.tsx";
import { DirectorNotices } from "./DirectorNotices.tsx";
import { Thread } from "./Thread.tsx";
import "./director.css";

/**
 * The 392 px Director column (a full-height drawer below 900 px): header with the current scene and
 * Stop, the mode and stop notices, the bottom-anchored thread, and the composer.
 * The shell owns the drawer: its toggle (aria-controls="director") moves focus in and back, and its
 * document Esc handler closes it. Close here is the only way out on phones, where the page behind is inert.
 */
export function DirectorColumn() {
  const { t } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const sceneId = useStudio((s) => s.sceneId);
  const view = useStudio((s) => s.view);
  const projectId = useStudio((s) => s.projectId);
  const connected = useStudio((s) => s.connection === "connected");
  const stopping = useStudio((s) => !!s.pending["control:stop"]);
  const scene = overview ? currentScene(overview, sceneId) : null;
  const stoppable = canStop(overview, director);

  return (
    <aside className="director" id="director" aria-label={t("director.title")}>
      <div className="dir-head">
        <span className="avatar" aria-hidden="true">{t("director.avatar")}</span>
        <b>{t("director.title")}</b>
        {/* The Director answers about what is on screen: the scene in Keyframes, the whole film elsewhere. */}
        <span className="scene">{!projectId ? t("director.scope.no_film") : view === "keyframes" && scene ? t("director.target.scene", { scene: scene.ordinal }) : t("director.scope.film")}</span>
        {stoppable && (
          <button type="button" className="pill sm dir-stop" data-act="stop" title={t("director.stop.title")} disabled={stopping || !connected} onClick={() => void store.stopFilm()}>
            {t("stop.button")}
          </button>
        )}
        <button type="button" className="pill sm dir-close" data-act="close-director" onClick={() => store.setDirectorOpen(false)}>{t("shell.close")}</button>
      </div>
      <DirectorNotices />
      <Thread />
      <Composer />
    </aside>
  );
}
