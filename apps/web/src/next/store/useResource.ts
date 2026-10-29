import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client.ts";
import { resourceFor, resourceIdentity, type OwnedResource } from "../model/settings-ownership.ts";
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
  const projectEpoch = useStudio((s) => s.projectEpoch);
  const identity = resourceIdentity(projectId, path, true, projectEpoch);
  const [state, setState] = useState<OwnedResource<T>>({ identity, data: null, error: null, status: null, loading: !!identity });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path || !identity) { setState((s) => resourceFor(s, null)); return; }
    const controller = new AbortController();
    setState((s) => ({ ...resourceFor(s, identity), loading: true }));
    store.read<T>(path, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setState({ identity, data, error: null, status: null, loading: false }); },
      (error: unknown) => { if (!controller.signal.aborted) setState((s) => ({ ...resourceFor(s, identity), error: error instanceof ApiError ? error.code : "NETWORK_ERROR", status: error instanceof ApiError ? error.status : null, loading: false })); },
    );
    return () => controller.abort();
  }, [store, path, identity, cursor, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...resourceFor(state, identity), reload };
}
