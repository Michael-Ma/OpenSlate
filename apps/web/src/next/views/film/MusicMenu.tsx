import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MusicRecording } from "../../model/film.ts";
import { clock as formatClock } from "../../model/motion.ts";

interface Props {
  anchor: HTMLElement;
  recordings: readonly MusicRecording[] | null;
  current: string | null;
  onPick(audioId: string | null): void;
  onImport(): void;
  onClose(): void;
}

/**
 * Change music: only music-role recordings from this film's assets (SB-24), No music, and a way to import more
 * in Assets. Fixed under (or above) its button; Esc or a click outside closes it and focus goes back.
 */
export function MusicMenu({ anchor, recordings, current, onPick, onImport, onClose }: Props) {
  const { t } = useI18n();
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth, height = element.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 4 + height <= window.innerHeight - 8;
    setPlace({ left, top: Math.max(8, below ? rect.bottom + 4 : rect.top - 4 - height) });
  }, [anchor, recordings]);

  // Focus the chosen item once the menu is placed (a hidden element cannot take focus).
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const element = menu.current;
    const first = element?.querySelector<HTMLElement>('[aria-checked="true"]') ?? element?.querySelector<HTMLElement>("button:not(:disabled)");
    if (!element?.contains(document.activeElement)) first?.focus();
  }, [placed, recordings]);

  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
      close.current();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [anchor]);

  const finish = (action: () => void) => {
    action();
    close.current();
    if (anchor.isConnected) anchor.focus();
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(() => {}); }
    else if (event.key === "Tab") { close.current(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
      next?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={menu}
      className="menu fv-menu"
      role="menu"
      aria-label={t("film.menu.title")}
      style={{ position: "fixed", left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
      onKeyDown={onKey}
    >
      <h4>{t("film.menu.title")}</h4>
      {recordings === null ? <p className="menu-note">{t("film.menu.loading")}</p> : null}
      {recordings !== null && !recordings.length ? <p className="menu-note">{t("film.menu.empty")}</p> : null}
      {(recordings ?? []).map((recording) => (
        <button key={recording.id} type="button" role="menuitemradio" aria-checked={current === recording.id} data-act="pick-music" data-audio={recording.id} onClick={() => finish(() => onPick(recording.id))}>
          <span className="grow">{recording.label}</span>
          <span className="muted num">{formatClock(recording.durationSeconds)}</span>
        </button>
      ))}
      <button type="button" role="menuitemradio" aria-checked={current === null} data-act="pick-music" data-audio="" onClick={() => finish(() => onPick(null))}>{t("film.menu.none")}</button>
      <hr />
      <button type="button" role="menuitem" data-act="import-music" onClick={() => { onClose(); onImport(); }}>{t("film.menu.import")}</button>
    </div>
  );
}
