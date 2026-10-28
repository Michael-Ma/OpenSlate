import { useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { useGuarded } from "./useWriteGuard.ts";
import "./give-up.css";

/**
 * Give up on a job the service never confirmed (plan decision D7): an explicit acknowledgement first, since it may
 * still finish and be charged. Shared by the inspector and the Director's transcription line. `note`: say what an
 * unconfirmed job means above the button (the inspector); a line that already says it leaves it out.
 */
export function GiveUp({ attemptId, busy, onRelease, className = "insp-alert", note = true }: {
  attemptId: string;
  busy: boolean;
  onRelease(attemptId: string): void;
  className?: string;
  note?: boolean;
}) {
  const { t } = useI18n();
  const server = useGuarded("server");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const ack = `give-up-ack-${attemptId}`;
  return (
    <div className={`${className} give-up`} role="status" data-attempt={attemptId}>
      {note ? <p>{t("inspector.give_up_note")}</p> : null}
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
