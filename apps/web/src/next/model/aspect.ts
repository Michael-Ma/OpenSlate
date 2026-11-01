/** Thumbnail boxes follow the picture's own shape, within these bounds, so nothing is cropped away. */
export const ASPECT_BOUNDS = { min: 9 / 21, max: 21 / 9 } as const;

export const boundedAspect = (aspect: number | null): number | null =>
  aspect && Number.isFinite(aspect) && aspect > 0 ? Math.min(ASPECT_BOUNDS.max, Math.max(ASPECT_BOUNDS.min, aspect)) : null;
