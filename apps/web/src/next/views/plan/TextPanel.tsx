import { useId, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { msg, type Msg } from "../../model/types.ts";
import { ConflictNotice, conflictAria, UnconfirmedNotice, type Unconfirmed } from "./Notices.tsx";
import { heldDraft, type DraftSlot } from "./useHeld.ts";

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
  /** Where the draft is kept (in the Plan view, by place). */
  slot: DraftSlot;
  onRetry(): void;
  onDismiss(): void;
  onCancel(): void;
  onSave(value: string): void;
}

/**
 * A text held against its saved value while it is edited (model/plan-conflict.ts): untouched, it follows the saved
 * film; changed under the person's own text, the save waits for Keep my text or Use saved text. The ids tie the
 * field and the turned-off Save to the notice and the hint that say why.
 */
export function useHeldText(saved: string, { saving, guard, unconfirmed, slot, onCancel, onSave }: Pick<FormState, "saving" | "guard" | "unconfirmed" | "slot" | "onCancel" | "onSave">) {
  const id = useId();
  const held = heldDraft({ text: saved }, slot);
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
  const ids = { conflict: `${id}-conflict`, hint: `${id}-hint`, input: `${id}-input` };
  /** After Keep my text or Use saved text the notice goes: focus returns to the text. */
  const choose = (pick: () => void) => () => {
    pick();
    requestAnimationFrame(() => document.getElementById(ids.input)?.focus());
  };
  return { held, value, stale, canSave, submit, hint, ids, keep: choose(held.keep), takeSaved: choose(held.takeSaved), fieldAria: conflictAria(ids.conflict, stale) };
}

/** The notices under an open text form: the saved text changed, or the save's reply was lost. */
export function FormNotices({ conflictId, stale, unconfirmed, saving, onKeep, onTakeSaved, onRetry, onDismiss }: { conflictId: string; stale: boolean; unconfirmed: Unconfirmed | null; saving: boolean; onKeep(): void; onTakeSaved(): void; onRetry(): void; onDismiss(): void }) {
  return (
    <>
      {stale ? <ConflictNotice id={conflictId} message={msg("plan.conflict.text")} onKeep={onKeep} onTakeSaved={onTakeSaved} /> : null}
      {unconfirmed ? <UnconfirmedNotice notice={unconfirmed} busy={saving} onRetry={onRetry} onDismiss={onDismiss} /> : null}
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
      {editing ? <TextForm key={field} label={title} text={text} {...form} />
        : <p className="text-block">{text.trim() ? text : <span className="muted">{t("plan.text.empty")}</span>}</p>}
    </section>
  );
}

function TextForm({ label, text, ...form }: FormState & { label: string; text: string }) {
  const { t } = useI18n();
  const { held, value, stale, canSave, submit, hint, ids, keep, takeSaved, fieldAria } = useHeldText(text, form);
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); form.onCancel(); } };
  const footHint = hint ? t(hint) : !value.trim() ? t("plan.text.required") : null;
  return (
    <form className="text-edit" data-form="text" onSubmit={submit} onKeyDown={onKeyDown}>
      <label className="sr" htmlFor={ids.input}>{label}</label>
      <textarea id={ids.input} className="textarea" rows={5} value={value} autoFocus data-conflict={stale || undefined} {...fieldAria} onChange={(event) => held.set("text", event.target.value)} />
      <NoneImpact text="plan.text.impact" />
      <FormNotices conflictId={ids.conflict} stale={stale} unconfirmed={form.unconfirmed} saving={form.saving} onKeep={keep} onTakeSaved={takeSaved} onRetry={form.onRetry} onDismiss={form.onDismiss} />
      {form.unconfirmed ? null : <SaveError error={form.error ?? null} />}
      <div className="two">
        <button type="submit" className="pill primary" data-act="save-text" disabled={!canSave} title={form.guard ?? (hint ? t(hint) : undefined)} aria-describedby={footHint ? ids.hint : undefined}>{t(form.saving ? "plan.saving" : "plan.save")}</button>
        <button type="button" className="pill" data-act="cancel-edit" onClick={form.onCancel}>{t("plan.cancel")}</button>
        {footHint ? <span className="hint" id={ids.hint}>{footHint}</span> : null}
      </div>
    </form>
  );
}
