import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { backupLine, decisionPhase, nothingInFlight, RELEASE_PRESS, recoveryRows, reviewMode } from "../model/recovery.ts";
import { useStore, useStudio } from "../store/react.tsx";
import "./recovery.css";

/** Where focus goes after a decision: the control that now stands where the pressed one was, or the heading. */
function focusAfter(section: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (!section?.isConnected) return;
    const active = document.activeElement;
    if (active && active !== document.body && section.contains(active)) return;
    const target = section.querySelector<HTMLElement>("[data-act='recovery-retry'], [data-act='recovery-finish'], [data-act='recovery-check'], h1");
    target?.focus({ preventScroll: true });
  });
}

/**
 * The full-width recovery review, in place of the view while the studio is in review after a restore from backup:
 * when the backup was made and that later work may be missing, what the backup holds (films, known pending jobs,
 * uncertain jobs, local preparations not submitted, saved Director requests) and what happens to each, and Finish
 * recovery review, which releases exactly the receipt and summary on screen. A lost reply offers only Retry recovery
 * decision (the same key and body, so it cannot count twice); a summary that changed is said and shown again.
 * Once finished it says that every film stays stopped and how to continue. "Look around first" puts it away; the
 * strip in every view brings it back. Neutral surfaces: amber is the Director's, white the primary action.
 */
export function RecoveryReview({ onPutAway }: { onPutAway(): void }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const recovery = useStudio((s) => s.recovery);
  const sending = useStudio((s) => !!s.pending[RELEASE_PRESS]);
  const section = useRef<HTMLElement>(null);
  /** The button that sent the decision being sent: it keeps its name while busy, so focus and scripts stay on it. */
  const [pressed, setPressed] = useState<"recovery-finish" | "recovery-retry">("recovery-finish");
  const mode = reviewMode(recovery);

  // Finished: the decision area is gone, so the heading takes focus and is read out.
  useEffect(() => {
    if (mode === "released") section.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [mode]);

  if (mode === "none") return null;

  if (mode === "released")
    return (
      <main className="work recovery-work" data-view="recovery">
        <section ref={section} className="recovery-card" data-recovery="released" aria-labelledby="recovery-title">
          <p className="recovery-eyebrow"><span className="recovery-ok" aria-hidden="true">✓</span>{t("recovery.eyebrow")}</p>
          <h1 id="recovery-title" tabIndex={-1}>{t("recovery.done.title")}</h1>
          <p className="recovery-lead">{t("recovery.done.body")}</p>
          <p className="recovery-lead">{t("recovery.done.how")}</p>
          <div className="recovery-actions">
            <button
              type="button"
              className="pill primary"
              data-act="recovery-done"
              onClick={() => {
                store.dismissRecovery();
                onPutAway();
              }}
            >
              {t("recovery.done.ok")}
            </button>
          </div>
        </section>
      </main>
    );

  const status = recovery.status!;
  const rows = recoveryRows(status.counts);
  // ready: Finish; unconfirmed: only Retry (the same decision); sending: busy; unavailable: Check again.
  const phase = decisionPhase(recovery, sending);
  const number = new Intl.NumberFormat(numberLocale(locale));
  const send = (act: "recovery-finish" | "recovery-retry") => () => {
    if (sending) return;
    setPressed(act);
    void store.releaseRecovery().then(() => focusAfter(section.current));
  };

  return (
    <main className="work recovery-work" data-view="recovery">
      <section ref={section} className="recovery-card" data-recovery="review" aria-labelledby="recovery-title">
        <p className="recovery-eyebrow">{t("recovery.eyebrow")}</p>
        <h1 id="recovery-title" tabIndex={-1}>{t("recovery.title")}</h1>
        <p className="recovery-lead">{t("recovery.lead")}</p>
        <p className="recovery-backup" data-field="backup">{tm(backupLine(status, locale))}</p>

        <h2 className="recovery-sub" id="recovery-counts">{t("recovery.counts")}</h2>
        <dl className="recovery-counts" aria-labelledby="recovery-counts">
          {rows.map((row) => (
            <div key={row.key} className="recovery-row" data-count={row.key}>
              <dt>{t(row.label)}</dt>
              <dd className="n">{number.format(row.count)}</dd>
              {row.note && <dd className="what">{tm(row.note)}</dd>}
            </div>
          ))}
        </dl>
        {nothingInFlight(status.counts) && <p className="recovery-lead" data-note="nothing">{t("recovery.nothing")}</p>}

        <div className="recovery-decision">
          {recovery.stale && <p className="recovery-notice" role="alert" data-note="stale"><span className="ic" aria-hidden="true">!</span><span>{t("recovery.stale")}</span></p>}
          {phase === "unconfirmed" && (
            <p className="recovery-notice" role="status" data-note="unconfirmed"><span className="ic" aria-hidden="true">?</span><span>{t("recovery.unconfirmed")}</span></p>
          )}
          {phase === "unavailable" && <p className="recovery-notice" role="status" data-note="unavailable"><span className="ic" aria-hidden="true">!</span><span>{t("recovery.unavailable")}</span></p>}
          <p className="recovery-after" id="recovery-after">{t("recovery.after")}</p>
          <div className="recovery-actions">
            {phase === "sending" ? (
              // aria-disabled, not disabled, so focus stays on the button while the decision is sent.
              <button type="button" className="pill primary" data-act={pressed} aria-disabled="true" aria-busy="true">{t("recovery.finishing")}</button>
            ) : phase === "unconfirmed" ? (
              <button type="button" className="pill primary" data-act="recovery-retry" aria-describedby="recovery-after" onClick={send("recovery-retry")}>{t("recovery.retry")}</button>
            ) : phase === "ready" ? (
              <button type="button" className="pill primary" data-act="recovery-finish" aria-describedby="recovery-after" onClick={send("recovery-finish")}>{t("recovery.finish")}</button>
            ) : (
              <button type="button" className="pill" data-act="recovery-check" onClick={() => void store.readRecovery()}>{t("recovery.check")}</button>
            )}
            <button type="button" className="pill ghost" data-act="recovery-later" onClick={onPutAway}>{t("recovery.later")}</button>
          </div>
        </div>
      </section>
    </main>
  );
}
