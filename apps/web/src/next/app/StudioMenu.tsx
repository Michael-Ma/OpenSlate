import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";

export interface StudioMenuItem {
  act: string;
  label: string;
  onSelect(): void;
}

function Dots() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * The top bar's menu: a 30 px round button beside Settings with a small menu under it (system.css 8.12 `.menu`).
 * Arrow keys, Home and End move; Esc or a click outside closes it and focus returns to the button; Tab closes it.
 */
export function StudioMenu({ items }: { items: StudioMenuItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  // Under the button, right-aligned and kept on screen; the first item takes focus.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = button.current?.getBoundingClientRect();
    const menu = list.current;
    if (!anchor || !menu) return;
    const left = Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
    Object.assign(menu.style, { left: `${left}px`, top: `${anchor.bottom + 6}px`, visibility: "visible" });
    menu.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (list.current?.contains(target) || button.current?.contains(target)) return;
      close(false);
    };
    const away = () => close(false);
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => { event.preventDefault(); buttons[(index + buttons.length) % buttons.length]?.focus(); };
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
    else if (event.key === "Tab") close(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="icon-btn studio-menu-btn"
        data-act="studio-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("shell.menu")}
        title={t("shell.menu")}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(event) => {
          if (!open && event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
        }}
      >
        <Dots />
      </button>
      {open && (
        <div ref={list} className="menu studio-menu" role="menu" aria-label={t("shell.menu")} style={{ visibility: "hidden" }} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <button
              key={item.act}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-act={item.act}
              // Focus goes back to the button first, so a dialog the item opens returns it there when it closes.
              onClick={() => { close(true); item.onSelect(); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
