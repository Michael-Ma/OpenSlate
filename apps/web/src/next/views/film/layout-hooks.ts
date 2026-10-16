import { useCallback, useEffect, useState } from "react";
import { alignedEndPadding, coverHeight, rowsBelow } from "../../model/film-export.ts";
import { separatorShown } from "../../model/film.ts";

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

