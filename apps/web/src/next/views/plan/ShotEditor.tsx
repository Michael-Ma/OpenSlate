import type { ShotOverview } from "@openslate/core/public";
import { useId, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { listLabels } from "../../model/keyframes.ts";
import { canStep, draftEdits, draftOf, draftProblem, DRAFT_FIELD, editChange, FIELD_LABEL, FRAMINGS, lengthFloor, lengthHint, lineNote, MOTIONS, shotImpact, stepLength, storedShot, type ShotDraft, type UnitPrices } from "../../model/plan-edit.ts";
import type { ShotRowView, SnapshotShot } from "../../model/plan.ts";
import { msg, type Msg } from "../../model/types.ts";
import { ConflictNotice, UnconfirmedNotice, type Unconfirmed } from "./Notices.tsx";
import { Rich } from "./Rich.tsx";
import { FullPrompts, rowId, Thumb } from "./ShotRow.tsx";
import { useHeld } from "./useHeld.ts";

interface Props {
  shot: ShotOverview;
  row: ShotRowView;
  /** The shot as the snapshot stores it: its action, video prompt and narration choice. */
  stored: SnapshotShot | undefined;
  fps: number;
  prices: UnitPrices;
  saving: boolean;
  /** Why saving is off right now (offline, a written plan waiting). */
  guard: string | undefined;
  /** The reason the last save was refused (from the server). */
  error: Msg | null;
  /** The last save's reply was lost: it may or may not have been saved. */
  unconfirmed: Unconfirmed | null;
  onRetry(): void;
  onCancel(): void;
  /** `live` is the shot as saved now; `draft` what the editor shows. */
  onSave(live: ShotDraft, draft: ShotDraft): void;
}

/**
 * The in-place shot editor. The impact line updates as you type and says, before saving, what the change
 * outdates and what remaking it costs. Length is a stepper with a floor at the accepted voice line (SB-8). The draft
 * is held against the saved shot: a field the person did not touch follows the saved film, and one the saved film
 * changed under their text waits for Keep my text or Use saved text before anything is saved.
 */
export function ShotEditor({ shot, row, stored, fps, prices, saving, guard, error, unconfirmed, onRetry, onCancel, onSave }: Props) {
  const { t, tm, locale } = useI18n();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const mode = stored?.narration?.mode;
  const live = draftOf(shot, mode, fps, stored);
  const held = useHeld<ShotDraft>(live);
  const draft = held.value;
  const set = <K extends keyof ShotDraft>(key: K, value: ShotDraft[K]) => held.set(key, value);
  const stale = held.stale.map((key) => DRAFT_FIELD[key]);

  const floor = lengthFloor(shot, fps, draft.narration);
  const impact = shotImpact(shot, live, draft, prices, locale);
  const problem = draftProblem(live, draft);
  const commands = draftEdits(live, draft, fps, mode, storedShot(shot, stored));
  const line = lineNote(shot, draft);
  const undoes = commands.length > 1 ? tm(editChange(row.label, commands.map((command) => command.fields))) : "";
  const blocked = stale.length > 0 || !!unconfirmed;
  const disabled = saving || !!guard || !!problem || commands.length === 0 || blocked;
  const conflictProps = (name: keyof ShotDraft) => (held.stale.includes(name) ? { "data-conflict": "true" } : {});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) onSave(live, draft);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  };
  const footHint = stale.length ? t("plan.conflict.blocked") : unconfirmed ? t("plan.unconfirmed.first") : problem ? tm(problem) : null;

  return (
    <li className="shot-edit" id={rowId(shot.shotId)} data-shot={shot.shotId} data-editing="true">
      <Thumb label={row.label} picture={row.picture} dimmed={row.pictureDimmed} empty={row.emptyThumb} />
      <form className="form-grid" data-form="shot" aria-label={t("plan.shot.edit_label", { shot: row.label })} onSubmit={submit} onKeyDown={onKeyDown}>
        <div className="field" {...conflictProps("purpose")}>
          <label htmlFor={field("purpose")}>{t("plan.field.purpose")}</label>
          <input id={field("purpose")} className="input" data-field="purpose" value={draft.purpose} placeholder={t("plan.field.purpose_placeholder")} autoFocus onChange={(event) => set("purpose", event.target.value)} />
        </div>
        <div className="field" {...conflictProps("framing")}>
          <label htmlFor={field("framing")}>{t("plan.field.framing")}</label>
          {/* Free text in the film's words; the usual framings are offered as suggestions. */}
          <input id={field("framing")} className="input" data-field="framing" list={field("framings")} value={draft.framing} placeholder={t("plan.field.framing_placeholder")} onChange={(event) => set("framing", event.target.value)} />
          <datalist id={field("framings")}>{FRAMINGS.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
        <div className="field len" {...conflictProps("seconds")}>
          <span className="label" id={field("len")}>{t("plan.field.length")}</span>
          <span className="stepper" role="group" aria-labelledby={field("len")} aria-describedby={field("len-hint")}>
            <button type="button" data-act="len-shorter" aria-label={t("plan.len.shorter")} disabled={!canStep(draft.seconds, -1, floor)} onClick={() => set("seconds", stepLength(draft.seconds, -1, floor))}>−</button>
            <output aria-live="polite" data-field="length">{t("plan.len.value", { seconds: draft.seconds })}</output>
            <button type="button" data-act="len-longer" aria-label={t("plan.len.longer")} disabled={!canStep(draft.seconds, 1, floor)} onClick={() => set("seconds", stepLength(draft.seconds, 1, floor))}>+</button>
          </span>
        </div>
        <span className="hint len-hint" id={field("len-hint")}>{tm(lengthHint(shot, floor))}</span>
        <div className="field wide" {...conflictProps("action")}>
          <label htmlFor={field("action")}>{t("plan.field.action")}</label>
          <textarea id={field("action")} className="textarea" data-field="action" rows={2} value={draft.action} placeholder={t("plan.field.action_placeholder")} onChange={(event) => set("action", event.target.value)} />
        </div>
        <div className="wide prompts-pair">
          <div className="field" {...conflictProps("prompt")}>
            <label htmlFor={field("prompt")}>{t("plan.field.prompt")}</label>
            <textarea id={field("prompt")} className="textarea" data-field="prompt" rows={3} value={draft.prompt} placeholder={t("plan.field.prompt_placeholder")} onChange={(event) => set("prompt", event.target.value)} />
          </div>
          <div className="field" {...conflictProps("videoPrompt")}>
            <label htmlFor={field("video")}>{t("plan.field.video_prompt")}</label>
            <textarea id={field("video")} className="textarea" data-field="video-prompt" rows={3} value={draft.videoPrompt} placeholder={t("plan.field.video_prompt_placeholder")} onChange={(event) => set("videoPrompt", event.target.value)} />
          </div>
        </div>
        <details className="wide saved-prompts" data-act="saved-prompts">
          <summary>{t("plan.prompts.saved")}</summary>
          <FullPrompts prompts={row.fullPrompts} />
        </details>
        <div className="field" {...conflictProps("motion")}>
          <label htmlFor={field("motion")}>{t("plan.field.motion")}</label>
          <input id={field("motion")} className="input" data-field="motion" list={field("motions")} value={draft.motion} onChange={(event) => set("motion", event.target.value)} />
          <datalist id={field("motions")}>{MOTIONS.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
        <div className="field narr" {...conflictProps("narration")}>
          <span className="label" id={field("narr")}>{t("plan.field.narration")}</span>
          <span className="segctl" role="radiogroup" aria-labelledby={field("narr")}>
            <button type="button" role="radio" aria-checked={draft.narration === "none"} data-act="narr-none" onClick={() => set("narration", "none")}>{t("plan.narr.choice_none")}</button>
            <button type="button" role="radio" aria-checked={draft.narration === "line"} data-act="narr-line" onClick={() => set("narration", "line")}>{t("plan.narr.choice_line")}</button>
          </span>
        </div>
        {draft.narration === "line" ? (
          <div className="field wide" {...conflictProps("line")}>
            <label htmlFor={field("line")}>{t("plan.field.line")}</label>
            <textarea id={field("line")} className="textarea" data-field="line" rows={2} value={draft.line} aria-describedby={field("line-note")} onChange={(event) => set("line", event.target.value)} />
            <span className="hint" id={field("line-note")} aria-live="polite" data-note="line">{line ? <Rich text={tm(line)} /> : null}</span>
          </div>
        ) : null}
        <div className="wide">
          <div className={`impact ${impact.tone}`} role="status" data-impact={impact.tone}>
            <span className="ic" aria-hidden="true">{impact.tone === "cost" ? "!" : "✓"}</span>
            <span className="txt"><Rich text={impact.parts.map((part) => tm(part)).join(locale === "zh-CN" ? "" : " ")} /></span>
          </div>
        </div>
        {stale.length ? (
          <ConflictNotice
            message={msg("plan.conflict.shot", { fields: listLabels([...new Set(stale)].map((name) => t(FIELD_LABEL[name])), locale) })}
            onKeep={held.keep}
            onTakeSaved={held.takeSaved}
          />
        ) : null}
        {unconfirmed ? <UnconfirmedNotice notice={unconfirmed} busy={saving} onRetry={onRetry} /> : null}
        {error && !unconfirmed ? <p className="wide edit-error" role="alert"><i className="ic" aria-hidden="true">!</i>{t("plan.edit.not_saved", { reason: tm(error) })}</p> : null}
        <div className="edit-foot wide">
          <button type="submit" className="pill primary" data-act="save-shot" disabled={disabled} title={guard ?? footHint ?? undefined}>{t(saving ? "plan.saving" : "plan.save")}</button>
          <button type="button" className="pill" data-act="cancel-edit" onClick={onCancel}>{t("plan.cancel")}</button>
          {footHint ? <span className="hint">{footHint}</span> : commands.length > 1 ? <span className="hint" data-hint="multi">{t("plan.edit.multi", { count: commands.length, change: undoes })}</span> : null}
        </div>
      </form>
    </li>
  );
}
