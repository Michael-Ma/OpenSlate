import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import type { RoleFilter } from "../model/assets.ts";
import { NO_RECOVERY, type RecoveryState } from "../model/recovery.ts";
import type { ComposerImage, DirectorStatus, Msg, ProjectSnapshot, ProjectSummary, Target, ViewName } from "../model/types.ts";

export type Connection = "connecting" | "connected" | "reconnecting" | "expired" | "failed";

/** Inline editing in the inspector or from a check. One at a time. */
export interface EditDraft {
  shotId: string;
  field: "imagePrompt" | "motion" | "desiredFrames" | "narration";
  value: string;
  /** Present while the save is in flight. */
  saving?: boolean;
  /** A subtitle/composite pre-save must retain its editor when an uncertain result is checked. */
  keepOpenAfterSave?: boolean;
  /** Exact reconciliation keeps the original internal/user feedback intent. */
  saveFeedback?: { message: Msg | null; quiet: boolean };
  /** Opening film and value baselines survive typing; the stored head is only a replay/recovery hint. */
  projectId?: string;
  expectedHeadVersion?: number;
  baselineValue?: string;
  baselineMotion?: string;
  baselineFrames?: number;
  secondsText?: string;
  revision?: number;
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
  /**
   * Set together with switching to this view (Keyframes' "Edit 2.1 in Plan"): that view was not on screen to see the
   * focus change, so it handles this one when it opens. Switching to another view drops the mark.
   */
  view?: ViewName;
}

export interface StudioState {
  connection: Connection;
  projects: ProjectSummary[];
  projectId: string | null;
  projectEpoch: number;
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
  /** The message being written: its words, what it points at, and the pictures it shows the Director (at most four). */
  composer: { text: string; targets: Target[]; sending: boolean; images: ComposerImage[] };
  edit: EditDraft | null;
  inspectorDrafts: Record<string, EditDraft>;
  /** Presses in flight, keyed by press id (e.g. "confirm:scene-2"); a control is disabled while its press is pending. */
  pending: Record<string, true>;
  toast: Toast | null;
  /** Installation recovery after a restore from backup; while it is in review the studio is read-only (model/recovery.ts). */
  recovery: RecoveryState;
}

export const initialState: StudioState = {
  connection: "connecting",
  projects: [],
  projectId: null,
  projectEpoch: 0,
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
  composer: { text: "", targets: [], sending: false, images: [] },
  edit: null,
  inspectorDrafts: {},
  pending: {},
  toast: null,
  recovery: NO_RECOVERY,
};
