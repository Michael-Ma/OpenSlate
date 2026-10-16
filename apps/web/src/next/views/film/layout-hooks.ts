import { useEffect, useState } from "react";
import { rowsBelow } from "../../model/film-export.ts";

/**
 * How many rows of a scrolling table are still to come below what can be read (model/film-export.ts rowsBelow),
 * followed as it scrolls and resizes: pass the returned ref to the scrolling element. Each row is measured by its
 * `rowSelector` cell; `cover` is how much of the bottom is drawn over; `rows` changes when the rows do.
 */
export function useRowsBelow(rowSelector: string, cover: number, rows: string): [(node: HTMLElement | null) => void, number] {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [below, setBelow] = useState(0);
  useEffect(() => {
    if (!node) { setBelow(0); return; }
    const measure = () => {
      const visibleBottom = node.getBoundingClientRect().top + node.clientTop + node.clientHeight;
      const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 1;
      setBelow(rowsBelow([...node.querySelectorAll<HTMLElement>(rowSelector)].map((cell) => cell.getBoundingClientRect().bottom), visibleBottom, cover, atEnd));
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(node);
    return () => { node.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [node, rowSelector, cover, rows]);
  return [setNode, below];
}
