import { useCallback, useState } from "react";
import type { Msg } from "../../model/types.ts";

/** The latest storyboard command made from the Plan view, which the header's one-step Undo names (D9). */
export interface LastChange {
  commandId: string;
  /** "edit 1.2", "delete Scene 1" */
  label: Msg;
  /** The head version the command produced: Undo is offered only while nothing has changed since. */
  headVersion: number;
}

/** Kept per film for this page's lifetime, so switching views and back still names the change. */
const records = new Map<string, LastChange>();

export function useLastChange(projectId: string): [LastChange | null, (next: LastChange | null) => void] {
  const [, rerender] = useState(0);
  const set = useCallback((next: LastChange | null) => {
    if (next) records.set(projectId, next);
    else records.delete(projectId);
    rerender((n) => n + 1);
  }, [projectId]);
  return [records.get(projectId) ?? null, set];
}
