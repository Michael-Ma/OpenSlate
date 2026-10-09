import type { StudioReference } from "./reference-model";
import type { ProjectSnapshot } from "./model";

/** One browser recovery value prevents text and its intended target from drifting apart. */
export interface ComposerDraft {
  text: string;
  scopeIds: string[];
  references: StudioReference[];
  replyQuestionId: string | null;
  continuationRequestId: string | null;
}

export const emptyComposerDraft = (): ComposerDraft => ({
  text: "",
  scopeIds: [],
  references: [],
  replyQuestionId: null,
  continuationRequestId: null,
});

export const isShotScopeList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 400 &&
  value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 160);
export const isLocalId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 160;
export const isReferenceList = (value: unknown): value is StudioReference[] =>
  Array.isArray(value) && value.length <= 12 && value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const ref = item as Record<string, unknown>;
    return typeof ref.key === "string" && ref.key.length <= 1000 &&
      typeof ref.projectId === "string" && ref.projectId.length <= 160 &&
      typeof ref.id === "string" && ref.id.length <= 160 &&
      typeof ref.label === "string" && ref.label.length <= 180 &&
      (ref.detail === undefined ||
        (typeof ref.detail === "string" && ref.detail.length <= 300)) &&
      ["project", "scene", "shot", "image", "video", "audio"].includes(String(ref.kind)) &&
      (ref.artifact === undefined || (
        !!ref.artifact && typeof ref.artifact === "object" &&
        (ref.artifact as { artifactId?: unknown }).artifactId === ref.id &&
        (ref.artifact as { kind?: unknown }).kind === ref.kind &&
        typeof (ref.artifact as { sha256?: unknown }).sha256 === "string" &&
        /^[a-f0-9]{64}$/.test((ref.artifact as { sha256: string }).sha256)
      ));
  });
export const isComposerDraft = (value: unknown): value is ComposerDraft => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.text === "string" && draft.text.length <= 16_000 &&
    isShotScopeList(draft.scopeIds) && isReferenceList(draft.references) &&
    (draft.replyQuestionId === null || isLocalId(draft.replyQuestionId)) &&
    (draft.continuationRequestId === null || isLocalId(draft.continuationRequestId));
};

export function cacheableComposerDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    scopeIds: [...draft.scopeIds],
    references: draft.references.map((ref) => ({
      key: ref.key,
      projectId: ref.projectId,
      kind: ref.kind,
      id: ref.id,
      label: ref.label,
      ...(ref.detail ? { detail: ref.detail.slice(0, 300) } : {}),
      ...(ref.artifact ? { artifact: {
        artifactId: ref.artifact.artifactId,
        sha256: ref.artifact.sha256,
        kind: ref.artifact.kind,
      } } : {}),
    })),
    replyQuestionId: draft.replyQuestionId,
    continuationRequestId: draft.continuationRequestId,
  };
}

export function composerIsEmpty(draft: ComposerDraft) {
  return !draft.text && !draft.scopeIds.length && !draft.references.length &&
    !draft.replyQuestionId && !draft.continuationRequestId;
}

/** Cached targets remain visible when canonical project state no longer contains them. */
export function composerContextIssues(
  draft: ComposerDraft,
  projectId: string,
  snapshot: ProjectSnapshot,
) {
  const question = snapshot.questions?.find((item) =>
    item.id === draft.replyQuestionId && item.state === "pending" && item.canAnswer !== false);
  return {
    staleReply: !!draft.replyQuestionId && (!!snapshot.control?.paused || !question),
    staleContinuation: !!draft.continuationRequestId &&
      !snapshot.pendingEditContinuations?.some((group) =>
        group.requestId === draft.continuationRequestId),
    missingScopeIds: draft.scopeIds.filter((id) =>
      !snapshot.project.shots.some((shot) => shot.id === id)),
    missingReferences: draft.references.filter((ref) =>
      ref.projectId !== projectId ||
      (ref.kind === "project" && ref.id !== projectId) ||
      (ref.kind === "scene" && !snapshot.project.scenes.some((scene) => scene.id === ref.id)) ||
      (ref.kind === "shot" && !snapshot.project.shots.some((shot) => shot.id === ref.id))),
    conflictingTargets: !!draft.replyQuestionId && !!draft.continuationRequestId,
  };
}
