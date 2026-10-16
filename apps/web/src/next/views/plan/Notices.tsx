import { useI18n } from "../../i18n/I18n.tsx";
import type { Msg } from "../../model/types.ts";
import { Rich } from "./Rich.tsx";

/**
 * The saved film changed under an open draft (model/plan-conflict.ts): the person's text is kept, and the save
 * waits for Keep my text or Use saved text. Neutral, with an icon and words: an app fact, not the Director's.
 */
export function ConflictNotice({ message, onKeep, onTakeSaved }: { message: Msg; onKeep(): void; onTakeSaved(): void }) {
  const { t, tm } = useI18n();
  return (
    <div className="conflict wide" role="alert" data-notice="conflict">
      <span className="ic" aria-hidden="true">!</span>
      <span className="txt"><Rich text={tm(message)} /></span>
      <span className="acts">
        <button type="button" className="pill sm" data-act="conflict-keep" onClick={onKeep}>{t("plan.conflict.keep")}</button>
        <button type="button" className="pill sm" data-act="conflict-saved" onClick={onTakeSaved}>{t("plan.conflict.use_saved")}</button>
      </span>
    </div>
  );
}

export interface Unconfirmed {
  /** "edit 1.2", "move 3.1": what may or may not have been saved. */
  change: Msg;
  /** Where it is said: in the open editor with this key ("shot:<id>", "brief", "title:<sceneId>"), the import sheet, or the view. */
  place: string;
  /** The retry also went unanswered. */
  still: boolean;
}

/**
 * A press whose reply was lost: it may or may not have been saved. "Retry the same request" resends it with the
 * same key, so the server answers with what happened and never applies it twice. In an editor it sits where the
 * save's reason would; for the outline's own actions it is a strip under the header.
 */
export function UnconfirmedNotice({ notice, busy, strip, onRetry, onDismiss }: { notice: Unconfirmed; busy: boolean; strip?: boolean; onRetry(): void; onDismiss?(): void }) {
  const { t, tm } = useI18n();
  return (
    <div className={strip ? "unconfirmed strip-note" : "unconfirmed wide"} role="alert" data-notice="unconfirmed">
      <span className="ic" aria-hidden="true">?</span>
      <span className="txt">
        <b>{t("plan.unconfirmed.title", { change: tm(notice.change) })}</b>{" "}
        <span>{t(notice.still ? "plan.unconfirmed.still" : "plan.unconfirmed.body")}</span>
      </span>
      <span className="acts">
        <button type="button" className="pill sm primary" data-act="retry-same" disabled={busy} onClick={onRetry}>{t("plan.unconfirmed.retry")}</button>
        {onDismiss ? <button type="button" className="pill sm" data-act="retry-dismiss" onClick={onDismiss}>{t("plan.unconfirmed.dismiss")}</button> : null}
      </span>
    </div>
  );
}
