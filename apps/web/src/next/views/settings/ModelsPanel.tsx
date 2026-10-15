import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ApiError } from "../../api/client.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { errorMsg } from "../../i18n/translate.ts";
import { applyRequest, choiceFor, impactOf, modelRows, previewRequest, previewUsable, sharedRequest, type MediaKind, type ModelApplyResult, type ModelPreview, type ModelRow, type ModelSettingsStatus } from "../../model/settings.ts";
import { DEMO_VALUE, codexState, directorRequest, directorRow, selectionFor, type DirectorChoice, type DirectorSetup } from "../../model/settings-director.ts";
import { msg, type Msg } from "../../model/types.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { Panel, ReadState, ReadyMark } from "./parts.tsx";

/**
 * A media switch in progress: checking → ready → applying. It fails (no preview: try again) or goes stale
 * (the server refused the apply, or the film moved on since the check: check again).
 */
interface MediaPending {
  job: MediaKind;
  value: string;
  phase: "checking" | "ready" | "applying" | "failed" | "stale";
  preview: ModelPreview | null;
  /** The studio's event cursor when the check was sent; any later event may change the work it covers. */
  checkedAt: number;
}

type Pending = { job: "director"; value: string } | MediaPending;

/** One press per job and choice, so picking another model while one is being checked is never blocked. */
const PREVIEW_PRESS = (kind: MediaKind, value: string) => `settings:preview:${kind}:${value}`;
const APPLY_PRESS = "settings:models:apply";
export const DIRECTOR_PRESS = "settings:director";

/**
 * Models: one row per job with its model, host-configured estimate and readiness (D15). Changing a select
 * first shows what the switch affects (the server's preview); nothing changes until Switch.
 */
export function ModelsPanel({ models, setup, film, offline }: {
  models: Resource<ModelSettingsStatus>;
  setup: Resource<DirectorSetup>;
  film: string;
  offline: string | null;
}) {
  const store = useStore();
  const { t, tm, locale } = useI18n();
  const overview = useStudio((s) => s.overview);
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const presses = useStudio((s) => s.pending);
  const labels = useMemo(() => Object.fromEntries(Object.values(overview?.shots ?? {}).map((shot) => [shot.shotId, shot.label])), [overview]);
  const rows = useMemo(() => (models.data ? modelRows(models.data, locale) : null), [models.data, locale]);
  const director = useMemo(() => (setup.data ? directorRow(setup.data) : null), [setup.data]);
  const [pending, setPending] = useState<Pending | null>(null);
  const token = useRef(0);
  /** Previews on their way, by press: choosing A, then B, then A again waits for A's first check instead of failing. */
  const inflight = useRef(new Map<string, { promise: Promise<ModelPreview | undefined>; checkedAt: number }>());
  const applying = !!presses[APPLY_PRESS] || !!presses[DIRECTOR_PRESS];

  // Once the saved choice is the pending one (a reply that was lost, another tab), the switch is done.
  useEffect(() => {
    if (!pending) return;
    const saved = pending.job === "director" ? director?.selected : models.data?.selected[pending.job];
    if (saved === pending.value) { token.current++; setPending(null); }
  }, [pending, director, models.data]);

  const focusSelect = (job: string) => requestAnimationFrame(() => document.getElementById(`set-m-${job}`)?.focus());
  const cursorNow = () => { const s = store.getState(); return s.overview?.cursor ?? s.snapshot?.cursor ?? 0; };

  const sendPreview = (status: ModelSettingsStatus, kind: MediaKind, value: string) => {
    const id = PREVIEW_PRESS(kind, value);
    return sharedRequest(inflight.current, id, () => {
      const request = previewRequest(status, kind, value);
      return { checkedAt: cursorNow(), promise: store.command<ModelPreview>(id, request.body, () => request) };
    });
  };

  /** What switching `kind` to `value` affects. `fresh` re-reads the settings first (Try again, Check again). */
  const check = async (kind: MediaKind, value: string, fresh = false) => {
    const mine = ++token.current;
    setPending({ job: kind, value, phase: "checking", preview: null, checkedAt: cursorNow() });
    let status = models.data;
    if (fresh) {
      status = await store.read<ModelSettingsStatus>("/settings/models").catch((error: unknown) => {
        store.dispatch({ type: "toast", message: errorMsg(error instanceof ApiError ? error.code : "NETWORK_ERROR"), tone: "error" });
        return null;
      });
      models.reload();
      if (token.current !== mine) return;
    }
    if (!status) { setPending({ job: kind, value, phase: "failed", preview: null, checkedAt: cursorNow() }); return; }
    if (status.selected[kind] === value) { setPending(null); return; }
    const { promise, checkedAt } = sendPreview(status, kind, value);
    const preview = await promise;
    if (token.current !== mine) return;
    setPending({ job: kind, value, phase: preview ? "ready" : "failed", preview: preview ?? null, checkedAt });
  };

  const choose = (job: "director" | MediaKind, current: string | null) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    token.current++;
    if (value === current) { setPending(null); return; }
    if (job === "director") setPending({ job, value });
    else void check(job, value);
  };

  const cancel = () => {
    const job = pending?.job;
    token.current++;
    setPending(null);
    if (job) focusSelect(job);
  };

  const applyMedia = async (row: ModelRow, shown: MediaPending, preview: ModelPreview) => {
    const choice = choiceFor(row, preview.selected[row.kind]);
    const toast = choice ? msg("set.toast.model_switched", { job: t(row.job), model: tm(choice.name) }) : undefined;
    const request = applyRequest(preview);
    const mine = ++token.current;
    setPending({ ...shown, phase: "applying" });
    const result = await store.command<ModelApplyResult>(APPLY_PRESS, request.body, () => request, toast);
    if (!result) {
      // Refused (the film or its settings moved on) or unanswered: the same Switch would fail the same way,
      // so the row asks for a fresh check instead. The toast says why.
      if (token.current === mine) setPending({ ...shown, phase: "stale" });
      return;
    }
    // The saved choice may already have cleared the row (its event can arrive before this reply).
    if (token.current === mine) { token.current++; setPending(null); }
    models.reload();
    focusSelect(row.kind);
  };

  const applyDirector = async (value: string, choice: DirectorChoice | null) => {
    const current = setup.data;
    if (!current) return;
    const request = directorRequest(current, selectionFor(current, value));
    const toast = value === DEMO_VALUE ? msg("set.toast.director_demo") : msg("set.toast.director_switched", { model: choice?.model ?? "" });
    const result = await store.command<DirectorSetup>(DIRECTOR_PRESS, request.body, () => request, toast);
    if (!result) return;
    setPending(null);
    setup.reload();
    focusSelect("director");
  };

  const directorName = (choice: DirectorChoice): string => (choice.model ? t("set.model.codex", { model: choice.model }) : t("set.model.demo_director"));
  const optionText = (name: string, ready: boolean, reason: Msg | null) => (ready || !reason ? name : t("set.models.option_off", { name, reason: tm(reason) }));

  const directorRowView = () => {
    if (!setup.data || !director) {
      return (
        <div className="mrow" data-job="director">
          <span className="c job">{t("set.job.director")}</span>
          <span className="c model dim" title={setup.error ?? undefined}>
            {!setup.error ? t("set.loading") : setup.error === "SERVICE_UNAVAILABLE" || setup.error === "NOT_FOUND" ? t("set.models.director_unavailable") : t("set.models.director_read_failed")}
          </span>
          <span className="c price" />
          <span className="c ready-c" />
        </div>
      );
    }
    const value = pending?.job === "director" ? pending.value : director.selected;
    const shown = director.choices.find((choice) => choice.value === value) ?? director.choices[0]!;
    const unchecked = shown.model !== null && codexState(setup.data) === "unchecked";
    const disabledWhy = offline ?? (director.locked ? tm(director.locked) : null);
    return (
      <div className="mrow" data-job="director">
        <span className="c job">{t("set.job.director")}</span>
        <span className="c model">
          <label className="sr" htmlFor="set-m-director">{t("set.models.select", { job: t("set.job.director") })}</label>
          <select id="set-m-director" className="select" data-act="model" data-job="director" value={value} disabled={!!disabledWhy || applying} title={disabledWhy ?? undefined} onChange={choose("director", director.selected)}>
            {director.choices.map((choice) => (
              <option key={choice.value} value={choice.value} disabled={!choice.ready && choice.value !== director.selected}>{optionText(directorName(choice), choice.ready, choice.reason)}</option>
            ))}
          </select>
        </span>
        <span className="c price">{tm(shown.estimate)}</span>
        <span className="c ready-c"><ReadyMark ready={shown.ready} reason={shown.reason} unchecked={unchecked} /></span>
        {pending?.job === "director" && (
          <ImpactRow
            title={t("set.impact.title.director", { model: directorName(shown) })}
            lines={[msg("set.impact.director_next"), msg(shown.model ? "set.impact.director_check" : "set.impact.director_demo")]}
            tone="cost"
            actions={<SwitchActions disabled={!!offline || applying || !shown.ready} busy={applying} why={offline} onSwitch={() => void applyDirector(value, shown)} onCancel={cancel} />}
          />
        )}
      </div>
    );
  };

  const mediaRowView = (row: ModelRow) => {
    const mine = pending && pending.job === row.kind ? pending : null;
    const value = mine?.value ?? row.selected ?? "";
    const shown = choiceFor(row, value);
    const disabledWhy = offline;
    return (
      <div className="mrow" data-job={row.kind} key={row.kind}>
        <span className="c job">{t(row.job)}</span>
        <span className="c model">
          {row.choices.length ? (
            <>
              <label className="sr" htmlFor={`set-m-${row.kind}`}>{t("set.models.select", { job: t(row.job) })}</label>
              <select id={`set-m-${row.kind}`} className="select" data-act="model" data-job={row.kind} value={value} disabled={!!disabledWhy || applying} title={disabledWhy ?? undefined} onChange={choose(row.kind, row.selected)}>
                {/* No saved choice: a placeholder, so choosing the first model is a real change. */}
                {row.selected === null && <option value="" disabled>{t("set.models.choose")}</option>}
                {row.choices.map((choice) => (
                  <option key={choice.value} value={choice.value} disabled={!!choice.missing || (!choice.ready && choice.value !== row.selected)}>
                    {choice.missing ? tm(choice.name) : optionText(tm(choice.name), choice.ready, choice.reason)}
                  </option>
                ))}
              </select>
            </>
          ) : <span className="dim">{t("set.models.none")}</span>}
        </span>
        <span className="c price">{shown ? tm(shown.estimate) : null}</span>
        <span className="c ready-c">{shown ? <ReadyMark ready={shown.ready} reason={shown.reason} /> : row.selected === null && row.choices.length > 0 && <span className="ready n">{t("set.models.not_chosen")}</span>}</span>
        {mine && shown && models.data && (
          <MediaImpact
            row={row} pending={mine} status={models.data} cursor={cursor} model={tm(shown.name)} labels={labels} locale={locale} offline={offline} applying={applying}
            onApply={(preview) => void applyMedia(row, mine, preview)} onRetry={() => void check(row.kind, mine.value, true)} onCancel={cancel}
          />
        )}
      </div>
    );
  };

  return (
    <Panel id="set-models" title="set.section.models" scope={t("set.scope.film", { film })}>
      {rows ? (
        <>
          <div className="mtable" role="group" aria-label={t("set.models.group")}>
            <span className="h">{t("set.models.col.job")}</span>
            <span className="h">{t("set.models.col.model")}</span>
            <span className="h">{t("set.models.col.estimate")}</span>
            <span className="h">{t("set.models.col.status")}</span>
            {directorRowView()}
            {rows.map(mediaRowView)}
          </div>
          <p className="hint set-note">{t("set.models.note")}</p>
        </>
      ) : <ReadState error={models.error} onRetry={models.reload} />}
    </Panel>
  );
}

function MediaImpact({ row, pending, status, cursor, model, labels, locale, offline, applying, onApply, onRetry, onCancel }: {
  row: ModelRow;
  pending: MediaPending;
  status: ModelSettingsStatus;
  /** The studio's event cursor now. */
  cursor: number;
  model: string;
  labels: Record<string, string>;
  locale: string;
  offline: string | null;
  applying: boolean;
  onApply(preview: ModelPreview): void;
  onRetry(): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const titleFor = (id: MessageId) => t(id, { model });
  if (pending.phase === "checking" || !pending.preview) {
    const failed = pending.phase !== "checking";
    return (
      <ImpactRow
        title={failed ? t("set.impact.failed") : t("set.impact.checking")}
        lines={[]}
        tone={failed ? "cost" : "info"}
        busy={!failed}
        actions={failed
          ? <><button type="button" className="pill" data-act="model-retry" disabled={!!offline} onClick={onRetry}>{t("set.retry")}</button><button type="button" className="pill" data-act="model-cancel" onClick={onCancel}>{t("set.cancel")}</button></>
          : <SwitchActions disabled why={null} onSwitch={() => {}} onCancel={onCancel} />}
      />
    );
  }
  const preview = pending.preview;
  // While Switch runs, its own event must not turn the row stale under the person's press.
  const sending = pending.phase === "applying";
  if (pending.phase === "stale" || (!sending && !previewUsable(preview, status, pending.checkedAt, cursor))) {
    return (
      <ImpactRow
        title={t("set.impact.stale")}
        lines={[]}
        tone="info"
        stale
        actions={<><button type="button" className="pill" data-act="model-recheck" disabled={!!offline} onClick={onRetry}>{t("set.impact.check_again")}</button><button type="button" className="pill" data-act="model-cancel" onClick={onCancel}>{t("set.cancel")}</button></>}
      />
    );
  }
  const impact = impactOf(preview, row.kind, labels, locale);
  return (
    <ImpactRow
      title={titleFor(impact.titleId)}
      lines={impact.lines}
      tone={impact.changes ? "cost" : "none"}
      actions={<SwitchActions disabled={!!offline || applying} busy={sending} why={offline} onSwitch={() => onApply(preview)} onCancel={onCancel} />}
    />
  );
}

function ImpactRow({ title, lines, tone, busy, stale, actions }: { title: string; lines: Msg[]; tone: "cost" | "none" | "info"; busy?: boolean; stale?: boolean; actions: ReactNode }) {
  const { tm } = useI18n();
  return (
    <div className="impact-row" data-impact={tone} data-stale={stale || undefined}>
      <div className={`impact${tone === "cost" ? " cost" : tone === "none" ? " none" : ""}`} role="status" aria-busy={busy || undefined}>
        <span className="ic" aria-hidden="true">{tone === "cost" ? "!" : tone === "none" ? "✓" : "i"}</span>
        <span><b>{title}</b>{lines.length ? " " : ""}{lines.map((line) => tm(line)).join(" ")}</span>
      </div>
      <div className="impact-acts">{actions}</div>
    </div>
  );
}

function SwitchActions({ disabled, why, busy, onSwitch, onCancel }: { disabled: boolean; why: string | null; busy?: boolean; onSwitch(): void; onCancel(): void }) {
  const { t } = useI18n();
  return (
    <>
      <button type="button" className="pill primary" data-act="model-apply" disabled={disabled} aria-busy={busy || undefined} title={why ?? undefined} onClick={onSwitch}>{busy ? t("set.models.switching") : t("set.models.switch")}</button>
      <button type="button" className="pill" data-act="model-cancel" onClick={onCancel}>{t("set.cancel")}</button>
    </>
  );
}
