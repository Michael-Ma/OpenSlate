import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import type { DirectorStatus, Msg, ProjectSnapshot, ProjectSummary, Target, ViewName } from "../model/types.ts";

export type Connection = "connecting" | "connected" | "reconnecting" | "expired" | "failed";

/** Inline editing in the inspector or from a check. One at a time. */
export interface EditDraft {
  shotId: string;
  field: "imagePrompt" | "motion" | "desiredFrames" | "narration";
  value: string;
  /** Present while the save is in flight. */
  saving?: boolean;
}

export interface Toast {
  id: number;
  message: Msg;
  tone: "info" | "error";
  /** The storyboard command to undo, when the action can be undone. */
  undoCommandId?: string;
}

export interface StudioState {
  connection: Connection;
  projects: ProjectSummary[];
  projectId: string | null;
  snapshot: ProjectSnapshot | null;
  overview: GenerationOverview | null;
  director: DirectorStatus | null;
  /** Held and settled Director proposals (phase P4); empty on servers without them. */
  proposals: DirectorProposal[];
  /** Load failures by source, so one failed read does not blank the whole studio. */
  loadErrors: Partial<Record<"snapshot" | "overview" | "director" | "projects", string | undefined>>;
  view: ViewName;
  sceneId: string | null;
  shotId: string | null;
  /** Narrow layouts show the Director as a drawer. */
  directorOpen: boolean;
  composer: { text: string; targets: Target[]; sending: boolean };
  edit: EditDraft | null;
  /** Presses in flight, keyed by press id (e.g. "confirm:scene-2"); a control is disabled while its press is pending. */
  pending: Record<string, true>;
  toast: Toast | null;
}

export const initialState: StudioState = {
  connection: "connecting",
  projects: [],
  projectId: null,
  snapshot: null,
  overview: null,
  director: null,
  proposals: [],
  loadErrors: {},
  view: "keyframes",
  sceneId: null,
  shotId: null,
  directorOpen: false,
  composer: { text: "", targets: [], sending: false },
  edit: null,
  pending: {},
  toast: null,
};
