import type { ExportView, GenerationOverview } from "@openslate/core/public";
import { useI18n } from "../../i18n/I18n.tsx";
import { EXPORT_SIZE, MAX_FILM_SECONDS, elapsedSeconds, filmSeconds, panelState, readinessRows, unavailableMsg, whenMsg, whyNotReady, type MediaView } from "../../model/film-export.ts";
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
  /** The film's music is missing or unmeasured, which stops the readiness read: open Change music. */
  onChangeMusic(anchor: HTMLElement): void;
}

/**
 * The Export panel (SB-16, SB-17, SB-18): readiness per shot with Clip and Voice columns, one Export button
 * whose summary says why it is off, rendering with elapsed time (no percentage exists), Cancel, and Check
 * again for an export a restart interrupted, which only looks for the finished file.
 */
export function ExportPanel({ overview, view, media, error, writable, busy, onExport, onCancel, onRecover, onChangeMusic }: Props) {
  const { t, tm, locale } = useI18n();
  // The clock ticks while the record says rendering: elapsed time, and a prepared export that never started.
  const now = useNow(view?.current?.state === "rendering");
  const state = panelState(view, media, now);
  const readiness = view?.readiness ?? null;
  const demo = !!readiness?.demo;
  const offline = writable ? undefined : t("film.offline");
  // Stopped turns off what would start work, and the title says why (P5-DESIGN shell change 8).
  // Exports render on this computer and spend nothing, so Stop does not turn them off (card B12).
  const startOff = offline;
  const size = { width: EXPORT_SIZE.width, height: EXPORT_SIZE.height };

  let body;
  if (state.kind === "rendering") {
    const seconds = readiness?.seconds ?? filmSeconds(overview);
    body = (
      <>
        <div className="big">{t("film.export.exporting")}<small>{t(state.record.demo ? "film.export.exporting_sub_demo" : "film.export.exporting_sub", { seconds, ...size })}</small></div>
        <div className="rendering">
          {/* Only the words are a live region: the elapsed time changes every second and is read on demand. */}
          <span><span role="status">{t("film.export.rendering")}</span> · <b data-act="elapsed">{t("film.export.elapsed", { elapsed: formatClock(elapsedSeconds(state.record.startedAt, now)) })}</b></span>
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
        <button type="button" className="pill go" data-act="export-again" disabled={!writable || busy.start || !readiness?.ready} title={startOff} onClick={onExport}>{t("film.export.again")}</button>
      </>
    );
  } else {
    const rows = readinessRows(overview, demo);
    const ready = !!readiness?.ready;
    const reasons = readiness && !ready ? whyNotReady(readiness, overview, locale) : [];
    const unavailable = !readiness && error ? unavailableMsg(error) : null;
    const head = !readiness ? (
      <div className="big">{t("film.export.not_ready")}<small data-act="export-unavailable">{unavailable ? tm(unavailable.text) : t("film.loading")}</small></div>
    ) : ready ? (
      demo
        ? <div className="big">{t("film.export.ready_demo")}<small>{t("film.export.ready_demo_sub")}</small></div>
        : <div className="big">{t("film.export.ready")}<small>{t("film.export.ready_sub", { seconds: readiness.seconds })}</small></div>
    ) : (
      <div className="big">{t("film.export.not_ready")}<small data-act="why-not">{reasons.map((reason) => tm(reason)).join(t("film.why.sep"))}</small></div>
    );
    // Without a readiness read (older studio, missing music) the length still comes from the storyboard.
    const seconds = readiness?.seconds ?? filmSeconds(overview);
    body = (
      <>
        {head}
        {unavailable?.music ? (
          <button type="button" className="pill sm" data-act="export-music" aria-haspopup="menu" disabled={!writable} title={offline} onClick={(event) => onChangeMusic(event.currentTarget)}>{t("film.tools.change_music")}</button>
        ) : null}
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
        <div className="hint" data-act="export-size">{seconds <= MAX_FILM_SECONDS ? t("film.export.length", { seconds, ...size }) : t("film.export.free", size)}</div>
        <button
          type="button"
          className={`pill go${ready ? " primary" : ""}`}
          data-act="export"
          disabled={!ready || !writable || busy.start}
          title={startOff}
          aria-describedby="fv-export-why"
          onClick={onExport}
        >
          {t(demo ? "film.export.button_demo" : "film.export.button")}
        </button>
        <div className="why" id="fv-export-why">
          {!writable ? t("film.offline") : !readiness ? null : !ready ? t("film.export.settle_first") : demo ? t("film.export.demo_stamp") : t("film.export.size")}
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
