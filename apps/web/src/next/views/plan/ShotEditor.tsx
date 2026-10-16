import type { ShotOverview } from "@openslate/core/public";
import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { canStep, draftEdits, draftOf, draftProblem, editChange, FRAMINGS, lengthFloor, lengthHint, lineNote, MOTIONS, shotImpact, stepLength, type ShotDraft, type UnitPrices } from "../../model/plan-edit.ts";
import { choiceLabel, planRecordingNote, takeOrigin } from "../../model/narration.ts";
import { useShotNarration } from "../../keyframes/narration-media.ts";
import type { NarrationMode, ShotRowView } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Rich } from "./Rich.tsx";
import { rowId, Thumb } from "./ShotRow.tsx";

interface Props {
  shot: ShotOverview;
  row: ShotRowView;
  mode: NarrationMode | undefined;
  fps: number;
  prices: UnitPrices;
  saving: boolean;
  /** Why saving is off right now (offline, a written plan waiting). */
  guard: string | undefined;
  /** The reason the last save was refused (from the server). */
  error: Msg | null;
  onCancel(): void;
  onSave(base: ShotDraft, draft: ShotDraft): void;
}

/**
 * The in-place shot editor. The impact line updates as you type and says, before saving, what the change
 * outdates and what remaking it costs. Length is a stepper with a floor at the accepted voice line (SB-8).
 */
export function ShotEditor({ shot, row, mode, fps, prices, saving, guard, error, onCancel, onSave }: Props) {
  const { t, tm, locale } = useI18n();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  // The base follows the shot as it is now, so a partly saved draft only sends what is still different.
  const base = useMemo(() => draftOf(shot, mode, fps), [shot, mode, fps]);
  const [draft, setDraft] = useState<ShotDraft>(base);
  const set = <K extends keyof ShotDraft>(key: K, value: ShotDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  // A shot set to "My recording" may still be using its voice line: its take says which, for the note and the impact.
  const detail = useShotNarration(mode === "uploaded" && shot.narration.state === "ready" ? shot.shotId : null);
  const origin = takeOrigin(shot, detail.data);
  const floor = lengthFloor(shot, fps, draft.narration);
  const impact = shotImpact(shot, base, draft, prices, locale, origin);
  const problem = draftProblem(base, draft);
  const edits = draftEdits(base, draft, fps, mode, shot.imagePrompt);
  const line = lineNote(shot, draft);
  // Framings are shot content in the film's own words; a framing written elsewhere is offered as it is.
  const framingOptions = draft.framing && !FRAMINGS.includes(draft.framing) ? [draft.framing, ...FRAMINGS] : FRAMINGS;
  const undoes = edits.length > 1 ? tm(editChange(row.label, edits.map((item) => item.field))) : "";
  const disabled = saving || !!guard || !!problem || edits.length === 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!disabled) onSave(base, draft);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onCancel();
  };

  return (
    <li className="shot-edit" id={rowId(shot.shotId)} data-shot={shot.shotId} data-editing="true">
      <Thumb label={row.label} picture={row.picture} dimmed={row.pictureDimmed} empty={row.emptyThumb} />
      <form className="form-grid" data-form="shot" aria-label={t("plan.shot.edit_label", { shot: row.label })} onSubmit={submit} onKeyDown={onKeyDown}>
        <div className="field">
          <label htmlFor={field("purpose")}>{t("plan.field.purpose")}</label>
          <input id={field("purpose")} className="input" data-field="purpose" value={draft.purpose} placeholder={t("plan.field.purpose_placeholder")} autoFocus onChange={(event) => set("purpose", event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={field("framing")}>{t("plan.field.framing")}</label>
          <select id={field("framing")} className="select" data-field="framing" value={draft.framing} onChange={(event) => set("framing", event.target.value)}>
            {!draft.framing ? <option value="" disabled>{t("plan.framing.choose")}</option> : null}
            {framingOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div className="field len">
          <span className="label" id={field("len")}>{t("plan.field.length")}</span>
          <span className="stepper" role="group" aria-labelledby={field("len")} aria-describedby={field("len-hint")}>
            <button type="button" data-act="len-shorter" aria-label={t("plan.len.shorter")} disabled={!canStep(draft.seconds, -1, floor)} onClick={() => set("seconds", stepLength(draft.seconds, -1, floor))}>−</button>
            <output aria-live="polite" data-field="length">{t("plan.len.value", { seconds: draft.seconds })}</output>
            <button type="button" data-act="len-longer" aria-label={t("plan.len.longer")} disabled={!canStep(draft.seconds, 1, floor)} onClick={() => set("seconds", stepLength(draft.seconds, 1, floor))}>+</button>
          </span>
        </div>
        <span className="hint len-hint" id={field("len-hint")}>{tm(lengthHint(shot, floor))}</span>
        <div className="field wide">
          <label htmlFor={field("prompt")}>{t("plan.field.prompt")}</label>
          <textarea id={field("prompt")} className="textarea" data-field="prompt" rows={2} value={draft.prompt} placeholder={t("plan.field.prompt_placeholder")} onChange={(event) => set("prompt", event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={field("motion")}>{t("plan.field.motion")}</label>
          <input id={field("motion")} className="input" data-field="motion" list={field("motions")} value={draft.motion} onChange={(event) => set("motion", event.target.value)} />
          <datalist id={field("motions")}>{MOTIONS.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
        <div className="field narr">
          <span className="label" id={field("narr")}>{t("plan.field.narration")}</span>
          <span className="segctl" role="radiogroup" aria-labelledby={field("narr")}>
            <button type="button" role="radio" aria-checked={draft.narration === "none"} data-act="narr-none" onClick={() => set("narration", "none")}>{t("plan.narr.choice_none")}</button>
            <button type="button" role="radio" aria-checked={draft.narration === "line"} data-act="narr-line" onClick={() => set("narration", "line")}>{t("plan.narr.choice_line")}</button>
            <button type="button" role="radio" aria-checked={draft.narration === "recording"} data-act="narr-recording" onClick={() => set("narration", "recording")}>{tm(choiceLabel("recording"))}</button>
          </span>
          {draft.narration === "recording" ? <span className="hint" data-note="recording">{tm(planRecordingNote(shot, mode, origin))}</span> : null}
        </div>
        {draft.narration === "line" ? (
          <div className="field wide">
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
        {error ? <p className="wide edit-error" role="alert"><i className="ic" aria-hidden="true">!</i>{t("plan.edit.not_saved", { reason: tm(error) })}</p> : null}
        <div className="edit-foot wide">
          <button type="submit" className="pill primary" data-act="save-shot" disabled={disabled} title={guard}>{t(saving ? "plan.saving" : "plan.save")}</button>
          <button type="button" className="pill" data-act="cancel-edit" onClick={onCancel}>{t("plan.cancel")}</button>
          {problem ? <span className="hint">{tm(problem)}</span> : edits.length > 1 ? <span className="hint" data-hint="multi">{t("plan.edit.multi", { count: edits.length, change: undoes })}</span> : null}
        </div>
      </form>
    </li>
  );
}
