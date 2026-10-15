import type { ShotOverview } from "@openslate/core/public";
import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { lineEstimate, lineEstimateMsg, MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "../model/checks.ts";
import { durationIssue, editImpact, parseSeconds, type InspectorView } from "../model/inspector.ts";
import type { EditDraft } from "../store/state.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { StatusPill } from "./parts.tsx";

/** Common camera moves offered as suggestions in the interface language; motion stays free text. */
const MOTION_SUGGESTIONS = ["static", "breath", "push_in", "pull_back", "pan_left", "pan_right", "tilt_up", "tilt_down"] as const;

interface Props {
  view: InspectorView;
  shot: ShotOverview;
  fps: number;
  draft: EditDraft | null;
  busy: { regenerate: boolean; edit: boolean; release: boolean; video: boolean };
  onPoint(): void;
  onRegenerate(): void;
  onRetryVideo(): void;
  onEdit(draft: EditDraft | null): void;
  onSaveDraft(draft: EditDraft): void;
  onSaveMotion(motion: string, seconds: number): void;
  onRelease(attemptId: string): void;
}

/**
 * Shot 2.1: framing, status, rows, @ pointer, and the stacked actions with inline edit forms (plan item SB-10).
 * Edits follow the shell's write guard (off while offline or expired); paid makes also stop while the film is
 * stopped. A control the guard turns off says why in its title.
 */
export function Inspector({ view, shot, fps, draft, busy, onPoint, onRegenerate, onRetryVideo, onEdit, onSaveDraft, onSaveMotion, onRelease }: Props) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const run = useGuarded("run");
  const editing = draft && draft.shotId === shot.shotId ? draft : null;
  const regen = view.regenerate;
  return (
    <aside className="insp" aria-label={t("inspector.label")} data-shot={shot.shotId}>
      <div className="insp-title">
        <div>
          <h3>{tm(view.title)}</h3>
          <div className="framing">{view.framing}</div>
        </div>
        <button type="button" className="pill sm at21" data-act="point" data-shot={shot.shotId} aria-label={t("inspector.point_label", { shot: view.label })} onClick={onPoint}>
          {t("inspector.point", { shot: view.label })}
        </button>
      </div>
      <div className="st"><StatusPill status={view.status} tone={view.tone} /></div>

      <div className="insp-body">
      {editing ? (
        <EditForm key={`${editing.shotId}:${editing.field}`} shot={shot} fps={fps} draft={editing} saving={busy.edit || !!editing.saving} onEdit={onEdit} onSaveDraft={onSaveDraft} onSaveMotion={onSaveMotion} />
      ) : (
        <dl className="rows">
          {view.rows.map((row) => (
            <div key={row.key} className="row-pair" data-row={row.key}>
              <dt>{tm(row.label)}</dt>
              <dd>
                {typeof row.value === "string"
                  ? (row.quoted ? <span className="quote" title={row.value}>{`“${row.value}”`}</span> : row.value)
                  : tm(row.value)}
                {row.notes.length ? (
                  // One line, as in the design ("7.4 s voice line · cut at 6 s"), so the stacked actions keep their room.
                  <small className={row.notes.some((note) => note.tone === "warn") ? "warn" : undefined}>{row.notes.map((note) => tm(note.message)).join(" · ")}</small>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!editing && view.notes.length ? <div className="insp-notes">{view.notes.map((note, index) => <p key={index} className="stale">{tm(note)}</p>)}</div> : null}
      {!editing && view.failure ? (
        <div className="insp-alert" role="status">
          <p>{tm(view.failure.message)}</p>
          {view.failure.retryVideo ? (
            <button type="button" className="pill sm" data-act="retry-video" data-shot={shot.shotId} {...run} disabled={!view.failure.retryVideo.enabled || busy.video || run.disabled} onClick={onRetryVideo}>
              {t("inspector.retry_video")}{view.failure.retryVideo.price ? ` · ${tm(view.failure.retryVideo.price)}` : ""}
            </button>
          ) : null}
        </div>
      ) : null}
      {!editing && view.noAnswer ? <GiveUp attemptId={view.noAnswer.attemptId} busy={busy.release} onRelease={onRelease} /> : null}
      </div>

      {editing ? null : (
        <div className="insp-actions">
          <button type="button" className="pill" data-act="edit-prompt" data-shot={shot.shotId} {...server} onClick={() => onEdit({ shotId: shot.shotId, field: "imagePrompt", value: shot.imagePrompt })}>{t("inspector.edit_prompt")}</button>
          <button type="button" className="pill" data-act="edit-motion" data-shot={shot.shotId} {...server} onClick={() => onEdit({ shotId: shot.shotId, field: "motion", value: shot.motion })}>{t("inspector.edit_motion")}</button>
          <button
            type="button"
            className={`pill${regen.primary ? " primary" : ""}`}
            data-act="regen"
            data-shot={shot.shotId}
            data-kind={regen.kind}
            {...run}
            disabled={!regen.enabled || busy.regenerate || run.disabled}
            aria-describedby={regen.cost || regen.clipNote || regen.reason ? `regen-note-${shot.shotId}` : undefined}
            onClick={onRegenerate}
          >
            {tm(regen.label)}
          </button>
          {regen.cost || regen.clipNote || regen.reason ? (
            <p className="insp-note" id={`regen-note-${shot.shotId}`}>
              {[regen.reason, regen.cost, regen.clipNote].filter((note) => note !== null).map((note) => tm(note!)).join(" ")}
            </p>
          ) : null}
        </div>
      )}
    </aside>
  );
}

interface FormProps {
  shot: ShotOverview;
  fps: number;
  draft: EditDraft;
  saving: boolean;
  onEdit(draft: EditDraft | null): void;
  onSaveDraft(draft: EditDraft): void;
  onSaveMotion(motion: string, seconds: number): void;
}

/** Inline edit with Save / Cancel. It says before saving which media the change outdates. */
function EditForm({ shot, fps, draft, saving, onEdit, onSaveDraft, onSaveMotion }: FormProps) {
  const { t, tm } = useI18n();
  const shotSeconds = Math.round(shot.durationFrames / fps);
  const [secondsText, setSecondsText] = useState(String(shotSeconds));
  const id = (part: string) => `edit-${part}-${shot.shotId}`;
  const cancel = () => onEdit(null);
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };

  useEffect(() => { setSecondsText(String(shotSeconds)); }, [shotSeconds]);

  if (draft.field === "motion" || draft.field === "desiredFrames") {
    const issue = durationIssue(secondsText, shot);
    const value = parseSeconds(secondsText);
    const motion = draft.field === "motion" ? draft.value : shot.motion;
    const changed = motion.trim() !== shot.motion || (value !== null && value * fps !== shot.durationFrames);
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (value === null || !motion.trim() || !changed || saving) return;
      onSaveMotion(motion.trim(), value);
    };
    return (
      <form className="edit-form" data-form="motion" onSubmit={submit} onKeyDown={onKey}>
        <label htmlFor={id("motion")}>{t("inspector.motion_label")}</label>
        <input id={id("motion")} list={id("motions")} value={motion} autoFocus onChange={(event) => onEdit({ ...draft, field: "motion", value: event.target.value })} />
        <datalist id={id("motions")}>{MOTION_SUGGESTIONS.map((option) => <option key={option} value={t(`motion.suggest.${option}`)} />)}</datalist>
        <label htmlFor={id("seconds")}>{t("inspector.duration_label", { min: MIN_SHOT_SECONDS, max: MAX_SHOT_SECONDS })}</label>
        <input
          id={id("seconds")}
          type="number"
          inputMode="numeric"
          min={MIN_SHOT_SECONDS}
          max={MAX_SHOT_SECONDS}
          step={1}
          value={secondsText}
          aria-invalid={issue?.kind === "refusal"}
          aria-describedby={id("impact")}
          onChange={(event) => setSecondsText(event.target.value)}
        />
        {issue ? <span className={`stale${issue.kind === "refusal" ? " warn" : ""}`} role={issue.kind === "refusal" ? "alert" : undefined}>{tm(issue.message)}</span> : null}
        <span className="stale" id={id("impact")}>{tm(editImpact(shot, ["motion", "desiredFrames"]))}</span>
        <FormButtons saving={saving} disabled={value === null || !motion.trim() || !changed} onCancel={cancel} />
      </form>
    );
  }

  if (draft.field === "narration") {
    const estimate = lineEstimate(draft.value, shot, fps);
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (draft.value.trim() === shot.narration.text || saving) return;
      onSaveDraft({ ...draft, value: draft.value.trim() });
    };
    return (
      <form className="edit-form" data-form="narration" onSubmit={submit} onKeyDown={onKey}>
        <label htmlFor={id("narration")}>{t("inspector.narration_label", { shot: shot.label })}</label>
        <textarea id={id("narration")} rows={4} value={draft.value} autoFocus aria-describedby={`${id("estimate")} ${id("impact")}`} onChange={(event) => onEdit({ ...draft, value: event.target.value })} />
        <span className={`est${estimate.fits ? "" : " warn"}`} id={id("estimate")} aria-live="polite">{draft.value.trim() ? tm(lineEstimateMsg(estimate)) : ""}</span>
        <span className="stale" id={id("impact")}>{tm(editImpact(shot, ["narration"]))}</span>
        <FormButtons saving={saving} disabled={draft.value.trim() === shot.narration.text} onCancel={cancel} />
      </form>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.value.trim() || draft.value.trim() === shot.imagePrompt || saving) return;
    onSaveDraft({ ...draft, value: draft.value.trim() });
  };
  return (
    <form className="edit-form" data-form="prompt" onSubmit={submit} onKeyDown={onKey}>
      <label htmlFor={id("prompt")}>{t("inspector.prompt_label", { shot: shot.label })}</label>
      <textarea id={id("prompt")} rows={6} value={draft.value} autoFocus aria-describedby={id("impact")} onChange={(event) => onEdit({ ...draft, value: event.target.value })} />
      <span className="stale" id={id("impact")}>{tm(editImpact(shot, ["imagePrompt"]))}</span>
      <FormButtons saving={saving} disabled={!draft.value.trim() || draft.value.trim() === shot.imagePrompt} onCancel={cancel} />
    </form>
  );
}

function FormButtons({ saving, disabled, onCancel }: { saving: boolean; disabled: boolean; onCancel(): void }) {
  const { t } = useI18n();
  const server = useGuarded("server");
  return (
    <div className="two">
      <button type="submit" className="pill chosen" data-act="save-edit" {...server} disabled={disabled || saving || server.disabled}>{t(saving ? "inspector.saving" : "inspector.save")}</button>
      <button type="button" className="pill" data-act="cancel-edit" onClick={onCancel}>{t("inspector.cancel")}</button>
    </div>
  );
}

/** Give up on a job the service never confirmed (plan decision D7): an explicit acknowledgement first. */
function GiveUp({ attemptId, busy, onRelease }: { attemptId: string; busy: boolean; onRelease(attemptId: string): void }) {
  const { t } = useI18n();
  const server = useGuarded("server");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const ack = `give-up-ack-${attemptId}`;
  return (
    <div className="insp-alert" role="status">
      <p>{t("inspector.give_up_note")}</p>
      {open ? (
        <>
          <label className="ack" htmlFor={ack}>
            <input id={ack} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>{t("inspector.give_up_ack")}</span>
          </label>
          <div className="two">
            <button type="button" className="pill chosen" data-act="give-up-confirm" {...server} disabled={!acknowledged || busy || server.disabled} onClick={() => onRelease(attemptId)}>{t("inspector.give_up_confirm")}</button>
            <button type="button" className="pill" data-act="give-up-cancel" onClick={() => { setOpen(false); setAcknowledged(false); }}>{t("inspector.cancel")}</button>
          </div>
        </>
      ) : (
        <button type="button" className="pill sm" data-act="give-up" {...server} onClick={() => setOpen(true)}>{t("inspector.give_up")}</button>
      )}
    </div>
  );
}
