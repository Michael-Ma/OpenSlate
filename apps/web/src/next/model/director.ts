import type { DirectorNote, DirectorProposal, GenerationOverview, MediaSlot } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import { noteViews, type NoteView } from "./notes.ts";
import type { MessageId } from "../i18n/messages.ts";
import { msg, type ConversationEntry, type DirectorStatus, type Msg, type PendingQuestion, type ProjectSnapshot, type Target, type TurnView } from "./types.ts";

/**
 * The Director column's view models (thread, questions, composer, picker, Stop). Pure: no React,
 * no network, no clock except the `now` passed in. Models return message ids, never sentences;
 * the Director's and the user's own words pass through untouched.
 */

/** The server's limit for one message (POST /messages, text maxLength). */
export const MESSAGE_LIMIT = 16000;

// ---- Stop -------------------------------------------------------------------

// A slot queued for a person (waiting for their confirm) does not move by itself, so there is nothing to stop.
const busySlot = (slot: MediaSlot) => slot.state === "running" || (slot.state === "queued" && slot.waiting?.code !== "review");

/**
 * Whether Stop has something to stop (GR-13): a running or waiting Director turn, a running or
 * queued keyframe or clip, or a running scene confirmation. Never while the film is already stopped,
 * and never merely because shots are still unmade (the old Stop showed while idle).
 */
export function canStop(overview: GenerationOverview | null, director: DirectorStatus | null): boolean {
  if (!overview || overview.stopped) return false;
  if (director?.status === "running" || director?.status === "waiting_user") return true;
  if (overview.director.state === "working" || overview.director.state === "waiting_user") return true;
  if (Object.values(overview.shots).some((shot) => busySlot(shot.keyframe) || busySlot(shot.video))) return true;
  return overview.scenes.some((scene) => scene.confirmation?.state === "running");
}

// ---- mode line -------------------------------------------------------------------

export interface ModeLine {
  /** info: a plain muted line; attention: the person has to do something. */
  tone: "info" | "attention";
  message: Msg;
}

/**
 * What the header says about the Director runtime (DC-15). The scripted Director says its replies are
 * canned; an unconnected one says where to set it up; an error says what to do. A working real Director
 * needs no line.
 */
export function modeLine(director: DirectorStatus | null, loadError: string | undefined): ModeLine | null {
  if (!director) return loadError ? { tone: "attention", message: msg("director.unreachable") } : null;
  if (director.status === "error") return { tone: "attention", message: msg("director.error") };
  if (director.mode === "offline" || director.status === "not_connected") return { tone: "attention", message: msg("director.offline") };
  if (director.mode === "fake") return { tone: "info", message: msg("director.mode.fake") };
  return null;
}

// ---- labels -------------------------------------------------------------------

/** "Scene 2" for a scene id, "2.3" for a shot id, null for the whole film or an id the film no longer has. */
export function scopeLabel(overview: GenerationOverview | null, id: string): Msg | null {
  if (!overview) return null;
  const scene = overview.scenes.find((s) => s.sceneId === id);
  if (scene) return msg("director.target.scene", { scene: scene.ordinal });
  const shot = overview.shots[id];
  if (shot) return msg("director.target.shot", { shot: shot.label });
  return null;
}

// ---- time -------------------------------------------------------------------

const intlLocale = (locale: Locale) => (locale === "zh-CN" ? "zh-CN" : "en-US");

/** "10:42" for a time today, "Oct 13, 10:42" for an earlier day; null when the time is missing or unreadable. */
export function bylineTime(at: string | undefined, locale: Locale, now: Date): string | null {
  if (!at) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const options: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

// ---- text -------------------------------------------------------------------

/** Classic composer links: `[@Shot 2.3](#openslate-ref/...)`. Shown as plain `@Shot 2.3`. */
const REFERENCE_LINK = /\[(@[^\]\n]{1,180})\]\(#openslate-ref\/[^)\s]*\)/g;
/** Mentions at the start of a message that only repeat the chips above them. */
const LEADING_MENTIONS = /^(?:\s*@(?:Scene\s+\d+|Shot\s+\d+\.\d+|\d+\.\d+|第\s*\d+\s*场))+[\s,:;，：]*/i;

/**
 * The user's words as they should read in the bubble: classic reference links become plain mentions,
 * and leading mentions are dropped when chips already show what the message points at.
 */
export function userText(text: string, hasChips: boolean): string {
  const plain = text.replace(REFERENCE_LINK, "$1");
  return (hasChips ? plain.replace(LEADING_MENTIONS, "") : plain).trim();
}

/** Plain paragraphs, split on blank lines. Never HTML or Markdown: the view renders them as text. */
export function paragraphs(text: string): string[] {
  return text.split(/\n[ \t]*\n+/).map((part) => part.trim()).filter(Boolean);
}

// ---- thread -------------------------------------------------------------------

/** Where a note's Open pill goes: the anchored shot, or the scene when the note has no shot. */
export interface NoteOpen {
  kind: "shot" | "scene";
  id: string;
  label: Msg;
}

/** A lettered Director note under the reply that wrote it (DC-18). Choices live in the banner, not here. */
export interface ThreadNote {
  view: NoteView;
  /** open: amber; done: settled, neutral with a green line; stale: neutral, says it is out of date. */
  tone: "open" | "done" | "stale";
  opens: NoteOpen[];
}

export interface ThreadEntry {
  id: string;
  who: "you" | "director";
  time: string | null;
  /** The scenes and shots a user message pointed at; empty for the whole film. */
  chips: Msg[];
  /** User messages: one block (line breaks kept). Director messages: plain paragraphs. */
  paragraphs: string[];
  /** A reply from the scripted Director (fixture or fake mode). */
  scripted: boolean;
  requestId: string | null;
  /** Director replies: the notes their turn wrote, in letter order. */
  notes: ThreadNote[];
}

export interface QuestionItemView {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
}

export interface QuestionView {
  id: string;
  items: QuestionItemView[];
}

export interface ThreadView {
  entries: ThreadEntry[];
  questions: QuestionView[];
  /** The Director is running a turn: show Working… */
  working: boolean;
  /** What the running turn is doing, when the server says (DC-16). */
  activity: Msg | null;
  /** How the latest turn ended, when it ended without a reply (DC-16). */
  ending: Msg | null;
}

const ENDINGS = new Set(["no_reply", "failed", "timeout", "superseded", "interrupted", "owner_lost"]);
const TOOL_ACTIVITY: Record<string, MessageId> = {
  read_context: "director.activity.reading",
  record_notes: "director.activity.notes",
  propose_change: "director.activity.proposing",
  prepare_change: "director.activity.proposing",
  apply_change: "director.activity.changing",
};

/** What the latest turn says about itself: its current activity while running, or an honest ending. */
export function turnStatus(turns: readonly TurnView[] | undefined): { activity: Msg | null; ending: Msg | null } {
  const latest = turns?.at(-1);
  if (!latest) return { activity: null, ending: null };
  if (latest.state === "running" || latest.state === "queued") {
    if (latest.action === "keyframe_review") return { activity: msg("director.activity.review"), ending: null };
    const id = latest.progress ? TOOL_ACTIVITY[latest.progress.tool] : undefined;
    return { activity: id ? msg(id) : null, ending: null };
  }
  const reason = latest.reason ?? "";
  return { activity: null, ending: ENDINGS.has(reason) ? msg(`director.ending.${reason as "no_reply" | "failed" | "timeout" | "superseded" | "interrupted" | "owner_lost"}`) : null };
}

/** The chosen options as structured answers (DC-17), alongside the readable text. */
export function structuredAnswers(question: QuestionView, choices: Readonly<Record<string, string>>): { questionId: string; optionIndex: number }[] {
  return question.items.flatMap((item) => {
    const index = item.options.findIndex((option) => option.label === choices[item.id]);
    return index >= 0 ? [{ questionId: item.id, optionIndex: index }] : [];
  });
}

/** Questions the person can still answer (state pending and canAnswer not false). */
export function pendingQuestions(questions: readonly PendingQuestion[] | undefined): QuestionView[] {
  return (questions ?? [])
    .filter((question) => question.state === "pending" && question.canAnswer !== false)
    .map((question) => ({
      id: question.id,
      items: question.questions.map((item) => ({ id: item.id, header: item.header, question: item.question, options: item.options.map((option) => ({ ...option })) })),
    }));
}

// ---- notes in the thread -------------------------------------------------------------

/** "a" < "b" < … < "z" < "aa": shorter letters first, then alphabetical. */
export const byLetter = (a: { letter: string }, b: { letter: string }) => a.letter.length - b.letter.length || a.letter.localeCompare(b.letter);

/**
 * Which Director reply each note sits under, by entry id. A note goes under the last reply of its own
 * request. Replies without a request id (older servers, the fixture film) fall back: the latest such
 * reply shows the latest Director turn's notes that no reply claimed. Lists are in letter order.
 */
export function threadNotes(conversation: readonly ConversationEntry[], notes: readonly DirectorNote[]): Map<string, DirectorNote[]> {
  const out = new Map<string, DirectorNote[]>();
  if (!notes.length) return out;
  const replies = conversation.filter((entry) => entry.role === "assistant");
  const lastReply = new Map<string, string>();
  for (const reply of replies) if (reply.requestId) lastReply.set(reply.requestId, reply.id);
  const add = (entryId: string, note: DirectorNote) => out.set(entryId, [...(out.get(entryId) ?? []), note]);
  const unclaimed: DirectorNote[] = [];
  for (const note of notes) {
    const entryId = lastReply.get(note.requestId);
    if (entryId) add(entryId, note);
    else unclaimed.push(note);
  }
  const bare = replies.filter((reply) => !reply.requestId).at(-1);
  if (bare && unclaimed.length) {
    // The latest turn: the newest note's turn (ISO times compare as strings; a tie goes to the later note).
    const newest = unclaimed.reduce((latest, note) => (note.createdAt >= latest.createdAt ? note : latest));
    for (const note of unclaimed) if (note.turnId === newest.turnId) add(bare.id, note);
  }
  for (const [entryId, list] of out) out.set(entryId, [...list].sort(byLetter));
  return out;
}

/** Open pills for a note: one per anchored shot that still exists, or its scene when it names no shot. */
export function noteOpens(view: NoteView, overview: GenerationOverview): NoteOpen[] {
  const shots = view.shotIds.flatMap((id) => {
    const shot = overview.shots[id];
    return shot ? [{ kind: "shot" as const, id, label: msg("note.choice.open", { shot: shot.label }) }] : [];
  });
  if (shots.length || view.shotIds.length) return shots;
  const scene = overview.scenes.find((s) => s.sceneId === view.sceneId);
  return scene ? [{ kind: "scene", id: scene.sceneId, label: msg("note.choice.open_scene", { scene: scene.ordinal }) }] : [];
}

const noteTone = (state: NoteView["state"]): ThreadNote["tone"] => (state === "resolved" ? "done" : state === "stale" ? "stale" : "open");

export function threadView(
  snapshot: ProjectSnapshot | null,
  overview: GenerationOverview | null,
  director: DirectorStatus | null,
  locale: Locale,
  now: Date,
  proposals: readonly DirectorProposal[] = [],
): ThreadView {
  const conversation = snapshot?.conversation ?? [];
  const placed = overview ? threadNotes(conversation, snapshot?.notes ?? []) : new Map<string, DirectorNote[]>();
  const notesFor = (entryId: string): ThreadNote[] => {
    const list = placed.get(entryId);
    if (!list || !overview) return [];
    return noteViews(list, overview, proposals).map((view) => ({ view, tone: noteTone(view.state), opens: noteOpens(view, overview) }));
  };
  const entries: ThreadEntry[] = conversation.map((entry) => {
    const time = bylineTime(entry.at, locale, now);
    if (entry.role === "user") {
      const chips = [...new Set(entry.scopeIds ?? [])].map((id) => scopeLabel(overview, id)).filter((label): label is Msg => label !== null);
      const text = userText(entry.text, chips.length > 0);
      return { id: entry.id, who: "you", time, chips, paragraphs: text ? [text] : [], scripted: false, requestId: entry.requestId ?? null, notes: [] };
    }
    return { id: entry.id, who: "director", time, chips: [], paragraphs: paragraphs(entry.text), scripted: entry.runtime === "scripted", requestId: entry.requestId ?? null, notes: notesFor(entry.id) };
  });
  const working = director?.status === "running" || overview?.director.state === "working";
  return { entries, questions: pendingQuestions(snapshot?.questions), working, ...turnStatus(snapshot?.turns) };
}

// ---- answers -------------------------------------------------------------------

/**
 * One free-text answer for the whole question set (the server takes a single string today, DC-17).
 * A single item sends the chosen label; several items send "header: label" lines. Free text follows.
 */
export function composeAnswer(question: QuestionView, choices: Readonly<Record<string, string>>, freeText: string): string {
  const chosen = question.items.filter((item) => choices[item.id]);
  const lines = question.items.length === 1
    ? chosen.map((item) => choices[item.id]!)
    : chosen.map((item) => `${item.header || item.question}: ${choices[item.id]}`);
  const extra = freeText.trim();
  return [lines.join("\n"), extra].filter(Boolean).join("\n\n");
}

// ---- composer -------------------------------------------------------------------

export interface ComposerChip {
  target: Target;
  /** "Removed" when the scene or shot is gone; the chip still shows so it can be removed. */
  label: Msg;
  key: string;
}

export interface ComposerView {
  chips: ComposerChip[];
  canSend: boolean;
  /** Why sending is not possible right now, when that is not obvious (empty is obvious). */
  problem: Msg | null;
  /**
   * The line beside @: what @ does, or why a message will wait (offline: the draft is kept; stopped: the Director
   * waits for Continue, and a message sent then does not resume the film). Null with no film open.
   */
  hint: Msg | null;
  /** The composer is off: no film is open, and the Director only works inside a film. */
  off: boolean;
}

export const targetKey = (target: Target) => `${target.kind}:${target.id}`;

/**
 * `reachable` is the shell's write guard (writes reach the studio), not the event stream alone: a stream that is
 * only reconnecting while reads still work leaves sending on. A stopped film keeps sending on and changes the hint.
 */
export function composerView(
  composer: { text: string; targets: readonly Target[]; sending: boolean },
  reachable: boolean,
  overview: GenerationOverview | null,
  film: { open: boolean; stopped: boolean } = { open: true, stopped: false },
): ComposerView {
  const chips = composer.targets.map((target) => ({ target, key: targetKey(target), label: scopeLabel(overview, target.id) ?? msg("director.target.gone") }));
  const text = composer.text.trim();
  const tooLong = text.length > MESSAGE_LIMIT;
  const problem = tooLong ? msg("director.composer.too_long") : null;
  const hint = !film.open ? null
    : !reachable ? msg("director.composer.hint_offline")
    : film.stopped ? msg("director.composer.hint_stopped")
    : msg("director.composer.hint");
  return { chips, canSend: film.open && !!text && !tooLong && reachable && !composer.sending, problem, hint, off: !film.open };
}

// ---- @ picker -------------------------------------------------------------------

export interface PickerItem {
  key: string;
  group: "scene" | "shot";
  target: Target;
  label: Msg;
  /** The scene title, or the shot's framing and prompt. The film's own words. */
  detail: string;
  /** Extra words the query may match, e.g. "2.2", "scene 2". */
  keywords: string[];
}

/** Scenes in order, then shots in scene order, from the overview's own labels. */
export function pickerItems(overview: GenerationOverview | null): PickerItem[] {
  if (!overview) return [];
  const scenes = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal);
  const sceneItems: PickerItem[] = scenes.map((scene) => ({
    key: `scene:${scene.sceneId}`,
    group: "scene",
    target: { kind: "scene", id: scene.sceneId },
    label: msg("director.target.scene", { scene: scene.ordinal }),
    detail: scene.title,
    keywords: [`scene ${scene.ordinal}`, `s${scene.ordinal}`, String(scene.ordinal)],
  }));
  const shotItems: PickerItem[] = scenes.flatMap((scene) =>
    scene.shotIds.flatMap((id) => {
      const shot = overview.shots[id];
      if (!shot) return [];
      return [{
        key: `shot:${id}`,
        group: "shot" as const,
        target: { kind: "shot" as const, id },
        label: msg("director.target.shot", { shot: shot.label }),
        detail: [shot.framing, shot.imagePrompt].filter(Boolean).join(" · "),
        keywords: [shot.label, `shot ${shot.label}`],
      }];
    }));
  return [...sceneItems, ...shotItems];
}

/**
 * Items whose label, keywords or detail contain the query (case-insensitive). Scenes stay before shots,
 * so the listed order is the arrow-key order; within each group, label and keyword prefixes come first.
 */
export function filterPicker(items: readonly PickerItem[], query: string, label: (message: Msg) => string): PickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  const rank = (item: PickerItem): number => {
    const names = [label(item.label), ...item.keywords].map((name) => name.toLowerCase());
    if (names.some((name) => name.startsWith(q))) return 0;
    return names.some((name) => name.includes(q)) || item.detail.toLowerCase().includes(q) ? 1 : -1;
  };
  const ranked = items.map((item, index) => ({ item, index, rank: rank(item) })).filter((entry) => entry.rank >= 0);
  const group = (item: PickerItem) => (item.group === "scene" ? 0 : 1);
  return ranked.sort((a, b) => group(a.item) - group(b.item) || a.rank - b.rank || a.index - b.index).map((entry) => entry.item);
}

export interface Mention {
  /** Index of the "@". */
  start: number;
  /** The caret. */
  end: number;
  query: string;
}

/** The "@query" being typed just before the caret, if any. An "@" counts at the start or after a space. */
export function mentionAt(text: string, caret: number): Mention | null {
  const prefix = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(prefix);
  if (!match) return null;
  const query = match[1] ?? "";
  return { start: prefix.length - query.length - 1, end: prefix.length, query };
}

/** Remove the typed "@query" after a pick; returns the new text and where the caret goes. */
export function removeMention(text: string, mention: Mention | null): { text: string; caret: number } {
  if (!mention) return { text, caret: text.length };
  return { text: text.slice(0, mention.start) + text.slice(mention.end), caret: mention.start };
}
