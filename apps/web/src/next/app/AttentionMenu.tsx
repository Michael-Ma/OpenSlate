import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { attentionItems, filmAttentionItems, type AttentionGroup, type AttentionItem } from "../model/attention.ts";
import { GiveUp } from "./GiveUp.tsx";
import { NARROW_QUERY, noteOpenView, shownView } from "../model/shell.ts";
import { useStore, useStudio } from "../store/react.tsx";

const GROUPS: AttentionGroup[] = ["waiting", "failed"];

/**
 * "Needs attention" (failure-display item 3): a counted pill left of Synced, hidden when nothing needs the person.
 * It opens the film-wide list of jobs that failed for good or wait for the service's answer; each item opens its
 * shot. Under the pill on wide screens, a bottom sheet on narrow ones. Keys as in the studio menu.
 */
export function AttentionMenu() {
  const { t, tm } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const items = useMemo(() => attentionItems(overview), [overview]);
  // Decision R4: film-wide local work that stopped after it started; Render again is acknowledged in place.
  const film = useMemo(() => filmAttentionItems(overview), [overview]);
  const pending = useStudio((s) => s.pending);
  const count = items.length + film.length;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };
  useEffect(() => { if (!count) setOpen(false); }, [count]);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = list.current, anchor = button.current?.getBoundingClientRect();
    if (!menu || !anchor) return;
    if (!window.matchMedia(NARROW_QUERY).matches) {
      const left = Math.max(8, Math.min(anchor.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
      Object.assign(menu.style, { left: `${left}px`, top: `${anchor.bottom + 6}px` });
    }
    menu.style.visibility = "visible";
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
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("resize", away); };
  }, [open]);

  if (!count) return null;

  const go = (item: AttentionItem) => {
    close(false);
    store.focusShot(item.shotId);
    const view = shownView(store.getState());
    if (noteOpenView(view) !== view) store.setView(noteOpenView(view));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (index: number) => { event.preventDefault(); buttons[(index + buttons.length) % buttons.length]?.focus(); };
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Tab") close(false);
  };

  return (
    <>
      <button ref={button} type="button" className="attn-btn" data-act="attention" aria-haspopup="dialog" aria-expanded={open}
        aria-label={t("attention.button_label", { count })} onClick={() => setOpen((value) => !value)}>
        <span className="count" aria-hidden="true">{count}</span><span className="attn-word">{t("attention.button")}</span>
      </button>
      {open && (
        <div ref={list} className="attn-pop" role="dialog" aria-label={t("attention.button")} style={{ visibility: "hidden" }} onKeyDown={onKeyDown}>
          <h3>{t("attention.title", { count })}</h3>
          <p className="sub">{t("attention.sub")}</p>
          {GROUPS.map((group) => {
            const rows = items.filter((item) => item.group === group);
            if (!rows.length) return null;
            return (
              <section key={group} aria-label={t(`attention.group.${group}`)}>
                <div className="attn-group">{t(`attention.group.${group}`)}</div>
                {rows.map((item) => (
                  <div key={item.key} className="attn-item" data-item={item.key} data-group={group}>
                    <span className="badge">{item.label}</span>
                    <div className="t"><b>{tm(item.title)}</b>{tm(item.detail)}</div>
                    <button type="button" className="pill sm" data-act="attention-open" data-shot={item.shotId} onClick={() => go(item)}>{t("attention.open", { shot: item.label })}</button>
                  </div>
                ))}
              </section>
            );
          })}
          {film.length ? (
            <section aria-label={t("attention.group.film")}>
              <div className="attn-group">{t("attention.group.film")}</div>
              {film.map((item) => (
                <div key={item.key} className="attn-item" data-item={item.key} data-group="film">
                  <div className="t"><b>{tm(item.title)}</b>{tm(item.detail)}</div>
                  <GiveUp attemptId={item.attemptId} className="attn-act" note={false} act="render-again" busy={Object.keys(pending).some((key) => key.startsWith("release:"))}
                    labels={{ note: null, ack: "attention.render_again_ack", open: "attention.render_again", confirm: "attention.render_again_confirm" }}
                    onRelease={(attemptId) => void store.retryLocalAttempt(attemptId)} />
                </div>
              ))}
            </section>
          ) : null}
          <div className="attn-foot">{t("attention.foot")}</div>
        </div>
      )}
    </>
  );
}
