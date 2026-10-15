import { useEffect, useRef, type RefObject } from "react";

/**
 * Open a native <dialog> as a modal while the component is mounted: the rest of the page is inert and focus
 * stays inside. Esc closes it through `onCancel`, or does nothing when the dialog cannot be dismissed
 * (`onCancel` null). When it unmounts, focus goes back to whatever opened it, or to `fallback()` when that
 * control is gone (a Stop pill that disappears once the film is stopped).
 */
export function useModalDialog(
  ref: RefObject<HTMLDialogElement | null>,
  onCancel: (() => void) | null,
  fallback?: () => HTMLElement | null,
): void {
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const back = useRef(fallback);
  back.current = fallback;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const onCancelEvent = (event: Event) => {
      event.preventDefault();
      cancel.current?.();
    };
    dialog.addEventListener("cancel", onCancelEvent);
    return () => {
      dialog.removeEventListener("cancel", onCancelEvent);
      if (dialog.open) dialog.close();
      // Wait for the commit that removed the dialog, so a fallback rendered in the same update exists.
      requestAnimationFrame(() => {
        // Opened again (React's development double effect reuses the same element): leave focus inside it.
        if (dialog.open) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected && !dialog.contains(active)) return;
        const target = opener?.isConnected ? opener : back.current?.() ?? null;
        target?.focus({ preventScroll: true });
      });
    };
  }, [ref]);
}
