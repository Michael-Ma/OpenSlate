import type { ShotOverview } from "@openslate/core/public";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { MAX_SHOT_SECONDS, MIN_SHOT_SECONDS } from "../model/checks.ts";
import { durationIssue, editImpact, parseSeconds, type InspectorView } from "../model/inspector.ts";
import { wordsOf, type ShotNarrationRead } from "../model/narration.ts";
import type { EditDraft } from "../store/state.ts";
import type { Resource } from "../store/useResource.ts";
import { useGuarded } from "../app/useWriteGuard.ts";
import { NarrationPanel } from "./NarrationPanel.tsx";
import { StatusPill } from "./parts.tsx";
import { PromptsPanel } from "./PromptsPanel.tsx";
import { TakesStrip } from "./TakesStrip.tsx";

/** Common camera moves offered as suggestions in the interface language; motion stays free text. */
const MOTION_SUGGESTIONS = ["static", "breath", "push_in", "pull_back", "pan_left", "pan_right", "tilt_up", "tilt_down"] as const;

interface Props {
  view: InspectorView;
  shot: ShotOverview;
  fps: number;
  draft: EditDraft | null;
  /** The shot's narration section and current take (GET /narration/shots/:shotId), read while the panel is open. */
  narrationDetail: Resource<ShotNarrationRead>;
  busy: { regenerate: boolean; edit: boolean; release: boolean; video: boolean };
  /** A paid press here lost its reply: pressing again resends the same request and never charges twice. */
  unconfirmed: { regenerate: boolean; video: boolean };
  onPoint(): void;
  onRegenerate(): void;
  onRetryVideo(): void;
  onEdit(draft: EditDraft | null): void;
  onSaveDraft(draft: EditDraft): void;
  onSaveMotion(motion: string, seconds: number): void;
  onRelease(attemptId: string): void;
  /** Open Plan on this shot's row (the prompts are edited there). */
  onEditInPlan(): void;
}

/**
 * Shot 2.1: framing, status, rows, @ pointer, and the stacked actions with inline edit forms (plan item SB-10).
 * Edits follow the shell's write guard (off while offline or expired); paid makes also stop while the film is
 * stopped. A control the guard turns off says why in its title.
 */
export function Inspector({ view, shot, fps, draft, narrationDetail, busy, unconfirmed, onPoint, onRegenerate, onRetryVideo, onEdit, onSaveDraft, onSaveMotion, onRelease, onEditInPlan }: Props) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const run = useGuarded("run");
  const editing = draft && draft.shotId === shot.shotId ? draft : null;
  const regen = view.regenerate;
  /** The row's Listen opened the narration panel: its player takes focus once the take has loaded. */
  const [listening, setListening] = useState(false);
  useEffect(() => { if (editing?.field !== "narration") setListening(false); }, [editing?.field]);
  const openNarration = (listen: boolean) => {
    setListening(listen);
    returnTo.current = listen ? "listen" : "edit";
    onEdit({ shotId: shot.shotId, field: "narration", value: wordsOf(shot.narration.text) });
  };
  // Closing the narration panel (Escape, Cancel, Done, Save) gives the focus back to the row's control that opened
  // it (Listen, else Edit), unless the person has moved on to something outside the inspector.
  const aside = useRef<HTMLElement>(null);
  const returnTo = useRef<"edit" | "listen" | null>(null);
  const narrationOpen = editing?.field === "narration";
  const wasOpen = useRef(narrationOpen);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = narrationOpen;
    if (!was || narrationOpen) return;
    const target = returnTo.current;
    returnTo.current = null;
    const root = aside.current;
    const active = document.activeElement;
    if (!target || !root || (active && active !== document.body && !root.contains(active))) return;
    (root.querySelector<HTMLElement>(`[data-act="narration-${target}"]`) ?? root.querySelector<HTMLElement>('[data-act="narration-edit"]'))?.focus();
  }, [narrationOpen]);
  // The takes strip and the prompts open in place of the rows and the actions, with Close and Esc.
  const [open, setOpen] = useState<"takes" | "prompts" | null>(null);
  // A stopped confirm is one line here (the scene's video panel has the details); Why shows them in place.
  const [why, setWhy] = useState(false);
  const backTo = useRef<string | null>(null);
  const takeCount = shot.keyframe.takeCount;
  const strip = open === "takes" && takeCount > 1 && !editing;
  const prompts = open === "prompts" && !editing;
  const sub = strip || prompts;
  // Another shot, or an edit form, closes them.
  useEffect(() => { setOpen(null); setWhy(false); }, [shot.shotId]);
  useEffect(() => { if (editing) setOpen(null); }, [editing]);
  // Closing puts focus back on the button that opened it.
  useEffect(() => {
    if (sub || !backTo.current) return;
    const act = backTo.current;
    backTo.current = null;
    aside.current?.querySelector<HTMLElement>(`[data-act="${act}"]`)?.focus({ preventScroll: true });
  }, [sub]);
  const close = () => { backTo.current = open; setOpen(null); };
  const lostRegen = unconfirmed.regenerate && regen.enabled && !busy.regenerate;
  const regenNotes = [lostRegen ? t("error.PAID_UNCONFIRMED") : null, ...[regen.reason, regen.cost, regen.clipNote].filter((note) => note !== null).map((note) => tm(note!))].filter(Boolean);
  return (
    <aside ref={aside} className="insp" aria-label={t("inspector.label")} data-shot={shot.shotId} data-editing={editing?.field}>
      <div className="insp-title">
        <div>
          <h3>{tm(view.title)}</h3>
          <div className="framing">{view.framing}</div>
        </div>
        <button type="button" className="pill sm at21" data-act="point" data-shot={shot.shotId} aria-label={t("inspector.point_label", { shot: view.label })} onClick={onPoint}>
          {t("inspector.point", { shot: view.label })}
        </button>
      </div>
      {/* The takes strip and the prompts take the status line's room too (the preview's badge still shows it). */}
      {sub ? null : (
        <div className="st">
          <StatusPill status={view.status} tone={view.tone} />
          {!editing ? (
            <button type="button" className="insp-link" data-act="prompts" data-shot={shot.shotId} aria-label={t("inspector.prompts_show_label", { shot: view.label })} onClick={() => setOpen("prompts")}>
              {t("inspector.prompts_show")}
            </button>
          ) : null}
        </div>
      )}

      <div className="insp-body">
      {editing?.field === "narration" ? (
        <NarrationPanel key={editing.shotId} shot={shot} fps={fps} draft={editing} detail={narrationDetail} saving={busy.edit || !!editing.saving} focusTake={listening} onEdit={onEdit} onSaveDraft={onSaveDraft} />
      ) : editing ? (
        <EditForm key={`${editing.shotId}:${editing.field}`} shot={shot} fps={fps} draft={editing} saving={busy.edit || !!editing.saving} onEdit={onEdit} onSaveDraft={onSaveDraft} onSaveMotion={onSaveMotion} />
      ) : strip ? (
        <TakesStrip shot={shot} onClose={close} />
      ) : prompts ? (
        <PromptsPanel shotId={shot.shotId} label={view.label} prompts={view.prompts} onClose={close} onEditInPlan={onEditInPlan} />
      ) : (
        <>
        {view.stopped ? (
          // The scene's confirm stopped at this shot: one line before the rows, so they keep their room; Why opens
          // the reason and the next step in place (they are also in the scene's video panel).
          <div className="insp-stop" data-act="stopped-here">
            <p role="status">
              <b>{t("inspector.stopped")}</b>{" "}
              <button
                type="button"
                className="insp-link"
                data-act="stopped-why"
                aria-expanded={why}
                aria-controls={`stopped-why-${shot.shotId}`}
                aria-label={t("inspector.stopped_why_label", { shot: view.label })}
                onClick={() => setWhy((value) => !value)}
              >
                {t("inspector.stopped_why")}
              </button>
            </p>
            {why ? <p className="insp-stop-why" id={`stopped-why-${shot.shotId}`}>{tm(view.stopped.reason)} {tm(view.stopped.next)}</p> : null}
          </div>
        ) : null}
        <dl className="rows">
          {view.rows.map((row) => (
            <div key={row.key} className="row-pair" data-row={row.key}>
              <dt>
                {tm(row.label)}
                {row.key === "narration" ? (
                  // Narration is edited and heard in its own panel (the line or a recording, the voice, the current take).
                  // Its two controls sit under the label, so the row is no taller than the line and its notes.
                  <span className="narr-acts">
                    <button type="button" className="pill sm" data-act="narration-edit" data-shot={shot.shotId} aria-label={t("narr.row.edit_label", { shot: view.label })} onClick={() => openNarration(false)}>{t("narr.row.edit")}</button>
                    {shot.narration.state === "ready" ? (
                      <button type="button" className="play sm" data-act="narration-listen" data-shot={shot.shotId} aria-label={t("narr.row.listen_label", { shot: view.label })} title={t("narr.row.listen")} onClick={() => openNarration(true)}>
                        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </dt>
              <dd>
                {row.key === "takes" ? (
                  <button
                    type="button"
                    className="insp-link"
                    data-act="takes"
                    data-shot={shot.shotId}
                    aria-label={t("inspector.takes_show_label", { count: takeCount, shot: view.label })}
                    onClick={() => setOpen("takes")}
                  >
                    {t("inspector.takes_show", { count: takeCount })}
                  </button>
                ) : typeof row.value === "string"
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
        </>
      )}

      {!editing && !sub && view.notes.length ? <div className="insp-notes">{view.notes.map((note, index) => <p key={index} className="stale">{tm(note)}</p>)}</div> : null}
      {!editing && !sub && view.failure ? (
        <div className="insp-alert" role="status">
          <p>{tm(view.failure.message)}</p>
          {view.failure.retryVideo ? (
            <button type="button" className="pill sm" data-act="retry-video" data-shot={shot.shotId} {...run} disabled={!view.failure.retryVideo.enabled || busy.video || run.disabled} onClick={onRetryVideo}>
              {t("inspector.retry_video")}{view.failure.retryVideo.price ? ` · ${tm(view.failure.retryVideo.price)}` : ""}
            </button>
          ) : null}
          {view.failure.retryVideo && unconfirmed.video && !busy.video ? <p className="lost" data-unconfirmed="true">{t("error.PAID_UNCONFIRMED")}</p> : null}
        </div>
      ) : null}
      {!editing && !sub && view.noAnswer ? <GiveUp attemptId={view.noAnswer.attemptId} busy={busy.release} onRelease={onRelease} /> : null}
      </div>

      {editing || sub ? null : (
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
            aria-describedby={regenNotes.length ? `regen-note-${shot.shotId}` : undefined}
            onClick={onRegenerate}
          >
            {tm(regen.label)}
          </button>
          {regenNotes.length ? (
            <p className={`insp-note${lostRegen ? " lost" : ""}`} id={`regen-note-${shot.shotId}`} data-unconfirmed={lostRegen ? "true" : undefined}>
              {regenNotes.join(" ")}
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

/** Inline edit of the prompt, or motion and duration, with Save / Cancel. It says before saving which media the change outdates. */
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
