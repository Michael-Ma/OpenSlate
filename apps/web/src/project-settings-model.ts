import type { ProviderKind, ProviderView } from "./provider-model";
import type { PendingCommand, PendingCommandSnapshot } from "./pending-command";
export const MODEL_KINDS: readonly ProviderKind[] = ["image", "video", "speech", "transcription"];
export type ModelSelection = Record<ProviderKind, string | null>;
export type ModelScope = { kind: "unfinished" } | { kind: "shots"; shotIds: string[] };
export interface ModelSettingsStatus {
  version: 1; projectId: string; headVersion: number; revisionId: string; capabilityLockId: string;
  selectionDigest: string; catalogDigest: string; selected: ModelSelection; options: ProviderView[];
}
interface ImpactNode { nodeId: string; alias: string; kind: string; shotId: string | null }
export interface ModelSettingsPreview {
  version: 1; id: string; previewDigest: string; projectId: string;
  base: Omit<ModelSettingsStatus, "version" | "projectId" | "selected" | "options">;
  selected: ModelSelection; scope: ModelScope;
  changes: Array<ImpactNode & { fromProfileId: string; toProfileId: string }>;
  preserved: Array<ImpactNode & { reason: "completed" | "in_flight" | "reviewed_audio" | "protected_dependency" | "outside_scope" | "unchanged" }>;
  counts: { changed: number; preserved: number }; generationApprovalRequired: boolean; allowanceRequired: boolean; notice: string;
}
export interface ModelSettingsApplied {
  receipt: { previewId: string; previewDigest: string; projectId: string; headVersion: number; revisionId: string; capabilityLockId: string;
    activePlanId: string | null; changedNodeIds: string[]; requestId: string | null };
  status: ModelSettingsStatus;
}
export interface CapturedModelPreview { preview: ModelSettingsPreview; draftIdentity: string }
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const id = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
export function modelDraftIdentity(selected: ModelSelection, scope: ModelScope): string {
  return JSON.stringify([MODEL_KINDS.map(kind => selected[kind]), scope.kind, scope.kind === "shots" ? [...scope.shotIds].sort() : []]);
}
export function modelPreviewCommand(status: ModelSettingsStatus, selected: ModelSelection, scope: ModelScope, shotIds: readonly string[], key: string): PendingCommand {
  const profileIds = MODEL_KINDS.map(kind => selected[kind]).filter((value): value is string => value !== null);
  if (!id(status.projectId) || !key || !hash(status.selectionDigest) || !hash(status.catalogDigest) || (!Number.isSafeInteger(status.headVersion) || status.headVersion < 0)
    || profileIds.length < 1 || new Set(profileIds).size !== profileIds.length
    || MODEL_KINDS.some(kind => selected[kind] !== null && !status.options.some(option => option.id === selected[kind] && option.profile?.kind === kind)))
    throw new Error("Refresh the available models and choose the model for each type of work.");
  if (scope.kind === "shots" && (!scope.shotIds.length || scope.shotIds.length > 360 || new Set(scope.shotIds).size !== scope.shotIds.length
    || scope.shotIds.some(value => !id(value) || !shotIds.includes(value)))) throw new Error("Select the current shots whose unfinished work should change.");
  return { path: `/api/projects/${encodeURIComponent(status.projectId)}/settings/models/preview`, key,
    body: { expectedHeadVersion: status.headVersion, expectedSelectionDigest: status.selectionDigest, expectedCatalogDigest: status.catalogDigest,
      profileIds, scope: structuredClone(scope) }, metadata: { draftIdentity: modelDraftIdentity(selected, scope), selected: structuredClone(selected), scope: structuredClone(scope) } };
}
export function modelPreviewCurrent(captured: CapturedModelPreview | null, status: ModelSettingsStatus | null, selected: ModelSelection, scope: ModelScope,
  checking: boolean, failed: boolean, currentHeadVersion?: number): boolean {
  if (!captured || !status || checking || failed || captured.draftIdentity !== modelDraftIdentity(selected, scope)) return false;
  const { preview } = captured, base = preview.base;
  return preview.projectId === status.projectId && id(preview.id) && hash(preview.previewDigest)
    && base.headVersion === status.headVersion && (currentHeadVersion === undefined || currentHeadVersion === status.headVersion)
    && base.revisionId === status.revisionId && base.capabilityLockId === status.capabilityLockId
    && base.selectionDigest === status.selectionDigest && base.catalogDigest === status.catalogDigest;
}
export function modelApplyCommand(captured: CapturedModelPreview, key: string): PendingCommand {
  const { preview } = captured;
  if (!id(preview.projectId) || !id(preview.id) || !hash(preview.previewDigest) || !key) throw new Error("Review a current model change before applying it.");
  return { path: `/api/projects/${encodeURIComponent(preview.projectId)}/settings/models/apply`, key,
    body: { previewId: preview.id, previewDigest: preview.previewDigest } };
}
export function preservedWorkReason(reason: ModelSettingsPreview["preserved"][number]["reason"]): string {
  return { completed: "Completed result kept", in_flight: "Job already in progress", reviewed_audio: "Audio with its own reviewed plan",
    protected_dependency: "Required by work that is being kept", outside_scope: "Outside the selected shots", unchanged: "Already uses these choices" }[reason];
}
export function modelSettingsContinuation(projectId: string, key: string, requestId: string | null, receipt: ModelSettingsApplied["receipt"]): PendingCommand {
  if (!id(projectId) || !key || receipt.projectId !== projectId || !id(receipt.previewId) || !hash(receipt.previewDigest) || requestId !== null && !id(requestId))
    throw new Error("Open the current project and saved model change before continuing.");
  return { path: `/api/projects/${encodeURIComponent(projectId)}/messages`, key,
    body: { text: "I changed this project's media model choices. Review the current settings and unfinished work, then prepare an updated plan for my review. Preserve completed results, existing jobs and protected inputs. Do not generate media or approve spending for me.",
      editing: true, scopeIds: [projectId], ...(requestId ? { continuationRequestId: requestId } : {}) },
    metadata: { previewId: receipt.previewId, previewDigest: receipt.previewDigest } };
}
export function modelAppliedCurrent(applied: ModelSettingsApplied | null, status: ModelSettingsStatus | null, checking: boolean, failed: boolean): boolean {
  if (!applied || !status || checking || failed) return false;
  return applied.receipt.projectId === status.projectId && applied.receipt.capabilityLockId === status.capabilityLockId
    && applied.status.capabilityLockId === applied.receipt.capabilityLockId
    && modelDraftIdentity(applied.status.selected, { kind: "unfinished" }) === modelDraftIdentity(status.selected, { kind: "unfinished" });
}
export function modelContinuationSent(applied: ModelSettingsApplied | null, continuation: PendingCommandSnapshot): boolean {
  if (!applied || !continuation.lastSuccess) return false;
  const command = continuation.settledCommand, metadata = command?.metadata as { previewId?: string; previewDigest?: string } | undefined;
  return command?.path === `/api/projects/${encodeURIComponent(applied.receipt.projectId)}/messages`
    && metadata?.previewId === applied.receipt.previewId && metadata?.previewDigest === applied.receipt.previewDigest;
}
/** A remounted panel may recover its review; reading a slot never sends a request. */
export function restoredModelDraft(slot: PendingCommandSnapshot): { selected: ModelSelection; scope: ModelScope; captured: CapturedModelPreview | null } | null {
  const command = slot.command ?? slot.settledCommand;
  if (!command?.path.endsWith("/preview")) return null;
  const metadata = command.metadata as { draftIdentity?: string; selected?: ModelSelection; scope?: ModelScope } | undefined;
  if (!metadata?.selected || !metadata.scope || metadata.draftIdentity !== modelDraftIdentity(metadata.selected, metadata.scope)) return null;
  return { selected: structuredClone(metadata.selected), scope: structuredClone(metadata.scope),
    captured: !slot.command && slot.lastSuccess ? { preview: slot.result as ModelSettingsPreview, draftIdentity: metadata.draftIdentity } : null };
}
export interface DirectorSelection { mode: "fake" | "native"; binaryPath?: string; model?: string; codexHome?: string }
export interface DirectorSettingsStatus {
  selection: DirectorSelection; defaults: Omit<DirectorSelection, "mode">; locked: boolean; modelCalls: number;
  selectionDigest: string; busy: boolean; changeAvailable: boolean; changeAppliesTo: "next_turn";
  readiness?: { status: string; issues?: Array<{ code: string; message?: string }> } | null;
  readinessSelectionDigest?: string; selectionMatchesCommand?: boolean;
}
export function directorChangeCommand(projectId: string, status: DirectorSettingsStatus, draft: DirectorSelection, key: string): PendingCommand {
  if (!id(projectId) || !hash(status.selectionDigest) || !key || status.busy || !status.changeAvailable)
    throw new Error("Wait for the current conversation or setup check to finish, then refresh settings.");
  let selection: DirectorSelection = { mode: "fake" };
  if (draft.mode === "native") {
    if (!draft.binaryPath?.startsWith("/") || draft.binaryPath.length > 4096 || draft.binaryPath.includes("\0")
      || !draft.model || !/^[A-Za-z0-9_.:/-]{1,120}$/.test(draft.model)
      || draft.codexHome !== undefined && (!draft.codexHome.startsWith("/") || draft.codexHome.length > 4096 || draft.codexHome.includes("\0")))
      throw new Error("Choose a model and a local Codex installation. Advanced setup contains the installation and account folders.");
    selection = { mode: "native", binaryPath: draft.binaryPath, model: draft.model, ...(draft.codexHome ? { codexHome: draft.codexHome } : {}) };
  } else if (draft.mode !== "fake") throw new Error("Choose Codex or the demo director.");
  return { path: `/api/projects/${encodeURIComponent(projectId)}/director/change`, key,
    body: { expectedSelectionDigest: status.selectionDigest, selection } };
}
export function directorSetupSummary(status: DirectorSettingsStatus): string {
  if (status.busy) return "Conversation or setup in progress · wait before changing the director";
  if (status.selection.mode === "fake") return "Demo workflow · no model account or model usage";
  if (status.readinessSelectionDigest === status.selectionDigest && status.readiness?.status === "ready") return "Setup check passed for this selection · no conversation started by the check";
  if (status.readinessSelectionDigest === status.selectionDigest && status.readiness?.status === "blocked") return "This selection needs setup attention";
  return "Saved Codex selection · account access is checked during setup";
}
