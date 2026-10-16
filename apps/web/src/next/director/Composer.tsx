import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { composerView, filterPicker, labelList, mentionAt, pickerItems, removeMention, withoutKeyframes, type PickerItem } from "../model/director.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";
import { AtPicker, pickerOptionId } from "./AtPicker.tsx";
import { PictureThumb, RefChip } from "./RefChip.tsx";
import { forgetDraft } from "./useComposerDraft.ts";

/** About six lines; past that the textarea scrolls. */
const MAX_LINES = 6;

/**
 * The reply box. One explicit target model: the chips are what the message points at, added only
 * with @ (typed, the @ button, or "@ 2.1" in the inspector). Selecting a shot never changes them.
 * Sending follows the shell's write guard (offline or expired turns it off, the draft stays); while the film is
 * stopped Send stays on and the hint says the Director waits for Continue. With no film open (Start) it is off.
 */
export function Composer({ hasFilm, restored }: { hasFilm: boolean; restored: boolean }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const mode = useMode();
  const composer = useStudio((s) => s.composer);
  const sendGuard = useGuarded("server");
  const reachable = !sendGuard.disabled;
  const stopped = useStudio((s) => !!s.overview?.stopped);
  const overview = useStudio((s) => s.overview);
  const director = useStudio((s) => s.director);
  const view = useMemo(() => composerView(composer, reachable, overview, { open: hasFilm, stopped }, director), [composer, reachable, overview, hasFilm, stopped, director]);
  const items = useMemo(() => pickerItems(overview), [overview]);

  const id = useId();
  const listId = `${id}-picker`;
  const noteId = `${id}-note`;
  const draftId = `${id}-draft`;
  const scopeId = `${id}-scope`;
  const hintId = `${id}-hint`;
  const picturesId = `${id}-pictures`;
  // The hint describes the textarea when it says why a message waits (offline, stopped), not when it explains @.
  const hintDescribes = !!view.hint && view.hint.id !== "director.composer.hint";
  const showDraft = restored && !view.off && (!!composer.text || composer.targets.length > 0 || composer.images.length > 0);
  // Focus lands here after "Show the Director" (on a phone with no toast), so the box names the pictures it carries.
  const describedBy = [view.pictures.length ? picturesId : null, view.problem ? noteId : null, hintDescribes ? hintId : null, view.pointsAt.length ? scopeId : null, showDraft ? draftId : null].filter(Boolean).join(" ") || undefined;
  const pictureNames = view.pictures.map((picture) => tm(picture.label));
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

  // Start has no film to point at: an open picker closes with the composer.
  useEffect(() => { if (view.off) setPicker({ open: false, active: 0 }); }, [view.off]);

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
    // Sent while another film was opened meanwhile: that film's kept draft is the message just sent.
    const projectId = store.getState().projectId;
    void store.sendMessage().then((sent) => { if (sent && projectId && store.getState().projectId !== projectId) forgetDraft(projectId, mode); });
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
        // The shell's Esc closes the narrow drawer unless the key was already used (escClosesDrawer).
        event.preventDefault();
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
        {view.pictures.length > 0 && (
          <ul className="pic-chips" aria-label={t("director.picture.group")}>
            {view.pictures.map((picture, index) => {
              const name = pictureNames[index]!;
              return (
                <li className={`pic-chip${picture.problem ? " problem" : ""}`} key={picture.key} data-picture={picture.image.artifactId} data-source={picture.image.source}>
                  <PictureThumb picture={picture.image} alt="" />
                  <span className="pic-name" title={name}>{name}</span>
                  <button type="button" data-act="remove-picture" aria-label={t("director.picture.remove", { name })} onClick={() => { store.removePicture(picture.key); textarea.current?.focus(); }}>×</button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="chips">
          {view.chips.map((chip) => {
            const label = tm(chip.label);
            const gone = chip.label.id === "director.target.gone";
            return (
              <span className="atchip-wrap" key={chip.key} data-target={chip.key}>
                <RefChip label={label} target={gone ? null : chip.target} />
                <button type="button" className="atchip-x" data-act="unpoint" aria-label={t("director.composer.remove", { target: label })} onClick={() => { store.pointAt(chip.target, false); textarea.current?.focus(); }}>×</button>
              </span>
            );
          })}
        </div>
        <label className="sr" htmlFor={`${id}-message`}>{t("director.composer.label")}</label>
        <textarea
          id={`${id}-message`}
          ref={textarea}
          data-field="message"
          rows={1}
          placeholder={t(view.off ? "director.composer.no_film" : "director.composer.placeholder")}
          value={composer.text}
          disabled={view.off}
          readOnly={composer.sending}
          aria-autocomplete="list"
          aria-controls={picker.open && shown.length ? listId : undefined}
          aria-activedescendant={activeItem ? pickerOptionId(listId, activeItem) : undefined}
          aria-describedby={describedBy}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        />
        <div className="composer-foot">
          <button type="button" className="at-btn" data-act="at" aria-label={t("director.composer.pick")} aria-haspopup="listbox" aria-expanded={picker.open} aria-controls={picker.open && shown.length ? listId : undefined} disabled={view.off} onClick={toggleFromButton}>@</button>
          <span id={hintId} data-hint={view.hint?.id ?? "none"}>{view.hint ? tm(view.hint) : ""}</span>
          <button type="button" className="send" data-act="send" aria-label={t("director.composer.send")} {...sendGuard} disabled={!view.canSend} onClick={send}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 12V2M2.5 6.5 7 2l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      </div>
      {view.problem && <p className="composer-note" id={noteId} role="status">{tm(view.problem)}</p>}
      {view.pointsAt.length > 0 && (
        // With no @ target the keyframes' shots replace the whole film; with targets they join them.
        <div className="composer-scope" data-note="points-at" data-scope={view.narrowed ? "narrowed" : "added"}>
          <p className="composer-draft" id={scopeId}>{t(view.narrowed ? "director.picture.points_only" : "director.picture.points_at", { shots: labelList(view.pointsAt, locale), n: view.pointsAt.length })}</p>
          {view.narrowed && (
            <button type="button" className="pill sm" data-act="keep-whole-film" disabled={composer.sending} onClick={() => { store.dispatch({ type: "composerImages", images: withoutKeyframes(composer.images) }); textarea.current?.focus(); }}>
              {t("director.picture.keep_film", { n: view.pointsAt.length })}
            </button>
          )}
        </div>
      )}
      {showDraft && <p className="composer-draft" id={draftId} data-draft="restored">{t("director.draft.restored")}</p>}
      {view.pictures.length > 0 && <span className="sr" id={picturesId}>{t("director.picture.in_message", { names: labelList(pictureNames, locale) })}</span>}
    </div>
  );
}
