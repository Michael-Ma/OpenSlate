import { useI18n } from "../../i18n/I18n.tsx";
import type { Msg } from "../../model/types.ts";
import { Modal } from "./Modal.tsx";

/** The open editor's first field: where focus goes back to after Keep editing, or into the editor just opened. */
const editorField = () => document.querySelector<HTMLElement>('main.plan form[data-form] :is(input, textarea)');

/**
 * Opening another editor, or adding a shot or scene (which opens one), would close an editor with unsaved text:
 * ask first. Keep editing is the default (Esc too); Discard changes throws the text away and goes on.
 */
export function DiscardDialog({ name, onKeep, onDiscard }: { name: Msg; onKeep(): void; onDiscard(): void }) {
  const { t, tm } = useI18n();
  return (
    <Modal className="dialog plan-dialog" labelledBy="plan-discard-title" returnTo={editorField} onClose={onKeep}>
      <h2 id="plan-discard-title">{t("plan.discard.title", { name: tm(name) })}</h2>
      <p className="hint">{t("plan.discard.body")}</p>
      <div className="foot">
        <button type="button" className="pill" data-act="discard-keep" data-autofocus onClick={onKeep}>{t("plan.discard.keep")}</button>
        <button type="button" className="pill primary" data-act="discard-confirm" onClick={onDiscard}>{t("plan.discard.confirm")}</button>
      </div>
    </Modal>
  );
}
