import { draftKey, draftToSave, readDraft } from "../model/director.ts";
import type { StudioState } from "../store/state.ts";
import type { StudioStore } from "../store/store.ts";

type DraftStore = Pick<StudioStore, "getState" | "subscribe" | "restoreDraft">;
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const versions = new WeakMap<DraftStore, Map<string, string>>();
export const ownedDraftVersion = (store: DraftStore, projectId: string): string | null => versions.get(store)?.get(projectId) ?? null;

/**
 * Keep each film's words in the shared cache. A window that handed its draft to another session must not take a
 * second copy from that cache; only new words in its own composer (including an unconsumed explicit carry) end
 * that exclusion. The set belongs to the window, so mounting this watcher again cannot revive the old draft.
 */
export function watchComposerDraft(store: DraftStore, storage: DraftStorage | null, mode: "live" | "fixture", relinquished: Set<string>, restored: (projectId: string | null) => void): () => void {
  let project: string | null = null;
  let last: StudioState["composer"] | null = null;
  const owned = versions.get(store) ?? new Map<string, string>();
  versions.set(store, owned);
  const contents = new Map<string, string>();
  const sync = () => {
    const state = store.getState();
    if (state.projectId !== project) {
      project = state.projectId;
      last = state.composer;
      if (!project) return;
      const { text, targets, images } = state.composer;
      if (text || targets.length || images.length) { relinquished.delete(project); return; }
      if (relinquished.has(project)) return;
      owned.delete(project);
      contents.delete(project);
      let raw: string | null = null;
      try { raw = storage?.getItem(draftKey(project, mode)) ?? null; } catch { /* unreadable: no draft */ }
      const draft = readDraft(raw);
      if (!draft) return;
      owned.set(project, raw!);
      contents.set(project, JSON.stringify(draft));
      restored(project);
      store.restoreDraft(draft);
      return;
    }
    if (!project || state.composer === last) return;
    last = state.composer;
    const draft = draftToSave(state.composer);
    if (draft) relinquished.delete(project);
    else restored(null);
    try {
      const key = draftKey(project, mode);
      const content = draft ? JSON.stringify(draft) : null;
      if (content && content !== contents.get(project)) {
        const raw = JSON.stringify({ ...draft, draftVersion: crypto.randomUUID() });
        storage?.setItem(key, raw);
        owned.set(project, raw);
        contents.set(project, content);
      } else if (!draft && !relinquished.has(project)) {
        removeDraftVersion(storage, key, owned.get(project) ?? null);
        owned.delete(project);
        contents.delete(project);
      }
    } catch { /* full or blocked: the draft stays in this tab only */ }
  };
  sync();
  return store.subscribe(sync);
}

/** Compare the exact stored version: another tab may have saved even identical words since this one read it. */
export function removeDraftVersion(storage: DraftStorage | null, key: string, version: string | null): void {
  if (version !== null && storage?.getItem(key) === version) storage.removeItem(key);
}
