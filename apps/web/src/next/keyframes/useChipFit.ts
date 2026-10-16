import { useLayoutEffect, type RefObject } from "react";
import { fitChip } from "../model/chip-fit.ts";

/** A text's laid-out width, unclipped and fractional (scrollWidth rounds, and a clipped box hides the rest). */
function textWidth(element: Element | null, end?: number): number {
  const text = element?.firstChild;
  if (!text) return 0;
  const range = document.createRange();
  range.selectNodeContents(text);
  if (end !== undefined) range.setEnd(text, Math.min(end, text.textContent?.length ?? 0));
  return range.getBoundingClientRect().width;
}

/**
 * Show as many of a card chip's words as its room holds (model/chip-fit.ts): each chip is measured with every word in
 * place, then marked data-fit for the CSS, and a cut head is given the width of its words up to the cut and the "…".
 * The room is the chips' column beside the badge. Fits again when a column changes width (the window, the card row)
 * and when the font arrives; `key` stands for the chips' words.
 */
export function useChipFit(root: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const fitAll = () => {
      for (const words of element.querySelectorAll<HTMLElement>(".callout .anno > .anno-words")) {
        const chip = words.parentElement!;
        const column = chip.closest(".callout");
        const head = words.querySelector<HTMLElement>(".anno-head");
        const tail = words.querySelector<HTMLElement>(".anno-tail");
        if (!column || !head) continue;
        chip.removeAttribute("data-fit");
        head.style.maxWidth = "";
        const cuts = (head.dataset.cuts ?? "").split(",").filter(Boolean).map(Number);
        // The "…" in the chip's own font, measured in place for a moment.
        const mark = words.appendChild(document.createElement("span"));
        mark.textContent = "…";
        const ellipsis = textWidth(mark);
        mark.remove();
        const { fit, head: width } = fitChip(column.getBoundingClientRect().width - (chip.getBoundingClientRect().width - words.getBoundingClientRect().width), {
          head: textWidth(head),
          tail: textWidth(tail),
          gap: tail ? parseFloat(getComputedStyle(tail).marginLeft) || 0 : 0,
          cuts: cuts.map((cut) => textWidth(head, cut)),
          ellipsis,
        });
        chip.setAttribute("data-fit", fit);
        if (width !== null) head.style.maxWidth = `${width}px`;
      }
    };
    fitAll();
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) fitAll(); });
    if (typeof ResizeObserver === "undefined") return () => { alive = false; };
    const observer = new ResizeObserver(fitAll);
    observer.observe(element);
    for (const column of element.querySelectorAll(".callout")) observer.observe(column);
    return () => { alive = false; observer.disconnect(); };
    // `key` stands for the chips' words: a new chip, or new words in one, fits again.
  }, [key]);
}
