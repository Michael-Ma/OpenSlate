import { Fragment, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { errorMsg } from "../../i18n/translate.ts";
import { codeSegments } from "../../model/shell.ts";
import type { Msg } from "../../model/types.ts";

/** One titled settings section: a panel with its scope ("for The Last Ferry", "every film"). */
export function Panel({ id, title, scope, end, children }: { id: string; title: MessageId; scope: string; end?: ReactNode; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="panel set-panel" id={id} aria-labelledby={`${id}-h`} data-section={id}>
      <div className="panel-head">
        <h2 id={`${id}-h`} tabIndex={-1}>{t(title)}</h2>
        <span className="scope">{scope}</span>
        {end && <span className="end">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** Like a native radio group, only the checked option of a group of radio buttons is in the tab order. */
export const radioTab = (checked: boolean): 0 | -1 => (checked ? 0 : -1);

/** Arrow keys move the choice inside a radio group of buttons (language, provider). */
export function onRadioKeys(event: KeyboardEvent<HTMLElement>) {
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  if (!forward && event.key !== "ArrowLeft" && event.key !== "ArrowUp") return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']:not(:disabled)")];
  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next = radios[(index + (forward ? 1 : radios.length - 1)) % radios.length];
  next?.focus();
  next?.click();
}

/** A section that has not been read yet, or whose read failed: the reason in words, the code only as a detail. */
export function ReadState({ error, onRetry }: { error: string | null; onRetry(): void }) {
  const { t, tm } = useI18n();
  if (!error) return <p className="lead" role="status">{t("set.loading")}</p>;
  return (
    <div className="set-readfail" role="alert">
      <span className="status fail" title={error} data-code={error}><i className="ic" aria-hidden="true">!</i>{t("set.read_failed", { reason: tm(errorMsg(error)) })}</span>
      <button type="button" className="pill sm" data-act="retry-read" onClick={onRetry}>{t("set.retry")}</button>
    </div>
  );
}

/** A film section while no film is open (Settings opened from Start): what it holds and how to change it. */
export function NoFilmPanel({ id, title, lead }: { id: string; title: MessageId; lead: MessageId }) {
  const { t } = useI18n();
  return (
    <Panel id={id} title={title} scope={t("set.scope.each_film")}>
      <p className="lead" data-no-film>{t(lead)}</p>
    </Panel>
  );
}

/** Readiness: green "✓ Ready" when it can run; otherwise the reason in plain neutral words. */
export function ReadyMark({ ready, reason, unchecked }: { ready: boolean; reason: Msg | null; unchecked?: boolean }) {
  const { t, tm } = useI18n();
  if (unchecked) return <span className="ready n">{t("set.status.not_checked")}</span>;
  if (ready) return <span className="ready y"><span aria-hidden="true">✓</span> {t("set.ready")}</span>;
  return <span className="ready n">{reason ? tm(reason) : null}</span>;
}

/**
 * A message with `backticks` around command names, which render as code. A command never wraps inside, so a line
 * may always break before one: in Chinese a full stop is followed by no space ("…--restart`。`./start.sh…").
 */
export function CodeText({ text }: { text: string }) {
  return <>{codeSegments(text).map((part, index) => (part.code ? <Fragment key={index}><wbr /><code className="mono cmd">{part.text}</code></Fragment> : <span key={index}>{part.text}</span>))}</>;
}

/**
 * A native modal dialog: focus stays inside, Esc closes it, and focus goes back to what opened it
 * (or to the view title when that is gone). Mounted while open.
 */
export function Dialog({ labelledBy, onClose, children }: { labelledBy: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onDialogClose = () => close.current();
    dialog.addEventListener("close", onDialogClose);
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[autofocus], button:not([disabled])");
    first?.focus();
    return () => {
      dialog.removeEventListener("close", onDialogClose);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-view='settings'] h1")?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} className="dialog set-dialog" aria-labelledby={labelledBy}>
      {children}
    </dialog>
  );
}
