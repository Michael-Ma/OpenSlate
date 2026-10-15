import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { pauseCountdown, resumeCountdown, startCountdown, toastLifetime, type Countdown } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import "./toast.css";

/**
 * One toast at a time. Info leaves after about 6 s unless the pointer or focus is on it; errors stay
 * until dismissed. Two live regions exist from the start so screen readers hear each new toast:
 * polite for info, assertive for errors.
 */
export function Toast() {
  const store = useStore();
  const { t, tm } = useI18n();
  const toast = useStudio((s) => s.toast);
  const countdown = useRef<Countdown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const id = toast?.id;
  const lifetime = toast ? toastLifetime(toast) : null;

  const arm = useCallback((toastId: number) => {
    clearTimeout(timer.current);
    const running = countdown.current;
    if (!running || running.since === null) return;
    timer.current = setTimeout(() => {
      if (store.getState().toast?.id === toastId) store.dismissToast();
    }, running.remaining);
  }, [store]);

  useEffect(() => {
    if (id === undefined || lifetime === null) { countdown.current = null; return; }
    // A new toast may land under a still pointer or replace a focused one; read where they are now.
    hovered.current = box.current?.matches(":hover") ?? false;
    focused.current = box.current?.contains(document.activeElement) ?? false;
    const now = performance.now();
    const started = startCountdown(lifetime, now);
    countdown.current = hovered.current || focused.current ? pauseCountdown(started, now) : started;
    arm(id);
    return () => clearTimeout(timer.current);
  }, [id, lifetime, arm]);

  const hold = () => {
    const current = countdown.current;
    if (!current || id === undefined) return;
    const now = performance.now();
    countdown.current = hovered.current || focused.current ? pauseCountdown(current, now) : resumeCountdown(current, now);
    arm(id);
  };

  const close = (after?: () => void) => {
    const back = focused.current ? returnFocus.current : null;
    focused.current = false;
    hovered.current = false;
    store.dismissToast();
    after?.();
    if (back?.isConnected) back.focus();
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    returnFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
    focused.current = true;
    hold();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    focused.current = false;
    hold();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    // Handled here, so the Director drawer stays open.
    event.preventDefault();
    close();
  };

  const body = toast && (
    <div
      ref={box}
      className={`toast ${toast.tone}`}
      data-tone={toast.tone}
      onMouseEnter={() => { hovered.current = true; hold(); }}
      onMouseLeave={() => { hovered.current = false; hold(); }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    >
      <span>{tm(toast.message)}</span>
      {toast.undoCommandId && (
        <button type="button" className="pill" data-act="undo" onClick={() => { const commandId = toast.undoCommandId!; close(() => void store.undo(commandId)); }}>
          {t("shell.undo")}
        </button>
      )}
      <button type="button" className="pill ghost toast-close" data-act="toast-close" aria-label={t("shell.dismiss")} onClick={() => close()}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );

  return (
    <>
      <div className="toast-live" role="status" aria-live="polite">{toast?.tone === "info" && body}</div>
      <div className="toast-live" role="alert">{toast?.tone === "error" && body}</div>
    </>
  );
}
