import { useEffect, useState } from "react";
import { draftKey } from "../model/director.ts";
import { useMode, useRelinquishedDrafts, useStore, useStudio } from "../store/react.tsx";
import type { StudioStore } from "../store/store.ts";
import { watchComposerDraft } from "./composer-draft.ts";

const browserStorage = (): Storage | null => {
  try { return window.localStorage; } catch { return null; }
};

/** Remove a film's kept draft (it was sent after another film was opened, so the composer no longer holds it). */
export function forgetDraft(projectId: string, mode: "live" | "fixture"): void {
  try { browserStorage()?.removeItem(draftKey(projectId, mode)); } catch { /* blocked: nothing kept to remove */ }
}

/**
 * Keeps each film's unsent message (its words, @ targets and pictures) in this browser, so a reload or a switch to
 * another film and back brings it back. Written on every change, removed once sent or emptied; storage that is
 * full, blocked or unreadable is ignored (the draft then lives only in this tab). The sample film keeps its own
 * key. Reports when the cache read is done, and whether a draft came back for the quiet "Unsent draft" line.
 */
export function useComposerDraft(): { ready: boolean; restored: boolean } {
  const store = useStore();
  const mode = useMode();
  const relinquished = useRelinquishedDrafts();
  const projectId = useStudio((s) => s.projectId);
  const empty = useStudio((s) => !s.composer.text && !s.composer.targets.length && !s.composer.images.length);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  const [readyFor, setReadyFor] = useState<StudioStore | null>(null);

  useEffect(() => {
    const off = watchComposerDraft(store, browserStorage(), mode, relinquished, setRestoredFor);
    setReadyFor(store);
    return off;
  }, [store, mode, relinquished]);

  return { ready: readyFor === store, restored: !empty && restoredFor !== null && restoredFor === projectId };
}
