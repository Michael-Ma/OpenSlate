import { useId, useRef } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { Film } from "../../model/start-commands.ts";
import { Dialog } from "./Dialog.tsx";

/**
 * Archive is soft: the film leaves the list and its media stays. The server refuses while jobs run
 * (ATTEMPTS_RUNNING), so for the open film, whose jobs are known, the dialog says so and waits.
 */
export function ArchiveDialog({ film, current, running, busy, offline, onConfirm, onCancel }: {
  film: Film;
  current: boolean;
  running: number;
  busy: boolean;
  offline: string | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog className="dialog start-dialog" labelledBy={titleId} onClose={onCancel} initialFocus={cancel}>
      <h2 id={titleId}>{t("start.archive.title", { name: film.name })}</h2>
      <ul>
        <li>{t("start.archive.keeps")}</li>
        <li>{t("start.archive.restore_hint")}</li>
        {current && <li>{t("start.archive.open_film")}</li>}
        {running > 0 && <li className="strong" role="status">{t("start.archive.running", { count: running })}</li>}
      </ul>
      <div className="foot">
        <button ref={cancel} type="button" className="pill" data-act="archive-cancel" onClick={onCancel}>{t("start.archive.cancel")}</button>
        <button
          type="button"
          className="pill primary"
          data-act="archive-confirm"
          disabled={busy || running > 0 || !!offline}
          title={offline ?? undefined}
          onClick={onConfirm}
        >
          {busy ? t("start.busy") : t("start.archive.confirm")}
        </button>
      </div>
    </Dialog>
  );
}
