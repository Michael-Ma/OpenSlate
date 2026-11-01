import { object, positive } from "./artifacts.js";

/** Display-only centred cover crop. Repeated placements count as separate affected clips. */
export function codePlanFitWarning(input: Record<string, unknown>, sizes: ReadonlyMap<string, { width?: number; height?: number }>): { clips: number; keptPercent: number } | undefined {
  if (!Array.isArray(input.timeline) || !positive(input.width) || !positive(input.height)) return undefined;
  const target = input.width / input.height, kept: number[] = [];
  for (const value of input.timeline) {
    const row = object(value);
    if (row.fit !== "cover") continue;
    const ref = object(row.artifact ?? row), size = sizes.get(`${String(ref.kind)}:${String(ref.sha256)}`);
    if (!positive(size?.width) || !positive(size?.height)) continue;
    const source = size.width / size.height, percent = 100 * Math.min(source / target, target / source);
    if (percent < 90) kept.push(percent);
  }
  return kept.length ? { clips: kept.length, keptPercent: Math.round(Math.min(...kept)) } : undefined;
}
