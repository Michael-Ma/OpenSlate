import { secondsOf, written } from "./plan.ts";
import { msg, type ConversationEntry, type Msg, type ProjectSnapshot } from "./types.ts";

/**
 * Bring a written plan (plan item SB-20; apps/server/src/plan-imports.ts): paste or choose a .txt/.md file up to
 * 12,000 characters, the Codex Director reads it, then the person reviews the proposed outline and confirms or
 * discards it. While one is pending, storyboard edits are refused (IMPORT_PENDING). Pure.
 */

export const IMPORT_MAX_CHARS = 12000;
export const IMPORT_NAME_MAX = 160;
export const DEFAULT_IMPORT_NAME = "plan.md";

/** The film as the server stores it: the snapshot's fields, plus the narration script and each shot's action. */
type Project = ProjectSnapshot["project"] & { maxFrames?: number; narration?: { script?: string; source?: string } };
type ProjectShot = Project["shots"][number] & { action?: string };

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

/** The film's own words the proposal may rewrite: the brief, the story and the narration script. */
export interface ReviewText {
  field: "brief" | "story" | "script";
  now: string;
  proposed: string;
  changed: boolean;
}

export interface ImportReview {
  now: Totals;
  proposed: Totals;
  /** Brief and story always; the narration script when either side has one. */
  texts: ReviewText[];
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

const actionOf = (shot: ProjectShot) => written("action", shot.action);

/** What a proposed shot changes, with the new words in full (prompts included: they drive the paid models). */
function changes(before: ProjectShot, after: ProjectShot, fps: number): Msg[] {
  const details: Msg[] = [];
  const line = lineOf(after);
  if (lineOf(before) !== line) details.push(line ? msg("plan.import.detail.line", { text: line }) : msg("plan.import.detail.no_line"));
  if (before.desiredFrames !== after.desiredFrames) details.push(msg("plan.import.detail.length", { from: secondsOf(before.desiredFrames, fps), to: secondsOf(after.desiredFrames, fps) }));
  if (before.framing.trim() !== after.framing.trim()) details.push(msg("plan.import.detail.framing", { from: before.framing, to: after.framing }));
  if (before.motion.trim() !== after.motion.trim()) details.push(msg("plan.import.detail.motion", { from: before.motion, to: after.motion }));
  if (before.purpose.trim() !== after.purpose.trim()) details.push(msg("plan.import.detail.purpose", { from: before.purpose }));
  if (actionOf(before) !== actionOf(after)) details.push(actionOf(after) ? msg("plan.import.detail.action", { text: actionOf(after) }) : msg("plan.import.detail.no_action"));
  if (before.imagePrompt.trim() !== after.imagePrompt.trim()) details.push(promptDetail("plan.import.detail.prompt", after.imagePrompt));
  if ((before.videoPrompt ?? "").trim() !== (after.videoPrompt ?? "").trim()) details.push(promptDetail("plan.import.detail.video_prompt", after.videoPrompt));
  return details;
}

const promptDetail = (id: "plan.import.detail.prompt" | "plan.import.detail.video_prompt", prompt: string | undefined): Msg => {
  const text = written(id === "plan.import.detail.prompt" ? "imagePrompt" : "videoPrompt", prompt);
  return text ? msg(id, { text }) : msg("plan.import.detail.prompt_none");
};

/** A new shot: its framing, length and line, then what happens and both prompts. */
function newDetails(shot: ProjectShot, fps: number): Msg[] {
  const line = lineOf(shot);
  const seconds = secondsOf(shot.desiredFrames, fps);
  const details = [line ? msg("plan.import.detail.new_line", { framing: shot.framing, seconds, text: line }) : msg("plan.import.detail.new_silent", { framing: shot.framing, seconds })];
  if (actionOf(shot)) details.push(msg("plan.import.detail.action", { text: actionOf(shot) }));
  details.push(promptDetail("plan.import.detail.prompt", shot.imagePrompt), promptDetail("plan.import.detail.video_prompt", shot.videoPrompt));
  return details;
}

const scriptOf = (project: Project) => project.narration?.script?.trim() ?? "";

/** The brief, the story and the narration script, now and proposed. */
export function reviewTexts(current: Project, proposed: Project): ReviewText[] {
  const text = (field: ReviewText["field"], now: string, next: string): ReviewText => ({ field, now: now.trim(), proposed: next.trim(), changed: now.trim() !== next.trim() });
  const out = [text("brief", current.brief, proposed.brief), text("story", current.story, proposed.story)];
  if (scriptOf(current) || scriptOf(proposed)) out.push(text("script", scriptOf(current), scriptOf(proposed)));
  return out;
}

/**
 * Now vs proposed: the brief, story and narration script, then every proposed shot tagged Same / Changed / New with
 * what changes. Media effects are not previewed (lead decision 5).
 */
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
      const details = old ? changes(old, shot, fps) : newDetails(shot, fps);
      const tag: RowTag = !old ? "new" : details.length ? "changed" : "same";
      counts[tag]++;
      return { shotId: shot.id, label: nextLabels.get(shot.id) ?? "", purpose: shot.purpose, tag, details: tag === "same" ? [] : details };
    }),
  }));
  const kept = new Set(proposed.shots.map((shot) => shot.id));
  const removed = current.shots.filter((shot) => !kept.has(shot.id)).map((shot) => ({ label: nowLabels.get(shot.id) ?? "", purpose: shot.purpose }));
  return { now: totals(current, fps), proposed: totals(proposed, fps), texts: reviewTexts(current, proposed), scenes, removed, counts };
}

/** What the Director wrote while reading this plan: its suggestions, listed apart from the outline and not applied. */
export function importNotes(conversation: readonly ConversationEntry[] | undefined, requestId: string): string[] {
  return (conversation ?? []).filter((entry) => entry.role === "assistant" && entry.requestId === requestId && entry.text.trim()).map((entry) => entry.text.trim());
}
