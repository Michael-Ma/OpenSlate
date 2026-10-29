import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * A native modal <dialog>: focus stays inside, Esc asks to close (unless `locked`), and focus goes back
 * to the control that opened it, or to the view title when that control is gone.
 */
export function Dialog({ className, labelledBy, onClose, locked = false, initialFocus, children }: {
  className: string;
  labelledBy: string;
  onClose(): void;
  /** While work runs (creating a film), Esc does nothing and the dialog stays. */
  locked?: boolean;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    initialFocus?.current?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      if (!lockedRef.current) onCloseRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>("[data-view='start'] h1")?.focus({ preventScroll: true });
    };
    // Opened once per mount; the opener is whatever had focus then. `initialFocus` is read once on purpose.
  }, []);

  return <dialog ref={ref} className={className} aria-labelledby={labelledBy}>{children}</dialog>;
}
