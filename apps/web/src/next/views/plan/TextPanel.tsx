import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import type { Msg } from "../../model/types.ts";

/** "Nothing made goes out of date" (SB-12): brief, story, scene direction and title edits detach no media. */
export function NoneImpact({ text }: { text: MessageId }) {
  const { t } = useI18n();
  return (
    <div className="impact none" data-impact="none">
      <span className="ic" aria-hidden="true">✓</span>
      <span className="txt">{t(text)}</span>
    </div>
  );
}

export function SaveError({ error }: { error: Msg | null }) {
  const { t, tm } = useI18n();
  return error ? <p className="edit-error" role="alert"><i className="ic" aria-hidden="true">!</i>{t("plan.edit.not_saved", { reason: tm(error) })}</p> : null;
}

interface Props {
  field: "brief" | "story";
  text: string;
  editing: boolean;
  saving: boolean;
  guard: string | undefined;
  error: Msg | null;
  onEdit(): void;
  onCancel(): void;
  onSave(value: string): void;
}

/** Brief or Story: the text, with Edit opening it in place. */
export function TextPanel({ field, text, editing, saving, guard, error, onEdit, onCancel, onSave }: Props) {
  const { t } = useI18n();
  const id = useId();
  const title = t(field === "brief" ? "plan.brief" : "plan.story");
  return (
    <section className="panel text-panel" aria-labelledby={`${id}-h`} data-panel={field}>
      <div className="panel-head">
        <span className="eyebrow" id={`${id}-h`}>{title}</span>
        {editing ? null : (
          <span className="end">
            <button type="button" className="pill sm" data-act="edit-text" data-field={field} aria-label={t("plan.edit_named", { name: title })} disabled={!!guard} title={guard} onClick={onEdit}>{t("plan.edit")}</button>
          </span>
        )}
      </div>
      {editing ? <TextForm key={field} id={`${id}-t`} label={title} text={text} saving={saving} guard={guard} error={error} onCancel={onCancel} onSave={onSave} />
        : <p className="text-block">{text.trim() ? text : <span className="muted">{t("plan.text.empty")}</span>}</p>}
    </section>
  );
}

function TextForm({ id, label, text, saving, guard, error, onCancel, onSave }: { id: string; label: string; text: string; saving: boolean; guard: string | undefined; error: Msg | null; onCancel(): void; onSave(value: string): void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(text);
  const changed = draft.trim() !== text.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (changed && draft.trim() && !saving && !guard) onSave(draft.trim());
    else if (!changed) onCancel();
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };
  return (
    <form className="text-edit" data-form="text" onSubmit={submit} onKeyDown={onKeyDown}>
      <label className="sr" htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" rows={5} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} />
      <NoneImpact text="plan.text.impact" />
      <SaveError error={error} />
      <div className="two">
        <button type="submit" className="pill primary" data-act="save-text" disabled={saving || !!guard || !draft.trim()} title={guard}>{t(saving ? "plan.saving" : "plan.save")}</button>
        <button type="button" className="pill" data-act="cancel-edit" onClick={onCancel}>{t("plan.cancel")}</button>
        {!draft.trim() ? <span className="hint">{t("plan.text.required")}</span> : null}
      </div>
    </form>
  );
}
