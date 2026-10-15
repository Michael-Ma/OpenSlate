import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import type { RoleFilter } from "../model/assets.ts";
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
  /** An Undo that is not a storyboard command (e.g. the narrator voice): the store runs the callback it holds under this key. */
  undoKey?: number;
}

/**
 * A shot or scene opened from elsewhere (a Director note's "Open 2.2"). The nonce is new on every open, so the
 * view on screen can react to the same shot opened twice: Plan scrolls to the row, Film seeks, Assets scrolls.
 */
export interface Focus {
  kind: "shot" | "scene";
  id: string;
  nonce: number;
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
  /** The last shot or scene opened from elsewhere; it is selected too. */
  focus: Focus | null;
  /**
   * The kind of file another view asked Assets to show (Film's "2 earlier in Assets" asks for exports). Assets applies
   * it when it opens and clears it, so the tab alone opens on everything.
   */
  assetsFilter: { role: RoleFilter } | null;
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
  focus: null,
  assetsFilter: null,
  directorOpen: false,
  composer: { text: "", targets: [], sending: false },
  edit: null,
  pending: {},
  toast: null,
};
