import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { applyRequest, choiceFor, impactOf, modelRows, previewCurrent, previewRequest, type MediaKind, type ModelApplyResult, type ModelPreview, type ModelRow, type ModelSettingsStatus } from "../../model/settings.ts";
import { DEMO_VALUE, codexState, directorRequest, directorRow, selectionFor, type DirectorChoice, type DirectorSetup } from "../../model/settings-director.ts";
import { msg, type Msg } from "../../model/types.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { Panel, ReadState, ReadyMark } from "./parts.tsx";

type Pending =
  | { job: "director"; value: string }
  | { job: MediaKind; value: string; phase: "checking" | "ready" | "failed"; preview: ModelPreview | null };

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
  const presses = useStudio((s) => s.pending);
  const labels = useMemo(() => Object.fromEntries(Object.values(overview?.shots ?? {}).map((shot) => [shot.shotId, shot.label])), [overview]);
  const rows = useMemo(() => (models.data ? modelRows(models.data, locale) : null), [models.data, locale]);
  const director = useMemo(() => (setup.data ? directorRow(setup.data) : null), [setup.data]);
  const [pending, setPending] = useState<Pending | null>(null);
  const token = useRef(0);
  const applying = !!presses[APPLY_PRESS] || !!presses[DIRECTOR_PRESS];

  const focusSelect = (job: string) => requestAnimationFrame(() => document.getElementById(`set-m-${job}`)?.focus());

  const check = async (kind: MediaKind, value: string) => {
    const status = models.data;
    if (!status) return;
    const mine = ++token.current;
    setPending({ job: kind, value, phase: "checking", preview: null });
    const request = previewRequest(status, kind, value);
    const preview = await store.command<ModelPreview>(PREVIEW_PRESS(kind, value), request.body, () => request);
    if (token.current !== mine) return;
    setPending({ job: kind, value, phase: preview ? "ready" : "failed", preview: preview ?? null });
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

  const applyMedia = async (row: ModelRow, preview: ModelPreview) => {
    const choice = choiceFor(row, preview.selected[row.kind]);
    const toast = choice ? msg("set.toast.model_switched", { job: t(row.job), model: tm(choice.name) }) : undefined;
    const request = applyRequest(preview);
    const result = await store.command<ModelApplyResult>(APPLY_PRESS, request.body, () => request, toast);
    if (!result) return;
    setPending(null);
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
          <span className="c model dim">{setup.error ? t("set.models.director_unavailable") : t("set.loading")}</span>
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
                {row.choices.map((choice) => (
                  <option key={choice.value} value={choice.value} disabled={!choice.ready && choice.value !== row.selected}>{optionText(tm(choice.name), choice.ready, choice.reason)}</option>
                ))}
              </select>
            </>
          ) : <span className="dim">{t("set.models.none")}</span>}
        </span>
        <span className="c price">{shown ? tm(shown.estimate) : null}</span>
        <span className="c ready-c">{shown && <ReadyMark ready={shown.ready} reason={shown.reason} />}</span>
        {mine && shown && models.data && <MediaImpact row={row} pending={mine} status={models.data} model={tm(shown.name)} labels={labels} locale={locale} offline={offline} applying={applying} onApply={(preview) => void applyMedia(row, preview)} onRetry={() => void check(row.kind, mine.value)} onCancel={cancel} />}
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

function MediaImpact({ row, pending, status, model, labels, locale, offline, applying, onApply, onRetry, onCancel }: {
  row: ModelRow;
  pending: Extract<Pending, { phase: string }>;
  status: ModelSettingsStatus;
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
    const failed = pending.phase === "failed";
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
  if (!previewCurrent(preview, status)) {
    return (
      <ImpactRow
        title={t("set.impact.stale")}
        lines={[]}
        tone="info"
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
      actions={<SwitchActions disabled={!!offline || applying} busy={applying} why={offline} onSwitch={() => onApply(preview)} onCancel={onCancel} />}
    />
  );
}

function ImpactRow({ title, lines, tone, busy, actions }: { title: string; lines: Msg[]; tone: "cost" | "none" | "info"; busy?: boolean; actions: ReactNode }) {
  const { tm } = useI18n();
  return (
    <div className="impact-row" data-impact={tone}>
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
