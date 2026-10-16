import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { alignedEndPadding, coverHeight, rowsBelow } from "../../model/film-export.ts";
import { separatorShown, wordsCut } from "../../model/film.ts";

/**
 * An element's width in px, followed as it resizes: pass the returned ref to the element. Null until measured (or
 * without ResizeObserver).
 */
export function useElementWidth(): [(node: HTMLElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!node || typeof ResizeObserver !== "function") return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

/** The bottom edge of an element's words (its text, not its boxes), or of its first box when it has no text. */
function wordsBottom(element: Element): number {
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let bottom = -Infinity;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent?.trim()) continue;
    range.selectNodeContents(text);
    const words = range.getBoundingClientRect();
    if (words.height > 0) bottom = Math.max(bottom, words.bottom);
  }
  return Number.isFinite(bottom) ? bottom : (element.firstElementChild ?? element).getBoundingClientRect().bottom;
}

/** Rows still below a scrolling table's fold, and how tall the count drawn over its bottom is (0 when none are). */
export interface RowsBelow { count: number; cover: number }

/**
 * How many rows of a scrolling table are still to come below what can be read (model/film-export.ts rowsBelow),
 * followed as it scrolls and resizes: pass the returned ref to the scrolling element. Rows are `rowSelector` elements
 * (they may be `display: contents`: their first cell gives the box) and count by their words; `cover` is the least the
 * count over the bottom covers (it reaches up to the first row it counts, coverHeight); `rows` changes when the rows
 * do. While the rows scroll, the table's bottom padding makes its last scroll position a row edge
 * (alignedEndPadding), and `showMore` scrolls the first row still below up to the top.
 */
export function useRowsBelow(rowSelector: string, cover: number, rows: string, reduced: boolean): [(node: HTMLElement | null) => void, RowsBelow, () => void] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [below, setBelow] = useState<RowsBelow>({ count: 0, cover: 0 });
  const read = useCallback((table: HTMLElement) => {
    const items = [...table.querySelectorAll<HTMLElement>(rowSelector)];
    const box = (item: HTMLElement) => (item.firstElementChild ?? item).getBoundingClientRect();
    // The inside of the table, unrounded (clientHeight is whole pixels; rows may sit on fractions).
    const frame = table.getBoundingClientRect();
    const style = getComputedStyle(table);
    const top = frame.top + parseFloat(style.borderTopWidth);
    const visibleBottom = frame.bottom - parseFloat(style.borderBottomWidth);
    // Where rows start under the sticky header, with the table at the top, and how far apart they are.
    const start = items.length ? box(items[0]!).top - top + table.scrollTop : 0;
    const pitch = items.length > 1 ? box(items[1]!).top - box(items[0]!).top : 0;
    return { items, box, top, start, pitch, visibleBottom };
  }, [rowSelector]);
  useEffect(() => {
    if (!node) { setBelow({ count: 0, cover: 0 }); return; }
    const measure = () => {
      const { items, box, start, pitch, visibleBottom, top } = read(node);
      const pad = alignedEndPadding(visibleBottom - top - start, pitch, items.length);
      const padding = pad === null ? "" : `${pad}px`;
      if (node.style.paddingBottom !== padding) node.style.paddingBottom = padding;
      const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      const bottoms = items.map(wordsBottom);
      const count = rowsBelow(bottoms, visibleBottom, cover, atEnd);
      const height = coverHeight(items.map((item) => box(item).top), bottoms, visibleBottom, cover, atEnd);
      setBelow((was) => (was.count === count && Math.abs(was.cover - height) < 0.1 ? was : { count, cover: height }));
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [node, read, cover, rows]);
  const showMore = useCallback(() => {
    if (!node) return;
    const { items, box, top, start, visibleBottom } = read(node);
    const next = items.find((item) => wordsBottom(item) > visibleBottom - cover + 0.5);
    if (next) node.scrollBy({ top: box(next).top - (top + start), behavior: reduced ? "auto" : "smooth" });
  }, [node, read, cover, reduced]);
  return [setNode, below, showMore];
}

/**
 * In a row that wraps, hides each `selector` separator that would end or start a line (model/film.ts
 * separatorShown). It keeps its space, so nothing reflows. Followed as the row resizes and its contents change: pass
 * the returned ref to the row.
 */
export function useLineSeparators(selector: string): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!node) return;
    let frame = 0;
    const box = (element: Element | null) => element ? element.getBoundingClientRect() : null;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const separator of node.querySelectorAll<HTMLElement>(selector)) {
          const shown = separatorShown(box(separator.previousElementSibling), separator.getBoundingClientRect(), box(separator.nextElementSibling));
          separator.style.visibility = shown ? "" : "hidden";
        }
      });
    };
    measure();
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resized?.observe(node);
    // Only content changes: the separators' own style changes are attribute changes, so they do not come back here.
    const changed = new MutationObserver(measure);
    changed.observe(node, { childList: true, subtree: true, characterData: true });
    return () => { cancelAnimationFrame(frame); resized?.disconnect(); changed.disconnect(); };
  }, [node, selector]);
  return setNode;
}

/**
 * Gives each element under the returned ref that lists `data-forms` (its forms, fullest first, e.g. "words mark") the
 * first form whose contents are not cut (model/film.ts wordsCut), as `data-form`; CSS draws each form. Measured before
 * paint, and again as the lanes resize or their contents change.
 */
export function useFittedForms(locale: string): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!node) return;
    const fit = () => {
      const all = [...node.querySelectorAll<HTMLElement>("[data-forms]")].map((element) => ({ element, forms: (element.dataset.forms ?? "").split(" ").filter(Boolean) }));
      // One layout per round: every element still cut tries its next form together.
      let pending = all.filter((item) => item.forms.length);
      for (let round = 0; pending.length; round++) {
        for (const { element, forms } of pending) if (element.dataset.form !== forms[round]) element.dataset.form = forms[round];
        pending = pending.filter(({ element, forms }) => round < forms.length - 1 && wordsCut(element));
      }
    };
    const resized = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    const observed = new Set<Element>();
    const styles = new MutationObserver(fit);
    let styled = new Set<Element>();
    const observeInputs = () => {
      const lanes = new Set<Element>([node, ...node.querySelectorAll(".lane")]);
      for (const lane of observed) if (!lanes.has(lane)) { resized?.unobserve(lane); observed.delete(lane); }
      for (const lane of lanes) if (!observed.has(lane)) { resized?.observe(lane); observed.add(lane); }
      // Observe styles only on chips, their contents and their containing boxes. In particular, the sibling
      // playhead's per-frame style is not a subscription at all.
      const next = new Set<Element>();
      for (const form of node.querySelectorAll("[data-forms]")) {
        for (let parent: Element | null = form; parent && node.contains(parent); parent = parent.parentElement) next.add(parent);
        for (const content of form.querySelectorAll("*")) next.add(content);
      }
      if (next.size === styled.size && [...next].every((element) => styled.has(element))) return;
      styles.disconnect();
      for (const element of next) styles.observe(element, { attributes: true, attributeFilter: ["style"] });
      styled = next;
    };
    observeInputs();
    fit();
    const withinForm = (target: Node) => !!(target instanceof Element ? target : target.parentElement)?.closest("[data-forms]");
    const containsForm = (target: Node) => target instanceof Element && (target.matches("[data-forms]") || !!target.querySelector("[data-forms]"));
    const changesFit = (change: MutationRecord) => {
      if (change.type === "attributes") return true; // data-forms is the only observed attribute here.
      if (withinForm(change.target)) return true;
      return change.type === "childList" && [...change.addedNodes, ...change.removedNodes].some(containsForm);
    };
    // Only fitting inputs: chip words/forms and their geometry. data-form is our output and is never observed.
    const changed = new MutationObserver((changes) => {
      if (changes.some((change) => change.type !== "characterData")) observeInputs();
      if (changes.some(changesFit)) fit();
    });
    changed.observe(node, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-forms"] });
    return () => { resized?.disconnect(); styles.disconnect(); changed.disconnect(); };
  }, [node, locale]);
  return setNode;
}
