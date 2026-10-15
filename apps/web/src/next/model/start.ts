import type { GenerationOverview, MediaState, ProjectListItem } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import { msg, type Msg, type ProjectSummary } from "./types.ts";

/**
 * The Start view's films list (SB-14, SB-22, decision D16): only ProjectListItem fields are drawn
 * (name, length, scene and shot counts, clips made, last change). No thumbnails and no demo flag:
 * the list item has neither (lead decision 2).
 */

/** The server's rename limit (project-library.ts). */
export const FILM_NAME_MAX = 160;
/** Above this many shots the clips-made meter would not fit its column; the words remain. */
export const TICKS_MAX = 12;

export type OpenView = "keyframes" | "plan";

export interface FilmRow {
  id: string;
  name: string;
  /** The film open in the studio now; its Open is the primary action. */
  current: boolean;
  meta: Msg;
  progress: Msg;
  /** One tick per shot, true when its clip is made; null when the film is too long to draw them. */
  ticks: boolean[] | null;
  openTo: OpenView;
}

export interface ArchivedRow {
  id: string;
  name: string;
  meta: Msg;
}

export interface FilmsView {
  live: FilmRow[];
  archived: ArchivedRow[];
  /** "3 films on this computer" (live films only). */
  count: Msg;
  /** Nothing in the list: show the welcome with the demo path (archived films may still exist). */
  firstRun: boolean;
}

/** Dates read like the study: "9 Oct" and "10:44" in English, "10月9日" in Chinese. */
const dateLocale = (locale: Locale) => (locale === "zh-CN" ? "zh-CN" : "en-GB");
const numberLocale = (locale: Locale) => (locale === "zh-CN" ? "zh-CN" : "en-US");

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type ChangedWhen = { kind: "today" | "yesterday"; time: string } | { kind: "date"; date: string };

/** When a film last changed, in the viewer's local calendar. Null for the server's "never" (the epoch) or a bad date. */
export function changedWhen(iso: string, now: Date, locale: Locale): ChangedWhen | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() <= 0) return null;
  const time = new Intl.DateTimeFormat(dateLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  if (sameDay(at, now)) return { kind: "today", time };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, yesterday)) return { kind: "yesterday", time };
  const options: Intl.DateTimeFormatOptions = at.getFullYear() === now.getFullYear()
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  return { kind: "date", date: new Intl.DateTimeFormat(dateLocale(locale), options).format(at) };
}

/** Film length in seconds: one decimal at most, in the interface language's digits. */
export function filmSeconds(seconds: number, locale: Locale): string {
  const rounded = Math.round(Math.max(0, seconds) * 10) / 10;
  return new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 1 }).format(rounded);
}

/** A film with shots opens where its pictures are; an empty one opens on its Plan. */
export const openViewFor = (item: Pick<ProjectListItem, "shots">): OpenView => (item.shots > 0 ? "keyframes" : "plan");

function filmMeta(item: ProjectListItem, now: Date, locale: Locale): Msg {
  const values = { scenes: item.scenes, shots: item.shots, seconds: filmSeconds(item.seconds, locale) };
  const when = changedWhen(item.updatedAt, now, locale);
  if (!when) return msg("start.film.meta", values);
  if (when.kind === "date") return msg("start.film.meta_date", { ...values, date: when.date });
  return msg(when.kind === "today" ? "start.film.meta_today" : "start.film.meta_yesterday", { ...values, time: when.time });
}

function filmProgress(item: ProjectListItem): Msg {
  if (item.shots <= 0) return msg("start.film.no_shots");
  return msg("start.film.progress", { made: Math.min(item.videosReady, item.shots), shots: item.shots });
}

const byLastChange = (a: ProjectListItem, b: ProjectListItem) => {
  const at = (item: ProjectListItem) => { const t = new Date(item.updatedAt).getTime(); return Number.isNaN(t) ? 0 : t; };
  return at(b) - at(a) || a.name.localeCompare(b.name);
};

/** The list as drawn: live films by last change, newest first; archived films under their own heading. */
export function filmsView(items: readonly ProjectListItem[], currentId: string | null, now: Date, locale: Locale): FilmsView {
  const live = items.filter((item) => !item.archived).sort(byLastChange);
  const archived = items.filter((item) => item.archived).sort(byLastChange);
  return {
    live: live.map((item) => ({
      id: item.id,
      name: item.name,
      current: item.id === currentId,
      meta: filmMeta(item, now, locale),
      progress: filmProgress(item),
      ticks: item.shots > 0 && item.shots <= TICKS_MAX ? Array.from({ length: item.shots }, (_, index) => index < item.videosReady) : null,
      openTo: openViewFor(item),
    })),
    archived: archived.map((item) => ({ id: item.id, name: item.name, meta: msg("start.archived.meta", { shots: item.shots }) })),
    count: msg("start.count", { count: live.length }),
    firstRun: live.length === 0,
  };
}

/**
 * What the top bar's film picker lists: the live films, plus the open film even when it was just
 * archived, so the picker never shows a value it has no option for.
 */
export function pickerProjects(items: readonly ProjectListItem[], currentId: string | null): ProjectSummary[] {
  return items.filter((item) => !item.archived || item.id === currentId).sort(byLastChange).map(({ id, name }) => ({ id, name }));
}

export function sameProjects(a: readonly ProjectSummary[], b: readonly ProjectSummary[]): boolean {
  return a.length === b.length && a.every((item, index) => item.id === b[index]?.id && item.name === b[index]?.name);
}

/** A rename to send, or null when there is nothing to save (empty, too long or unchanged). */
export function renameValue(input: string, current: string): string | null {
  const name = input.trim();
  if (!name || name.length > FILM_NAME_MAX || name === current) return null;
  return name;
}

const BUSY: readonly MediaState[] = ["queued", "running", "no_answer"];

/**
 * Jobs that keep a film from being archived (the server refuses with ATTEMPTS_RUNNING): queued,
 * running or unanswered keyframes, clips and voice lines. Only known for the open film.
 */
export function runningJobs(overview: GenerationOverview | null): number {
  if (!overview) return 0;
  let count = 0;
  for (const shot of Object.values(overview.shots)) {
    if (BUSY.includes(shot.keyframe.state)) count++;
    if (BUSY.includes(shot.video.state)) count++;
    if (shot.narration.state === "making" || shot.narration.state === "no_answer") count++;
  }
  return count;
}
