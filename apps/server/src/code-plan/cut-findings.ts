import { isDeepStrictEqual } from "node:util";
import { object, positive } from "./artifacts.js";
import { rowFrames } from "../media/local-timeline.js";
import type { CodePlanDiff } from "@openslate/core/public";

type Finding = CodePlanDiff["findings"][number];
type Cut = { sees: string; seconds: number; clip: string; proof?: unknown };
const proofShape = (): Finding[] => [{ code: "PROOF_SHAPE", detail: "Write proof as a list of up to three sentences, and mark a cut with proof: 1, 2 or 3." }];
const numberList = (numbers: readonly number[]) => numbers.length === 1 ? String(numbers[0]) : `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
const rounded = (seconds: number) => Number(seconds.toFixed(2));

function proofFindings(proofScene: Record<string, unknown> | undefined, cuts: readonly Cut[], malformedCuts: boolean, orphanMark: boolean): Finding[] {
  if (!proofScene) return !malformedCuts && orphanMark ? proofShape() : [];
  const proof = proofScene.proof;
  if (!Array.isArray(proof) || proof.length < 1 || proof.length > 3
    || Array.from(proof).some(text => typeof text !== "string" || !text.trim() || text.length > 240)) return proofShape();
  if (malformedCuts) return [];
  if (orphanMark) return proofShape();

  const seen = new Set<number>();
  let markedSeconds = 0, totalSeconds = 0;
  for (const cut of cuts) {
    totalSeconds += cut.seconds;
    if (!Object.hasOwn(cut, "proof")) continue;
    const mark = cut.proof;
    if (typeof mark !== "number" || !Number.isInteger(mark) || mark < 1 || mark > proof.length) return proofShape();
    seen.add(mark);
    markedSeconds += cut.seconds;
  }
  const missing = proof.map((_, index) => index + 1).filter(mark => !seen.has(mark));
  if (missing.length) return [{ code: "PROOF_UNSEEN", detail: `No cut shows ${missing.length === 1 ? "proof" : "proofs"} ${numberList(missing)}.` }];
  if (markedSeconds < totalSeconds / 3) return [{ code: "PROOF_SHORT", detail: `The cuts that show the proof total ${rounded(markedSeconds)} of ${rounded(totalSeconds)} seconds; the take needs at least a third of the film.` }];
  return [];
}

/** Bounded advice only. Declarations are descriptive data and never acquire execution authority. */
export function cutListFindings(scenes: readonly Record<string, unknown>[], shots: readonly Record<string, unknown>[], renderSeconds: readonly number[] = []): Finding[] {
  const lists = scenes.filter(scene => Object.hasOwn(scene, "cuts"));
  const proofScene = scenes.find(scene => Object.hasOwn(scene, "proof"));
  const findings: Finding[] = [], cuts: Cut[] = [], proofCuts: Cut[] = [];
  let checked = 0, malformed = false, orphanMark = false;
  for (const scene of lists) {
    if (!Array.isArray(scene.cuts)) { malformed = true; continue; }
    if (scene.cuts.length > 64 - checked) malformed = true;
    const hasProof = Object.hasOwn(scene, "proof");
    for (const raw of scene.cuts.slice(0, Math.max(0, 64 - checked))) {
      checked++;
      const cut = object(raw);
      if (!hasProof && Object.hasOwn(cut, "proof")) orphanMark = true;
      if (typeof cut.sees !== "string" || !positive(cut.seconds) || typeof cut.clip !== "string") malformed = true;
      else {
        cuts.push(cut as Cut);
        if (scene === proofScene) proofCuts.push(cut as Cut);
      }
    }
  }
  const advice = proofFindings(proofScene, proofCuts, malformed, orphanMark);
  if (!lists.length) return advice;
  if (malformed) findings.push({ code: "CUTS_SHAPE", detail: "Use at most 64 cuts: an array of objects with string sees, positive number seconds and string clip." });
  if (malformed && (proofScene || orphanMark)) return [...findings, ...advice];
  // Preserve the shot warnings on older plans with malformed, unannotated lists.
  // A pass can pause on shared pictures before it reaches any shots.
  if (shots.length) {
    // "still" names a held picture that belongs to no shot (a shared picture or an upload).
    const ids = new Set(shots.flatMap(shot => typeof shot.id === "string" ? [shot.id] : [])), used = new Set(cuts.map(cut => cut.clip).filter(clip => clip !== "still"));
    const unused = [...ids].filter(id => !used.has(id)), unknown = [...used].filter(id => !ids.has(id));
    if (unused.length) findings.push({ code: "CUTS_UNUSED_SHOT", detail: `No cut names these shots: ${unused.slice(0, 5).join(", ")}.` });
    if (unknown.length) findings.push({ code: "CUTS_UNKNOWN_CLIP", detail: `Cuts name undeclared shots: ${unknown.slice(0, 5).join(", ")}.` });
  }
  const seconds = cuts.reduce((sum, cut) => sum + cut.seconds, 0);
  if (!malformed) for (const rendered of renderSeconds) if (Math.abs(seconds - rendered) > 1)
    findings.push({ code: "CUTS_LENGTH", detail: `The cuts total ${rounded(seconds)} seconds; the rendered timeline is ${rounded(rendered)} seconds.` });
  return [...findings, ...advice];
}

export interface RenderSourceInfo { width?: number; height?: number; durationFrames?: number; shotId?: string | undefined }
export type RenderSources = ReadonlyMap<string, RenderSourceInfo>;
const renderArtifact = (row: Record<string, unknown>) => object(row.artifact ?? row);
const sourceKey = (ref: Record<string, unknown>) => `${String(ref.kind)}:${String(ref.sha256)}`;
export const renderSource = (row: Record<string, unknown>, sources: RenderSources): RenderSourceInfo | undefined => {
  return sources.get(sourceKey(renderArtifact(row)));
};

interface RepeatSource { contentKey: string; artifactId: string | undefined; zoom: unknown; range?: { start: number; duration: number } }
function repeatSource(value: unknown, sources: RenderSources): RepeatSource | undefined {
  const row = object(value), ref = renderArtifact(row);
  if (typeof ref.sha256 !== "string") return undefined;
  const source = { contentKey: sourceKey(ref), artifactId: typeof ref.artifactId === "string" ? ref.artifactId : undefined, zoom: row.zoom };
  if (ref.kind === "image") return source;
  if (ref.kind !== "video") return undefined;
  const start = row.startFrame ?? 0, duration = row.durationFrames ?? sources.get(source.contentKey)?.durationFrames;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || !positive(duration)) return undefined;
  return { ...source, range: { start, duration } };
}

function rowsRepeat(a: RepeatSource, b: RepeatSource): boolean {
  const sameArtifact = a.artifactId !== undefined && b.artifactId !== undefined
    ? a.artifactId === b.artifactId : a.contentKey === b.contentKey;
  if (!sameArtifact || !isDeepStrictEqual(a.zoom, b.zoom)) return false;
  if (!a.range || !b.range) return !a.range && !b.range;
  const overlap = Math.min(a.range.start + a.range.duration, b.range.start + b.range.duration) - Math.max(a.range.start, b.range.start);
  return overlap > Math.min(a.range.duration, b.range.duration) / 2;
}

export function repeatedRowFindings(input: Record<string, unknown>, sources: RenderSources): Finding[] {
  if (!Array.isArray(input.timeline)) return [];
  const rows = input.timeline.slice(0, 64).map(row => repeatSource(row, sources));
  // Merge matching pairs into connected groups, including transitive matches.
  const parents = rows.map((_, index) => index);
  const root = (index: number) => {
    while (parents[index] !== index) index = parents[index]!;
    return index;
  };
  for (const [index, row] of rows.entries()) {
    if (!row) continue;
    for (let other = index + 1; other < rows.length; other++) {
      const next = rows[other];
      if (next && rowsRepeat(row, next)) parents[root(other)] = root(index);
    }
  }
  const groups = new Map<number, number[]>();
  for (const [index, row] of rows.entries()) {
    if (!row) continue;
    const leader = root(index), group = groups.get(leader);
    if (group) group.push(index + 1);
    else groups.set(leader, [index + 1]);
  }
  const details = [...groups].filter(([, group]) => group.length > 1).slice(0, 3).map(([leader, group]) =>
    `Rows ${numberList(group)} ${rows[leader]!.range ? "show the same part of one clip." : "hold the same picture."}`);
  if (!details.length) return [];
  return [{ code: "ROW_REPEATED", detail: `${details.join(" ")} A repeat should change: closer, shorter or a different moment.` }];
}

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
