import type { DirectorNote, GenerationOverview } from "@openslate/core/public";
import type { MessageValues } from "../i18n/format.ts";
import type { MessageId } from "../i18n/messages.ts";

/** A message to show: an id from the catalog plus its values. Models never return sentences. */
export interface Msg {
  id: MessageId;
  values?: MessageValues;
}

export const msg = (id: MessageId, values?: MessageValues): Msg => (values ? { id, values } : { id });

/** The parts of GET /api/projects/:projectId that the next UI reads. */
export interface ProjectSnapshot {
  project: {
    id: string;
    name: string;
    revisionId: string;
    headVersion: number;
    brief: string;
    story: string;
    scenes: { id: string; revisionId: string; purpose: string; title?: string }[];
    shots: {
      id: string;
      sceneId: string;
      purpose: string;
      framing: string;
      motion: string;
      desiredFrames: number;
      imagePrompt: string;
      videoPrompt: string;
      narration?: { mode: "undecided" | "none" | "generated" | "uploaded"; text: string; voice: "stock" | "personal" };
    }[];
  };
  conversation?: ConversationEntry[];
  questions?: PendingQuestion[];
  /** Director notes (phase P4); absent on servers without contract 5.0.0. */
  notes?: DirectorNote[];
  control?: { paused: boolean; authorityId?: string };
  cursor: number;
}

export interface ConversationEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  state?: string;
  requestId?: string;
  /** Scene and shot ids the message pointed at, when the server reports them. */
  scopeIds?: string[];
  at?: string;
  /** Which Director runtime wrote an assistant entry, when the server reports it (DC-15). */
  runtime?: "scripted" | "live";
}

export interface PendingQuestion {
  id: string;
  requestId: string;
  state: "pending" | "answered";
  canAnswer?: boolean;
  questions: { id: string; header: string; question: string; options: { label: string; description: string }[] }[];
}

export interface DirectorStatus {
  mode: "offline" | "fake" | "native";
  status: "idle" | "running" | "waiting_user" | "error" | "not_connected";
  activeRequestId?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
}

/** The four tabs, plus Settings (gear in the top bar) and Start (the film list). */
export type ViewName = "plan" | "keyframes" | "assets" | "film" | "settings" | "start";

/** What the composer points at. */
export interface Target {
  kind: "scene" | "shot";
  id: string;
}

export interface FilmData {
  snapshot: ProjectSnapshot;
  overview: GenerationOverview;
  director: DirectorStatus | null;
}
