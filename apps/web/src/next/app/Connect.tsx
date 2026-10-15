import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { codeSegments } from "../model/shell.ts";
import { ReconnectNote } from "../views/start/ReconnectNote.tsx";
import "./connect.css";

/**
 * Shown before the studio answers, when the window's session expired, or when the studio could not be reached.
 * Rendered outside the studio store (boot shows it while no session exists), so it only reads the language.
 * Once it cannot connect, Start's note says the films are safe and that jobs cut off by a restart are never
 * resent by themselves (P5-DESIGN "Reconnect after a restart", GR-14).
 */
export function Connect({ state, onRetry }: { state: "connecting" | "expired" | "failed"; onRetry(): void }) {
  const { t } = useI18n();
  const retry = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (state !== "connecting") retry.current?.focus(); }, [state]);

  return (
    <main className="connect" data-state={state} aria-busy={state === "connecting"}>
      <div className="connect-card">
        <div className="brand">
          <span className="logo" aria-hidden="true"><i /></span>
          <span className="word">{t("app.name")}</span>
        </div>
        {state === "connecting" ? (
          <p className="connect-wait" role="status">
            <span className="connect-dots" aria-hidden="true"><i /><i /><i /></span>
            {t("connect.connecting")}
          </p>
        ) : (
          <>
            <h1>{t("connect.title")}</h1>
            <p className="connect-reason" role="alert">{t(state === "expired" ? "connect.expired" : "connect.failed")}</p>
            <p className="connect-how">
              {codeSegments(t("connect.body")).map((part, index) => (part.code ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>))}
            </p>
            <ReconnectNote />
            <button ref={retry} type="button" className="pill primary" data-act="retry" onClick={onRetry}>{t("connect.retry")}</button>
          </>
        )}
      </div>
    </main>
  );
}
