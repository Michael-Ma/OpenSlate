/**
 * Layout arithmetic for the Keyframes view that CSS cannot do alone: the Now / After strip fitted to its row, the
 * runs of text that must not break between a number and its unit, and how far a scrolling row moves to show an
 * item whole. Pure; the components measure the page and apply the results.
 */

/** The design's scale: a shot is 15 px wide per second of film. */
export const STRIP_PX_PER_SECOND = 15;
/** The design's dashed tail (the next scene, or the end of the film) is 150 px wide where the row has room. */
export const STRIP_TAIL_WIDTH = 150;

/** One row of the strip as measured on the page: each shot's seconds and the widths its two labels need. */
export interface StripRowInput {
  /** full: "2.3 · 8 s"; short: "2.3". Widths include the segment's padding. */
  shots: { seconds: number; full: number; short: number }[];
  /** The width the tail's whole text needs, or null when the row has no tail. */
  tail: number | null;
}

/** full: the whole label; short: the shot's label alone; cut: even that is too wide and ends with "…". */
export type StripLabel = "full" | "short" | "cut";

export interface StripFit {
  /** Pixels per second, shared by both rows so Now and After stay comparable. */
  scale: number;
  rows: { shots: { width: number; label: StripLabel }[]; tail: number | null }[];
}

/**
 * Fit the Now / After strip into `room` pixels. Shots keep the design's 15 px a second while every row fits with
 * its tail's whole text; on a narrower row the scale drops for both rows alike. A shot too narrow for its whole
 * label shows its shot label alone (the seconds stay in its tooltip); the tail takes the rest of the row, up to
 * the design's 150 px, and ends with "…" only when even a strip of slivers leaves it too little.
 */
export function fitStrip(rows: readonly StripRowInput[], room: number, gap: number, most = STRIP_PX_PER_SECOND, tailWidth = STRIP_TAIL_WIDTH): StripFit {
  let scale = most;
  for (const row of rows) {
    const seconds = row.shots.reduce((sum, shot) => sum + Math.max(0, shot.seconds), 0);
    if (seconds <= 0) continue;
    const parts = row.shots.length + (row.tail === null ? 0 : 1);
    const fixed = gap * Math.max(0, parts - 1) + (row.tail ?? 0);
    scale = Math.min(scale, (room - fixed) / seconds);
  }
  scale = Math.max(0, scale);
  // Half a pixel of slack: measured text widths are fractional.
  const fits = (width: number, need: number) => width + 0.5 >= need;
  return {
    scale,
    rows: rows.map((row) => {
      const shots = row.shots.map((shot) => {
        const width = Math.max(0, shot.seconds) * scale;
        return { width, label: fits(width, shot.full) ? "full" as const : fits(width, shot.short) ? "short" as const : "cut" as const };
      });
      if (row.tail === null) return { shots, tail: null };
      const used = shots.reduce((sum, shot) => sum + shot.width, 0) + gap * shots.length;
      return { shots, tail: Math.max(0, Math.min(room - used, Math.max(tailWidth, row.tail))) };
    }),
  };
}

/** Two fits are the same layout (re-measuring after a fit applies must not render again). */
export function sameStripFit(a: StripFit | null, b: StripFit | null): boolean {
  if (!a || !b) return a === b;
  const close = (x: number | null, y: number | null) => (x === null || y === null ? x === y : Math.abs(x - y) < 0.25);
  return close(a.scale, b.scale) && a.rows.length === b.rows.length && a.rows.every((row, r) => {
    const other = b.rows[r]!;
    return close(row.tail, other.tail) && row.shots.length === other.shots.length
      && row.shots.every((shot, s) => close(shot.width, other.shots[s]!.width) && shot.label === other.shots[s]!.label);
  });
}

/** A number and its unit of time: "7.4 s", "6 秒", "6秒". */
const NUMBER_UNIT = /\d+(?:[.,]\d+)?\s?(?:s|秒)(?![\p{L}\p{N}])/gu;

/**
 * The text cut into runs, with every number and its unit as one run to keep on one line ("…but the shot is 6 s."
 * never leaves "s." alone on the next line).
 */
export function unitRuns(text: string): { text: string; keep: boolean }[] {
  const runs: { text: string; keep: boolean }[] = [];
  let at = 0;
  for (const match of text.matchAll(NUMBER_UNIT)) {
    if (match.index > at) runs.push({ text: text.slice(at, match.index), keep: false });
    runs.push({ text: match[0], keep: true });
    at = match.index + match[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), keep: false });
  return runs;
}

/**
 * The scroll offset that shows an item whole inside a row that scrolls sideways, `margin` px clear of the edge it
 * came in from; the offset is unchanged when the item already shows whole. Rectangles are in page pixels.
 */
export function revealScroll(scrollLeft: number, view: { left: number; right: number }, item: { left: number; right: number }, margin = 8): number {
  if (item.left < view.left) return scrollLeft - (view.left - item.left + margin);
  if (item.right > view.right) return scrollLeft + (item.right - view.right + margin);
  return scrollLeft;
}
