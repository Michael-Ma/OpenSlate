import type { AssetItem } from "@openslate/core/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { readAllAssets, type AssetPage } from "../../model/assets.ts";
import { useStore, useStudio } from "../../store/react.tsx";

export interface AssetList {
  items: AssetItem[] | null;
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
 * Every page of GET /assets, read again whenever the studio's event cursor moves. A read in progress is
 * not cancelled by a new event (events can arrive faster than a large library reads); one more read
 * follows it instead. The list from before stays on screen while the next one loads.
 */
export function useAssetList(): AssetList {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const projectId = useStudio((s) => s.projectId);
  const [state, setState] = useState<{ projectId: string | null; items: AssetItem[] | null; truncated: boolean; error: string | null; loading: boolean }>(
    { projectId: null, items: null, truncated: false, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  const run = useRef<Run>(fresh());

  // A new film (or leaving the view) cancels what is being read for the old one.
  useEffect(() => () => {
    run.current.controller.abort();
    run.current = fresh();
  }, [projectId]);

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
          setState({ projectId, items: result.items, truncated: result.truncated, error: null, loading: false });
        } catch (error) {
          if (signal.aborted) return;
          setState((s) => ({ ...s, error: error instanceof ApiError ? error.code : "NETWORK_ERROR", loading: false }));
        }
      } while (current.again && !signal.aborted);
      current.running = false;
    })();
  }, [store, projectId, cursor, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const own = state.projectId === projectId;
  return { items: own ? state.items : null, truncated: own && state.truncated, error: state.error, loading: state.loading || !own, reload };
}
