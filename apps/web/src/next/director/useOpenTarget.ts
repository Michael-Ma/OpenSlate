import { useCallback } from "react";
import { NARROW_QUERY, noteOpenView, shownView } from "../model/shell.ts";
import type { Target } from "../model/types.ts";
import { useStore } from "../store/react.tsx";

/**
 * Open a scene or shot from the Director column (a note's Open pill, a chip, a reference link in a message). It is
 * selected and brought into view in the current view when that view shows shots (Plan scrolls to the row, Film
 * selects and seeks, Assets scrolls to the set, Keyframes selects the card); from Settings and Start it goes to
 * Keyframes (P5-DESIGN shell item 9). On narrow screens the drawer closes so the shot is seen.
 */
export function useOpenTarget(): (target: Target) => void {
  const store = useStore();
  return useCallback((target: Target) => {
    if (target.kind === "shot") store.focusShot(target.id);
    else store.focusScene(target.id);
    const view = shownView(store.getState());
    if (noteOpenView(view) !== view) store.setView(noteOpenView(view));
    if (window.matchMedia(NARROW_QUERY).matches) store.setDirectorOpen(false);
  }, [store]);
}
