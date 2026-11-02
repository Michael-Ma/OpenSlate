import { useMemo, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { stopLines, stopPreview } from "../model/shell-states.ts";
import { useStudio } from "../store/react.tsx";
import { useModalDialog } from "./useModalDialog.ts";

/**
 * The confirm before Stop (GR-13): what finishes and is charged, what is taken off and needs a new confirm,
 * and that the Director stops. The counts follow the film live while the dialog is open.
 * Esc and Keep going close it; focus returns to Stop, or to Continue once Stop is gone.
 */
export function StopDialog({ onClose, onStop }: { onClose(): void; onStop(): void }) {
  const { t, tm } = useI18n();
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const lines = useMemo(() => stopLines(stopPreview(overview, director)), [overview, director]);
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, onClose, () => document.querySelector<HTMLElement>("[data-act='continue-film']"));

  return (
    <dialog ref={ref} className="shell-dialog" data-dialog="stop" aria-labelledby="stop-dialog-title" aria-describedby="stop-dialog-body">
      <h2 id="stop-dialog-title">{t("stop.dialog.title")}</h2>
      <div id="stop-dialog-body">
        <p>{t("stop.dialog.body")}</p>
        {lines.length > 0 && <ul>{lines.map((line) => <li key={line.id}>{tm(line)}</li>)}</ul>}
      </div>
      <div className="foot">
        <button type="button" className="pill" data-act="keep-going" onClick={onClose}>{t("stop.dialog.keep")}</button>
        <button type="button" className="pill primary" data-act="confirm-stop" onClick={onStop}>{t("stop.button")}</button>
      </div>
    </dialog>
  );
}
