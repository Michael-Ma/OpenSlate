import { useSyncExternalStore } from "react";
import { NARROW_QUERY } from "../model/shell.ts";

const query = () => window.matchMedia(NARROW_QUERY);
const subscribe = (listener: () => void) => {
  const list = query();
  list.addEventListener("change", listener);
  return () => list.removeEventListener("change", listener);
};

/** True below 900 px, where the Director is a drawer. */
export const useNarrow = (): boolean => useSyncExternalStore(subscribe, () => query().matches, () => false);
