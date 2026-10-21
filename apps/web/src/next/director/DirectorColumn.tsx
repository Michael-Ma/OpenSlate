import { useState, type DragEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { headerScope, labelList } from "../model/director.ts";
import { currentScene } from "../model/keyframes.ts";
import { directorHasFilm, shownView } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { Composer } from "./Composer.tsx";
import { DirectorNotices } from "./DirectorNotices.tsx";
import { Thread } from "./Thread.tsx";
import { useComposerDraft } from "./useComposerDraft.ts";
import { useComposerUploads } from "./useComposerUploads.ts";
import { droppedFiles } from "../model/composer-files.ts";
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
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const composer = useStudio((s) => s.composer);
  const sceneId = useStudio((s) => s.sceneId);
  const view = useStudio(shownView);
  const hasFilm = useStudio(directorHasFilm);
  const scene = overview ? currentScene(overview, sceneId) : null;
  const draft = useComposerDraft();
  const uploads = useComposerUploads();
  // Files dragged over the column: the whole column takes them, with a quiet outline while they hover.
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const drop = hasFilm ? {
    onDragEnter: (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); setDragging(true); } },
    onDragOver: (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      uploads.attach(droppedFiles(Array.from(event.dataTransfer.items ?? []), event.dataTransfer.files));
    },
  } : {};
  const scope = headerScope({ hasFilm, sceneOrdinal: view === "keyframes" && scene ? scene.ordinal : null, composer, overview });
  const scopeText = scope.kind === "message" ? t("director.scope.points", { targets: labelList(scope.labels.map(tm), locale) }) : tm(scope.label);

  return (
    <aside className="director" id="director" aria-label={t("director.title")} data-film={hasFilm ? "open" : "none"} data-draft-ready={draft.ready} data-dragging={dragging ? "true" : undefined} {...drop}>
      <div className="dir-head">
        <span className="avatar" aria-hidden="true">{t("director.avatar")}</span>
        <b>{t("director.title")}</b>
        {/* What is on screen (the scene in Keyframes, the whole film elsewhere), or what the message being written points at. */}
        <span className="scene" data-scope={scope.kind} title={scopeText}>{scopeText}</span>
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
      <Composer hasFilm={hasFilm} restored={draft.restored} uploads={uploads} />
      {dragging ? <div className="dir-drop" aria-hidden="true"><span>{t("director.file.drop")}</span></div> : null}
    </aside>
  );
}
