import { useEffect, useRef, useState, type ReactNode } from "react";

/** Where focus lands when the element that opened a dialog is gone (e.g. a deleted scene's menu button). */
export const PLAN_TITLE_ID = "plan-title";

const firstFocus = (dialog: HTMLDialogElement) =>
  dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),button:not(:disabled)");

/**
 * A native modal <dialog> (system.css 8.6): the browser contains focus; Esc asks the owner to close it; on close
 * focus returns to `returnTo`'s element, else to the element that opened it, or to the view title when that element
 * was removed. Focus starts
 * on the step's [data-autofocus] element. When `step` changes, focus moves to the new step's unless it is already
 * in the new step's content: the old step's element is gone, and the dialog's own chrome ([data-modal-chrome],
 * e.g. the header's Close, where the browser puts focus when a focused button turns off) is not a choice.
 */
export function Modal({ className, labelledBy, step, returnTo, onClose, children }: { className: string; labelledBy: string; step?: string; returnTo?: () => HTMLElement | null; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Read during render, before the dialog takes focus.
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  // Where focus goes on close when the owner knows better than the opener (e.g. back into an open editor).
  const returnRef = useRef(returnTo);
  returnRef.current = returnTo;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    firstFocus(dialog)?.focus();
    return () => {
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        const back = returnRef.current?.() ?? (opener?.isConnected ? opener : document.getElementById(PLAN_TITLE_ID));
        back?.focus({ preventScroll: true });
      });
    };
  }, [opener]);

  const shownStep = useRef(step);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || shownStep.current === step) return;
    shownStep.current = step;
    const active = document.activeElement;
    const kept = !!active && active !== dialog && dialog.contains(active) && !active.closest("[data-modal-chrome]");
    if (!kept) firstFocus(dialog)?.focus();
  }, [step]);

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      {children}
    </dialog>
  );
}
