import { useLayoutEffect, type RefObject } from "react";
import { widestLine, wraps } from "../../model/chip-fit.ts";

/**
 * Words that wrap take only as wide as their widest line (model/chip-fit.ts), so a chip around them ends where its
 * words do instead of running on to the edge of its column. Measured with the words free to wrap in all the room
 * there is, again whenever that room changes width or the font arrives; `key` stands for the words.
 */
export function useShrinkWrap(words: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const element = words.current;
    // The room is the column the chip sits in.
    const room = element?.closest(".anno")?.parentElement;
    if (!element || !room) return;
    const wrap = () => {
      element.style.width = "";
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      // One more pixel than the widest line: its words then wrap exactly as they did.
      if (wraps(lines)) element.style.width = `${Math.ceil(widestLine(lines)) + 1}px`;
    };
    wrap();
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) wrap(); });
    if (typeof ResizeObserver === "undefined") return () => { alive = false; element.style.width = ""; };
    // Only a new width can change how the words wrap (the room grows taller as they do).
    let width = room.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = room.getBoundingClientRect().width;
      if (Math.abs(next - width) < 0.5) return;
      width = next;
      wrap();
    });
    observer.observe(room);
    return () => { alive = false; observer.disconnect(); element.style.width = ""; };
  }, [key]);
}
