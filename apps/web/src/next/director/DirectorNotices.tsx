import { useI18n } from "../i18n/I18n.tsx";
import { modeLine, stopNotices } from "../model/director.ts";
import { useStore, useStudio } from "../store/react.tsx";

/** Under the header: the runtime mode line, the stopped banner with Continue, and the restart notice. */
export function DirectorNotices() {
  const { t, tm } = useI18n();
  const store = useStore();
  const director = useStudio((s) => s.director);
  const loadError = useStudio((s) => s.loadErrors.director);
  const overview = useStudio((s) => s.overview);
  const connected = useStudio((s) => s.connection === "connected");
  const resuming = useStudio((s) => !!s.pending["control:resume"]);
  const line = modeLine(director, loadError);
  const { stopped, restartCasualties } = stopNotices(overview);
  if (!line && !stopped && !restartCasualties) return null;
  return (
    <div className="dir-notices">
      {line && <p className={`dir-mode ${line.tone}`} data-mode={director?.mode ?? "unknown"}>{tm(line.message)}</p>}
      {stopped && (
        <section className="dir-banner" data-state="stopped" aria-live="polite">
          <p>{t("stop.banner", { sent: stopped.sent }).trim()}</p>
          {stopped.detached > 0 && <p>{t("stop.detached", { count: stopped.detached })}</p>}
          <div className="row">
            <button type="button" className="pill sm primary" data-act="continue" disabled={resuming || !connected} onClick={() => void store.continueFilm()}>
              {t("stop.continue")}
            </button>
          </div>
        </section>
      )}
      {restartCasualties > 0 && <p className="dir-banner" data-state="restart">{t("restart.casualties", { count: restartCasualties })}</p>}
    </div>
  );
}
