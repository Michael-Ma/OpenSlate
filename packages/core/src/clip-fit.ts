/**
 * How a finished clip fills the film frame in the export and in the Film preview. Pure and browser-safe.
 *
 * Video providers do not return the exact film shape: Viggle H3 is asked for `aspect_ratio: "9:16"` but conditions on
 * the 2:3 first frame (Codex has no 9:16 canvas) and snaps to its own resolution buckets, so the same 9:16 film gets
 * 768×1152, 768×1216 or 768×1344 clips. Fitting those whole ("contain") into 720×1280 adds black bars. A clip whose
 * shape is close to the film's is therefore centre-cropped to fill the frame ("cover"); a clip of a clearly different
 * shape (another orientation, square in a vertical film) stays whole with bars, so no subject is cut away.
 */
export type ClipFit = "contain" | "cover";

/** Largest ratio between a clip's aspect and the film's that still crops to fill: 2:3 → 9:16 is 1.185, 3:2 → 16:9 is 1.185. */
export const CLIP_COVER_TOLERANCE = 1.25;

/**
 * The fit for one clip of `width`×`height` in a film frame of `frameWidth`×`frameHeight`. Only films whose person chose
 * a format may crop (`chosen`); legacy films keep "contain" so their frozen export manifests stay byte-identical.
 */
export function clipFit(width: number, height: number, frameWidth: number, frameHeight: number, chosen: boolean): ClipFit {
  if (!chosen) return "contain";
  const sizes = [width, height, frameWidth, frameHeight];
  if (!sizes.every(value => Number.isFinite(value) && value > 0)) return "contain";
  const ratio = Math.abs(Math.log((width / height) / (frameWidth / frameHeight)));
  return ratio === 0 || ratio > Math.log(CLIP_COVER_TOLERANCE) ? "contain" : "cover";
}
