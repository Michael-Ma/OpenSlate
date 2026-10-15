import { useEffect, useRef, useState, type ReactNode } from "react";

/** Where focus lands when the element that opened a dialog is gone (e.g. a deleted scene's menu button). */
export const PLAN_TITLE_ID = "plan-title";

/**
 * A native modal <dialog> (system.css 8.6): the browser contains focus; Esc asks the owner to close it; on close
 * focus returns to the element that opened it, or to the view title when that element was removed.
 */
export function Modal({ className, labelledBy, onClose, children }: { className: string; labelledBy: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Read during render, before the dialog takes focus.
  const [opener] = useState(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const first = dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),button:not(:disabled)");
    first?.focus();
    return () => {
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        const back = opener?.isConnected ? opener : document.getElementById(PLAN_TITLE_ID);
        back?.focus({ preventScroll: true });
      });
    };
  }, [opener]);

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
