import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useStore, useStudio } from "../../store/react.tsx";

export interface Read<T> {
  data: T | null;
  /** The error code of the last failed read. */
  error: string | null;
  /** Its HTTP status: a 404 means the route does not exist on this server yet. */
  status: number | null;
  loading: boolean;
  reload(): void;
}

/**
 * store/useResource.ts with the HTTP status kept: the Settings view must tell a route that is not there yet
 * (the review switch, server card B10) from one that failed. Re-reads whenever the event cursor moves,
 * except after a 404, which is asked again only on reload(). `film: false` reads an /api path that needs no
 * open film (the provider catalog), so "This computer" works on Start too.
 */
export function useRead<T>(path: string | null, { film = true }: { film?: boolean } = {}): Read<T> {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const projectId = useStudio((s) => s.projectId);
  const [state, setState] = useState<{ data: T | null; error: string | null; status: number | null; loading: boolean }>({ data: null, error: null, status: null, loading: !!path });
  const [nonce, setNonce] = useState(0);
  /** The read that answered 404, by film, path and reload count; kept out of the effect's dependencies so it never re-runs the read. */
  const missing = useRef<string | null>(null);
  useEffect(() => {
    if (!path || (film && !projectId)) return;
    const key = `${film ? projectId : ""}|${path}|${nonce}`;
    if (missing.current === key) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    store.read<T>(path, controller.signal).then(
      (data) => {
        if (controller.signal.aborted) return;
        missing.current = null;
        setState({ data, error: null, status: null, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const known = error instanceof ApiError;
        if (known && error.status === 404) missing.current = key;
        setState((s) => ({ ...s, error: known ? error.code : "NETWORK_ERROR", status: known ? error.status : null, loading: false }));
      },
    );
    return () => controller.abort();
  }, [store, path, film, projectId, cursor, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
