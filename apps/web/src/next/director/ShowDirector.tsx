import { useCallback } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { PictureCandidate } from "../model/director.ts";
import { NARROW_QUERY } from "../model/shell.ts";
import { msg } from "../model/types.ts";
import { useStore } from "../store/react.tsx";

/** Focus the reply box; on a phone its drawer opens first, so the next few frames are tried. */
export function focusComposer(tries = 12): void {
  requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>("#director textarea[data-field='message']");
    composer?.focus({ preventScroll: true });
    if (document.activeElement !== composer && tries > 1) focusComposer(tries - 1);
  });
}

/**
 * "Show the Director" a picture: it joins the message being written (with its thumbnail) and the reply box gets
 * focus, in the drawer on a phone. When the picture cannot be shown (the scripted Director, no FFmpeg, an earlier
 * take, four already) a toast says why and nothing is added. Returns whether it was added.
 */
export function useShowToDirector(): (candidate: PictureCandidate) => boolean {
  const store = useStore();
  return useCallback((candidate: PictureCandidate) => {
    const refused = store.showPicture(candidate);
    if (refused) {
      store.dispatch({ type: "toast", message: refused, tone: "info" });
      return false;
    }
    if (window.matchMedia(NARROW_QUERY).matches) store.setDirectorOpen(true);
    store.dispatch({ type: "toast", message: msg("director.picture.added"), tone: "info" });
    focusComposer();
    return true;
  }, [store]);
}

/** The button itself, for the Assets detail and the Keyframes preview. */
export function ShowDirectorButton({ candidate, label, className = "pill", onShown }: { candidate: PictureCandidate; label?: string; className?: string; onShown?(): void }) {
  const { t } = useI18n();
  const show = useShowToDirector();
  return (
    <button type="button" className={className} data-act="show-director" aria-label={label} onClick={() => { if (show(candidate)) onShown?.(); }}>
      {t("director.picture.show")}
    </button>
  );
}
