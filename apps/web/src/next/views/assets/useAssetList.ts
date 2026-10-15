import type { AssetItem } from "@openslate/core/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { ASSET_REREAD_DELAY_MS, readAllAssets, type AssetPage } from "../../model/assets.ts";
import { useStore, useStudio } from "../../store/react.tsx";

export interface AssetList {
  items: AssetItem[] | null;
  /** How many the studio has: the length of `items`, or more when the list is truncated. */
  total: number;
  /** More than the read limit exist; the newest are listed. */
  truncated: boolean;
  /** The error code of the last failed read. */
  error: string | null;
  loading: boolean;
  reload(): void;
}

interface Run {
  running: boolean;
  again: boolean;
  controller: AbortController;
}

const fresh = (): Run => ({ running: false, again: false, controller: new AbortController() });

/**
 * Every page of GET /assets. The first read and a reload the person asks for start at once; when the studio's
 * event cursor moves (events come in bursts while jobs run), the library reads again once, a moment after the
 * first event of the burst. A read in progress is not cancelled by a new event; one more read follows it
 * instead. The list from before stays on screen while the next one loads.
 */
export function useAssetList(): AssetList {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const projectId = useStudio((s) => s.projectId);
  const [state, setState] = useState<{ projectId: string | null; items: AssetItem[] | null; total: number; truncated: boolean; error: string | null; loading: boolean }>(
    { projectId: null, items: null, total: 0, truncated: false, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const run = useRef<Run>(fresh());
  const seenCursor = useRef(cursor);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new film (or leaving the view) cancels what is being read for the old one.
  useEffect(() => () => {
    run.current.controller.abort();
    run.current = fresh();
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [projectId]);

  // A moved cursor asks for one read a moment later; more events in the meantime join it.
  useEffect(() => {
    if (cursor === seenCursor.current) return;
    seenCursor.current = cursor;
    if (timer.current) return;
    timer.current = setTimeout(() => { timer.current = null; setNonce((n) => n + 1); }, ASSET_REREAD_DELAY_MS);
  }, [cursor]);

  useEffect(() => {
    if (!projectId) return;
    const current = run.current;
    if (current.running) { current.again = true; return; }
    current.running = true;
    const signal = current.controller.signal;
    setState((s) => ({ ...s, loading: true }));
    void (async () => {
      do {
        current.again = false;
        try {
          const result = await readAllAssets((offset) => store.read<AssetPage>(`/assets?offset=${offset}`, signal));
          if (signal.aborted) return;
          setState({ projectId, items: result.items, total: Math.max(result.total, result.items.length), truncated: result.truncated, error: null, loading: false });
        } catch (error) {
          if (signal.aborted) return;
          setState((s) => ({ ...s, error: error instanceof ApiError ? error.code : "NETWORK_ERROR", loading: false }));
        }
      } while (current.again && !signal.aborted);
      current.running = false;
    })();
  }, [store, projectId, nonce]);

  const reload = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setNonce((n) => n + 1);
  }, []);
  const own = state.projectId === projectId;
  return { items: own ? state.items : null, total: own ? state.total : 0, truncated: own && state.truncated, error: state.error, loading: state.loading || !own, reload };
}
