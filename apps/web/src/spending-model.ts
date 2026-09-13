import type { PendingCommand } from "./pending-command";

export interface SpendingProviderDisplay {
  id: string; revision: string; adapter: "openai-image" | "minimax-h3"; model: string; definitionDigest: string;
  settings: { width: number; height: number; quality: string } | { resolution: string };
}
export interface AllowanceWork {
  candidateId: string; nodeId: string; specDigest: string; alias: string | null; shotId: string | null;
  operation: "image" | "video" | null; current: boolean; historyAvailable: boolean;
}

export interface SpendingCandidate {
  candidateId: string; nodeId: string; specDigest: string; alias: string; shotId: string | null; operation: string;
  profileId: string | null; profileRevision: string | null; profileDigest: string | null; profileDefinitionDigest: string | null;
  estimatedMicros: string | null; selectionCurrent: boolean; suggestedForIssue: boolean; unavailableCode: string | null;
  workState: string; latestAttempt: { id: string; phase: string; ordinal: number; retryPermitted: boolean } | null;
  matchingAllowanceCount?: number;
  providerDisplay: SpendingProviderDisplay | null;
}
export interface SpendingAllowance {
  id: string; profileDigest: string; profileDefinitionDigest: string; selections: Array<{ candidateId: string; nodeId: string; specDigest: string }>;
  maxAttempts: number; maxEstimatedMicros: string; expiresAt: string; createdAt: string;
  usedAttempts: number; usedEstimatedMicros: string; remainingAttempts: number; remainingEstimatedMicros: string;
  revoked: boolean; expired: boolean; status: string; currentSelectionCount: number;
  providerDisplay: SpendingProviderDisplay | null; work: AllowanceWork[];
}
interface Coverage { offset: number; returned: number; total: number; nextOffset: number | null }
export function spendingPage(coverage: Coverage, limit: number) {
  return { visible: coverage.total > limit || coverage.offset > 0, previousOffset: coverage.offset > 0 ? Math.max(0, coverage.offset - limit) : null,
    label: coverage.returned ? `${coverage.offset + 1}–${coverage.offset + coverage.returned} of ${coverage.total}` : "No work on this page" };
}
export interface SpendingState {
  version: 1; projectId: string; revisionId: string; headVersion: number; planId: string | null;
  projectBudget: { capMicros: string; committedMicros: string; currency: "USD"; revision: number };
  candidates: SpendingCandidate[]; allowances: SpendingAllowance[];
  coverage: { candidates: Coverage; allowances: Coverage };
}
interface IssueBody {
  profileDigest: string; profileDefinitionDigest: string; selections: Array<{ candidateId: string; nodeId: string; specDigest: string }>;
  maxAttempts: number; maxEstimatedMicros: string; expiresAt: string;
}
export interface SpendingReview {
  projectId: string; profileId: string; operation: string; unitMicros: string;
  labels: string[]; providerDisplay: SpendingProviderDisplay; body: IssueBody; command: PendingCommand;
}
const hash = (value: string | null): value is string => !!value && /^[a-f0-9]{64}$/.test(value);
const id = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
function micros(value: string | null): bigint {
  if (value === null || !/^(0|[1-9][0-9]{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) throw new Error("This work has no valid configured estimate.");
  return BigInt(value);
}
export function spendingMoney(value: string): string {
  const amount = micros(value), whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0");
  return `$${whole}.${fraction} USD`;
}
export function canSelectSpending(candidate: SpendingCandidate): boolean {
  return candidate.selectionCurrent && candidate.suggestedForIssue && ["image", "video"].includes(candidate.operation)
    && (candidate.matchingAllowanceCount ?? 0) === 0 && !!candidate.providerDisplay
    && candidate.providerDisplay.definitionDigest === candidate.profileDefinitionDigest && candidate.providerDisplay.id === candidate.profileId
    && candidate.providerDisplay.revision === candidate.profileRevision;
}
export function spendingModelSettings(display: SpendingProviderDisplay): string {
  return "resolution" in display.settings ? display.settings.resolution : `${display.settings.width} × ${display.settings.height} · ${display.settings.quality}`;
}
/** Capture the exact visible work once; refreshing the page cannot widen an approval or retry. */
export function reviewSpending(state: SpendingState, candidateIds: string[], key: string, now = Date.now()): SpendingReview {
  if (!id(state.projectId) || !key || candidateIds.length < 1 || candidateIds.length > 100 || new Set(candidateIds).size !== candidateIds.length)
    throw new Error("Select the current work you want to authorize.");
  const selected = candidateIds.map(candidateId => state.candidates.find(candidate => candidate.candidateId === candidateId));
  if (selected.some(candidate => !candidate || !canSelectSpending(candidate))) throw new Error("The selected work changed. Refresh before reviewing its allowance.");
  const candidates = selected as SpendingCandidate[], first = candidates[0]!;
  if (!first.profileId || !hash(first.profileDigest) || !hash(first.profileDefinitionDigest)
    || candidates.some(candidate => candidate.profileId !== first.profileId || candidate.operation !== first.operation
      || candidate.profileDigest !== first.profileDigest || candidate.profileDefinitionDigest !== first.profileDefinitionDigest
      || candidate.estimatedMicros !== first.estimatedMicros || !id(candidate.candidateId) || !id(candidate.nodeId) || !hash(candidate.specDigest)))
    throw new Error("Review work using one exact saved model and estimate at a time.");
  const unitMicros = micros(first.estimatedMicros).toString(), total = (BigInt(unitMicros) * BigInt(candidates.length)).toString(); micros(total);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("The allowance needs a valid expiry time.");
  const body: IssueBody = { profileDigest: first.profileDigest, profileDefinitionDigest: first.profileDefinitionDigest,
    selections: candidates.map(candidate => ({ candidateId: candidate.candidateId, nodeId: candidate.nodeId, specDigest: candidate.specDigest })),
    maxAttempts: candidates.length, maxEstimatedMicros: total, expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() };
  return { projectId: state.projectId, profileId: first.profileId, operation: first.operation, unitMicros, providerDisplay: structuredClone(first.providerDisplay!),
    labels: candidates.map(candidate => candidate.alias), body,
    command: { path: `/api/projects/${encodeURIComponent(state.projectId)}/spending/allowances`, key, body: structuredClone(body) } };
}
export function spendingReviewCurrent(review: SpendingReview, state: SpendingState | null, now = Date.now()): boolean {
  if (!state || review.projectId !== state.projectId || Date.parse(review.body.expiresAt) <= now) return false;
  return review.body.selections.every(selected => state.candidates.some(candidate => canSelectSpending(candidate)
    && candidate.candidateId === selected.candidateId && candidate.nodeId === selected.nodeId && candidate.specDigest === selected.specDigest
    && candidate.profileDigest === review.body.profileDigest && candidate.profileDefinitionDigest === review.body.profileDefinitionDigest
    && candidate.estimatedMicros === review.unitMicros && candidate.operation === review.operation));
}
export function revokeSpending(projectId: string, allowanceId: string, key: string): PendingCommand {
  if (!id(projectId) || !id(allowanceId) || !key) throw new Error("Choose a saved allowance to revoke.");
  return { path: `/api/projects/${encodeURIComponent(projectId)}/spending/allowances/${encodeURIComponent(allowanceId)}/revoke`, key, body: {} };
}
/** Parse user-entered USD without floating-point rounding, retaining at most six fractional digits. */
export function budgetCommand(projectId: string, budget: SpendingState["projectBudget"], dollars: string, key: string): PendingCommand {
  const value = dollars.trim();
  if (!id(projectId) || !key || !Number.isSafeInteger(budget.revision) || budget.revision < 0 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))
    throw new Error("Enter a nonnegative USD amount with up to six decimal places.");
  const [whole, fraction = ""] = value.split("."), capMicros = (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"))).toString();
  micros(capMicros); micros(budget.capMicros);
  return { path: `/api/projects/${encodeURIComponent(projectId)}/spending/budget`, key,
    body: { expectedRevision: budget.revision, expectedCapMicros: budget.capMicros, capMicros } };
}
