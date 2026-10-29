import { useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { MessageId } from "../i18n/messages.ts";
import type { Msg } from "../model/types.ts";
import { useGuarded } from "./useWriteGuard.ts";
import "./give-up.css";

/** The words of one acknowledged recovery action: what it means, what the person acknowledges, and its two buttons. */
export interface RecoveryLabels {
  note: MessageId | null;
  ack: MessageId;
  open: MessageId;
  confirm: MessageId;
  /** A short head line naming the situation (v8 visual pass), and the money tag beside it. */
  title?: MessageId;
  charge?: MessageId;
}
const GIVE_UP: RecoveryLabels = { note: "inspector.give_up_note", ack: "inspector.give_up_ack", open: "inspector.give_up", confirm: "inspector.give_up_confirm", title: "recovery.title.give_up", charge: "recovery.charge.maybe" };

/** "for 2 h 5 min" / "for 12 min" since a job was sent, or null without a usable time. */
function sinceMsg(startedAt: string | null | undefined, now: number): Msg | null {
  const at = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(at) || at > now) return null;
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  if (minutes < 60) return { id: "recovery.since_minutes", values: { minutes } };
  return minutes % 60 ? { id: "recovery.since_hours", values: { hours: Math.floor(minutes / 60), minutes: minutes % 60 } } : { id: "recovery.since_hours_only", values: { hours: minutes / 60 } };
}

/**
 * Give up on a job the service never confirmed (plan decision D7): an explicit acknowledgement first, since it may
 * still finish and be charged. Shared by the inspector and the Director's transcription line. `note`: say what an
 * unconfirmed job means above the button (the inspector); a line that already says it leaves it out.
 * The same acknowledged pattern serves the rule-drift recovery actions (decisions R2-R4) through `labels` and `act`:
 * discarding a finished job, stopping waiting for a running one, and rendering interrupted local work again.
 * Each says first what happened and whether money is involved (the head line and its tag), then the action.
 */
export function GiveUp({ attemptId, busy, onRelease, className = "insp-alert", note = true, labels = GIVE_UP, act = "give-up", reason = null, since = null }: {
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
  /** When the job was sent: a job still reported running says for how long (decision R3). */
  since?: string | null;
}) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const ack = `${act}-ack-${attemptId}`;
  const elapsed = sinceMsg(since, Date.now());
  return (
    <div className={`${className} give-up`} role="status" data-attempt={attemptId} data-recovery={act} data-open={open || undefined}>
      {note && labels.title ? (
        <div className="gu-head">
          <i className="gu-ic" aria-hidden="true">!</i>
          <b>{t(labels.title)}</b>
          {labels.charge ? <span className="gu-charge" data-charge={labels.charge}>{t(labels.charge)}</span> : null}
        </div>
      ) : null}
      {note && labels.note ? <p>{t(labels.note)}{elapsed ? <> <span className="gu-since">{tm(elapsed)}</span></> : null}</p> : null}
      {reason ? <p className="reason" data-reason="native">{t("inspector.no_answer_reason", { reason: tm(reason) })}</p> : null}
      {open ? (
        <div className="gu-confirm">
          <label className="ack" htmlFor={ack}>
            <input id={ack} type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>{t(labels.ack)}</span>
          </label>
          <div className="two">
            <button type="button" className="pill chosen" data-act={`${act}-confirm`} {...server} disabled={!acknowledged || busy || server.disabled} onClick={() => onRelease(attemptId)}>{t(labels.confirm)}</button>
            <button type="button" className="pill" data-act={`${act}-cancel`} onClick={() => { setOpen(false); setAcknowledged(false); }}>{t("inspector.cancel")}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="pill sm" data-act={act} {...server} onClick={() => setOpen(true)}>{t(labels.open)}</button>
      )}
    </div>
  );
}
