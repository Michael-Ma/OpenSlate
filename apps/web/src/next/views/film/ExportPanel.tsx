import type { ExportView, GenerationOverview } from "@openslate/core/public";
import { useI18n } from "../../i18n/I18n.tsx";
import { EXPORT_SIZE, MAX_FILM_SECONDS, elapsedSeconds, panelState, readinessRows, whenMsg, whyNotReady, type MediaView } from "../../model/film-export.ts";
import { clock as formatClock } from "../../model/motion.ts";
import { useNow } from "./clock-hooks.ts";

interface Props {
  overview: GenerationOverview;
  view: ExportView | null;
  media: MediaView | null;
  /** The code of a failed /exports read (an older studio has no storyboard export). */
  error: string | null;
  writable: boolean;
  busy: { start: boolean; cancel: boolean; recover: boolean };
  onExport(): void;
  onCancel(exportId: string): void;
  onRecover(exportId: string): void;
}

/**
 * The Export panel (SB-16, SB-17, SB-18): readiness per shot with Clip and Voice columns, one Export button
 * whose summary says why it is off, rendering with elapsed time (no percentage exists), Cancel, and Check
 * again for an export a restart interrupted, which only looks for the finished file.
 */
export function ExportPanel({ overview, view, media, error, writable, busy, onExport, onCancel, onRecover }: Props) {
  const { t, tm, locale } = useI18n();
  const state = panelState(view, media);
  const rendering = state.kind === "rendering" ? state.record : null;
  const now = useNow(!!rendering);
  const readiness = view?.readiness ?? null;
  const demo = !!readiness?.demo;
  const offline = writable ? undefined : t("film.offline");
  const size = { width: EXPORT_SIZE.width, height: EXPORT_SIZE.height };

  let body;
  if (state.kind === "rendering") {
    const seconds = readiness?.seconds ?? 0;
    body = (
      <>
        <div className="big">{t("film.export.exporting")}<small>{t(state.record.demo ? "film.export.exporting_sub_demo" : "film.export.exporting_sub", { seconds, ...size })}</small></div>
        <div className="rendering" role="status">
          <span>{t("film.export.rendering")} · <b data-act="elapsed">{t("film.export.elapsed", { elapsed: formatClock(elapsedSeconds(state.record.startedAt, now)) })}</b></span>
          <div className="progress indet" role="progressbar" aria-label={t("film.export.progress")}><i /></div>
          <span>{t("film.export.no_percent")}</span>
        </div>
        <button type="button" className="pill go" data-act="cancel-export" disabled={!writable || busy.cancel} title={offline} onClick={() => onCancel(state.record.exportId)}>{t("film.export.cancel")}</button>
      </>
    );
  } else if (state.kind === "interrupted") {
    const started = whenMsg(state.record.startedAt, new Date(), locale);
    body = (
      <>
        <div className="big">{t("film.export.interrupted")}<small>{t("film.export.interrupted_sub", { time: started ? tm(started) : "" })}</small></div>
        <div className="impact cost" role="status"><span className="ic" aria-hidden="true">?</span><span>{t("film.export.interrupted_body")}</span></div>
        <button type="button" className="pill primary go" data-act="check-again" disabled={!writable || busy.recover} title={offline} onClick={() => onRecover(state.record.exportId)}>
          {busy.recover ? t("film.export.checking") : t("film.export.check")}
        </button>
        <button type="button" className="pill go" data-act="export-again" disabled={!writable || busy.start || !readiness?.ready} title={offline} onClick={onExport}>{t("film.export.again")}</button>
      </>
    );
  } else {
    const rows = readinessRows(overview, demo);
    const ready = !!readiness?.ready;
    const reasons = readiness && !ready ? whyNotReady(readiness, overview, locale) : [];
    const head = !readiness ? (
      <div className="big">{t("film.export.not_ready")}<small>{error ? t("film.export.unavailable", { code: error }) : t("film.loading")}</small></div>
    ) : ready ? (
      demo
        ? <div className="big">{t("film.export.ready_demo")}<small>{t("film.export.ready_demo_sub")}</small></div>
        : <div className="big">{t("film.export.ready")}<small>{t("film.export.ready_sub", { seconds: readiness.seconds })}</small></div>
    ) : (
      <div className="big">{t("film.export.not_ready")}<small data-act="why-not">{reasons.map((reason) => tm(reason)).join(t("film.why.sep"))}</small></div>
    );
    const seconds = readiness?.seconds ?? 0;
    body = (
      <>
        {head}
        {state.failed ? <div className="impact cost" role="status" data-act="export-failed"><span className="ic" aria-hidden="true">!</span><span>{tm(state.failed)}</span></div> : null}
        {state.cancelled ? <div className="hint" role="status" data-act="export-cancelled">{t("film.export.cancelled")}</div> : null}
        <div className="checks" role="table" aria-label={t("film.checks.label")}>
          <div role="row" className="checks-row">
            <span role="columnheader" className="h">{t("film.checks.shot")}</span>
            <span role="columnheader" className="h">{t("film.checks.clip")}</span>
            <span role="columnheader" className="h">{t("film.checks.voice")}</span>
          </div>
          {rows.map((row) => (
            <div role="row" className="checks-row" key={row.shotId} data-shot={row.shotId}>
              <b role="rowheader">{row.label}</b>
              <span role="cell" className={row.clip.tone === "ok" ? "y" : "n"}>{row.clip.tone === "ok" ? <span aria-hidden="true">✓ </span> : null}{tm(row.clip.text)}</span>
              <span role="cell" className={row.voice.tone === "ok" ? "y" : row.voice.text.id === "film.cell.no_line" ? "" : "n"}>{row.voice.tone === "ok" ? <span aria-hidden="true">✓ </span> : null}{tm(row.voice.text)}</span>
            </div>
          ))}
        </div>
        <div className="hint">{seconds <= MAX_FILM_SECONDS ? t("film.export.length", { seconds }) : t("film.export.free")}</div>
        <button
          type="button"
          className={`pill go${ready ? " primary" : ""}`}
          data-act="export"
          disabled={!ready || !writable || busy.start}
          title={offline}
          aria-describedby="fv-export-why"
          onClick={onExport}
        >
          {t(demo ? "film.export.button_demo" : "film.export.button")}
        </button>
        <div className="why" id="fv-export-why">
          {!writable ? t("film.offline") : ready ? (demo ? t("film.export.demo_stamp", size) : t("film.export.size", size)) : t("film.export.settle_first")}
        </div>
      </>
    );
  }

  return (
    <aside className="panel export" aria-label={t("film.export.eyebrow")} data-state={state.kind}>
      <div className="panel-head"><span className="eyebrow">{t("film.export.eyebrow")}</span></div>
      {body}
    </aside>
  );
}
