/** A resource's saved values belong to one film and path, never to the next selection. */
export interface OwnedResource<T> {
  identity: string | null;
  data: T | null;
  error: string | null;
  status: number | null;
  loading: boolean;
}

export function resourceIdentity(projectId: string | null, path: string | null, film = true, projectEpoch = 0): string | null {
  return !path || (film && !projectId) ? null : JSON.stringify([film ? projectId : null, path, film ? projectEpoch : null]);
}

/** Called during render too: an effect has not yet cleared the previous film when selection first changes. */
export function resourceFor<T>(state: OwnedResource<T>, identity: string | null): OwnedResource<T> {
  return state.identity === identity ? state : { identity, data: null, error: null, status: null, loading: identity !== null };
}

export interface ProjectDrafts {
  get<T>(projectId: string, field: string): T | null;
  set<T>(projectId: string, field: string, value: T | null | ((current: T | null) => T | null)): void;
  subscribe(listener: () => void): () => void;
}

/** In-memory page-lifetime drafts. They survive view mounts and film switches without crossing stores. */
export function createProjectDrafts(): ProjectDrafts {
  const films = new Map<string, Map<string, unknown>>();
  const listeners = new Set<() => void>();
  const get = <T>(projectId: string, field: string): T | null => (films.get(projectId)?.get(field) as T | undefined) ?? null;
  return {
    get,
    set<T>(projectId: string, field: string, value: T | null | ((current: T | null) => T | null)) {
      const current = get<T>(projectId, field);
      const next = typeof value === "function" ? (value as (current: T | null) => T | null)(current) : value;
      if (current === next) return;
      if (next === null) {
        const film = films.get(projectId);
        film?.delete(field);
        if (!film?.size) films.delete(projectId);
      } else {
        let film = films.get(projectId);
        if (!film) { film = new Map(); films.set(projectId, film); }
        film.set(field, next);
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Async settings preparation keeps the film that opened it, even if selection changes before dispatch. */
export function settingsRequest<T extends { path: string; body: unknown }>(projectId: string | null, request: T): T {
  return { ...request, path: request.path.startsWith("/api/") ? request.path : `/api/projects/${encodeURIComponent(projectId ?? "")}${request.path}` };
}
