import { object, positive } from "./artifacts.js";
import { rowFrames } from "../media/local-timeline.js";
import type { CodePlanDiff } from "@openslate/core/public";

type Finding = CodePlanDiff["findings"][number];
/** Bounded advice only. Declarations are descriptive data and never acquire execution authority. */
export function cutListFindings(scenes: readonly Record<string, unknown>[], shots: readonly Record<string, unknown>[], renderSeconds: readonly number[] = []): Finding[] {
  const lists = scenes.filter(scene => Object.hasOwn(scene, "cuts"));
  if (!lists.length) return [];
  const findings: Finding[] = [], cuts: { sees: string; seconds: number; clip: string }[] = [];
  let checked = 0, malformed = false;
  for (const scene of lists) {
    if (!Array.isArray(scene.cuts)) { malformed = true; continue; }
    if (scene.cuts.length > 64 - checked) malformed = true;
    for (const raw of scene.cuts.slice(0, Math.max(0, 64 - checked))) {
      checked++;
      const cut = object(raw);
      if (typeof cut.sees !== "string" || !positive(cut.seconds) || typeof cut.clip !== "string") malformed = true;
      else cuts.push(cut as typeof cuts[number]);
    }
  }
  if (malformed) findings.push({ code: "CUTS_SHAPE", detail: "Use at most 64 cuts: an array of objects with string sees, positive number seconds and string clip." });
  // "still" names a held picture that belongs to no shot (a shared picture or an upload).
  const ids = new Set(shots.flatMap(shot => typeof shot.id === "string" ? [shot.id] : [])), used = new Set(cuts.map(cut => cut.clip).filter(clip => clip !== "still"));
  const unused = [...ids].filter(id => !used.has(id)), unknown = [...used].filter(id => !ids.has(id));
  if (unused.length) findings.push({ code: "CUTS_UNUSED_SHOT", detail: `No cut names these shots: ${unused.slice(0, 5).join(", ")}.` });
  if (unknown.length) findings.push({ code: "CUTS_UNKNOWN_CLIP", detail: `Cuts name undeclared shots: ${unknown.slice(0, 5).join(", ")}.` });
  const seconds = cuts.reduce((sum, cut) => sum + cut.seconds, 0);
  if (!malformed) for (const rendered of renderSeconds) if (Math.abs(seconds - rendered) > 1)
    findings.push({ code: "CUTS_LENGTH", detail: `The cuts total ${Number(seconds.toFixed(2))} seconds; the rendered timeline is ${Number(rendered.toFixed(2))} seconds.` });
  return findings;
}

export interface RenderSourceInfo { width?: number; height?: number; durationFrames?: number; shotId?: string | undefined }
export type RenderSources = ReadonlyMap<string, RenderSourceInfo>;
export const renderSource = (row: Record<string, unknown>, sources: RenderSources): RenderSourceInfo | undefined => {
  const ref = object(row.artifact ?? row); return sources.get(`${String(ref.kind)}:${String(ref.sha256)}`);
};
/** Timeline positions stay in 30 Hz ticks, including native-24fps footage. */
export function renderTimelineFrames(input: Record<string, unknown>, sources: RenderSources): number | undefined {
  if (!Array.isArray(input.timeline)) return undefined;
  let frames = 0;
  for (const value of input.timeline) {
    const row = object(value), duration = row.durationFrames ?? renderSource(row, sources)?.durationFrames;
    if (!positive(duration)) return undefined;
    frames += rowFrames({ durationFrames: duration, ...(row.speed === undefined ? {} : { speed: row.speed as 1 }), ...(row.holdFrames === undefined ? {} : { holdFrames: row.holdFrames as number }) });
  }
  return frames;
}
export function zoomSoftFindings(input: Record<string, unknown>, sources: RenderSources): Finding[] {
  if (!Array.isArray(input.timeline) || !positive(input.width) || !positive(input.height)) return [];
  return input.timeline.flatMap((value, index) => {
    const row = object(value), size = renderSource(row, sources);
    if (!positive(size?.width) || !positive(size.height)) return [];
    const scale = (row.fit === "cover" ? Math.max : Math.min)(input.width as number / size.width, input.height as number / size.height)
      * Number(object(row.zoom).scale ?? 1);
    return scale > 1.5 ? [{ code: "ZOOM_SOFT", detail: `Row ${index + 1} enlarges the picture ${Number(scale.toFixed(1))}×; it will look soft.` }] : [];
  });
}
