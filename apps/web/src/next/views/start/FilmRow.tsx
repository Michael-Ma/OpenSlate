import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { FILM_NAME_MAX, renameValue, type FilmRow as Row } from "../../model/start.ts";

interface Guard {
  /** Why writes are off (offline); null when they work. */
  offline: string | null;
}

/** One film: name (or the inline rename), counts and last change, the clips-made meter, Open and •••. */
export function FilmRow({ row, renaming, busy, guard, onOpen, onStartRename, onRename, onCancelRename, onArchive }: {
  row: Row;
  renaming: boolean;
  busy: boolean;
  guard: Guard;
  onOpen(): void;
  onStartRename(): void;
  onRename(name: string): Promise<boolean>;
  onCancelRename(): void;
  onArchive(): void;
}) {
  const { t, tm } = useI18n();
  const nameId = useId();
  return (
    <section className="panel film-row" aria-labelledby={nameId} data-film={row.id} aria-current={row.current ? "true" : undefined}>
      <div className="film-main">
        {renaming
          ? <RenameForm labelId={nameId} name={row.name} busy={busy} guard={guard} onSave={onRename} onCancel={onCancelRename} />
          : <h2 id={nameId}>{row.name}</h2>}
        <div className="meta">{tm(row.meta)}</div>
      </div>
      <div className="prog">
        {row.ticks && (
          <span className="ticks" aria-hidden="true">
            {row.ticks.map((made, index) => <i key={index} className={made ? "on" : undefined} />)}
          </span>
        )}
        <span>{tm(row.progress)}</span>
      </div>
      <div className="acts">
        <button type="button" className={`pill${row.current ? " primary" : ""}`} data-act="open-film" aria-label={t("start.film.open_label", { name: row.name })} onClick={onOpen}>
          {t("start.film.open")}
        </button>
        <MoreMenu name={row.name} guard={guard} onRename={onStartRename} onArchive={onArchive} />
      </div>
    </section>
  );
}

function RenameForm({ labelId, name, busy, guard, onSave, onCancel }: {
  labelId: string;
  name: string;
  busy: boolean;
  guard: Guard;
  onSave(name: string): Promise<boolean>;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const hintId = useId();
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const next = renameValue(value, name);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || guard.offline) return;
    if (next === null) { if (!value.trim() || value.trim() === name) onCancel(); return; }
    void onSave(next);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    <form className="rename" onSubmit={submit} onKeyDown={onKey}>
      <label className="sr" htmlFor={`${labelId}-input`} id={labelId}>{t("start.rename.label")}</label>
      <input ref={input} id={`${labelId}-input`} className="input" value={value} maxLength={FILM_NAME_MAX} aria-describedby={hintId} data-act="rename-input" onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className="pill sm primary" data-act="rename-save" disabled={busy || !!guard.offline} title={guard.offline ?? undefined}>{t("start.rename.save")}</button>
      <button type="button" className="pill sm" data-act="rename-cancel" onClick={onCancel}>{t("start.rename.cancel")}</button>
      <span className="hint" id={hintId}>{t("start.rename.hint")}</span>
    </form>
  );
}

/** The ••• menu: Rename, Archive…. Arrow keys move, Esc or a click outside closes it and focus returns. */
function MoreMenu({ name, guard, onRename, onArchive }: { name: string; guard: Guard; onRename(): void; onArchive(): void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    setPlace(null);
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !menu.current || !button.current) return;
    const anchor = button.current.getBoundingClientRect();
    const box = menu.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
    const below = anchor.bottom + 4;
    const top = below + box.height > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - box.height) : below;
    setPlace({ left, top });
  }, [open]);

  // Focus the first item once the menu is placed (a hidden element cannot take focus).
  const placed = place !== null;
  useEffect(() => {
    if (placed) menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const away = () => close(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [open]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(false); return; }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1]?.focus(); return; }
    if (!step || !items.length) return;
    event.preventDefault();
    items[(index + step + items.length) % items.length]?.focus();
  };

  // Focus goes back to ••• first, so a dialog opened from the menu returns there when it closes.
  const choose = (action: () => void) => () => { close(true); action(); };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="pill ghost more"
        data-act="film-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("start.film.more", { name })}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.6" fill="currentColor" /><circle cx="8" cy="2" r="1.6" fill="currentColor" /><circle cx="14" cy="2" r="1.6" fill="currentColor" /></svg>
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="start-menu"
          role="menu"
          aria-label={t("start.film.more", { name })}
          style={place ? { left: place.left, top: place.top } : { visibility: "hidden" }}
          onKeyDown={onKey}
        >
          <button type="button" role="menuitem" data-act="menu-rename" disabled={!!guard.offline} title={guard.offline ?? undefined} onClick={choose(onRename)}>{t("start.menu.rename")}</button>
          <hr />
          <button type="button" role="menuitem" data-act="menu-archive" disabled={!!guard.offline} title={guard.offline ?? undefined} onClick={choose(onArchive)}>{t("start.menu.archive")}</button>
        </div>
      )}
    </>
  );
}
