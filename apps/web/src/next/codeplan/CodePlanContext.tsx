import type { CodePlanSourceView, CodePlanView } from "@openslate/core/public";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "../api/client.ts";
import { CODE_PLAN_PATH } from "../api/code-plan.ts";
import { isCodeProject } from "../model/code-plan.ts";
import type { StudioState } from "../store/state.ts";
import type { StudioStore } from "../store/store.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useResource } from "../store/useResource.ts";

export interface CodePlanRead {
  /** The open film is a code-plan film. False for every graph film: nothing below reads a code-plan route then. */
  enabled: boolean;
  view: CodePlanView | null;
  /** The code of the last failed read. */
  error: string | null;
  loading: boolean;
  reload(): void;
}

const OFF: CodePlanRead = { enabled: false, view: null, error: null, loading: false, reload: () => {} };
const CodePlanContext = createContext<CodePlanRead>(OFF);

/** Stable selector: whether the open film is a code-plan film. */
export const codePlanOpen = (state: StudioState): boolean => isCodeProject(state.snapshot, state.projectId);

/**
 * The one read of GET /code-plan for the whole shell (top bar, Director column and views). It follows the studio's
 * event cursor like every other view resource, so each code_plan.changed event reads it again.
 */
export function CodePlanProvider({ children }: { children: ReactNode }) {
  const enabled = useStudio(codePlanOpen);
  const projectId = useStudio((s) => s.projectId);
  const read = useResource<CodePlanView>(enabled ? CODE_PLAN_PATH : null);
  // A read that answered for another film (never expected) is not shown as this film's.
  const view = read.data && read.data.projectId === projectId ? read.data : null;
  // A stuck vendor task sends no events, so read again now and then while work is out: its wait keeps growing.
  const working = !!view?.steps.some((step) => step.state === "in_flight");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(read.reload, 60_000);
    return () => clearInterval(timer);
  }, [working, read.reload]);
  const value = useMemo<CodePlanRead>(() => (enabled ? { enabled, view, error: read.error, loading: read.loading, reload: read.reload } : OFF),
    [enabled, view, read.error, read.loading, read.reload]);
  return <CodePlanContext.Provider value={value}>{children}</CodePlanContext.Provider>;
}

export const useCodePlan = (): CodePlanRead => useContext(CodePlanContext);

// ---- one version's program ------------------------------------------------------------------

/** A stored version never changes, so each is read once per film and kept for this store. */
const sources = new WeakMap<StudioStore, Map<string, CodePlanSourceView>>();

export type SourceRead = { status: "idle" } | { status: "loading" } | { status: "ready"; source: CodePlanSourceView } | { status: "failed"; code: string };

export function useVersionSource(version: number | null): SourceRead {
  const store = useStore();
  const projectId = useStudio((s) => s.projectId);
  const enabled = useStudio(codePlanOpen);
  const key = enabled && projectId && version !== null ? `${projectId}:${version}` : null;
  const cached = key ? sources.get(store)?.get(key) : undefined;
  const [state, setState] = useState<{ key: string | null; read: SourceRead }>({ key: null, read: { status: "idle" } });
  useEffect(() => {
    if (!key || version === null || cached) return;
    const controller = new AbortController();
    setState({ key, read: { status: "loading" } });
    store.readCodePlanSource(version, controller.signal).then(
      (source) => {
        if (controller.signal.aborted) return;
        let byFilm = sources.get(store);
        if (!byFilm) { byFilm = new Map(); sources.set(store, byFilm); }
        byFilm.set(key, source);
        setState({ key, read: { status: "ready", source } });
      },
      (error: unknown) => { if (!controller.signal.aborted) setState({ key, read: { status: "failed", code: error instanceof ApiError ? error.code : "NETWORK_ERROR" } }); },
    );
    return () => controller.abort();
  }, [store, key, version, cached]);
  if (!key) return { status: "idle" };
  if (cached) return { status: "ready", source: cached };
  return state.key === key ? state.read : { status: "loading" };
}
