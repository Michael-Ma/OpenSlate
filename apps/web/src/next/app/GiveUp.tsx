import { useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { MessageId } from "../i18n/messages.ts";
import type { Msg } from "../model/types.ts";
import { useGuarded } from "./useWriteGuard.ts";
import "./give-up.css";

/** The words of one acknowledged recovery action: what it means, what the person acknowledges, and its two buttons. */
export interface RecoveryLabels { note: MessageId | null; ack: MessageId; open: MessageId; confirm: MessageId }
const GIVE_UP: RecoveryLabels = { note: "inspector.give_up_note", ack: "inspector.give_up_ack", open: "inspector.give_up", confirm: "inspector.give_up_confirm" };

/**
 * Give up on a job the service never confirmed (plan decision D7): an explicit acknowledgement first, since it may
 * still finish and be charged. Shared by the inspector and the Director's transcription line. `note`: say what an
 * unconfirmed job means above the button (the inspector); a line that already says it leaves it out.
 * The same acknowledged pattern serves the rule-drift recovery actions (decisions R2-R4) through `labels` and `act`:
 * discarding a finished job, stopping waiting for a running one, and rendering interrupted local work again.
 */
export function GiveUp({ attemptId, busy, onRelease, className = "insp-alert", note = true, labels = GIVE_UP, act = "give-up", reason = null }: {
  attemptId: string;
  busy: boolean;
  onRelease(attemptId: string): void;
  className?: string;
  note?: boolean;
  labels?: RecoveryLabels;
  /** data-act prefix of the three buttons: `${act}`, `${act}-confirm` and `${act}-cancel`. */
  act?: string;
  /** An allowlisted reason line under the note (decision R1). */
  reason?: Msg | null;
}) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const ack = `${act}-ack-${attemptId}`;
  return (
    <div className={`${className} give-up`} role="status" data-attempt={attemptId} data-recovery={act}>
      {note && labels.note ? <p>{t(labels.note)}</p> : null}
      {reason ? <p className="reason" data-reason="native">{t("inspector.no_answer_reason", { reason: tm(reason) })}</p> : null}
      {open ? (
        <>
          <label className="ack" htmlFor={ack}>
            <input id={ack} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>{t(labels.ack)}</span>
          </label>
          <div className="two">
            <button type="button" className="pill chosen" data-act={`${act}-confirm`} {...server} disabled={!acknowledged || busy || server.disabled} onClick={() => onRelease(attemptId)}>{t(labels.confirm)}</button>
            <button type="button" className="pill" data-act={`${act}-cancel`} onClick={() => { setOpen(false); setAcknowledged(false); }}>{t("inspector.cancel")}</button>
          </div>
        </>
      ) : (
        <button type="button" className="pill sm" data-act={act} {...server} onClick={() => setOpen(true)}>{t(labels.open)}</button>
      )}
    </div>
  );
}
