/** Below this width the Director is a drawer (studio.css uses the same 899 px breakpoint). */
export const NARROW_QUERY = "(max-width: 899px)";

export const isNarrow = (): boolean => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches;
