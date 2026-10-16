import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { partlyInView, ROOMY, scrolls as scrollsIn, tighten, type FitMeasure, type InspectorLayout, type Span } from "../model/inspector-fit.ts";

/** The units a scrolled inspector shows whole or not at all: the title, the status, each row, a note, each action. */
const UNITS = ".insp-title, .insp > .st, .insp-stop > p, .insp .rows .row-pair, .insp-notes > p, .insp-body > .insp-alert, .insp-actions > *";
/** The note under the keyframe button carries its price: it is shown with its button, never without it. */
const BUTTON_NOTE = ".insp-actions > .insp-note";
/** The two actions that sit side by side once the inspector is compact. */
const PAIR = '.insp-actions [data-act="edit-prompt"] .lbl, .insp-actions [data-act="edit-motion"] .lbl';

/** The actions pinned at the foot of the inspector (the pinned layout), else null. */
function pinnedActions(root: HTMLElement): HTMLElement | null {
  return root.getAttribute("data-fit") === "pinned" ? root.querySelector<HTMLElement>(".insp-actions") : null;
}

function measure(root: HTMLElement): FitMeasure {
  const body = root.querySelector<HTMLElement>(".insp-body");
  const actions = pinnedActions(root);
  const title = root.querySelector<HTMLElement>(".insp-title");
  // At rest (scrolled to the top), the pinned actions start this far below the inspector's padding box; the title
  // must end above them.
  const top = root.getBoundingClientRect().top + root.clientTop;
  const cramped = !!actions && !!title && title.getBoundingClientRect().bottom - top + root.scrollTop > root.clientHeight - actions.offsetHeight + 0.5;
  return {
    overflows: root.scrollHeight > root.clientHeight + 1 || (!!body && body.scrollHeight > body.clientHeight + 1),
    labelCut: [...root.querySelectorAll<HTMLElement>(PAIR)].some((label) => label.scrollWidth > label.clientWidth + 1),
    cramped,
  };
}

/** A row is display: contents (its label and value sit in the rows grid): its box is its children's. */
function partsOf(unit: HTMLElement): HTMLElement[] {
  return getComputedStyle(unit).display === "contents" ? [...unit.children] as HTMLElement[] : [unit];
}

function spanOf(parts: HTMLElement[]): Span {
  const rects = parts.map((part) => part.getBoundingClientRect()).filter((rect) => rect.height > 0);
  return rects.length ? { top: Math.min(...rects.map((rect) => rect.top)), bottom: Math.max(...rects.map((rect) => rect.bottom)) } : { top: 0, bottom: 0 };
}

/** The units that scroll: every one, or all but the pinned actions (always in view at the foot). */
function unitsOf(root: HTMLElement): HTMLElement[][] {
  const pinned = pinnedActions(root);
  const units: HTMLElement[][] = [];
  for (const element of root.querySelectorAll<HTMLElement>(UNITS)) {
    if (pinned?.contains(element)) continue;
    if (element.matches(BUTTON_NOTE) && units.length) units[units.length - 1]!.push(element);
    else units.push(partsOf(element));
  }
  return units;
}

/** What the scrolling units are drawn in: the inspector's content box, above the pinned actions if any. */
function viewOf(root: HTMLElement): Span {
  const box = root.getBoundingClientRect();
  const style = getComputedStyle(root);
  const top = box.top + root.clientTop;
  const actions = pinnedActions(root);
  return { top: top + parseFloat(style.paddingTop), bottom: actions ? actions.getBoundingClientRect().top : top + root.clientHeight - parseFloat(style.paddingBottom) };
}

/**
 * Marks the units only partly in view; CSS leaves them undrawn (still focusable). Also says whether rows are hidden
 * below (the pinned actions' chevron) and how tall the actions are (the browser's own focus scrolling keeps clear).
 */
function markPartlyInView(root: HTMLElement): void {
  const units = unitsOf(root);
  const spans = units.map(spanOf);
  const view = viewOf(root);
  const cut = partlyInView(spans, view);
  units.forEach((parts, index) => parts.forEach((part) => part.toggleAttribute("data-cut", cut[index])));
  root.toggleAttribute("data-below", spans.some((span) => span.bottom > view.bottom + 0.5));
  const actions = pinnedActions(root);
  root.style.setProperty("--insp-pin", actions ? `${actions.offsetHeight}px` : "0px");
}

/** Scrolls the whole unit holding the focus into the view (a button with its priced note, say). */
function reveal(root: HTMLElement, target: Element): void {
  const unit = unitsOf(root).find((parts) => parts.some((part) => part.contains(target)));
  if (!unit) return;
  const span = spanOf(unit);
  const view = viewOf(root);
  if (span.bottom > view.bottom) root.scrollTop += Math.min(span.bottom - view.bottom, span.top - view.top);
  else if (span.top < view.top) root.scrollTop -= view.top - span.top;
  markPartlyInView(root);
}

/** A refit or a restored panel can keep focus in a row without dispatching a new focusin event. */
function revealFocus(root: HTMLElement): void {
  const focused = root.ownerDocument.activeElement;
  if (focused instanceof Element && root.contains(focused)) reveal(root, focused);
}

function clearMarks(root: HTMLElement): void {
  for (const element of root.querySelectorAll("[data-cut]")) element.removeAttribute("data-cut");
  root.removeAttribute("data-below");
  root.style.removeProperty("--insp-pin");
}

/**
 * The inspector's layout for its rows view (model/inspector-fit.ts), measured before the browser paints: on new
 * content or a new size it starts from the design's roomy layout and tightens while anything overflows. In the
 * layouts that scroll, a row or button partly in view stays undrawn, as the person scrolls too, and one that takes
 * the focus is scrolled fully in. `active` is false while a panel or an edit form has the inspector, and on a phone,
 * where the inspector is as tall as its content.
 */
export function useInspectorFit(root: RefObject<HTMLElement | null>, active: boolean, content: string): InspectorLayout {
  const [layout, setLayout] = useState<InspectorLayout>(ROOMY);
  // The inspector's room is set by the stage, never by its content. A resize is measured at once (flushSync), so a
  // frame with a cut row is never painted. Its border box: a scrollbar coming or going is not a new room.
  const [room, setRoom] = useState("");
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = `${element.offsetWidth}x${element.offsetHeight}`;
      flushSync(() => setRoom(next));
    });
    observer.observe(element, { box: "border-box" });
    return () => observer.disconnect();
  }, [root]);
  // Text is measured again once the web font has replaced the fallback.
  const [fonts, setFonts] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => { if (live) setFonts(true); });
    return () => { live = false; };
  }, []);

  const key = `${active}|${content}|${room}|${fonts}`;
  const seen = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !active) return;
    if (seen.current !== key) {
      seen.current = key;
      if (layout !== ROOMY) { setLayout(ROOMY); return; }
    }
    const next = tighten(layout, measure(element));
    if (next !== layout) setLayout(next);
  });

  const scrolls = active && scrollsIn(layout.fit);
  // Every render may move a unit (new rows, a note): mark again.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    if (scrolls) { markPartlyInView(element); revealFocus(element); }
    else clearMarks(element);
  });
  useEffect(() => {
    const element = root.current;
    if (!element || !scrolls) return;
    // Scroll events come once a frame, before it is painted.
    const onScroll = () => markPartlyInView(element);
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Element) reveal(element, event.target); };
    element.addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("focusin", onFocus);
    revealFocus(element);
    return () => {
      element.removeEventListener("scroll", onScroll);
      element.removeEventListener("focusin", onFocus);
    };
  }, [root, scrolls]);

  return active ? layout : ROOMY;
}
