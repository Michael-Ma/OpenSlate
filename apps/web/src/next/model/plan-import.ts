import { secondsOf } from "./plan.ts";
import { msg, type ConversationEntry, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * Bring a written plan (plan item SB-20; apps/server/src/plan-imports.ts): paste or choose a .txt/.md file up to
 * 12,000 characters, the Codex Director reads it, then the person reviews the proposed outline and confirms or
 * discards it. While one is pending, storyboard edits are refused (IMPORT_PENDING). Pure.
 */

export const IMPORT_MAX_CHARS = 12000;
export const IMPORT_NAME_MAX = 160;
export const DEFAULT_IMPORT_NAME = "plan.md";

type Project = ProjectSnapshot["project"] & { maxFrames?: number };

/** GET /api/projects/:projectId/plan-imports */
export interface PlanImportsRead {
  pending: PendingImport | null;
}

export interface PendingImport {
  id: string;
  name: string;
  text: string;
  sourceDigest: string;
  stale: boolean;
  running: boolean;
  draft: { preparedId: string; proposalDigest: string; project: Project } | null;
}

/** The document name the server will accept: trimmed, defaulting to plan.md. */
export function importName(name: string): string {
  return name.trim() || DEFAULT_IMPORT_NAME;
}

/** Why the document cannot be sent yet, or null (the server's rule: a non-empty .txt or .md up to 12,000 characters). */
export function importProblem(name: string, text: string): Msg | null {
  const finalName = importName(name);
  if (!/\.(txt|md)$/i.test(finalName) || finalName.length > IMPORT_NAME_MAX) return msg("plan.import.name_invalid");
  if (!text.trim()) return msg("plan.import.text_empty");
  if (text.length > IMPORT_MAX_CHARS || text.includes("\0")) return msg("plan.import.too_long", { max: IMPORT_MAX_CHARS });
  return null;
}

export type ImportStage = "paste" | "nocodex" | "reading" | "review" | "stale" | "waiting";

/** Which step the import sheet shows. */
export function importStage(pending: PendingImport | null, codexReady: boolean): ImportStage {
  if (!pending) return codexReady ? "paste" : "nocodex";
  if (pending.stale) return "stale";
  if (pending.draft && !pending.running) return "review";
  return pending.running ? "reading" : "waiting";
}

// ---- review -------------------------------------------------------------------------------------------

export interface Totals {
  scenes: number;
  shots: number;
  seconds: number;
}

export type RowTag = "same" | "changed" | "new";

export interface ReviewRow {
  shotId: string;
  label: string;
  purpose: string;
  tag: RowTag;
  details: Msg[];
}

export interface ReviewScene {
  sceneId: string;
  ordinal: number;
  title: string;
  isNew: boolean;
  rows: ReviewRow[];
}

export interface ImportReview {
  now: Totals;
  proposed: Totals;
  scenes: ReviewScene[];
  /** Shots of the current outline the proposal leaves out. */
  removed: { label: string; purpose: string }[];
  counts: Record<RowTag, number>;
}

const totals = (project: Project, fps: number): Totals => ({
  scenes: project.scenes.length,
  shots: project.shots.length,
  seconds: secondsOf(project.shots.reduce((sum, shot) => sum + shot.desiredFrames, 0), fps),
});

const titleOf = (scene: Project["scenes"][number]) => scene.title?.trim() || scene.purpose;
const lineOf = (shot: Project["shots"][number]) => (shot.narration && shot.narration.mode !== "none" ? shot.narration.text.trim() : "");

/** Labels ("2.3") by storyboard order. */
function labels(project: Project): Map<string, string> {
  const out = new Map<string, string>();
  project.scenes.forEach((scene, sceneIndex) => {
    project.shots.filter((shot) => shot.sceneId === scene.id).forEach((shot, shotIndex) => out.set(shot.id, `${sceneIndex + 1}.${shotIndex + 1}`));
  });
  return out;
}

function changes(before: Project["shots"][number], after: Project["shots"][number], fps: number): Msg[] {
  const details: Msg[] = [];
  const line = lineOf(after);
  if (lineOf(before) !== line) details.push(line ? msg("plan.import.detail.line", { text: line }) : msg("plan.import.detail.no_line"));
  if (before.desiredFrames !== after.desiredFrames) details.push(msg("plan.import.detail.length", { from: secondsOf(before.desiredFrames, fps), to: secondsOf(after.desiredFrames, fps) }));
  if (before.framing.trim() !== after.framing.trim()) details.push(msg("plan.import.detail.framing", { from: before.framing, to: after.framing }));
  if (before.motion.trim() !== after.motion.trim()) details.push(msg("plan.import.detail.motion", { from: before.motion, to: after.motion }));
  if (before.purpose.trim() !== after.purpose.trim()) details.push(msg("plan.import.detail.purpose", { from: before.purpose }));
  if (before.imagePrompt.trim() !== after.imagePrompt.trim()) details.push(msg("plan.import.detail.prompt"));
  return details;
}

/** Now vs proposed, with every proposed shot tagged Same / Changed / New. Media effects are not previewed (lead decision 5). */
export function importReview(current: Project, proposed: Project, fps: number): ImportReview {
  const before = new Map(current.shots.map((shot) => [shot.id, shot]));
  const sceneIds = new Set(current.scenes.map((scene) => scene.id));
  const nowLabels = labels(current);
  const nextLabels = labels(proposed);
  const counts: Record<RowTag, number> = { same: 0, changed: 0, new: 0 };
  const scenes = proposed.scenes.map((scene, index): ReviewScene => ({
    sceneId: scene.id,
    ordinal: index + 1,
    title: titleOf(scene),
    isNew: !sceneIds.has(scene.id),
    rows: proposed.shots.filter((shot) => shot.sceneId === scene.id).map((shot): ReviewRow => {
      const old = before.get(shot.id);
      const line = lineOf(shot);
      const seconds = secondsOf(shot.desiredFrames, fps);
      const details = old ? changes(old, shot, fps)
        : [line ? msg("plan.import.detail.new_line", { framing: shot.framing, seconds, text: line }) : msg("plan.import.detail.new_silent", { framing: shot.framing, seconds })];
      const tag: RowTag = !old ? "new" : details.length ? "changed" : "same";
      counts[tag]++;
      return { shotId: shot.id, label: nextLabels.get(shot.id) ?? "", purpose: shot.purpose, tag, details: tag === "same" ? [] : details };
    }),
  }));
  const kept = new Set(proposed.shots.map((shot) => shot.id));
  const removed = current.shots.filter((shot) => !kept.has(shot.id)).map((shot) => ({ label: nowLabels.get(shot.id) ?? "", purpose: shot.purpose }));
  return { now: totals(current, fps), proposed: totals(proposed, fps), scenes, removed, counts };
}

/** What the Director wrote while reading this plan: its suggestions, listed apart from the outline and not applied. */
export function importNotes(conversation: readonly ConversationEntry[] | undefined, requestId: string): string[] {
  return (conversation ?? []).filter((entry) => entry.role === "assistant" && entry.requestId === requestId && entry.text.trim()).map((entry) => entry.text.trim());
}
