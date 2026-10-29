import { useI18n } from "../../i18n/I18n.tsx";
import { changeLookRequest, lookView } from "../../model/style-proposal.ts";
import type { ProjectSnapshot } from "../../model/types.ts";
import { useStore } from "../../store/react.tsx";
import "./cast.css";

/**
 * The film's look (decision 7) and, for a film with a song, the way to fit its shots to it. Change never sets a look
 * here: it puts the request in the Director's composer, and the Director answers with two or three looks to choose
 * from in the chat (the style proposal card). The person sends it, as any other message.
 */
export function LookPanel({ snapshot }: { snapshot: ProjectSnapshot }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const view = lookView(snapshot);
  const song = !!snapshot.project.soundtrack;
  const ask = () => {
    const request = tm(changeLookRequest(view));
    const current = store.getState().composer.text.trim();
    store.setComposerText(current ? `${current}\n${request}` : request);
    if (window.matchMedia?.("(max-width: 899px)").matches) store.setDirectorOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus());
  };
  return (
    <section className={`panel look${song ? " with-song" : ""}`} data-look={view.chosen ? "chosen" : "default"} aria-labelledby="look-title">
      <div className="look-main">
        <div className="panel-head">
          <span className="eyebrow" id="look-title">{t("style.eyebrow")}</span>
          <div className="end">
            <button type="button" className="pill sm" data-act="change-look" title={t("style.change_title")} onClick={ask}>{t(view.chosen ? "style.change" : "style.choose")}</button>
          </div>
        </div>
        <p className="look-label"><b>{"text" in view.label ? view.label.text : tm(view.label)}</b></p>
        {view.detail ? <p className="look-detail">{view.detail}</p> : <p className="hint">{t("style.default_hint")}</p>}
      </div>
      {song ? (
        <div className="look-song" data-act="song">
          <span className="eyebrow">{t("style.music")}</span>
          <p className="hint">{t("style.music.on")}</p>
          <button type="button" className="link-btn" data-act="fit-song-in-film" title={t("style.music.fit_title")} onClick={() => store.setView("film")}>{t("style.music.fit")} →</button>
        </div>
      ) : null}
    </section>
  );
}
