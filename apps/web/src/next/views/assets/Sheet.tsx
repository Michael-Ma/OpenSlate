import { useEffect, useRef, type ReactNode } from "react";

/**
 * A right-hand sheet on a native modal <dialog>: focus stays inside, Esc closes it, and focus returns
 * to whatever opened it. The parent shows it by rendering it and closes it by unmounting it from `onClose`.
 *
 * The browser can close the dialog on its own (a second Esc without a click in between cannot be held), so
 * its `close` event also calls `onClose`: a closed dialog never stays mounted behind React's back. `onClose`
 * is called once.
 */
export function Sheet({ labelledBy, onClose, className = "", act, children }: {
  labelledBy: string;
  onClose(): void;
  className?: string;
  act?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    let closing = false;
    const closeOnce = () => {
      if (closing) return;
      closing = true;
      close.current();
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeOnce();
    };
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", closeOnce);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", closeOnce);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("main[data-view='assets'] h1")?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog ref={ref} className={`sheet ${className}`.trim()} aria-labelledby={labelledBy} data-act={act}>
      {children}
    </dialog>
  );
}
