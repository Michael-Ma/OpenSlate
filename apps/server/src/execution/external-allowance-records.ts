import { digest, invariant, moneyMicros } from "@openslate/core";
import type { Attempt } from "./engine.js";

export interface AllowanceSelection { candidateId: string; nodeId: string; specDigest: string }
export interface AllowanceIssueInput {
  profileDigest: string; profileDefinitionDigest: string; selections: AllowanceSelection[]; maxAttempts: number; maxEstimatedMicros: string; expiresAt: string;
}
export const MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export interface ExternalAllowance extends AllowanceIssueInput {
  id: string; projectId: string; version: 1; requestId: string; principalId: string; contextDigest: string;
  createdAt: string; currency: "USD";
}
export interface AllowanceRevokeInput { allowanceId: string }
export interface ExternalAllowanceRevocation {
  id: string; projectId: string; version: 1; allowanceId: string; requestId: string; principalId: string; contextDigest: string; createdAt: string;
}
export interface ExternalAllowanceConsumption {
  id: string; projectId: string; version: 1; attemptId: string; allowanceId: string; candidateId: string;
  nodeId: string; specDigest: string; profileDigest: string; profileDefinitionDigest: string; requestDigest: string; estimatedMicros: string; recordedAt: string;
}
export interface AllowanceHumanRequest {
  id: string; projectId: string; principalId: string; contextDigest: string | null; scopeIds: string[]; state: string;
}
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const time = (value: unknown): value is string => typeof value === "string" && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function fields(value: unknown, required: string[]): void {
  invariant(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key)),
  "ALLOWANCE_INVALID", "Use the exact bounded allowance fields");
}
export function assertAllowanceIssueInput(value: AllowanceIssueInput): void {
  fields(value, ["profileDigest", "profileDefinitionDigest", "selections", "maxAttempts", "maxEstimatedMicros", "expiresAt"]);
  invariant(hash(value.profileDigest) && hash(value.profileDefinitionDigest) && Array.isArray(value.selections) && value.selections.length > 0 && value.selections.length <= 800
    && Number.isSafeInteger(value.maxAttempts) && value.maxAttempts > 0 && value.maxAttempts <= 10000
    && typeof value.maxEstimatedMicros === "string" && value.maxEstimatedMicros.length <= 19 && time(value.expiresAt),
  "ALLOWANCE_INVALID", "Allowance requires an exact profile, bounded candidates, start and estimate caps, and an ISO expiry");
  moneyMicros(value.maxEstimatedMicros);
  for (const selected of value.selections) {
    fields(selected, ["candidateId", "nodeId", "specDigest"]);
    invariant(id(selected.candidateId) && id(selected.nodeId) && hash(selected.specDigest), "ALLOWANCE_INVALID", "Invalid allowance selection");
  }
  invariant(new Set(value.selections.map(value => value.candidateId)).size === value.selections.length
    && new Set(value.selections.map(value => value.nodeId)).size === value.selections.length, "ALLOWANCE_INVALID", "Allowance selections must be unique");
}
export function assertAllowanceRevokeInput(value: AllowanceRevokeInput): void {
  fields(value, ["allowanceId"]); invariant(id(value.allowanceId), "ALLOWANCE_INVALID", "Invalid allowance identity");
}
/** The authenticated host binds this digest when minting a dedicated human request. */
export function allowanceIssueContextDigest(projectId: string, input: AllowanceIssueInput): string {
  assertAllowanceIssueInput(input); return digest({ purpose: "external_allowance.issue", version: 1, projectId, input });
}
export function allowanceRevokeContextDigest(projectId: string, input: AllowanceRevokeInput): string {
  assertAllowanceRevokeInput(input); return digest({ purpose: "external_allowance.revoke", version: 1, projectId, input });
}
export function allowanceIssueInput(value: ExternalAllowance): AllowanceIssueInput {
  return { profileDigest: value.profileDigest, profileDefinitionDigest: value.profileDefinitionDigest, selections: value.selections, maxAttempts: value.maxAttempts,
    maxEstimatedMicros: value.maxEstimatedMicros, expiresAt: value.expiresAt };
}
function authority(value: { projectId: string; requestId: string; principalId: string; contextDigest: string }, request: AllowanceHumanRequest): void {
  invariant(request && request.id === value.requestId && request.projectId === value.projectId && request.principalId === value.principalId
    && request.contextDigest === value.contextDigest, "ALLOWANCE_AUTHORITY_INVALID", "Allowance requires its exact human request context");
}
export function assertExternalAllowance(value: ExternalAllowance, request: AllowanceHumanRequest): void {
  fields(value, ["id", "projectId", "version", "requestId", "principalId", "contextDigest", "createdAt", "currency",
    "profileDigest", "profileDefinitionDigest", "selections", "maxAttempts", "maxEstimatedMicros", "expiresAt"]);
  assertAllowanceIssueInput(allowanceIssueInput(value)); authority(value, request);
  invariant(value.version === 1 && id(value.id) && value.id === value.requestId && value.currency === "USD" && time(value.createdAt)
    && Date.parse(value.createdAt) < Date.parse(value.expiresAt) && Date.parse(value.expiresAt) - Date.parse(value.createdAt) <= MAX_EXTERNAL_ALLOWANCE_LIFETIME_MS
    && value.contextDigest === allowanceIssueContextDigest(value.projectId, allowanceIssueInput(value)),
  "ALLOWANCE_INVALID", "Allowance must retain its exact issue authority and bounded lifetime");
}
export function assertExternalAllowanceRevocation(value: ExternalAllowanceRevocation, allowance: ExternalAllowance, request: AllowanceHumanRequest): void {
  fields(value, ["id", "projectId", "version", "allowanceId", "requestId", "principalId", "contextDigest", "createdAt"]);
  authority(value, request);
  invariant(value.version === 1 && value.id === allowance.id && value.allowanceId === allowance.id && value.projectId === allowance.projectId
    && time(value.createdAt) && value.contextDigest === allowanceRevokeContextDigest(value.projectId, { allowanceId: value.allowanceId }),
  "ALLOWANCE_INVALID", "Revocation must retain its exact allowance and human request");
}
export function assertExternalAllowanceConsumption(value: ExternalAllowanceConsumption, allowance: ExternalAllowance,
  attempt: Attempt, reservation: { attemptId: string; projectId: string; micros: string }): void {
  fields(value, ["id", "projectId", "version", "attemptId", "allowanceId", "candidateId", "nodeId", "specDigest", "profileDigest", "profileDefinitionDigest",
    "requestDigest", "estimatedMicros", "recordedAt"]);
  invariant(value.version === 1 && value.id === attempt.id && value.attemptId === attempt.id && value.projectId === attempt.projectId
    && value.projectId === allowance.projectId && value.allowanceId === allowance.id && attempt.request.externalAllowanceId === allowance.id
    && value.requestDigest === digest(attempt.request) && value.candidateId === attempt.candidateId && value.nodeId === attempt.nodeId
    && value.specDigest === attempt.specDigest && value.profileDigest === allowance.profileDigest && value.profileDigest === attempt.request.profile?.digest
    && value.profileDefinitionDigest === allowance.profileDefinitionDigest
    && allowance.selections.some(selected => selected.candidateId === value.candidateId && selected.nodeId === value.nodeId && selected.specDigest === value.specDigest)
    && reservation && reservation.projectId === value.projectId && reservation.attemptId === attempt.id && reservation.micros === value.estimatedMicros
    && typeof value.estimatedMicros === "string" && value.estimatedMicros.length <= 19 && time(value.recordedAt)
    && Date.parse(value.recordedAt) >= Date.parse(allowance.createdAt) && Date.parse(value.recordedAt) < Date.parse(allowance.expiresAt),
  "ALLOWANCE_CONSUMPTION_INVALID", "Consumption must bind its exact admitted request, selection and estimated reservation");
  moneyMicros(value.estimatedMicros);
}
