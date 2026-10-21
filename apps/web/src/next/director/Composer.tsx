import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { composerView, filterPicker, labelList, mentionAt, pickerItems, removeMention, withoutKeyframes, type PickerItem } from "../model/director.ts";
import { msg } from "../model/types.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import { useGuarded, useRecoveryLock } from "../app/useWriteGuard.ts";
import { AtPicker, pickerOptionId } from "./AtPicker.tsx";
import { PictureThumb, RefChip } from "./RefChip.tsx";
import { forgetDraft, keptDraftVersion } from "./useComposerDraft.ts";
import { droppedFiles, fileStatus, roomFor, type ComposerFile } from "../model/composer-files.ts";
import type { useComposerUploads } from "./useComposerUploads.ts";
import { IMPORT_ACCEPT } from "../model/assets-import.ts";

/** About six lines; past that the textarea scrolls. */
const MAX_LINES = 6;
/** The composer's hint while a restored studio is in recovery review. */
const RECOVERY_HINT = msg("guard.recovery_short");

/**
 * The reply box. One explicit target model: the chips are what the message points at, added only
 * with @ (typed, the @ button, or "@ 2.1" in the inspector). Selecting a shot never changes them.
 * Sending follows the shell's write guard (offline or expired turns it off, the draft stays); while the film is
 * stopped Send stays on and the hint says the Director waits for Continue. With no film open (Start) it is off.
 */
export function Composer({ hasFilm, restored, uploads }: { hasFilm: boolean; restored: boolean; uploads: ReturnType<typeof useComposerUploads> }) {
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
  // A restored studio in recovery review: the hint names that reason instead of "offline" (the draft is kept as well).
  const locked = useRecoveryLock() !== null;
  const hint = locked && view.hint ? RECOVERY_HINT : view.hint;
  const items = useMemo(() => pickerItems(overview), [overview]);

  const id = useId();
  const listId = `${id}-picker`;
  const noteId = `${id}-note`;
  const draftId = `${id}-draft`;
  const scopeId = `${id}-scope`;
  const hintId = `${id}-hint`;
  const picturesId = `${id}-pictures`;
  // The hint describes the textarea when it says why a message waits (offline, stopped), not when it explains @.
  const hintDescribes = !!hint && hint.id !== "director.composer.hint";
  const showDraft = restored && !view.off && (!!composer.text || composer.targets.length > 0 || composer.images.length > 0);
  const fileInput = useRef<HTMLInputElement>(null);
  const files = composer.files;
  const full = roomFor(files, composer.images.length) === 0;
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
    const version = projectId ? keptDraftVersion(store, projectId) : null;
    void store.sendMessage().then((sent) => { if (sent && projectId && store.getState().projectId !== projectId) forgetDraft(projectId, mode, version); });
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

  // Pasted files (a screenshot, a copied file) attach; pasted text stays text.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = droppedFiles(Array.from(event.clipboardData?.items ?? []), event.clipboardData?.files ?? null);
    if (!pasted.length) return;
    event.preventDefault();
    uploads.attach(pasted);
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
        {/* Pictures and @ targets share one wrapping row (and one size) while they fit. */}
        {(view.pictures.length > 0 || view.chips.length > 0 || files.length > 0) && (
          <div className="composer-tokens">
            {files.length > 0 && (
              <ul className="file-chips" aria-label={t("director.file.group")}>
                {files.map((file) => <FileChip key={file.key} file={file} onRemove={() => { uploads.remove(file.key); textarea.current?.focus(); }} />)}
              </ul>
            )}
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
            {view.chips.length > 0 && (
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
            )}
          </div>
        )}
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
          onPaste={onPaste}
        />
        <div className="composer-foot">
          <button type="button" className="at-btn" data-act="at" aria-label={t("director.composer.pick")} aria-haspopup="listbox" aria-expanded={picker.open} aria-controls={picker.open && shown.length ? listId : undefined} disabled={view.off} onClick={toggleFromButton}>@</button>
          <button type="button" className="at-btn attach-btn" data-act="attach" aria-label={t("director.file.attach")} title={full ? t("director.file.full", { max: 8 }) : t("director.file.attach")} disabled={view.off || composer.sending || full} onClick={() => fileInput.current?.click()}>
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 4.5 5.4 9.6a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a3 3 0 0 0-4.3-4.3L3.4 7.6a4.4 4.4 0 0 0 6.2 6.2l4.2-4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <input ref={fileInput} type="file" multiple hidden accept={IMPORT_ACCEPT} data-act="attach-input" tabIndex={-1} onChange={(event) => { uploads.attach(Array.from(event.target.files ?? [])); event.target.value = ""; textarea.current?.focus(); }} />
          <span id={hintId} data-hint={hint?.id ?? "none"}>{hint ? tm(hint) : ""}</span>
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

/** The kind of a file, drawn small; an image shows itself once its preview is read. */
function KindIcon({ kind }: { kind: ComposerFile["kind"] }) {
  const paths: Record<ComposerFile["kind"], string> = {
    image: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3",
    video: "M2.5 4h8v8h-8zM10.5 7l3-2v6l-3-2",
    audio: "M6 11.5V4l6-1.5V10M6 11.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM12 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z",
    document: "M4 2.5h5.5l2.5 2.5v8.5H4zM9.5 2.5V5H12M6 8h4M6 10.5h4",
  };
  return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={paths[kind]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

/** One attached file: what it is, how its upload goes (or why it failed), and remove. */
function FileChip({ file, onRemove }: { file: ComposerFile; onRemove(): void }) {
  const { t, tm } = useI18n();
  const status = tm(fileStatus(file));
  const fraction = file.state === "uploading" ? Math.min(1, file.loaded / Math.max(1, file.size)) : null;
  return (
    <li className={`file-chip ${file.state}`} data-file={file.key} data-kind={file.kind} data-state={file.state}>
      <span className="file-ic">{file.preview ? <img src={file.preview} alt="" /> : <KindIcon kind={file.kind} />}</span>
      <span className="file-text">
        <span className="file-name" title={file.name}>{file.name}</span>
        <span className="file-status" role={file.state === "failed" ? "alert" : undefined}>{status}</span>
      </span>
      {fraction !== null ? <span className="file-bar" aria-hidden="true"><i style={{ width: `${Math.round(fraction * 100)}%` }} /></span> : null}
      <button type="button" data-act="remove-file" aria-label={t("director.file.remove", { name: file.name })} onClick={onRemove}>×</button>
    </li>
  );
}
