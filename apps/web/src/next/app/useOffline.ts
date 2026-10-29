import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.ts";
import { OFFLINE_GRACE_MS, REACH_PROBE_MS, unreachable } from "../model/shell-states.ts";
import type { StudioStore } from "../store/store.ts";

/** How long one reachability read may take before it counts as no answer. */
const PROBE_TIMEOUT_MS = 4000;

/** True when the studio answered, whatever it said: a refusal (even an expired session) is still an answer. */
async function studioAnswers(store: StudioStore): Promise<boolean> {
  try {
    await store.read("/api/projects", AbortSignal.timeout(PROBE_TIMEOUT_MS));
    return true;
  } catch (error) {
    return error instanceof ApiError && error.status > 0;
  }
}

/**
 * Whether the studio is out of reach, for the offline strip and the write guard. The store only knows the event
 * stream (it reports a stream that ended while reads still work as reconnecting too), so once the stream has been
 * down for OFFLINE_GRACE_MS while the page is visible, the shell asks with a plain read, and again every
 * REACH_PROBE_MS while the stream stays down. Only a stream that is down and a read that got no answer is offline.
 * A hidden tab drops its stream on purpose and reconnects as soon as it is shown again, so the wait starts over
 * on every return. `check()` asks at once (Try now).
 */
export function useOffline(store: StudioStore, streamDown: boolean): { offline: boolean; check(): void } {
  const [graceOver, setGraceOver] = useState(false);
  const [lastRead, setLastRead] = useState<"ok" | "failed" | null>(null);
  const probe = useRef<() => void>(() => {});

  useEffect(() => {
    setGraceOver(false);
    setLastRead(null);
    if (!streamDown) { probe.current = () => {}; return; }
    let live = true;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let next: ReturnType<typeof setTimeout> | undefined;
    let asking = false;
    const ask = () => {
      clearTimeout(next);
      if (!live || document.hidden || asking) return;
      asking = true;
      void studioAnswers(store).then((answered) => {
        asking = false;
        if (!live) return;
        setLastRead(answered ? "ok" : "failed");
        next = setTimeout(ask, REACH_PROBE_MS);
      });
    };
    const arm = () => {
      clearTimeout(grace);
      clearTimeout(next);
      setGraceOver(false);
      setLastRead(null);
      if (document.hidden) return;
      grace = setTimeout(() => { setGraceOver(true); ask(); }, OFFLINE_GRACE_MS);
    };
    probe.current = ask;
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      live = false;
      clearTimeout(grace);
      clearTimeout(next);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [store, streamDown]);

  const check = useCallback(() => probe.current(), []);
  return { offline: unreachable({ streamDown, graceOver, lastRead }), check };
}
