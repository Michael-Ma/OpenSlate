/**
 * How the Keyframes inspector's rows view fits its room. The rows come first: when they do not fit above the
 * stacked actions, the layout tightens a step at a time instead of cutting a row or a button mid-height.
 *  - roomy: the design's layout, with Edit prompt, Edit motion & duration and Regenerate keyframe stacked.
 *  - compact: Edit prompt and Edit motion & duration side by side, and tighter spacing.
 *  - scroll: compact, and the whole inspector scrolls as one unit. A row or button only partly in view is not
 *    drawn until it is scrolled fully in, so nothing shows half-cut (partlyInView).
 * `short` gives Edit motion & duration its short label, only once the full words cannot fit side by side.
 */
export type InspectorFit = "roomy" | "compact" | "scroll";

export interface InspectorLayout {
  fit: InspectorFit;
  short: boolean;
}

/** The design's layout: where every new content or room starts before it is measured. */
export const ROOMY: InspectorLayout = { fit: "roomy", short: false };

/** What the browser measured in the layout on screen. */
export interface FitMeasure {
  /** The rows or the actions run past the inspector's room. */
  overflows: boolean;
  /** A side-by-side action's label does not fit on its one line. */
  labelCut: boolean;
}

/**
 * One step tighter while something does not fit, else the same layout (the same object, so a caller can tell).
 * A side-by-side label is shortened before anything else moves, since that may be all the room needed.
 */
export function tighten(layout: InspectorLayout, measure: FitMeasure): InspectorLayout {
  if (layout.fit !== "roomy" && measure.labelCut && !layout.short) return { ...layout, short: true };
  if (!measure.overflows || layout.fit === "scroll") return layout;
  return { ...layout, fit: layout.fit === "roomy" ? "compact" : "scroll" };
}

/** A unit's top and bottom edge (a row, the title, one action); the view is the scrolled inspector's content box. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * The units a scrolled inspector does not draw: each one that is not wholly inside the view but would fit in it.
 * A unit taller than the view is always drawn, or it could never be read.
 */
export function partlyInView(units: readonly Span[], view: Span): boolean[] {
  const room = view.bottom - view.top;
  return units.map((unit) => {
    const inside = unit.top >= view.top - 0.5 && unit.bottom <= view.bottom + 0.5;
    return !inside && unit.bottom - unit.top <= room + 0.5;
  });
}
