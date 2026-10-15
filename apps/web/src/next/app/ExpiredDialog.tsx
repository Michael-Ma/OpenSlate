import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { codeSegments } from "../model/shell.ts";
import { useModalDialog } from "./useModalDialog.ts";

/** How long Try again waits for a new session before it says the window is still not connected. */
const RETRY_WAIT_MS = 1500;

/**
 * The session expired while the studio was open (OpenSlate restarted, or 12 hours passed). A modal over the
 * page, so nothing on screen is lost; Esc does not dismiss it because nothing works until the window connects.
 * Try again asks for a new session; a successful one replaces the store and this dialog goes away.
 */
export function ExpiredDialog({ onRetry }: { onRetry(): void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [trying, setTrying] = useState(false);
  useModalDialog(ref, null);

  useEffect(() => {
    if (!attempt) return;
    const timer = setTimeout(() => setTrying(false), RETRY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [attempt]);

  // aria-disabled rather than disabled while trying, so focus stays on the button inside the modal.
  const retry = () => {
    if (trying) return;
    setTrying(true);
    setAttempt((n) => n + 1);
    onRetry();
  };

  return (
    <dialog ref={ref} className="shell-dialog expired" data-dialog="expired" aria-labelledby="expired-title" aria-describedby="expired-body">
      <h2 id="expired-title">{t("expired.title")}</h2>
      <div id="expired-body">
        <p>{t("expired.body")}</p>
        <p>{codeSegments(t("expired.how")).map((part, index) => (part.code ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>))}</p>
      </div>
      <p className="still" role="status">{attempt > 0 && !trying ? t("expired.still") : ""}</p>
      <div className="foot">
        <button type="button" className="pill primary" data-act="reconnect" aria-disabled={trying} onClick={retry}>
          {t(trying ? "connect.connecting" : "connect.retry")}
        </button>
      </div>
    </dialog>
  );
}
