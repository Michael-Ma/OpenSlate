import type { GenerationOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import type { MessageId } from "../i18n/messages.ts";
import type { Connection, Toast } from "../store/state.ts";
import { filmMeta } from "./keyframes.ts";
import { msg, type Msg, type ProjectSummary, type ViewName } from "./types.ts";

/** Below this width the shell stacks: sticky top bar, tabs on their own row, Director as a drawer. */
export const NARROW_QUERY = "(max-width: 899px)";

export const VIEWS: readonly ViewName[] = ["plan", "keyframes", "assets", "film"];

/** Views the next studio has designed; the rest open in the classic studio for now (plan decision D13). */
export const isDesignedView = (view: ViewName): boolean => view === "keyframes" || view === "assets";

export interface ViewTab {
  view: ViewName;
  label: MessageId;
  selected: boolean;
  /** Not designed yet: the workspace links to the classic studio. */
  classic: boolean;
}

const TAB_LABELS: Record<ViewName, MessageId> = {
  plan: "shell.tab.plan",
  keyframes: "shell.tab.keyframes",
  assets: "shell.tab.assets",
  film: "shell.tab.film",
  settings: "shell.tab.settings",
  start: "shell.tab.start",
};

export function viewTabs(current: ViewName): ViewTab[] {
  return VIEWS.map((view) => ({ view, label: TAB_LABELS[view], selected: view === current, classic: !isDesignedView(view) }));
}

export const viewLabel = (view: ViewName): MessageId => TAB_LABELS[view];

/** Roving focus in the tab row: arrows wrap, Home and End jump. Returns null for keys the row ignores. */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return (index + 1) % count;
    case "ArrowLeft": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** The classic studio names its views differently. */
const CLASSIC_VIEW: Record<ViewName, string> = { plan: "plan", keyframes: "frames", assets: "assets", film: "cut", settings: "plan", start: "plan" };

/**
 * The same page in the classic studio at the matching view. Keeps the language; drops the sample-film
 * switch because the classic studio has no sample film. The session cookie carries over, so no new link is needed.
 */
export function classicHref(search: string, view: ViewName): string {
  const params = new URLSearchParams(search);
  params.delete("fixture");
  params.set("ui", "classic");
  params.set("view", CLASSIC_VIEW[view]);
  return `?${params.toString()}`;
}

export const otherLocale = (locale: Locale): Locale => (locale === "en" ? "zh-CN" : "en");

/**
 * An explicit `?lang=` in the address wins over the saved preference on reload, so a switch must update it too.
 * Returns null when the address has no language to update.
 */
export function searchWithLocale(search: string, locale: Locale): string | null {
  const params = new URLSearchParams(search);
  if (!params.has("lang")) return null;
  params.set("lang", locale);
  return `?${params.toString()}`;
}

export interface ConnectionPill {
  label: Msg;
  /** "ok" while changes reach the studio; "waiting" otherwise. */
  tone: "ok" | "waiting";
}

export function connectionPill(connection: Connection): ConnectionPill {
  switch (connection) {
    case "connected": return { label: msg("shell.saved"), tone: "ok" };
    case "connecting": return { label: msg("connect.connecting"), tone: "waiting" };
    default: return { label: msg("shell.offline"), tone: "waiting" };
  }
}

export interface FilmHeading {
  title: string;
  /** Duration and frame rate; null until the overview is read. */
  meta: Msg | null;
  counts: Msg | null;
}

/** The film's name comes from the snapshot, else the project list while the snapshot loads. */
export function filmHeading(
  name: string | undefined,
  projects: readonly ProjectSummary[],
  projectId: string | null,
  overview: GenerationOverview | null,
): FilmHeading {
  const title = name ?? projects.find((project) => project.id === projectId)?.name ?? "";
  if (!overview) return { title, meta: null, counts: null };
  const meta = filmMeta(overview);
  return {
    title,
    meta: msg("shell.meta", { seconds: meta.seconds, fps: meta.fps }),
    counts: msg("shell.counts", { scenes: meta.scenes, shots: meta.shots }),
  };
}

/** A film picker appears only when there is something to switch to. */
export const showProjectPicker = (projects: readonly ProjectSummary[]): boolean => projects.length > 1;

// ---- toast timing ------------------------------------------------------------

/** Info toasts leave on their own; errors stay until dismissed. */
export const TOAST_INFO_MS = 6000;
/** After the pointer or focus leaves a paused toast, it stays at least this long. */
export const TOAST_RESUME_MIN_MS = 2000;

export const toastLifetime = (toast: Pick<Toast, "tone">): number | null => (toast.tone === "info" ? TOAST_INFO_MS : null);

/** A pausable countdown. `since` is when the current running stretch began; null while paused. */
export interface Countdown {
  remaining: number;
  since: number | null;
}

export const startCountdown = (ms: number, now: number): Countdown => ({ remaining: ms, since: now });

export function pauseCountdown(countdown: Countdown, now: number): Countdown {
  if (countdown.since === null) return countdown;
  return { remaining: Math.max(0, countdown.remaining - (now - countdown.since)), since: null };
}

export function resumeCountdown(countdown: Countdown, now: number): Countdown {
  if (countdown.since !== null) return countdown;
  return { remaining: Math.max(countdown.remaining, TOAST_RESUME_MIN_MS), since: now };
}

// ---- drawer ------------------------------------------------------------------

/** Esc closes the Director drawer on narrow screens, unless something inside already used the key (an open @ picker). */
export function escClosesDrawer(event: { key: string; defaultPrevented: boolean }, directorOpen: boolean, narrow: boolean): boolean {
  return event.key === "Escape" && !event.defaultPrevented && directorOpen && narrow;
}

// ---- text --------------------------------------------------------------------

/** Split a message on `backticks` so command names render as code. An unpaired backtick stays literal. */
export function codeSegments(text: string): { text: string; code: boolean }[] {
  const parts = text.split("`");
  if (parts.length % 2 === 0) return text ? [{ text, code: false }] : [];
  return parts.map((part, index) => ({ text: part, code: index % 2 === 1 })).filter((part) => part.text !== "");
}
