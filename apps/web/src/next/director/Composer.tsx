import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { composerView, filterPicker, mentionAt, pickerItems, removeMention, type PickerItem } from "../model/director.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { AtPicker, pickerOptionId } from "./AtPicker.tsx";

/** About six lines; past that the textarea scrolls. */
const MAX_LINES = 6;
const NARROW = "(max-width: 899px)";

/**
 * The reply box. One explicit target model: the chips are what the message points at, added only
 * with @ (typed, the @ button, or "@ 2.1" in the inspector). Selecting a shot never changes them.
 */
export function Composer() {
  const { t, tm } = useI18n();
  const store = useStore();
  const composer = useStudio((s) => s.composer);
  const connected = useStudio((s) => s.connection === "connected");
  const overview = useStudio((s) => s.overview);
  const directorOpen = useStudio((s) => s.directorOpen);
  const view = useMemo(() => composerView(composer, connected, overview), [composer, connected, overview]);
  const items = useMemo(() => pickerItems(overview), [overview]);

  const id = useId();
  const listId = `${id}-picker`;
  const noteId = `${id}-note`;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const caretAfterRender = useRef<number | null>(null);
  const [picker, setPicker] = useState({ open: false, active: 0 });
  const [caret, setCaret] = useState(0);

  const mention = picker.open ? mentionAt(composer.text, caret) : null;
  const query = mention?.query ?? "";
  const shown = useMemo(() => (picker.open ? filterPicker(items, query, tm) : []), [picker.open, items, query, tm]);
  const active = Math.min(picker.active, Math.max(0, shown.length - 1));
  const activeItem = picker.open ? shown[active] : undefined;

  // Grow with the text up to about six lines, then scroll; put the caret back after a pick.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const line = parseFloat(getComputedStyle(element).lineHeight) || 20;
    const max = Math.round(line * MAX_LINES);
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 24), max)}px`;
    element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden";
    if (caretAfterRender.current !== null) {
      element.setSelectionRange(caretAfterRender.current, caretAfterRender.current);
      caretAfterRender.current = null;
    }
  }, [composer.text]);

  // The narrow drawer opens straight into the reply box.
  useEffect(() => {
    if (directorOpen && window.matchMedia(NARROW).matches) textarea.current?.focus({ preventScroll: true });
  }, [directorOpen]);

  // A click anywhere outside the composer closes the picker.
  useEffect(() => {
    if (!picker.open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setPicker({ open: false, active: 0 });
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [picker.open]);

  const closePicker = () => setPicker({ open: false, active: 0 });

  const pick = (item: PickerItem) => {
    const typed = mentionAt(composer.text, caret);
    if (typed) {
      // Drop the "@query" that opened the picker; the chip replaces it.
      const next = removeMention(composer.text, typed);
      caretAfterRender.current = next.caret;
      setCaret(next.caret);
      store.setComposerText(next.text);
    }
    store.pointAt(item.target, true);
    closePicker();
    textarea.current?.focus();
  };

  const send = () => {
    if (!view.canSend) return;
    closePicker();
    void store.sendMessage();
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target;
    store.setComposerText(value);
    setCaret(selectionStart);
    // Typing "@" (at the start or after a space) opens the picker; anything else closes it.
    const typing = mentionAt(value, selectionStart);
    if (typing && !picker.open) setPicker({ open: true, active: 0 });
    else if (!typing && picker.open) closePicker();
    else if (typing) setPicker((current) => ({ ...current, active: 0 }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (picker.open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!shown.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        setPicker({ open: true, active: (active + step + shown.length) % shown.length });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !composing) {
        event.preventDefault();
        if (activeItem) pick(activeItem);
        else closePicker();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      send();
    }
  };

  const toggleFromButton = () => {
    setPicker((current) => ({ open: !current.open, active: 0 }));
    const element = textarea.current;
    if (element) { element.focus(); setCaret(element.selectionStart); }
  };

  return (
    <div className="composer-wrap" ref={wrap}>
      {picker.open && <AtPicker listId={listId} items={shown} active={active} query={query} onPick={pick} onActive={(index) => setPicker({ open: true, active: index })} />}
      <div className="composer">
        <div className="chips">
          {view.chips.map((chip) => (
            <span className="atchip" key={chip.key} data-target={chip.key}>
              @{tm(chip.label)}
              <button type="button" data-act="unpoint" aria-label={t("director.composer.remove", { target: tm(chip.label) })} onClick={() => { store.pointAt(chip.target, false); textarea.current?.focus(); }}>×</button>
            </span>
          ))}
        </div>
        <label className="sr" htmlFor={`${id}-message`}>{t("director.composer.label")}</label>
        <textarea
          id={`${id}-message`}
          ref={textarea}
          data-field="message"
          rows={1}
          placeholder={t("director.composer.placeholder")}
          value={composer.text}
          readOnly={composer.sending}
          aria-autocomplete="list"
          aria-controls={picker.open && shown.length ? listId : undefined}
          aria-activedescendant={activeItem ? pickerOptionId(listId, activeItem) : undefined}
          aria-describedby={view.problem ? noteId : undefined}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        />
        <div className="composer-foot">
          <button type="button" className="at-btn" data-act="at" aria-label={t("director.composer.pick")} aria-haspopup="listbox" aria-expanded={picker.open} aria-controls={picker.open && shown.length ? listId : undefined} onClick={toggleFromButton}>@</button>
          <span>{t("director.composer.hint")}</span>
          <button type="button" className="send" data-act="send" aria-label={t("director.composer.send")} disabled={!view.canSend} onClick={send}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 12V2M2.5 6.5 7 2l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      {view.problem && <p className="composer-note" id={noteId} role="status">{tm(view.problem)}</p>}
    </div>
  );
}
