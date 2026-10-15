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

interface Running {
  key: string;
  controller: AbortController;
  /** The event cursor moved while it was on its way: read once more when it answers, unless it is a 404. */
  again: boolean;
}

/**
 * store/useResource.ts with the HTTP status kept: the Settings view must tell a route that is not there yet
 * (the review switch, server card B10) from one that failed. Re-reads whenever the event cursor moves, but
 * one read at a time: an event during a read asks for one more read after it instead of cancelling it, so a
 * missing route answers 404 once and is asked again only on reload(). `film: false` reads an /api path that
 * needs no open film (the provider catalog), so "This computer" works on Start too.
 */
export function useRead<T>(path: string | null, { film = true }: { film?: boolean } = {}): Read<T> {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const projectId = useStudio((s) => s.projectId);
  const [state, setState] = useState<{ data: T | null; error: string | null; status: number | null; loading: boolean }>({ data: null, error: null, status: null, loading: !!path });
  const [nonce, setNonce] = useState(0);
  /** The read that answered 404, by film, path and reload count. */
  const missing = useRef<string | null>(null);
  const running = useRef<Running | null>(null);

  useEffect(() => {
    if (!path || (film && !projectId)) {
      running.current?.controller.abort();
      running.current = null;
      return;
    }
    const key = `${film ? projectId : ""}|${path}|${nonce}`;
    if (missing.current === key) return;
    const current = running.current;
    if (current?.key === key) { current.again = true; return; }
    current?.controller.abort();
    const start = () => {
      const entry: Running = { key, controller: new AbortController(), again: false };
      running.current = entry;
      setState((s) => ({ ...s, loading: true }));
      const settle = (next: () => void) => {
        if (entry.controller.signal.aborted) return;
        running.current = null;
        next();
      };
      store.read<T>(path, entry.controller.signal).then(
        (data) => settle(() => {
          missing.current = null;
          setState({ data, error: null, status: null, loading: false });
          if (entry.again) start();
        }),
        (error: unknown) => settle(() => {
          const known = error instanceof ApiError;
          const notThere = known && error.status === 404;
          if (notThere) missing.current = key;
          setState((s) => ({ ...s, error: known ? error.code : "NETWORK_ERROR", status: known ? error.status : null, loading: false }));
          if (entry.again && !notThere) start();
        }),
      );
    };
    start();
  }, [store, path, film, projectId, cursor, nonce]);

  // Leaving the view cancels the read on its way.
  useEffect(() => () => {
    running.current?.controller.abort();
    running.current = null;
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
