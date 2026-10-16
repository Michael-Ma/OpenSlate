import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { errorMsg } from "../i18n/translate.ts";
import { codeSegments } from "../model/shell.ts";
import type { Msg } from "../model/types.ts";
import { useStore } from "../store/react.tsx";
import { useModalDialog } from "./useModalDialog.ts";

/**
 * The confirm before Disconnect this studio: the window stops being connected, the films stay on this computer,
 * anything running carries on, and coming back needs a fresh link from `pnpm studio`. Esc and Stay connected close it
 * (focus returns to the menu button). Disconnect ends the session (POST /api/session/logout); once the studio confirms
 * it the page becomes the Connect screen. A refusal or no answer is said here, since the toast sits behind the modal.
 */
export function DisconnectDialog({ onClose, onDisconnected }: { onClose(): void; onDisconnected(): void }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Msg | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useModalDialog(ref, onClose, () => document.querySelector<HTMLElement>(".topbar [data-act='studio-menu']"));

  const disconnect = () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    void store.disconnect().then((code) => {
      if (code === null) { onDisconnected(); return; }
      if (!mounted.current) return;
      setBusy(false);
      setProblem(errorMsg(code));
    });
  };

  return (
    <dialog ref={ref} className="shell-dialog" data-dialog="disconnect" aria-labelledby="disconnect-title" aria-describedby="disconnect-body">
      <h2 id="disconnect-title">{t("disconnect.title")}</h2>
      <div id="disconnect-body">
        <p>{t("disconnect.body")}</p>
        <p>{codeSegments(t("disconnect.how")).map((part, index) => (part.code ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>))}</p>
      </div>
      <p className="still" role="alert">{problem ? tm(problem) : ""}</p>
      <div className="foot">
        <button type="button" className="pill" data-act="stay-connected" onClick={onClose}>{t("disconnect.keep")}</button>
        {/* aria-disabled while it is sent, so focus stays on the button inside the modal. */}
        <button type="button" className="pill primary" data-act="confirm-disconnect" aria-disabled={busy} aria-busy={busy || undefined} onClick={disconnect}>
          {t(busy ? "disconnect.busy" : "disconnect.confirm")}
        </button>
      </div>
    </dialog>
  );
}
