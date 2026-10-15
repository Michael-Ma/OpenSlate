import { useI18n } from "../i18n/I18n.tsx";
import type { MessageId } from "../i18n/messages.ts";
import { classicHref, viewLabel } from "../model/shell.ts";
import { useMode, useStore } from "../store/react.tsx";
import "./classic.css";

type ClassicViewName = "plan" | "assets" | "film";

const ABOUT: Record<ClassicViewName, MessageId> = {
  plan: "classic.about.plan",
  assets: "classic.about.assets",
  film: "classic.about.film",
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
 * Plan, Assets and Film are not designed for the new studio yet (plan decision D13): the workspace
 * names the view and links to the same view in the classic studio.
 */
export function ClassicView({ view }: { view: ClassicViewName }) {
  const { t } = useI18n();
  const store = useStore();
  const mode = useMode();
  const name = t(viewLabel(view));
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

/** Connected, but there is no film yet. Creating one is not designed in the new studio. */
export function NoFilms() {
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
