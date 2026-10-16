import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { resourceFor, resourceIdentity, type OwnedResource } from "../../model/settings-ownership.ts";
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
  /** `follow` changed while it was on its way: read once more when it answers, unless it is a 404. */
  again: boolean;
}

export interface ReadOptions {
  /** false: an /api path that needs no open film (the provider catalog), so "This computer" works on Start too. */
  film?: boolean;
  /**
   * What makes it read again. By default every studio event (the event cursor); a view passes a narrower
   * value (e.g. the film's head version) for data that only those changes can touch. reload() always reads.
   */
  follow?: string | number;
}

/**
 * store/useResource.ts with the HTTP status kept, so the view can tell a route this server does not have
 * (a 404) from one that failed. Re-reads when `follow` changes, but one read at a time: a change during a
 * read asks for one more read after it instead of cancelling it, and a missing route answers 404 once and is
 * asked again only on reload().
 */
export function useRead<T>(path: string | null, { film = true, follow }: ReadOptions = {}): Read<T> {
  const store = useStore();
  const cursor = useStudio((s) => (follow === undefined ? (s.overview?.cursor ?? s.snapshot?.cursor ?? 0) : 0));
  const trigger = follow ?? cursor;
  const projectId = useStudio((s) => s.projectId);
  const projectEpoch = useStudio((s) => s.projectEpoch);
  const identity = resourceIdentity(projectId, path, film, projectEpoch);
  const [state, setState] = useState<OwnedResource<T>>({ identity, data: null, error: null, status: null, loading: !!identity });
  const [nonce, setNonce] = useState(0);
  /** The read that answered 404, by film, path and reload count. */
  const missing = useRef<string | null>(null);
  const running = useRef<Running | null>(null);

  useEffect(() => {
    if (!path || !identity) {
      running.current?.controller.abort();
      running.current = null;
      setState((s) => resourceFor(s, null));
      return;
    }
    const key = `${identity}|${nonce}`;
    if (missing.current === key) return;
    const current = running.current;
    if (current?.key === key) { current.again = true; return; }
    current?.controller.abort();
    const start = () => {
      const entry: Running = { key, controller: new AbortController(), again: false };
      running.current = entry;
      setState((s) => ({ ...resourceFor(s, identity), loading: true }));
      const settle = (next: () => void) => {
        if (entry.controller.signal.aborted || running.current !== entry) return;
        running.current = null;
        next();
      };
      store.read<T>(path, entry.controller.signal).then(
        (data) => settle(() => {
          missing.current = null;
          setState({ identity, data, error: null, status: null, loading: false });
          if (entry.again) start();
        }),
        (error: unknown) => settle(() => {
          const known = error instanceof ApiError;
          const notThere = known && error.status === 404;
          if (notThere) missing.current = key;
          setState((s) => ({ ...resourceFor(s, identity), error: known ? error.code : "NETWORK_ERROR", status: known ? error.status : null, loading: false }));
          if (entry.again && !notThere) start();
        }),
      );
    };
    start();
  }, [store, path, identity, trigger, nonce]);

  // Leaving the view cancels the read on its way.
  useEffect(() => () => {
    running.current?.controller.abort();
    running.current = null;
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...resourceFor(state, identity), reload };
}
