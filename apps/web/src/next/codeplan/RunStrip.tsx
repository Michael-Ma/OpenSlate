import { useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { CEILING_PRESS, runStrip, TONE_CLASS, TONE_GLYPH } from "../model/code-plan.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useCodePlan } from "./CodePlanContext.tsx";
import { LimitEditor } from "./LimitEditor.tsx";
import { showWaitingChoice } from "./ChoiceCards.tsx";
import "./codeplan.css";

/**
 * Under the Director's header in a code-plan film: the run's state as a chip, the version it runs, and what it has
 * spent of its ceiling (with what is sent and not yet known). While a Director turn holds new paid work it says so.
 * At the ceiling it offers one more dollar, and the limit can be changed in place at any time; an error is said
 * plainly, in the pass's own words.
 */
export function CodePlanRunStrip() {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const { view, error, loading, reload } = useCodePlan();
  const guard = useGuarded("run");
  const raising = useStudio((s) => !!s.pending[CEILING_PRESS]);
  const [editing, setEditing] = useState(false);
  if (!view) {
    if (!error && !loading) return null;
    return (
      <section className="cp-run" aria-label={t("codeplan.run.label")} data-state={error ? "unread" : "loading"}>
        <p className="cp-run-note" role="status">{error ? t("codeplan.run.unread", { code: error }) : t("codeplan.run.loading")}</p>
        {error ? <button type="button" className="pill sm" data-act="code-plan-reload" onClick={reload}>{t("codeplan.run.retry")}</button> : null}
      </section>
    );
  }
  const strip = runStrip(view, numberLocale(locale));
  return (
    <section className="cp-run" aria-label={t("codeplan.run.label")} data-state={view.state} data-held={strip.held ? "true" : undefined}>
      <div className="cp-run-top">
        <span className={TONE_CLASS[strip.tone]} data-act="code-plan-state" data-run={view.state}>
          {strip.tone === "busy" ? <i className="cp-spin" aria-hidden="true" /> : TONE_GLYPH[strip.tone] ? <span aria-hidden="true">{TONE_GLYPH[strip.tone]}</span> : null}
          {tm(strip.status)}
        </span>
        {strip.waiting ? <button type="button" className="cp-limit-open" data-act="code-plan-show-choice" onClick={showWaitingChoice}>{t("codeplan.run.show_choice", { count: strip.waiting })}</button> : null}
        {view.planVersion !== null ? <span className="cp-run-ver">{t("codeplan.run.version", { version: view.planVersion })}</span> : null}
        <span className="cp-run-spend" data-act="code-plan-spend">{tm(strip.spend)}</span>
        {!editing ? <button type="button" className="cp-limit-open" data-act="code-plan-limit-open" aria-label={t("codeplan.limit.open_label")} {...guard} onClick={() => setEditing(true)}>{t("codeplan.limit.open")}</button> : null}
      </div>
      <div className="cp-meter" aria-hidden="true" data-level={strip.meter.level ?? undefined}>
        <i className="spent" style={{ width: `${strip.meter.spent * 100}%` }} />
        <i className="reserved" style={{ width: `${strip.meter.reserved * 100}%` }} />
      </div>
      {editing ? <LimitEditor view={view} onClose={() => setEditing(false)} /> : null}
      {strip.reviewingClips ? <p className="cp-run-note" role="status" data-act="code-plan-reviewing">{t("codeplan.run.reviewing", { count: strip.reviewingClips })}</p> : null}
      {strip.held ? <p className="cp-run-note" role="status" data-act="code-plan-held">{t("codeplan.run.held")}</p> : null}
      {strip.error !== null || view.state === "error" ? (
        <div className="cp-run-error" role="alert">
          <span className="mark" aria-hidden="true">!</span>
          <div>
            <b>{t("codeplan.run.error_title")}</b>
            {strip.error ? <pre className="cp-error-text">{strip.error}</pre> : null}
            <span>{t("codeplan.run.error_next")}</span>
          </div>
        </div>
      ) : null}
      {strip.raise ? (
        <div className="cp-run-raise">
          <p>{t("codeplan.run.raise_why", { ceiling: strip.raise.ceiling })}</p>
          <button
            type="button"
            className="pill sm primary"
            data-act="code-plan-raise"
            {...guard}
            disabled={guard.disabled || raising}
            aria-busy={raising || undefined}
            onClick={() => { if (strip.raise) void store.setCodePlanCeiling(view, strip.raise.body); }}
          >
            {tm(strip.raise.label)}
          </button>
          <span className="cp-hint">{t("codeplan.run.raise_hint")}</span>
        </div>
      ) : null}
    </section>
  );
}

