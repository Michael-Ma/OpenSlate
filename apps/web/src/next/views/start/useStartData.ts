import type { ProjectListItem } from "@openslate/core/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { codexSource } from "../../model/start.ts";
import { PROVIDERS_PATH, projectPath, readFilms } from "../../model/start-commands.ts";
import { codexFrom, type Codex, type DirectorSetupRead, type ProviderCatalog } from "../../model/start-new.ts";
import { useStore, useStudio } from "../../store/react.tsx";

const codeOf = (error: unknown) => (error instanceof ApiError ? error.code : "NETWORK_ERROR");
const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export interface Films {
  data: ProjectListItem[] | null;
  error: string | null;
  /** Read again now; resolves when the new list is in. */
  reload(): Promise<void>;
}

/**
 * Every film on this computer, archived ones included. Read on open, after each Start command, when
 * the open film changes (its counts move) and when the studio comes back. Works with no film open.
 */
export function useFilms(): Films {
  const store = useStore();
  const cursor = useStudio((s) => s.overview?.cursor ?? s.snapshot?.cursor ?? 0);
  const connected = useStudio((s) => s.connection === "connected");
  const [state, setState] = useState<{ data: ProjectListItem[] | null; error: string | null }>({ data: null, error: null });
  const latest = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const ticket = ++latest.current;
    try {
      const data = await readFilms(store, signal);
      if (ticket === latest.current) setState({ data, error: null });
    } catch (error) {
      if (!aborted(error) && ticket === latest.current) setState((s) => ({ ...s, error: codeOf(error) }));
    }
  }, [store]);

  // The list does not need the event stream; reconnecting only reads it again.
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, cursor, connected]);

  const reload = useCallback(() => load(), [load]);
  return { ...state, reload };
}

export interface Providers {
  /** This computer's model catalog (GET /api/providers); null while it is read, "failed" when it could not be. */
  catalog: ProviderCatalog | null | "failed";
  /** Read it again (the models changed under the New film sheet). */
  reload(): void;
}

export function useProviders(): Providers {
  const store = useStore();
  const [catalog, setCatalog] = useState<ProviderCatalog | null | "failed">(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    store.read<ProviderCatalog>(PROVIDERS_PATH, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setCatalog(value); },
      (error: unknown) => { if (!controller.signal.aborted && !aborted(error)) setCatalog("failed"); },
    );
    return () => controller.abort();
  }, [store, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { catalog, reload };
}

/**
 * Whether this computer has Codex. The server keeps the Director per film and has no host-level read,
 * so this reads the open film's Director setup, else any listed film's (the host defaults are the same
 * for every film). With no film at all (a real first run) it stays unknown, and a new film's Director
 * step finds out.
 */
export function useCodex(films: readonly ProjectListItem[] | null): Codex {
  const store = useStore();
  const projectId = useStudio((s) => s.projectId);
  const source = codexSource(projectId, films);
  const [codex, setCodex] = useState<Codex>({ state: "unknown" });
  useEffect(() => {
    if (!source) { setCodex({ state: "unknown" }); return; }
    const controller = new AbortController();
    store.read<DirectorSetupRead>(projectPath(source, "/director/setup"), controller.signal).then(
      (setup) => { if (!controller.signal.aborted) setCodex(codexFrom(setup)); },
      () => { if (!controller.signal.aborted) setCodex({ state: "unknown" }); },
    );
    return () => controller.abort();
  }, [store, source]);
  return codex;
}
