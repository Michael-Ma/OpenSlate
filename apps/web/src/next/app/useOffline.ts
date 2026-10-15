import { useEffect, useState } from "react";
import { OFFLINE_GRACE_MS } from "../model/shell-states.ts";

/**
 * True once the event stream has been down for OFFLINE_GRACE_MS while the page is visible. A hidden tab drops
 * its stream on purpose and reconnects as soon as it is shown again, so the wait starts over on every return.
 */
export function useOffline(reconnecting: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!reconnecting) { setShown(false); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      setShown(false);
      if (!document.hidden) timer = setTimeout(() => setShown(true), OFFLINE_GRACE_MS);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [reconnecting]);
  return reconnecting && shown;
}
