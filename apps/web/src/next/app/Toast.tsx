import { useCallback, useEffect, useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { NARROW_QUERY, pauseCountdown, resumeCountdown, startCountdown, toastLifetime, toastSpot, type Countdown, type ScreenBox } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useGuarded } from "./useWriteGuard.ts";
import "./toast.css";

const screenBox = (element: Element): ScreenBox => {
  const { top, bottom, left, width } = element.getBoundingClientRect();
  return { top, bottom, left, width };
};

/**
 * From 900 px, puts the toast where `toastSpot` says: over the top of the view's picture, else at the top (or, in a
 * view with neither a picture nor a title row, the foot) of the workspace. Below 900 px the stylesheet keeps it at
 * the foot of the screen.
 */
function placeToast(toast: HTMLElement): void {
  const narrow = window.matchMedia(NARROW_QUERY).matches;
  const main = narrow ? null : document.querySelector("main.work");
  if (!main) {
    for (const name of ["--toast-top", "--toast-x", "--toast-max"]) toast.style.removeProperty(name);
    return;
  }
  const picture = main.querySelector(".preview");
  const head = picture?.querySelector(".pv-head, .pv-top") ?? null;
  const spot = toastSpot({
    workspace: screenBox(main),
    picture: picture ? screenBox(picture) : null,
    pictureHead: head ? screenBox(head) : null,
    titled: !!main.querySelector(".view-head"),
    viewportHeight: window.innerHeight,
    toastHeight: toast.offsetHeight,
  });
  // Only what moved is written, so a page that keeps changing under it (a playing clock) costs no style work.
  const set = (name: string, value: number) => {
    const px = `${Math.round(value)}px`;
    if (toast.style.getPropertyValue(name) !== px) toast.style.setProperty(name, px);
  };
  set("--toast-top", spot.top);
  set("--toast-x", spot.centre);
  set("--toast-max", spot.maxWidth);
}

/**
 * One toast at a time. Info leaves after about 6 s unless the pointer or focus is on it; errors stay
 * until dismissed. Two live regions exist from the start so screen readers hear each new toast:
 * polite for info, assertive for errors. Undo writes, so it follows the write guard.
 */
export function Toast() {
  const store = useStore();
  const { t, tm } = useI18n();
  const toast = useStudio((s) => s.toast);
  const undoGuard = useGuarded("server");
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

  // Placed before it paints, then kept in place while the page under it moves: a scroll, a resize, a banner that
  // changed height with the same action, a strip that came or went, another view.
  useLayoutEffect(() => {
    const toast = box.current;
    if (id === undefined || !toast) return;
    placeToast(toast);
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (box.current) placeToast(box.current); });
    };
    const observer = new MutationObserver(later);
    observer.observe(document.querySelector(".app") ?? document.body, { childList: true, subtree: true });
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later, true);
    };
  }, [id]);

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
      {(toast.undoCommandId || toast.undoKey) && (
        <button type="button" className="pill" data-act="undo" {...undoGuard} onClick={() => { const shown = toast; close(() => store.undoToast(shown)); }}>
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
