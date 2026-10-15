import { useEffect, useRef, type RefObject } from "react";

/**
 * Open a native <dialog> as a modal while the component is mounted: the rest of the page is inert and focus
 * stays inside. Esc closes it through `onCancel`, or does nothing when the dialog cannot be dismissed
 * (`onCancel` null). When it unmounts, focus goes back to whatever opened it, or to `fallback()` when that
 * control is gone (a Stop pill that disappears once the film is stopped).
 *
 * The browser can still close the dialog on its own: Chrome ignores preventDefault on a second Esc that has
 * no click or key press of the page's own in between. The component is still mounted then, so a dialog that
 * can be dismissed reports it through `onCancel` (the state that shows it follows), and one that cannot is
 * shown again at once with focus back inside. `closedby="none"` asks browsers that know it to ignore Esc
 * altogether for a dialog that cannot be dismissed.
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
    if (cancel.current) dialog.removeAttribute("closedby");
    else dialog.setAttribute("closedby", "none");
    if (!dialog.open) dialog.showModal();
    let mounted = true;
    const onCancelEvent = (event: Event) => {
      event.preventDefault();
      cancel.current?.();
    };
    const onClose = () => {
      // A close from this hook's own cleanup, or a stale one after React's development double effect reopened it.
      if (!mounted || dialog.open) return;
      if (cancel.current) {
        cancel.current();
        return;
      }
      dialog.showModal();
      firstControl(dialog)?.focus({ preventScroll: true });
    };
    dialog.addEventListener("cancel", onCancelEvent);
    dialog.addEventListener("close", onClose);
    return () => {
      mounted = false;
      dialog.removeEventListener("cancel", onCancelEvent);
      dialog.removeEventListener("close", onClose);
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

/** Where showModal() puts focus: the autofocus control, else the first button, link or field. */
function firstControl(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>("[autofocus]") ?? dialog.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
}
