/**
 * How a chip shows its words in the room it has: the one-line note and check chips on the Keyframes cards. Pure; the
 * components measure the page and apply the results.
 */
import { unitRuns } from "./keyframes-layout.ts";

/**
 * A chip's words as a head and its last word, which usually carries the point: "Mara's coat came out" + "maroon",
 * "Make 2.3" + "8 s" (a number keeps its unit). One word, or words without spaces, is all head. `cuts` are where the
 * head may end early: after each of its words but the last ("Mara's", "Mara's coat", "Mara's coat came"), and between
 * the characters of a language written without spaces ("玛拉的外套…"), once at least a word's worth shows.
 */
export interface ChipParts {
  head: string;
  tail: string;
  cuts: number[];
}

/** Scripts written without spaces between words: any character boundary there is a place to cut. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const PUNCTUATION = /\p{P}/u;
const TRAILING_PUNCTUATION = /\p{P}+$/u;

export function chipParts(text: string): ChipParts {
  const words: string[] = [];
  let current = "";
  // Ordinary spaces part the words; a number and its unit ("6 s", "8 秒") stay one word with what follows it.
  for (const run of unitRuns(text.trim())) {
    if (run.keep) { current += run.text; continue; }
    run.text.split(" ").forEach((part, index) => {
      if (index > 0 && current) { words.push(current); current = ""; }
      current += part;
    });
  }
  if (current) words.push(current);
  const heads = words.length < 2 ? words : words.slice(0, -1);
  const cuts = new Set<number>();
  let at = 0;
  heads.forEach((word, index) => {
    // Inside a word written without spaces, between any two characters (never just after a comma or full stop).
    for (let i = 1; i < word.length; i++) {
      const before = word[i - 1]!, next = word[i]!;
      if (before !== " " && next !== " " && !PUNCTUATION.test(before) && (UNSPACED.test(before) || UNSPACED.test(next))) cuts.add(at + i);
    }
    at += word.length;
    // After each word but the head's last, without the comma or full stop it ends with.
    const end = at - (word.match(TRAILING_PUNCTUATION)?.[0].length ?? 0);
    if (index < heads.length - 1 && end > at - word.length) cuts.add(end);
    at += 1;
  });
  const head = heads.join(" ");
  // A cut keeps at least a word's worth ("The…" or "旁…" says nothing): four letters, or two written without spaces.
  const enough = (cut: number) => {
    const letters = [...head.slice(0, cut).replace(/\s/g, "")];
    return letters.length >= 4 || (letters.length >= 2 && letters.some((letter) => UNSPACED.test(letter)));
  };
  return { head, tail: words.length < 2 ? "" : words.at(-1)!, cuts: [...cuts].filter(enough).sort((a, b) => a - b) };
}

/**
 * whole: every word shows. cut: the head ends early with "…" and the last word shows whole after it ("Mara's coat…
 * maroon"). tail: the last word alone. none: no words at all, only the chip's letter (and a settled chip's check),
 * never a lone "…" or a word cut in the middle.
 */
export type ChipFit = "whole" | "cut" | "tail" | "none";

export interface ChipWidths {
  /** The whole head, the last word, and the space between them. */
  head: number;
  tail: number;
  gap: number;
  /** The head's width up to each of its cuts (chipParts), and the width of the "…" that ends a cut head. */
  cuts: number[];
  ellipsis: number;
}

/** A cut head is given a quarter pixel more than its words and "…", so they always fit in it. */
const CUT_SLACK = 0.25;

/**
 * Which words fit in `room` pixels, and for a cut how wide the head is (its words up to the cut, the "…" and a
 * quarter pixel). The head gives way first, a word at a time; the last word goes last. Text widths are measured to
 * the layout's own unit (1/64 px), so anything wider than the room by more than that would be cut by the browser.
 */
export function fitChip(room: number, widths: ChipWidths): { fit: ChipFit; head: number | null } {
  const fits = (need: number) => need <= room + 1 / 64;
  const after = widths.tail ? widths.gap + widths.tail : 0;
  if (fits(widths.head + after)) return { fit: "whole", head: null };
  const cut = [...widths.cuts].reverse().map((width) => width + widths.ellipsis + CUT_SLACK).find((head) => fits(head + after));
  if (cut !== undefined) return { fit: "cut", head: cut };
  if (widths.tail && fits(widths.tail)) return { fit: "tail", head: null };
  return { fit: "none", head: null };
}
