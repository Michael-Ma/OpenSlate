import { useEffect, useRef, type ReactNode } from "react";

/**
 * A right-hand sheet on a native modal <dialog>: focus stays inside, Esc closes it (unless `holdOpen`),
 * and focus returns to whatever opened it. The parent shows it by rendering it and closes it by
 * unmounting it from `onClose`.
 */
export function Sheet({ labelledBy, onClose, holdOpen = false, className = "", act, children }: {
  labelledBy: string;
  onClose(): void;
  /** While true, Esc does nothing (e.g. while the studio is storing an import). */
  holdOpen?: boolean;
  className?: string;
  act?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const hold = useRef(holdOpen);
  hold.current = holdOpen;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!hold.current) close.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
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
