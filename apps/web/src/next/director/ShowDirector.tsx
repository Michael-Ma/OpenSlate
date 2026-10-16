import { useCallback, useRef, useState } from "react";
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
 * On a phone the drawer opens over everything and the toast would sit on the reply box being typed in, so there is
 * no toast: the new picture chip shows it, and the reply box's description names the pictures it carries.
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
    else store.dispatch({ type: "toast", message: msg("director.picture.added"), tone: "info" });
    focusComposer();
    return true;
  }, [store]);
}

/**
 * The button itself, for the Assets detail and the Keyframes preview. `candidate` may be a check to run when it is
 * pressed (the preview asks the asset library whether its keyframe came from a demo provider); the button is busy
 * meanwhile, and a second press waits for the first.
 */
export function ShowDirectorButton({ candidate, label, className = "pill", onShown }: { candidate: PictureCandidate | (() => Promise<PictureCandidate>); label?: string; className?: string; onShown?(): void }) {
  const { t } = useI18n();
  const show = useShowToDirector();
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const press = async () => {
    if (busy.current) return;
    if (typeof candidate !== "function") { if (show(candidate)) onShown?.(); return; }
    busy.current = true;
    setChecking(true);
    try {
      if (show(await candidate())) onShown?.();
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };
  return (
    <button type="button" className={className} data-act="show-director" aria-label={label} aria-busy={checking || undefined} onClick={() => void press()}>
      {t("director.picture.show")}
    </button>
  );
}
