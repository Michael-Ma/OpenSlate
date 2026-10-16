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
  /** full: "2.3 · 8 s"; short: "2.3". Widths include the segment's padding. hot: the shot the change touches. */
  shots: { seconds: number; full: number; short: number; hot?: boolean }[];
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

/** Labels may shrink the strip's scale to this share of its plain fit, never further, so lengths stay readable. */
export const STRIP_LEAST_SCALE = 0.5;

/** A shot of either row: its seconds and the width its label needs (0 while it may end with "…"). */
interface Floor { seconds: number; need: number }

/**
 * A shot's width at `scale`: its seconds at that scale, at least its own label's need, and at least a shorter shot's
 * need plus the difference in seconds. A longer shot is never drawn narrower than a shorter one, so a change of
 * length shows between Now and After however much a label widened them.
 */
function widthAt(seconds: number, need: number, scale: number, floors: readonly Floor[]): number {
  let width = Math.max(seconds * scale, need);
  for (const floor of floors) if (floor.seconds < seconds) width = Math.max(width, floor.need + (seconds - floor.seconds) * scale);
  return width;
}

/**
 * Fit the Now / After strip into `room` pixels. Shots keep the design's 15 px a second while every row fits with
 * its tail's whole text; on a narrower row the scale drops for both rows alike. Labels then claim room in order:
 * the changed (hot) shot's whole label and its counterpart's in the Now row first, taking it from the other shots;
 * then the other shots' own labels ("2.3") and whole labels, as far as the row holds them without losing a label
 * that already shows. No label shrinks the scale below half its plain fit, so lengths stay readable. A shot left too
 * narrow shows its label alone or ends with "…" (the whole label is in its tooltip). The tail takes the rest of the
 * row, up to the design's 150 px, and ends with "…" only when even a strip of slivers leaves it too little.
 */
export function fitStrip(rows: readonly StripRowInput[], room: number, gap: number, most = STRIP_PX_PER_SECOND, tailWidth = STRIP_TAIL_WIDTH): StripFit {
  // A label shows when its segment is as wide as it (to a layout unit, 1/64 px); one within half a pixel of fitting
  // is given that half pixel.
  const fits = (width: number, need: number, slack = 1 / 64) => width + slack >= need;
  const fixed = rows.map((row) => gap * Math.max(0, row.shots.length + (row.tail === null ? 0 : 1) - 1) + (row.tail ?? 0));
  const levels = rows.map((row) => row.shots.map(() => 0 as 0 | 1 | 2)); // 0 cut, 1 short, 2 full
  const needOf = (r: number, s: number) => {
    const shot = rows[r]!.shots[s]!;
    return levels[r]![s] === 2 ? shot.full : levels[r]![s] === 1 ? shot.short : 0;
  };
  const floorsOf = (): Floor[] => rows.flatMap((row, r) => row.shots.map((shot, s) => ({ seconds: Math.max(0, shot.seconds), need: needOf(r, s) })));
  // The largest scale up to `most` at which every row fits with these labels, or null when none does.
  const scaleFor = (floors: readonly Floor[]): number | null => {
    const fits = (scale: number) => rows.every((row, r) =>
      row.shots.reduce((sum, shot, s) => sum + widthAt(Math.max(0, shot.seconds), needOf(r, s), scale, floors), 0) + fixed[r]! <= room);
    if (!fits(0)) return null;
    if (fits(most)) return most;
    let low = 0, high = most;
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle; else high = middle;
    }
    return low;
  };

  // The plain fit: every shot as long as it is, every tail whole.
  let scale = most;
  for (const [r, row] of rows.entries()) {
    const seconds = row.shots.reduce((sum, shot) => sum + Math.max(0, shot.seconds), 0);
    if (seconds > 0) scale = Math.min(scale, (room - fixed[r]!) / seconds);
  }
  scale = Math.max(0, scale);
  if (scale > 0) {
    const least = scale * STRIP_LEAST_SCALE;
    // Who is asked first: the hot shots, then the same shot in the other rows, then the rest (by column, both rows
    // at once, so a shot that is the same in Now and After stays the same width in both).
    const hot = new Set(rows.flatMap((row) => row.shots.flatMap((shot, s) => (shot.hot ? [s] : []))));
    const groups = (pick: (r: number, s: number) => boolean) => {
      const columns = Math.max(0, ...rows.map((row) => row.shots.length));
      const out: [number, number][][] = [];
      for (let s = 0; s < columns; s++) {
        const cells = rows.flatMap((row, r) => (s < row.shots.length && pick(r, s) ? [[r, s] as [number, number]] : []));
        if (cells.length) out.push(cells);
      }
      return out;
    };
    const hotCells = groups((r, s) => !!rows[r]!.shots[s]!.hot);
    const counterparts = groups((r, s) => hot.has(s) && !rows[r]!.shots[s]!.hot);
    const others = groups((_, s) => !hot.has(s));
    // Raise a group's labels to `level` if the rows still fit at no less than `floor`; keep the new scale.
    const claim = (cells: [number, number][], level: 1 | 2, floor: number) => {
      const before = cells.map(([r, s]) => levels[r]![s]!);
      if (before.every((value) => value >= level)) return;
      for (const [r, s] of cells) levels[r]![s] = Math.max(levels[r]![s]!, level) as 0 | 1 | 2;
      const next = scaleFor(floorsOf());
      if (next === null || next < floor - 1e-6) cells.forEach(([r, s], index) => { levels[r]![s] = before[index]!; });
      // (A search result within a hair of the scale is the scale: the labels fitted in the room there was.)
      else if (next < scale - 1e-6) scale = next;
    };
    for (const cells of hotCells) { claim(cells, 1, least); claim(cells, 2, least); }
    for (const cells of counterparts) { claim(cells, 1, least); claim(cells, 2, least); }
    // Every label that shows now keeps showing: the other shots' labels only take room that leaves them. (A label
    // within half a pixel of fitting asks its whole width, so the scale may give up a hair for it.)
    const floors = floorsOf();
    const shown = levels.map((row) => [...row]);
    rows.forEach((row, r) => row.shots.forEach((shot, s) => {
      const width = widthAt(Math.max(0, shot.seconds), needOf(r, s), scale, floors);
      levels[r]![s] = Math.max(levels[r]![s]!, fits(width, shot.full, 0.5) ? 2 : fits(width, shot.short, 0.5) ? 1 : 0) as 0 | 1 | 2;
    }));
    const locked = scaleFor(floorsOf());
    if (locked === null) levels.forEach((row, r) => row.forEach((_, s) => { row[s] = shown[r]![s]!; }));
    else if (locked < scale - 1e-6) scale = locked;
    for (const cells of others) claim(cells, 1, least);
    for (const cells of others) claim(cells, 2, least);
  }

  const floors = floorsOf();
  return {
    scale,
    rows: rows.map((row, r) => {
      const shots = row.shots.map((shot, s) => {
        const width = widthAt(Math.max(0, shot.seconds), needOf(r, s), scale, floors);
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
