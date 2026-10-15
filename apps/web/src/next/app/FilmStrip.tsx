import { useI18n } from "../i18n/I18n.tsx";
import { listLabels } from "../model/keyframes.ts";
import { continuedToast, restartTitle, stoppedLines, type FilmStrip as Strip } from "../model/shell-states.ts";
import { msg } from "../model/types.ts";
import { useStore, useStudio } from "../store/react.tsx";

function StoppedMark() {
  return <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><rect width="9" height="9" rx="1.5" fill="currentColor" /></svg>;
}

/**
 * One strip at the top of the workspace for a film-wide state, the same in every view: offline (Try now),
 * stopped (what finishes and is charged, what was taken off, Continue) or restart casualties (Show, Dismiss).
 * Neutral surface with a white icon; Continue is the primary action, so it is white.
 */
export function FilmStrip({ strip, onRetry, onDismissRestart }: { strip: Strip; onRetry(): void; onDismissRestart(key: string): void }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const connected = useStudio((s) => s.connection === "connected");
  const resuming = useStudio((s) => !!s.pending["control:resume"]);

  if (strip.kind === "offline")
    return (
      <section className="film-strip" data-strip="offline" aria-label={t("strip.offline.title")}>
        <span className="ic" aria-hidden="true">!</span>
        <p className="txt"><b>{t("strip.offline.title")}</b> <span>{t("strip.offline.body")}</span></p>
        <div className="acts">
          <button type="button" className="pill sm" data-act="retry-now" onClick={onRetry}>{t("strip.offline.retry")}</button>
        </div>
      </section>
    );

  if (strip.kind === "stopped") {
    const lines = stoppedLines(strip);
    const resume = async () => {
      const receipt = await store.continueFilm();
      if (receipt !== undefined) store.dispatch({ type: "toast", message: continuedToast(strip.detached), tone: "info" });
    };
    return (
      <section className="film-strip" data-strip="stopped" aria-label={t("strip.stopped.title")}>
        <span className="ic" aria-hidden="true"><StoppedMark /></span>
        <p className="txt"><b>{t("strip.stopped.title")}</b>{lines.length > 0 && <> <span>{lines.map((line) => tm(line)).join(" ")}</span></>}</p>
        <div className="acts">
          <button type="button" className="pill sm primary" data-act="continue-film" disabled={resuming || !connected} onClick={() => void resume()}>
            {t("stop.continue")}
          </button>
        </div>
      </section>
    );
  }

  const { restart } = strip;
  const first = restart.first;
  const show = () => {
    if (!first) return;
    store.setView("keyframes");
    store.selectShot(first.shotId);
  };
  return (
    <section className="film-strip" data-strip="restart" aria-label={tm(msg("strip.restart.jobs", { count: restart.count }))}>
      <span className="ic" aria-hidden="true">?</span>
      <p className="txt">
        <b>{tm(restartTitle(restart, (labels) => listLabels(labels, locale)))}</b> <span>{t("strip.restart.body", { count: restart.count })}</span>
      </p>
      <div className="acts">
        {first && <button type="button" className="pill sm" data-act="show-casualty" data-shot={first.shotId} onClick={show}>{t("strip.restart.show", { shot: first.label })}</button>}
        <button type="button" className="pill sm ghost" data-act="dismiss-restart" onClick={() => onDismissRestart(restart.key)}>{t("shell.dismiss")}</button>
      </div>
    </section>
  );
}
