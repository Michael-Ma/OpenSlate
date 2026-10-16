import type { DirectorProposal, GenerationOverview } from "@openslate/core/public";
import type { RoleFilter } from "../model/assets.ts";
import type { DirectorStatus, Msg, ProjectSnapshot, ProjectSummary, Target, ViewName } from "../model/types.ts";
import type { Connection, EditDraft, StudioState } from "./state.ts";

export type Action =
  | { type: "connection"; connection: Connection }
  | { type: "projects"; projects: ProjectSummary[] }
  | { type: "project"; projectId: string }
  | { type: "snapshot"; snapshot: ProjectSnapshot }
  | { type: "overview"; overview: GenerationOverview }
  | { type: "director"; director: DirectorStatus }
  | { type: "proposals"; proposals: DirectorProposal[] }
  | { type: "loadError"; source: keyof StudioState["loadErrors"]; code: string | null }
  | { type: "view"; view: ViewName }
  | { type: "scene"; sceneId: string }
  | { type: "shot"; shotId: string }
  | { type: "focus"; kind: "shot" | "scene"; id: string; view?: ViewName }
  | { type: "assetsFilter"; role: RoleFilter | null }
  | { type: "directorOpen"; open: boolean }
  | { type: "composerText"; text: string }
  | { type: "composerTarget"; target: Target; add: boolean }
  | { type: "composerSending"; sending: boolean }
  | { type: "composerSent" }
  | { type: "edit"; edit: EditDraft | null }
  | { type: "pending"; pressId: string; pending: boolean }
  | { type: "toast"; message: Msg; tone: "info" | "error"; undoCommandId?: string; undoKey?: number }
  | { type: "toastDismiss" };

const sameTarget = (a: Target, b: Target) => a.kind === b.kind && a.id === b.id;

/** Pure. Effects (network, timers, storage) live in the store, never here. */
export function reducer(state: StudioState, action: Action): StudioState {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.connection };
    case "projects":
      return { ...state, projects: action.projects };
    case "project":
      if (action.projectId === state.projectId) return state;
      return { ...state, projectId: action.projectId, snapshot: null, overview: null, director: null, proposals: [], loadErrors: {}, sceneId: null, shotId: null, focus: null, edit: null, pending: {}, composer: { text: "", targets: [], sending: false } };
    case "snapshot":
      if (action.snapshot.project.id !== state.projectId) return state;
      // A stale read (lower cursor) never replaces a newer one.
      if (state.snapshot && action.snapshot.cursor < state.snapshot.cursor) return state;
      return { ...state, snapshot: action.snapshot, loadErrors: { ...state.loadErrors, snapshot: undefined } };
    case "overview": {
      if (action.overview.projectId !== state.projectId) return state;
      if (state.overview && action.overview.cursor < state.overview.cursor) return state;
      // Keep the selection when it still exists; otherwise let the view pick a sensible scene and shot.
      const sceneId = state.sceneId && action.overview.scenes.some((s) => s.sceneId === state.sceneId) ? state.sceneId : null;
      const shotId = state.shotId && action.overview.shots[state.shotId] ? state.shotId : null;
      const edit = state.edit && action.overview.shots[state.edit.shotId] ? state.edit : null;
      return { ...state, overview: action.overview, sceneId, shotId, edit, loadErrors: { ...state.loadErrors, overview: undefined } };
    }
    case "director":
      return { ...state, director: action.director, loadErrors: { ...state.loadErrors, director: undefined } };
    case "proposals":
      return { ...state, proposals: action.proposals };
    case "loadError":
      return { ...state, loadErrors: { ...state.loadErrors, [action.source]: action.code ?? undefined } };
    case "view": {
      // A focus set for the view being opened is that view's alone: once another view opens, it is an ordinary one.
      const mark = state.focus?.view;
      const focus = mark && mark !== action.view ? { kind: state.focus!.kind, id: state.focus!.id, nonce: state.focus!.nonce } : state.focus;
      return { ...state, view: action.view, focus };
    }
    case "scene": {
      if (action.sceneId === state.sceneId) return state;
      const first = state.overview?.scenes.find((s) => s.sceneId === action.sceneId)?.shotIds[0] ?? null;
      return { ...state, sceneId: action.sceneId, shotId: first, edit: null };
    }
    case "shot": {
      // Selecting a shot never changes what the composer points at (plan item LG-3).
      const sceneId = state.overview?.shots[action.shotId]?.sceneId ?? state.sceneId;
      return { ...state, shotId: action.shotId, sceneId, edit: state.edit?.shotId === action.shotId ? state.edit : null };
    }
    case "focus": {
      // Selected like any selection, and marked as opened from elsewhere with a new nonce. With a view, that view
      // opens with it and handles it when it mounts.
      const selected = reducer(state, action.kind === "shot" ? { type: "shot", shotId: action.id } : { type: "scene", sceneId: action.id });
      const focus = { kind: action.kind, id: action.id, nonce: (state.focus?.nonce ?? 0) + 1, ...(action.view ? { view: action.view } : {}) };
      return { ...selected, ...(action.view ? { view: action.view } : {}), focus };
    }
    case "assetsFilter":
      return { ...state, assetsFilter: action.role ? { role: action.role } : null };
    case "directorOpen":
      return { ...state, directorOpen: action.open };
    case "composerText":
      return { ...state, composer: { ...state.composer, text: action.text } };
    case "composerTarget": {
      const without = state.composer.targets.filter((t) => !sameTarget(t, action.target));
      return { ...state, composer: { ...state.composer, targets: action.add ? [...without, action.target] : without } };
    }
    case "composerSending":
      return { ...state, composer: { ...state.composer, sending: action.sending } };
    case "composerSent":
      return { ...state, composer: { text: "", targets: [], sending: false } };
    case "edit":
      return { ...state, edit: action.edit };
    case "pending": {
      const pending = { ...state.pending };
      if (action.pending) pending[action.pressId] = true;
      else delete pending[action.pressId];
      return { ...state, pending };
    }
    case "toast":
      return { ...state, toast: { id: (state.toast?.id ?? 0) + 1, message: action.message, tone: action.tone, ...(action.undoCommandId ? { undoCommandId: action.undoCommandId } : {}), ...(action.undoKey ? { undoKey: action.undoKey } : {}) } };
    case "toastDismiss":
      return { ...state, toast: null };
  }
}
