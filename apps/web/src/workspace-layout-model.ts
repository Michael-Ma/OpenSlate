export const DEFAULT_DIRECTOR_WIDTH = 380;
export const MIN_DIRECTOR_WIDTH = 260;
export const MAX_DIRECTOR_WIDTH = 640;
export const MIN_WORKSPACE_WIDTH = 360;
export const SEPARATOR_WIDTH = 5;

export function directorWidthLimit(containerWidth: number): number {
  return Math.max(
    MIN_DIRECTOR_WIDTH,
    Math.min(
      MAX_DIRECTOR_WIDTH,
      Number.isFinite(containerWidth) && containerWidth > 0
        ? containerWidth - MIN_WORKSPACE_WIDTH - SEPARATOR_WIDTH
        : MAX_DIRECTOR_WIDTH,
    ),
  );
}
export function clampDirectorWidth(
  value: number,
  containerWidth: number,
): number {
  return Math.round(
    Math.max(
      MIN_DIRECTOR_WIDTH,
      Math.min(
        directorWidthLimit(containerWidth),
        Number.isFinite(value) ? value : DEFAULT_DIRECTOR_WIDTH,
      ),
    ),
  );
}
export function directorWidthForKey(
  value: number,
  key: string,
  containerWidth: number,
  shift = false,
): number | null {
  const step = shift ? 40 : 16;
  if (key === "ArrowLeft")
    return clampDirectorWidth(value - step, containerWidth);
  if (key === "ArrowRight")
    return clampDirectorWidth(value + step, containerWidth);
  if (key === "Home") return MIN_DIRECTOR_WIDTH;
  if (key === "End") return directorWidthLimit(containerWidth);
  return null;
}
