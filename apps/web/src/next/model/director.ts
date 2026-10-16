import type { AssetItem, DirectorNote, DirectorProposal, GenerationOverview, MediaSlot, ShotOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import { parseMarkdown, parseRefLink, refLink, type Block, type RefLink } from "./markdown.ts";
import { noteViews, type NoteView } from "./notes.ts";
import { isMessageId, type MessageId } from "../i18n/messages.ts";
import { msg, type ComposerImage, type ConversationEntry, type DirectorStatus, type Msg, type PendingQuestion, type ProjectSnapshot, type Target, type TurnView } from "./types.ts";

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

/** Any `[label](#openslate-ref/...)` link in a user's message. */
const REF_ANYWHERE = /\[([^\]\n]{1,180})\]\((#openslate-ref\/[^)\s]*)\)/g;

export type UserSegment = { kind: "text"; text: string } | { kind: "ref"; ref: RefLink; label: string };

export interface UserMessage {
  /** Pictures the message showed the Director (its leading picture links), in order, with their names. */
  pictures: { ref: RefLink; label: string; name: Msg }[];
  /** The words, with any other reference links as references the view can open. */
  segments: UserSegment[];
}

/**
 * A user's message as the bubble shows it: the leading picture links become picture chips; leading scene and shot
 * links that only repeat the chips above them (classic messages) and leading plain mentions are dropped when
 * there are chips; any other reference link stays where it is, as a reference.
 */
export function userMessage(text: string, hasChips: boolean, scopeIds: readonly string[] = []): UserMessage {
  const segments: UserSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(REF_ANYWHERE)) {
    const ref = parseRefLink(match[2]!);
    if (!ref) continue;
    if (match.index > last) segments.push({ kind: "text", text: text.slice(last, match.index) });
    segments.push({ kind: "ref", ref, label: match[1]!.replace(/^@/, "") });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });

  const pictures: UserMessage["pictures"] = [];
  while (segments.length) {
    const first = segments[0]!;
    if (first.kind === "text" && !first.text.trim()) { segments.shift(); continue; }
    if (first.kind !== "ref") break;
    if (first.ref.kind === "image") pictures.push({ ref: first.ref, label: first.label, name: sentPictureName(first.label) });
    else if (!(hasChips && (first.ref.kind === "project" || scopeIds.includes(first.ref.id)))) break;
    segments.shift();
  }
  const head = segments[0];
  if (head?.kind === "text") {
    const trimmed = (hasChips ? head.text.trimStart().replace(LEADING_MENTIONS, "") : head.text).trimStart();
    if (trimmed) segments[0] = { kind: "text", text: trimmed };
    else segments.shift();
  }
  const tail = segments.at(-1);
  if (tail?.kind === "text") {
    const trimmed = tail.text.trimEnd();
    if (trimmed) segments[segments.length - 1] = { kind: "text", text: trimmed };
    else segments.pop();
  }
  return { pictures, segments };
}

/**
 * A sent picture's name, from its link's words (messageText writes them): a shot label ("2.1") was that shot's
 * keyframe, "image" an imported picture; anything else (a classic reference) is shown as written.
 */
export function sentPictureName(label: string): Msg {
  if (/^\d+\.\d+$/.test(label)) return msg("director.picture.keyframe", { shot: label });
  if (label === "image") return msg("director.picture.imported");
  return msg("director.picture.name", { name: label });
}

/** What a reference in a message leads to: a scene or shot this film still has, or a picture to show. */
export interface RefView {
  open: Target | null;
  picture: { artifactId: string; sha256: string } | null;
}

export function resolveRef(ref: RefLink, overview: GenerationOverview | null): RefView {
  if (!overview || ref.projectId !== overview.projectId) return { open: null, picture: null };
  if (ref.kind === "scene" && overview.scenes.some((scene) => scene.sceneId === ref.id)) return { open: { kind: "scene", id: ref.id }, picture: null };
  if (ref.kind === "shot" && overview.shots[ref.id]) return { open: { kind: "shot", id: ref.id }, picture: null };
  if (ref.kind === "image" && ref.sha256) return { open: null, picture: { artifactId: ref.id, sha256: ref.sha256 } };
  return { open: null, picture: null };
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

/** A reply (or a message without one) whose Director turn failed: says so, with the Director's reason when known. */
export interface Attention {
  /** The reason in the interface language, when the error code is one the catalog words. */
  detail: Msg | null;
  /** The Director's own words, when the server sent them and the code is not one the catalog words. */
  text: string | null;
}

export interface ThreadEntry {
  id: string;
  who: "you" | "director";
  time: string | null;
  /** The scenes and shots a user message pointed at; empty for the whole film. */
  chips: Msg[];
  /** What each chip opens, in the same order. */
  chipTargets: Target[];
  /** User messages: one block (line breaks kept). Director messages: plain paragraphs. */
  paragraphs: string[];
  /** User messages: the pictures they showed and their words with references. Empty for the Director. */
  user: UserMessage;
  /** Director messages: the reply as safe Markdown blocks. Empty for the user. */
  blocks: Block[];
  /** A reply from the scripted Director (fixture or fake mode). */
  scripted: boolean;
  requestId: string | null;
  /** Director replies: the notes their turn wrote, in letter order. */
  notes: ThreadNote[];
  /** Set on the last entry of a request whose Director turn failed. */
  attention: Attention | null;
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
  /** Unfinished Director edits that hold shots (card B13), with Let it go. */
  held: HeldEdit[];
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

/** Replies are read again on every refresh; their Markdown is parsed once per text (a small, bounded cache). */
const parsed = new Map<string, Block[]>();
function replyBlocks(text: string): Block[] {
  const hit = parsed.get(text);
  if (hit) return hit;
  const blocks = parseMarkdown(text);
  if (parsed.size >= 300) parsed.delete(parsed.keys().next().value!);
  parsed.set(text, blocks);
  return blocks;
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
  const noWords: UserMessage = { pictures: [], segments: [] };
  const entries: ThreadEntry[] = conversation.map((entry) => {
    const time = bylineTime(entry.at, locale, now);
    const failed = entry.state === "failed" ? { detail: null, text: null } : null;
    if (entry.role === "user") {
      const scoped = [...new Set(entry.scopeIds ?? [])].flatMap((id) => {
        const label = scopeLabel(overview, id);
        const kind = overview?.scenes.some((scene) => scene.sceneId === id) ? "scene" as const : "shot" as const;
        return label ? [{ label, target: { kind, id } }] : [];
      });
      const chips = scoped.map((chip) => chip.label);
      const text = userText(entry.text, chips.length > 0);
      return { id: entry.id, who: "you", time, chips, chipTargets: scoped.map((chip) => chip.target), paragraphs: text ? [text] : [], user: userMessage(entry.text, chips.length > 0, entry.scopeIds), blocks: [], scripted: false, requestId: entry.requestId ?? null, notes: [], attention: failed };
    }
    return { id: entry.id, who: "director", time, chips: [], chipTargets: [], paragraphs: paragraphs(entry.text), user: noWords, blocks: replyBlocks(entry.text), scripted: entry.runtime === "scripted", requestId: entry.requestId ?? null, notes: notesFor(entry.id), attention: failed };
  });
  // A failed turn marks the last entry of its request (the reply, or the message when there is none).
  const failures = failedTurns(snapshot?.turns, director);
  for (const [requestId, attention] of failures) {
    let index = entries.length - 1;
    while (index >= 0 && entries[index]!.requestId !== requestId) index--;
    if (index >= 0) entries[index] = { ...entries[index]!, attention };
  }
  const status = turnStatus(snapshot?.turns);
  const latest = snapshot?.turns?.at(-1);
  // The marker says it where the reply is; the ending line would only repeat it.
  const marked = !!latest && failures.has(latest.requestId) && entries.some((entry) => entry.requestId === latest.requestId);
  const working = director?.status === "running" || overview?.director.state === "working";
  return { entries, questions: pendingQuestions(snapshot?.questions), held: heldEdits(overview, snapshot, director), working, ...status, ending: marked ? null : status.ending };
}

const FAILED_STATES = new Set(["failed", "unknown"]);

/**
 * The requests whose latest Director turn failed, with what is known about why. Only the current turn (the
 * Director status) carries an error code and the Director's own words; an older failure says only that it failed.
 */
export function failedTurns(turns: readonly TurnView[] | undefined, director: DirectorStatus | null): Map<string, Attention> {
  const latest = new Map<string, TurnView>();
  for (const turn of turns ?? []) latest.set(turn.requestId, turn);
  const out = new Map<string, Attention>();
  for (const [requestId, turn] of latest) {
    if (!FAILED_STATES.has(turn.state)) continue;
    const current = director?.turn?.requestId === requestId ? director : director?.activeRequestId === requestId && !director.turn ? director : null;
    // An unconfirmed ending is one the catalog words exactly (the server's own sentence for it is English).
    if (turn.state === "unknown") { out.set(requestId, { detail: msg("director.attention.unknown"), text: null }); continue; }
    const code = current?.turn?.errorCode ?? null;
    const coded = code && isMessageId(`error.${code}`) ? msg(`error.${code}` as MessageId) : null;
    const words = current?.message?.trim() || null;
    const fallback = turn.reason === "timeout" ? msg("director.ending.timeout")
      : turn.reason === "owner_lost" ? msg("director.ending.owner_lost")
      : msg("director.ending.failed");
    out.set(requestId, coded ? { detail: coded, text: null } : words ? { detail: null, text: words } : { detail: fallback, text: null });
  }
  return out;
}

// ---- held edits (card B13) -------------------------------------------------------------

export interface HeldEdit {
  requestId: string;
  /** The held shots, in film order. */
  shotIds: string[];
  /** Their labels ("3.1"), the film's own words. */
  labels: string[];
  /** Why it cannot be let go right now (the Director is still working on it), or null. */
  blocked: Msg | null;
}

/**
 * Unfinished Director edits that hold shots: every queued slot waiting on `edit_pending`, grouped by the request
 * that holds it. Letting one go (POST .../requests/:requestId/release-holds) ends that edit; the server refuses
 * while its turn is queued or running, so the button says to wait or Stop first.
 */
export function heldEdits(overview: GenerationOverview | null, snapshot: ProjectSnapshot | null, director: DirectorStatus | null): HeldEdit[] {
  if (!overview) return [];
  const held = new Map<string, string[]>();
  const scenes = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal);
  for (const scene of scenes)
    for (const shotId of scene.shotIds) {
      const shot = overview.shots[shotId];
      if (!shot) continue;
      for (const slot of [shot.keyframe, shot.video]) {
        const requestId = slot.state === "queued" && slot.waiting?.code === "edit_pending" ? slot.waiting.requestId : undefined;
        if (!requestId) continue;
        const list = held.get(requestId) ?? [];
        if (!list.includes(shotId)) list.push(shotId);
        held.set(requestId, list);
      }
    }
  return [...held].map(([requestId, shotIds]) => {
    const working = (director?.status === "running" && director.activeRequestId === requestId)
      || (overview.director.state === "working" && overview.director.requestId === requestId)
      || !!snapshot?.turns?.some((turn) => turn.requestId === requestId && (turn.state === "queued" || turn.state === "running"));
    return { requestId, shotIds, labels: shotIds.map((id) => overview.shots[id]!.label), blocked: working ? msg("director.held.working") : null };
  });
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
  /** The pictures the message will show the Director, with thumbnails. */
  pictures: PictureChip[];
  /**
   * Shots the message will also point at because it shows their keyframes (the Codex Director is given the current
   * keyframe of each shot a message points at), labels in film order; empty when the chips already cover them.
   */
  pointsAt: string[];
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
  composer: ComposerState,
  reachable: boolean,
  overview: GenerationOverview | null,
  film: { open: boolean; stopped: boolean } = { open: true, stopped: false },
  director: DirectorStatus | null = null,
): ComposerView {
  const chips = composer.targets.map((target) => ({ target, key: targetKey(target), label: scopeLabel(overview, target.id) ?? msg("director.target.gone") }));
  const pictures = pictureChips(composer.images ?? [], overview);
  const pointsAt = keyframeScope(composer, overview);
  const text = composer.text.trim();
  const tooLong = (overview ? messageText(composer, overview) : text).length > MESSAGE_LIMIT;
  // Pictures the Director cannot take now (its mode changed, or a keyframe was replaced) keep the draft but hold Send.
  const pictureProblem = !pictures.length ? null : pictureRefusal(director) ?? pictures.find((picture) => picture.problem)?.problem ?? null;
  const problem = tooLong ? msg("director.composer.too_long") : pictureProblem;
  const hint = !film.open ? null
    : !reachable ? msg("director.composer.hint_offline")
    : film.stopped ? msg("director.composer.hint_stopped")
    : msg("director.composer.hint");
  return { chips, pictures, pointsAt, canSend: film.open && !!text && !problem && reachable && !composer.sending, problem, hint, off: !film.open };
}

/** The labels of the shots whose keyframes the message shows and that no chip already points at (by shot or scene). */
function keyframeScope(composer: ComposerState, overview: GenerationOverview | null): string[] {
  if (!overview) return [];
  const covered = (shotId: string) => composer.targets.some((target) => target.id === shotId || (target.kind === "scene" && overview.shots[shotId]?.sceneId === target.id));
  const ids = new Set((composer.images ?? []).flatMap((image) => (image.source === "keyframe" && image.shotId && overview.shots[image.shotId] && !covered(image.shotId) ? [image.shotId] : [])));
  const order = [...overview.scenes].sort((a, b) => a.ordinal - b.ordinal).flatMap((scene) => scene.shotIds);
  return order.filter((id) => ids.has(id)).map((id) => overview.shots[id]!.label);
}

/** "3.1 and 3.2", "3.1、3.2和3.3": shot labels as one list in the interface language. */
export function labelList(labels: readonly string[], locale: Locale): string {
  try { return new Intl.ListFormat(intlLocale(locale), { type: "conjunction" }).format(labels); } catch { return labels.join(", "); }
}

/** The composer's contents (the store's `composer`). Older callers may leave out the pictures. */
export interface ComposerState {
  text: string;
  targets: readonly Target[];
  sending: boolean;
  images?: readonly ComposerImage[];
}

/**
 * The composer once its message was sent: only what was sent goes. The words go (the box is read-only while
 * sending); an @ target or a picture added while it was sending stays for the next message.
 */
export function afterSend(composer: ComposerState, sent: Pick<ComposerState, "text" | "targets" | "images">): { text: string; targets: Target[]; sending: false; images: ComposerImage[] } {
  const sentTargets = new Set(sent.targets.map(targetKey));
  const sentImages = new Set((sent.images ?? []).map(pictureKey));
  return {
    text: composer.text === sent.text ? "" : composer.text,
    targets: composer.targets.filter((target) => !sentTargets.has(targetKey(target))),
    sending: false,
    images: (composer.images ?? []).filter((image) => !sentImages.has(pictureKey(image))),
  };
}

// ---- pictures for the Director ------------------------------------------------------------

/** The most pictures one message can show (the server's limit for attached images). */
export const PICTURE_LIMIT = 4;

export const pictureKey = (image: Pick<ComposerImage, "artifactId" | "sha256">) => `${image.artifactId}:${image.sha256}`;

/**
 * Why this film's Director cannot be shown pictures right now, or null when it can: only the Codex Director with
 * FFmpeg on this computer looks at pictures (the server's imageAttachmentsAvailable).
 */
export function pictureRefusal(director: DirectorStatus | null): Msg | null {
  if (!director) return msg("director.picture.unknown");
  if (director.mode === "fake") return msg("director.picture.scripted");
  if (director.mode === "offline" || director.status === "not_connected") return msg("director.picture.not_connected");
  if (director.imageAttachmentsAvailable === false) return msg("director.picture.no_ffmpeg");
  if (director.imageAttachmentsAvailable !== true) return msg("director.picture.unavailable");
  return null;
}

/** A picture offered to the Director from Assets or the Keyframes preview, or why it cannot be shown. */
export type PictureCandidate = { image: ComposerImage } | { refused: Msg };

/**
 * An image asset as a picture for the Director: an imported picture, or a shot's current keyframe. Demo stand-ins
 * and earlier takes are refused with the reason (the Director only sees a shot's current keyframe). Null for
 * anything that is not a picture.
 */
export function pictureFromAsset(item: AssetItem, overview: GenerationOverview | null): PictureCandidate | null {
  if (item.artifact.kind !== "image") return null;
  if (item.source === "demo") return { refused: msg("director.picture.demo") };
  const base = { artifactId: item.artifact.artifactId, sha256: item.artifact.sha256 };
  // The library keeps no file name for imported pictures (its label is "<film> · upload"), so they are named by kind.
  if (item.role === "upload") return { image: { ...base, source: "upload", shotId: null, name: "" } };
  if (item.role !== "keyframe") return null;
  const shot = item.shotId ? overview?.shots[item.shotId] : undefined;
  if (!shot) return { refused: msg("director.picture.former") };
  const current = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
  if (!current || current.artifactId !== base.artifactId || current.sha256 !== base.sha256) return { refused: msg("director.picture.earlier_take") };
  return { image: { ...base, source: "keyframe", shotId: shot.shotId, name: "" } };
}

/** The Keyframes preview's picture: the shot's current keyframe. */
export function pictureFromShot(shot: ShotOverview): PictureCandidate {
  const current = shot.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
  if (!current) return { refused: msg("director.picture.no_keyframe", { shot: shot.label }) };
  return { image: { artifactId: current.artifactId, sha256: current.sha256, source: "keyframe", shotId: shot.shotId, name: "" } };
}

/** Add a picture to the message, or say why not: the Director cannot take pictures, it is already there, or four are. */
export function addPicture(images: readonly ComposerImage[], candidate: PictureCandidate, director: DirectorStatus | null): { images: ComposerImage[]; added: ComposerImage } | { refused: Msg } {
  if ("refused" in candidate) return candidate;
  const refusal = pictureRefusal(director);
  if (refusal) return { refused: refusal };
  if (images.some((image) => pictureKey(image) === pictureKey(candidate.image))) return { refused: msg("director.picture.already") };
  if (images.length >= PICTURE_LIMIT) return { refused: msg("director.picture.limit") };
  return { images: [...images, candidate.image], added: candidate.image };
}

/** "2.1 keyframe", an imported picture's name, or "Imported image" (numbered when there are several). */
export function pictureLabel(image: ComposerImage, overview: GenerationOverview | null, number = 0): Msg {
  if (image.source === "upload") return image.name ? msg("director.picture.name", { name: image.name }) : number ? msg("director.picture.imported_n", { n: number }) : msg("director.picture.imported");
  const shot = image.shotId ? overview?.shots[image.shotId] : undefined;
  return shot ? msg("director.picture.keyframe", { shot: shot.label }) : msg("director.picture.keyframe_gone");
}

export interface PictureChip {
  key: string;
  image: ComposerImage;
  label: Msg;
  /** Why this picture cannot be sent now (its shot was removed, or has a newer keyframe), or null. */
  problem: Msg | null;
}

export function pictureChips(images: readonly ComposerImage[], overview: GenerationOverview | null): PictureChip[] {
  const nameless = images.filter((image) => image.source === "upload" && !image.name);
  return images.map((image) => {
    const number = nameless.length > 1 ? nameless.indexOf(image) + 1 : 0;
    let problem: Msg | null = null;
    if (image.source === "keyframe" && overview) {
      const shot = image.shotId ? overview.shots[image.shotId] : undefined;
      const current = shot?.keyframe.state === "ready" ? shot.keyframe.artifact : undefined;
      if (!shot) problem = msg("director.picture.gone");
      else if (!current || current.artifactId !== image.artifactId || current.sha256 !== image.sha256) problem = msg("director.picture.not_current", { shot: shot.label });
    }
    return { key: pictureKey(image), image, label: pictureLabel(image, overview, number), problem };
  });
}

/** A link's label without the characters that would end it, short enough for a chip. */
const linkLabel = (text: string) => text.replace(/[[\]\n\r]+/g, " ").trim().slice(0, 120) || "picture";

/**
 * The text that is sent: one `[@name](#openslate-ref/…/image/…)` link per picture, in order, before the person's
 * words. The Director is given the pictures in the same order, and the bubble shows them again from these links.
 */
export function messageText(composer: ComposerState, overview: Pick<GenerationOverview, "projectId" | "shots">): string {
  const text = composer.text.trim();
  const images = composer.images ?? [];
  if (!images.length) return text;
  const links = images.map((image) => {
    const label = image.source === "upload" ? image.name || "image" : overview.shots[image.shotId ?? ""]?.label ?? "keyframe";
    return `[@${linkLabel(label)}](${refLink({ projectId: overview.projectId, kind: "image", id: image.artifactId, sha256: image.sha256 })})`;
  });
  return `${links.join(" ")}\n\n${text}`;
}

export interface MessageBody {
  text: string;
  scopeIds: string[];
  editing: true;
  /** Imported pictures, as the server takes them ({ artifactId, sha256 }, one to four). */
  images?: { artifactId: string; sha256: string }[];
}

/**
 * POST /messages for the composer: the targets (and the shots of any keyframes it shows, so the Codex Director is
 * given those keyframes), or the whole film; imported pictures as images. Null when there is nothing to send.
 */
export function messageBody(composer: ComposerState, overview: Pick<GenerationOverview, "projectId" | "shots">): MessageBody | null {
  if (!composer.text.trim()) return null;
  const images = composer.images ?? [];
  const keyframeShots = images.flatMap((image) => (image.source === "keyframe" && image.shotId ? [image.shotId] : []));
  const scoped = [...new Set([...composer.targets.map((target) => target.id), ...keyframeShots])];
  const uploads = images.filter((image) => image.source === "upload").map(({ artifactId, sha256 }) => ({ artifactId, sha256 }));
  return {
    text: messageText(composer, overview),
    scopeIds: scoped.length ? scoped : [overview.projectId],
    editing: true,
    ...(uploads.length ? { images: uploads } : {}),
  };
}

// ---- the unsent draft (kept per film in this browser) -----------------------------------------

export interface Draft {
  text: string;
  targets: Target[];
  images: ComposerImage[];
}

/** localStorage key of a film's unsent draft; the sample film keeps its own, apart from real films. */
export const draftKey = (projectId: string, mode: "live" | "fixture" = "live") => `openslate.next.${mode === "fixture" ? "sample-draft" : "draft"}.${projectId}`;

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160;

/** What to keep: null when the composer is empty (the saved draft is then removed). */
export function draftToSave(composer: ComposerState): Draft | null {
  const images = [...(composer.images ?? [])];
  if (!composer.text && !composer.targets.length && !images.length) return null;
  return { text: composer.text, targets: composer.targets.map((target) => ({ kind: target.kind, id: target.id })), images: images.map((image) => ({ ...image })) };
}

/** A saved draft read back, checked field by field; anything malformed reads as no draft. */
export function readDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const { text, targets, images } = draft;
  // A long draft comes back as it was (the composer then says it is too long and holds Send); only its shape is checked.
  if (typeof text !== "string") return null;
  if (!Array.isArray(targets) || targets.length > 400 || !Array.isArray(images) || images.length > PICTURE_LIMIT) return null;
  const goodTargets = targets.every((target) => !!target && typeof target === "object" && ["scene", "shot"].includes((target as Target).kind) && isId((target as Target).id));
  const goodImages = images.every((item) => {
    if (!item || typeof item !== "object") return false;
    const image = item as ComposerImage;
    return isId(image.artifactId) && typeof image.sha256 === "string" && /^[a-f0-9]{64}$/.test(image.sha256)
      && (image.source === "upload" ? image.shotId === null : image.source === "keyframe" && isId(image.shotId))
      && typeof image.name === "string" && image.name.length <= 300;
  });
  if (!goodTargets || !goodImages) return null;
  const result: Draft = {
    text,
    targets: (targets as Target[]).map((target) => ({ kind: target.kind, id: target.id })),
    images: (images as ComposerImage[]).map(({ artifactId, sha256, source, shotId, name }) => ({ artifactId, sha256, source, shotId, name })),
  };
  return draftToSave({ ...result, sending: false }) ? result : null;
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
