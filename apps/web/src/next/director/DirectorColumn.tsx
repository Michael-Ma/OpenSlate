import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { canStop } from "../model/director.ts";
import { currentScene } from "../model/keyframes.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { Composer } from "./Composer.tsx";
import { DirectorNotices } from "./DirectorNotices.tsx";
import { isNarrow } from "./narrow.ts";
import { Thread } from "./Thread.tsx";
import "./director.css";

/**
 * The 392 px Director column (a full-height drawer below 900 px): header with the current scene and
 * Stop, the mode and stop notices, the bottom-anchored thread, and the composer.
 */
export function DirectorColumn() {
  const { t } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const sceneId = useStudio((s) => s.sceneId);
  const directorOpen = useStudio((s) => s.directorOpen);
  const connected = useStudio((s) => s.connection === "connected");
  const stopping = useStudio((s) => !!s.pending["control:stop"]);
  const scene = overview ? currentScene(overview, sceneId) : null;
  const stoppable = canStop(overview, director);

  const close = () => {
    store.setDirectorOpen(false);
    // Hand focus back to whatever opens the drawer, so it is not lost inside the hidden column.
    document.querySelector<HTMLElement>('[aria-controls="director"]')?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented && directorOpen && isNarrow()) close();
  };

  return (
    <aside className="director" id="director" aria-label={t("director.title")} onKeyDown={onKeyDown}>
      <div className="dir-head">
        <span className="avatar" aria-hidden="true">{t("director.avatar")}</span>
        <b>{t("director.title")}</b>
        <span className="scene">{scene ? t("director.target.scene", { scene: scene.ordinal }) : null}</span>
        {stoppable && (
          <button type="button" className="pill sm dir-stop" data-act="stop" title={t("director.stop.title")} disabled={stopping || !connected} onClick={() => void store.stopFilm()}>
            {t("stop.button")}
          </button>
        )}
        <button type="button" className="pill sm dir-close" data-act="close-director" onClick={close}>{t("shell.close")}</button>
      </div>
      <DirectorNotices />
      <Thread />
      <Composer />
    </aside>
  );
}
