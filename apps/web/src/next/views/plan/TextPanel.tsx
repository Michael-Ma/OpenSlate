import { useId, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { msg, type Msg } from "../../model/types.ts";
import { ConflictNotice, UnconfirmedNotice, type Unconfirmed } from "./Notices.tsx";
import { useHeld } from "./useHeld.ts";

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

/** The server's reason, said once where the edit (or delete) was made; neutral with an icon. */
export function SaveError({ error, lead = "plan.edit.not_saved" }: { error: Msg | null; lead?: "plan.edit.not_saved" | "plan.delete.not_deleted" }) {
  const { t, tm } = useI18n();
  return error ? <p className="edit-error" role="alert"><i className="ic" aria-hidden="true">!</i>{t(lead, { reason: tm(error) })}</p> : null;
}

/** What an open text form says and does when the saved text changes under it, or its save went unanswered. */
export interface FormState {
  saving: boolean;
  guard: string | undefined;
  error?: Msg | null;
  unconfirmed: Unconfirmed | null;
  onRetry(): void;
  onCancel(): void;
  onSave(value: string): void;
}

/**
 * A text held against its saved value while it is edited (model/plan-conflict.ts): untouched, it follows the saved
 * film; changed under the person's own text, the save waits for Keep my text or Use saved text.
 */
export function useHeldText(saved: string, { saving, guard, unconfirmed, onCancel, onSave }: Omit<FormState, "error" | "onRetry">) {
  const held = useHeld({ text: saved });
  const value = held.value.text;
  const stale = held.stale.length > 0;
  const changed = value.trim() !== saved.trim();
  const canSave = !saving && !guard && !!value.trim() && !stale && !unconfirmed;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!changed && !stale) onCancel();
    else if (changed && canSave) onSave(value.trim());
  };
  const hint = stale ? "plan.conflict.blocked" as const : unconfirmed ? "plan.unconfirmed.first" as const : null;
  return { held, value, stale, canSave, submit, hint };
}

/** The notices under an open text form: the saved text changed, or the save's reply was lost. */
export function FormNotices({ stale, unconfirmed, saving, onKeep, onTakeSaved, onRetry }: { stale: boolean; unconfirmed: Unconfirmed | null; saving: boolean; onKeep(): void; onTakeSaved(): void; onRetry(): void }) {
  return (
    <>
      {stale ? <ConflictNotice message={msg("plan.conflict.text")} onKeep={onKeep} onTakeSaved={onTakeSaved} /> : null}
      {unconfirmed ? <UnconfirmedNotice notice={unconfirmed} busy={saving} onRetry={onRetry} /> : null}
    </>
  );
}

interface Props extends FormState {
  field: "brief" | "story";
  text: string;
  editing: boolean;
  error: Msg | null;
  onEdit(): void;
}

/** Brief or Story: the text, with Edit opening it in place. */
export function TextPanel({ field, text, editing, onEdit, ...form }: Props) {
  const { t } = useI18n();
  const id = useId();
  const title = t(field === "brief" ? "plan.brief" : "plan.story");
  return (
    <section className="panel text-panel" aria-labelledby={`${id}-h`} data-panel={field}>
      <div className="panel-head">
        <span className="eyebrow" id={`${id}-h`}>{title}</span>
        {editing ? null : (
          <span className="end">
            <button type="button" className="pill sm" data-act="edit-text" data-field={field} aria-label={t("plan.edit_named", { name: title })} disabled={!!form.guard} title={form.guard} onClick={onEdit}>{t("plan.edit")}</button>
          </span>
        )}
      </div>
      {editing ? <TextForm key={field} id={`${id}-t`} label={title} text={text} {...form} />
        : <p className="text-block">{text.trim() ? text : <span className="muted">{t("plan.text.empty")}</span>}</p>}
    </section>
  );
}

function TextForm({ id, label, text, ...form }: FormState & { id: string; label: string; text: string }) {
  const { t } = useI18n();
  const { held, value, stale, canSave, submit, hint } = useHeldText(text, form);
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); form.onCancel(); } };
  return (
    <form className="text-edit" data-form="text" onSubmit={submit} onKeyDown={onKeyDown}>
      <label className="sr" htmlFor={id}>{label}</label>
      <textarea id={id} className="textarea" rows={5} value={value} autoFocus data-conflict={stale || undefined} onChange={(event) => held.set("text", event.target.value)} />
      <NoneImpact text="plan.text.impact" />
      <FormNotices stale={stale} unconfirmed={form.unconfirmed} saving={form.saving} onKeep={held.keep} onTakeSaved={held.takeSaved} onRetry={form.onRetry} />
      {form.unconfirmed ? null : <SaveError error={form.error ?? null} />}
      <div className="two">
        <button type="submit" className="pill primary" data-act="save-text" disabled={!canSave} title={form.guard ?? (hint ? t(hint) : undefined)}>{t(form.saving ? "plan.saving" : "plan.save")}</button>
        <button type="button" className="pill" data-act="cancel-edit" onClick={form.onCancel}>{t("plan.cancel")}</button>
        {hint ? <span className="hint">{t(hint)}</span> : !value.trim() ? <span className="hint">{t("plan.text.required")}</span> : null}
      </div>
    </form>
  );
}
