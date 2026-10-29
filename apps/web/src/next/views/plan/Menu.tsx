import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuItem {
  act: string;
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Why it is off. */
  title?: string;
  /** Draw a line above this item. */
  separated?: boolean;
}

interface Props {
  /** The button's accessible name ("More for Scene 1"). */
  label: string;
  act: string;
  items: MenuItem[];
  disabled?: boolean;
  title?: string;
  data?: Record<`data-${string}`, string>;
}

/**
 * A `•••` button with a small action menu under it (system.css 8.12). Arrow keys move, Esc or a click outside
 * closes it and focus returns to the button. It is fixed in place and follows its button when the page scrolls.
 */
export function Menu({ label, act, items, disabled, title, data }: Props) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    setPlace(null);
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  /** Under the button, right-aligned, flipped above when there is no room below. */
  const placeMenu = () => {
    const anchor = button.current?.getBoundingClientRect();
    const menu = list.current;
    if (!anchor || !menu) return false;
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) return false;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
    const below = anchor.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - 4 - height) : below;
    // Applied at once as well, so the first item can take focus before React renders the new place.
    Object.assign(menu.style, { left: `${left}px`, top: `${top}px`, visibility: "visible" });
    setPlace({ left, top });
    return true;
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (placeMenu()) list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    else close(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (list.current?.contains(target) || button.current?.contains(target)) return;
      close(false);
    };
    // The page can scroll under a fixed menu (a smooth scroll to a moved row, the wheel): it follows its button.
    const follow = () => { if (!placeMenu()) close(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
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
        className="pill sm ghost more"
        data-act={act}
        {...data}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") { event.preventDefault(); close(true); }
          else if (!open && event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && (
        <div
          ref={list}
          className="menu plan-menu"
          role="menu"
          aria-label={label}
          style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <div key={item.act} role="none" className={item.separated ? "sep" : undefined}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-act={item.act}
                disabled={item.disabled}
                title={item.title}
                onClick={() => { close(true); item.onSelect(); }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
