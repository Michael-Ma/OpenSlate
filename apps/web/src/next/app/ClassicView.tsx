import { useI18n } from "../i18n/I18n.tsx";
import type { MessageId } from "../i18n/messages.ts";
import { classicHref, hasNoFilms, shownView, viewLabel } from "../model/shell.ts";
import type { ViewName } from "../model/types.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import "./classic.css";

type ClassicViewName = Exclude<ViewName, "keyframes">;

const ABOUT: Record<ClassicViewName, MessageId> = {
  plan: "classic.about.plan",
  assets: "classic.about.assets",
  film: "classic.about.film",
  settings: "classic.about.settings",
  start: "classic.about.start",
};

function ClassicMark() {
  return (
    <svg className="classic-mark" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="6" y="9" width="28" height="22" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 15h28M13 9v6M20 9v6M27 9v6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * A view whose build in the new studio is still on its way (the phase P5 stubs) names itself and links to the
 * same view in the classic studio (plan decision D13); the top bar keeps its own link to the classic studio.
 * With no films at all the page is held on Start, so the panel says there is no film yet instead, without a way
 * back to Keyframes that would only land on Start again.
 * The panel names the view that is shown, so a stub that passes another view's name (Settings and Start reuse
 * Plan's) still reads as Settings or All films.
 */
export function ClassicView({ view: asked }: { view: ClassicViewName }) {
  const { t } = useI18n();
  const store = useStore();
  const mode = useMode();
  const noFilms = useStudio(hasNoFilms);
  const shown = useStudio(shownView);
  const view: ClassicViewName = shown === "keyframes" ? asked : shown;
  const name = t(viewLabel(view));
  if (noFilms) return <NoFilms />;
  return (
    <main className="classic-view" id="workspace" data-view={view}>
      <section className="classic-panel" aria-labelledby="classic-title">
        <ClassicMark />
        <h1 id="classic-title">{name}</h1>
        <p className="classic-about">{t(ABOUT[view])}</p>
        <p className="classic-note">{t("classic.note")}</p>
        {mode === "fixture" && <p className="classic-note">{t("classic.fixture_note")}</p>}
        <div className="classic-actions">
          <a className="pill primary" data-act="open-classic" href={classicHref(window.location.search, view)}>{t("classic.open", { view: name })}</a>
          <button type="button" className="pill ghost" data-act="back-to-keyframes" onClick={() => store.setView("keyframes")}>{t("classic.back")}</button>
        </div>
      </section>
    </main>
  );
}

/** Connected, but there is no film yet. Until the Start view is built, a film is created in the classic studio. */
function NoFilms() {
  const { t } = useI18n();
  return (
    <main className="classic-view" id="workspace" data-view="none">
      <section className="classic-panel" aria-labelledby="no-films-title">
        <ClassicMark />
        <h1 id="no-films-title">{t("start.no_projects")}</h1>
        <div className="classic-actions">
          <a className="pill primary" data-act="open-classic" href={classicHref(window.location.search, "plan")}>{t("classic.open_studio")}</a>
        </div>
      </section>
    </main>
  );
}
