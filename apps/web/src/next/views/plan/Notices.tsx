import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { keptText, type KeptField } from "../../model/plan-drafts.ts";
import type { Msg } from "../../model/types.ts";
import { Rich } from "./Rich.tsx";

/**
 * The saved film changed under an open draft (model/plan-conflict.ts): the person's text is kept, and the save
 * waits for Keep my text or Use saved text. Neutral, with an icon and words: an app fact, not the Director's.
 * `id` lets the conflicting fields and the turned-off Save point at it (aria-describedby).
 */
export function ConflictNotice({ id, message, onKeep, onTakeSaved }: { id: string; message: Msg; onKeep(): void; onTakeSaved(): void }) {
  const { t, tm } = useI18n();
  return (
    <div className="conflict wide" role="alert" id={id} data-notice="conflict">
      <span className="ic" aria-hidden="true">!</span>
      <span className="txt"><Rich text={tm(message)} /></span>
      <span className="acts">
        <button type="button" className="pill sm" data-act="conflict-keep" onClick={onKeep}>{t("plan.conflict.keep")}</button>
        <button type="button" className="pill sm" data-act="conflict-saved" onClick={onTakeSaved}>{t("plan.conflict.use_saved")}</button>
      </span>
    </div>
  );
}

/** What a conflicting field carries: marked invalid, and described by the notice (and its own hint, if any). */
export function conflictAria(conflictId: string, conflicting: boolean, own?: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  if (!conflicting) return own ? { "aria-describedby": own } : {};
  return { "aria-invalid": true, "aria-describedby": own ? `${conflictId} ${own}` : conflictId };
}

export interface Unconfirmed {
  /** The press, so its notice is its own: only its resend, a dismiss or a cancel clears it. */
  pressId: string;
  /** "edit 1.2", "move 3.1": what may or may not have been saved. */
  change: Msg;
  /** Where it is said: in the open editor with this key ("shot:<id>", "brief", "title:<sceneId>"), the import sheet, or the view. */
  place: string;
  /** The retry also went unanswered. */
  still: boolean;
}

/**
 * A press whose reply was lost: it may or may not have been saved. "Retry the same request" resends it with the
 * same key, so the server answers with what happened and never applies it twice; Dismiss reads the studio again
 * instead. In an editor it sits where the save's reason would; for the outline's own actions (or an editor that is
 * gone) it is in the strip under the header.
 */
export function UnconfirmedNotice({ notice, busy, strip, onRetry, onDismiss }: { notice: Unconfirmed; busy: boolean; strip?: boolean; onRetry(): void; onDismiss?(): void }) {
  const { t, tm } = useI18n();
  return (
    <div className={strip ? "unconfirmed strip-note" : "unconfirmed wide"} role="alert" data-notice="unconfirmed" data-press={notice.pressId}>
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

/**
 * An open editor whose shot or scene was deleted underneath (the Director, another window): the person's unsaved
 * text stays on screen, with Copy and Close, instead of going with the editor. Neutral: an app fact.
 */
export function KeptDraft({ notice, fields, onClose }: { notice: Msg; fields: readonly KeptField[]; onClose(): void }) {
  const { t, tm } = useI18n();
  const id = useId();
  const ref = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  // It takes the editor's place on screen: bring it into sight, and take focus when it went with the editor.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    const active = document.activeElement;
    if (!active || active === document.body) element.querySelector<HTMLElement>('[data-act="kept-copy"]')?.focus({ preventScroll: true });
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(keptText(fields));
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <section ref={ref} className="kept panel" aria-labelledby={`${id}-h`} data-notice="kept">
      <h2 className="sr" id={`${id}-h`}>{t("plan.kept.label")}</h2>
      <div className="kept-head" role="alert">
        <span className="ic" aria-hidden="true">!</span>
        <span className="txt"><Rich text={tm(notice)} /></span>
      </div>
      <dl>
        {fields.map((field) => (
          <div key={field.key} data-kept={field.key}>
            <dt>{field.label}</dt>
            <dd>{field.value}</dd>
          </div>
        ))}
      </dl>
      <div className="acts">
        <button type="button" className="pill sm primary" data-act="kept-copy" onClick={() => void copy()}>{t(copied === "done" ? "plan.kept.copied" : "plan.kept.copy")}</button>
        <button type="button" className="pill sm" data-act="kept-close" onClick={onClose}>{t("plan.kept.close")}</button>
        <span className="hint" role="status">{copied === "failed" ? t("plan.kept.copy_failed") : ""}</span>
      </div>
    </section>
  );
}
