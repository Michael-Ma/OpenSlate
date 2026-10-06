import { useEffect, useRef, useState } from "react";
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
}: {
  value: string;
  label: string;
  version: number;
  save(value: string, version: number): void;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value),
    editing = useRef(false),
    cancelled = useRef(false),
    base = useRef({ value, version });
  useEffect(() => {
    if (!editing.current) {
      setDraft(value);
      base.current = { value, version };
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
      base.current = { value, version };
    },
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) return;
      if (draft.trim() !== base.current.value)
        save(draft.trim(), base.current.version);
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.key === "Escape") {
        cancelled.current = true;
        setDraft(value);
        editing.current = false;
        base.current = { value, version };
        event.currentTarget.value = value;
        event.currentTarget.blur();
      } else if (event.key === "Enter" && !multiline)
        event.currentTarget.blur();
    },
  };
  return multiline ? <textarea {...props} rows={2} /> : <input {...props} />;
}
