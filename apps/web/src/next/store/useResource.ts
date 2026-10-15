import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client.ts";
import { useStore, useStudio } from "./react.tsx";

export interface Resource<T> {
  data: T | null;
  /** The error code of the last failed read. */
  error: string | null;
  loading: boolean;
  reload(): void;
}

/**
 * Read a view's own data (e.g. "/assets", "/exports") and read it again whenever the studio's event
 * cursor moves, so it follows the same invalidations as the overview. `path` null skips the read.
 */
export function useResource<T>(path: string | null): Resource<T> {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const projectId = useStudio((s) => s.projectId);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path || !projectId) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    store.read<T>(path, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ data, error: null, loading: false }); },
      (error: unknown) => { if (!controller.signal.aborted) setState((s) => ({ ...s, error: error instanceof ApiError ? error.code : "NETWORK_ERROR", loading: false })); },
    );
    return () => controller.abort();
  }, [store, path, projectId, cursor, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
