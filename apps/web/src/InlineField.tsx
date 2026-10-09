import { useEffect, useRef, useState } from "react";
import { useTranslation } from "./Locale";
import { UiButton } from "./ui";
import {
  clearLocalDraft,
  isLocalFieldText,
  readLocalDraft,
  writeLocalDraft,
} from "./local-draft-cache";
export type BoardCommand = (body: Record<string, unknown>) => void;
/** Keep focused text and its original revision across SSE updates. */
export function InlineField({
  value,
  label,
  version,
  save,
  multiline = false,
  disabled = false,
  className = "",
  cache,
}: {
  value: string;
  label: string;
  version: number;
  save(value: string, version: number): void;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  cache?: { namespace: string | undefined; projectId: string; field: string };
}) {
  const { t } = useTranslation();
  const restored = useRef<ReturnType<typeof readLocalDraft<string>> | undefined>(undefined);
  if (restored.current === undefined)
    restored.current = cache
      ? readLocalDraft(cache.namespace, cache.projectId, cache.field, isLocalFieldText)
      : null;
  const cacheRevision = useRef(restored.current?.revision ?? null);
  const writeCache = (next: string) => {
    if (!cache) return;
    const result = writeLocalDraft(cache.namespace, cache.projectId, cache.field,
      next, base.current, cacheRevision.current);
    if (result.status === "saved") cacheRevision.current = result.revision!;
  };
  const clearCache = () => {
    if (!cache) return;
    const result = clearLocalDraft(cache.namespace, cache.projectId, cache.field,
      cacheRevision.current ?? undefined);
    if (result === "saved") cacheRevision.current = null;
  };
  const initialBase = restored.current?.base as { value?: unknown; version?: unknown } | undefined;
  const [draft, setDraft] = useState(restored.current?.value ?? value),
    [, forceBase] = useState(0),
    editing = useRef(false),
    cancelled = useRef(false),
    base = useRef({
      value: typeof initialBase?.value === "string" ? initialBase.value : value,
      version: typeof initialBase?.version === "number" ? initialBase.version : version,
    });
  const stale = draft !== value &&
    (base.current.value !== value || base.current.version !== version);
  useEffect(() => {
    if (!editing.current) {
      if (draft.trim() === value) {
        if (draft !== value) setDraft(value);
        clearCache();
        base.current = { value, version };
      } else if (draft === base.current.value) {
        setDraft(value);
        base.current = { value, version };
      }
    }
  }, [value, version]);
  const props = {
    value: draft,
    disabled,
    "aria-label": label,
    className: `board-edit ${className}`,
    onFocus: () => {
      cancelled.current = false;
      editing.current = true;
      if (draft === value) base.current = { value, version };
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.target.value;
      setDraft(next);
      if (cache) {
        if (next === value) clearCache();
        else writeCache(next);
      }
    },
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) return;
      if (draft.trim() === value) {
        setDraft(value);
        clearCache();
      } else if (!stale && draft.trim() !== base.current.value)
        save(draft.trim(), base.current.version);
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === "Escape") {
        cancelled.current = true;
        setDraft(value);
        clearCache();
        editing.current = false;
        base.current = { value, version };
        event.currentTarget.value = value;
        event.currentTarget.blur();
      } else if (event.key === "Enter" && !multiline)
        event.currentTarget.blur();
    },
  };
  return <>
    {multiline ? <textarea {...props} rows={2} /> : <input {...props} />}
    {stale && <p role="status" className="inline-error">
      {t("The saved project changed. Your local text is kept. Review it before saving.", "已保存的项目发生变化。本地文字已保留，请检查后再保存。")}
      <UiButton type="button" variant="ghost" className="text-button" onClick={() => {
        base.current = { value, version };
        writeCache(draft);
        forceBase((n) => n + 1);
      }}>{t("Keep my text for current version", "在当前版本保留我的文字")}</UiButton>
      <UiButton type="button" variant="ghost" className="text-button" onClick={() => {
        setDraft(value);
        base.current = { value, version };
        clearCache();
      }}>{t("Use saved text", "使用已保存的文字")}</UiButton>
    </p>}
  </>;
}
