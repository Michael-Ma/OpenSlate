import type { DirectorNote, GenerationOverview, ReviewNotesFailure } from "@openslate/core/public";
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
      /** voice: "stock" follows the film's narrator, a stock voice id ("cedar") pins it, "personal" is the film's personal voice. */
      narration?: { mode: "undecided" | "none" | "generated" | "uploaded"; text: string; voice: string };
    }[];
  };
  conversation?: ConversationEntry[];
  questions?: PendingQuestion[];
  /** Director turns with honest endings and progress (DC-16); absent on older servers. */
  turns?: TurnView[];
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

export interface TurnView {
  id: string;
  requestId: string;
  state: string;
  at?: string;
  runtime?: "scripted" | "live";
  action?: "conversation" | "keyframe_review";
  /** Why a turn ended other than with a reply: no_reply, failed, timeout, superseded, interrupted, owner_lost. */
  reason?: string | null;
  effects?: { notesCreated: number; proposalsHeld: number; changesApplied: number };
  /** Safe native phase metadata; no reasoning text, arguments or diagnostics. */
  activity?: { phase: "reasoning" | "tool"; state: "started" | "completed"; at: string } | null;
  progress?: { tool: string; state: string } | null;
  /** The latest refused note batch, cleared when a corrected batch saves; no tool arguments or model prose. */
  notesSaveFailure?: ReviewNotesFailure | null;
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
  /** The current turn, when the server reports it: its request, state and (once failed) error code. */
  turn?: { requestId: string; state: string; errorCode?: string | null } | null;
  /** The Director's own words about a turn that needs attention (English, from the server), when it has any. */
  message?: string | null;
  /** True when this film's Director can be shown pictures: the Codex Director with FFmpeg on this computer. */
  imageAttachmentsAvailable?: boolean;
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

/**
 * A picture the composer shows the Director (at most four in one message). An imported picture is sent as an
 * image; a keyframe is shown by pointing the message at its shot, because the Codex Director is given the current
 * keyframe of every shot a message points at (and the server takes only imported PNGs as explicit images).
 */
export interface ComposerImage {
  artifactId: string;
  sha256: string;
  source: "upload" | "keyframe";
  /** The keyframe's shot; null for an imported picture. */
  shotId: string | null;
  /** An imported picture's name (the person's own words); empty for a keyframe, which is named by its shot. */
  name: string;
}

export interface FilmData {
  snapshot: ProjectSnapshot;
  overview: GenerationOverview;
  director: DirectorStatus | null;
}
