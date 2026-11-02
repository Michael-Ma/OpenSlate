import { useCallback, useSyncExternalStore } from "react";
import { createProjectDrafts, type ProjectDrafts } from "../../model/settings-ownership.ts";
import { useStore, useStudio } from "../../store/react.tsx";

const draftsByStore = new WeakMap<object, ProjectDrafts>();

/** Settings forms remain with their film while other views or films are open. */
export function useProjectDraft<T>(field: string): [T | null, (value: T | null | ((current: T | null) => T | null)) => void] {
  const store = useStore();
  const projectId = useStudio((s) => s.projectId) ?? "";
  let drafts = draftsByStore.get(store);
  if (!drafts) { drafts = createProjectDrafts(); draftsByStore.set(store, drafts); }
  const source = drafts;
  const value = useSyncExternalStore(source.subscribe, () => source.get<T>(projectId, field));
  const setValue = useCallback((next: T | null | ((current: T | null) => T | null)) => source.set(projectId, field, next), [source, projectId, field]);
  return [value, setValue];
}
