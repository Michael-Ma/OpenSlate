import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";

export const IMPORTED_AUTHORITY_KINDS = ["message", "prepared", "epoch", "director_turn", "grant", "candidate", "external_allowance", "attempt", "owned_transcription_proposal", "owned_transcription_review", "owned_transcription_application", "narration_speech_proposal", "narration_speech_review", "narration_speech_application", "project_model_preview"] as const;
export type ImportedAuthorityKind = typeof IMPORTED_AUTHORITY_KINDS[number];
export interface VerifiedRecoveryOrigin {
  restoreId: string; backupId: string; backupManifestSha256: string; sourceDatabaseSha256: string;
  originalDataRoot: string; backupCreatedAt: string; restoredAt: string;
}
export interface RecoveryFence {
  id: string; projectId: string; restoreId: string; version: 1; kind: ImportedAuthorityKind; recordId: string;
  originalBodySha256: string; originalBody: string | null;
}
export interface RecoveryReceipt extends VerifiedRecoveryOrigin {
  version: 1; generation: number; projectIds: string[]; fenceDigest: string;
}
export interface RecoveryReleaseInput { restoreId: string; expectedReceiptDigest: string; expectedSummaryDigest: string }
export interface RecoveryReleaseReceipt extends RecoveryReleaseInput {
  version: 1; commandId: string; principalId: string; releasedAt: string;
}
export interface InstallationRecoveryRow { generation: number; receipt: RecoveryReceipt; release: RecoveryReleaseReceipt | null }
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v);
const time = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function fields(value: unknown, expected: string[]): void {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), "RECOVERY_INVALID", "Invalid recovery record fields");
}
export const recoveryBodyHash = (body: string): string => createHash("sha256").update(body).digest("hex");
export const recoveryFenceId = (restoreId: string, projectId: string, kind: ImportedAuthorityKind, recordId: string): string => digest({ restoreId, projectId, kind, recordId });
const originFields = ["restoreId", "backupId", "backupManifestSha256", "sourceDatabaseSha256", "originalDataRoot", "backupCreatedAt", "restoredAt"];
function origin(value: VerifiedRecoveryOrigin): void {
  invariant(id(value.restoreId) && id(value.backupId) && hash(value.backupManifestSha256) && hash(value.sourceDatabaseSha256)
    && typeof value.originalDataRoot === "string" && isAbsolute(value.originalDataRoot) && value.originalDataRoot !== "/"
    && value.originalDataRoot.length <= 4096 && !value.originalDataRoot.includes("\0") && time(value.backupCreatedAt) && time(value.restoredAt), "RECOVERY_INVALID", "Invalid verified recovery origin");
}
export function assertRecoveryOrigin(value: VerifiedRecoveryOrigin): void { fields(value, originFields); origin(value); }
export function assertRecoveryReceipt(value: RecoveryReceipt): void {
  fields(value, [...originFields, "version", "generation", "projectIds", "fenceDigest"]); origin(value);
  invariant(value.version === 1 && Number.isSafeInteger(value.generation) && value.generation > 0 && hash(value.fenceDigest)
    && Array.isArray(value.projectIds) && value.projectIds.length <= 10000 && value.projectIds.every(id)
    && new Set(value.projectIds).size === value.projectIds.length && canonical(value.projectIds) === canonical([...value.projectIds].sort()),
  "RECOVERY_INVALID", "Invalid recovery receipt");
}
export function assertRecoveryFence(value: RecoveryFence): void {
  fields(value, ["id", "projectId", "restoreId", "version", "kind", "recordId", "originalBodySha256", "originalBody"]);
  invariant(value.version === 1 && id(value.restoreId) && id(value.projectId) && id(value.recordId)
    && IMPORTED_AUTHORITY_KINDS.includes(value.kind) && value.id === recoveryFenceId(value.restoreId, value.projectId, value.kind, value.recordId)
    && hash(value.originalBodySha256) && (value.kind === "director_turn" ? typeof value.originalBody === "string"
      && Buffer.byteLength(value.originalBody) <= 64 * 1024 && recoveryBodyHash(value.originalBody) === value.originalBodySha256 : value.originalBody === null),
  "RECOVERY_INVALID", "Invalid imported authority fence");
}
export function assertRecoveryReleaseInput(value: RecoveryReleaseInput): void {
  fields(value, ["restoreId", "expectedReceiptDigest", "expectedSummaryDigest"]);
  invariant(id(value.restoreId) && hash(value.expectedReceiptDigest) && hash(value.expectedSummaryDigest), "RECOVERY_INVALID", "Invalid recovery release input");
}
export function assertRecoveryRelease(value: RecoveryReleaseReceipt, receipt: RecoveryReceipt): void {
  fields(value, ["restoreId", "expectedReceiptDigest", "expectedSummaryDigest", "version", "commandId", "principalId", "releasedAt"]);
  assertRecoveryReleaseInput({ restoreId: value.restoreId, expectedReceiptDigest: value.expectedReceiptDigest, expectedSummaryDigest: value.expectedSummaryDigest });
  invariant(value.version === 1 && value.restoreId === receipt.restoreId && value.expectedReceiptDigest === digest(receipt)
    && id(value.commandId) && id(value.principalId) && time(value.releasedAt), "RECOVERY_INVALID", "Invalid human recovery release receipt");
}
