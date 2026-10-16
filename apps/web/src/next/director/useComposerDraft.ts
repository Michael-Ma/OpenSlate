import { useEffect, useState } from "react";
import { draftKey, draftToSave, readDraft } from "../model/director.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import type { StudioState } from "../store/state.ts";

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
 * key. Returns whether the composer now holds a draft that came back this way, for the quiet "Unsent draft" line.
 */
export function useComposerDraft(): boolean {
  const store = useStore();
  const mode = useMode();
  const projectId = useStudio((s) => s.projectId);
  const empty = useStudio((s) => !s.composer.text && !s.composer.targets.length && !s.composer.images.length);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    const storage = browserStorage();
    let project: string | null = null;
    let last: StudioState["composer"] | null = null;
    const sync = () => {
      const state = store.getState();
      if (state.projectId !== project) {
        // Another film (or the first): the reducer emptied the composer; bring back that film's draft.
        project = state.projectId;
        last = state.composer;
        if (!project) return;
        const { text, targets, images } = state.composer;
        if (text || targets.length || images.length) return;
        let raw: string | null = null;
        try { raw = storage?.getItem(draftKey(project, mode)) ?? null; } catch { /* unreadable: no draft */ }
        const draft = readDraft(raw);
        if (!draft) return;
        setRestoredFor(project);
        store.restoreDraft(draft);
        return;
      }
      if (!project || state.composer === last) return;
      last = state.composer;
      const draft = draftToSave(state.composer);
      // The line goes once the draft is sent or cleared.
      if (!draft) setRestoredFor(null);
      try {
        if (draft) storage?.setItem(draftKey(project, mode), JSON.stringify(draft));
        else storage?.removeItem(draftKey(project, mode));
      } catch { /* full or blocked: the draft stays in this tab only */ }
    };
    sync();
    return store.subscribe(sync);
  }, [store, mode]);

  return !empty && restoredFor !== null && restoredFor === projectId;
}
