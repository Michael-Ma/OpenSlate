import type { PendingCommand } from "./pending-command";

export type SpendingProviderDisplay = { id: string; revision: string; model: string; definitionDigest: string } & (
  { adapter: "codex-image"; settings: { runtimeVersion: string; directorModel: string; width: number; height: number };
    usage: { kind: "codex_subscription"; unit: "native_turn"; quotaEstimateAvailable: false } }
  | { adapter: "openai-image"; settings: { width: number; height: number; quality: string } }
  | { adapter: "minimax-h3"; settings: { resolution: string } }
  | { adapter: "viggle-h3"; settings: { quality: string; resolution: string; aspectRatio: string } }
  | { adapter: "openai-speech" | "openai-transcription"; settings: Record<string, never> });
export type SpendingAudioDisplay = { operation: "speech"; voice: string; textBytes: number; instructionsPresent: boolean }
  | { operation: "transcription"; language: string | null; timing: "word" };
interface AudioDetails { audioDisplay?: SpendingAudioDisplay | null; audioUnavailableCode?: string | null }
export interface AllowanceWork extends AudioDetails {
  candidateId: string; nodeId: string; specDigest: string; alias: string | null; shotId: string | null;
  operation: "image" | "video" | "speech" | "transcription" | null; current: boolean; historyAvailable: boolean;
}

export interface SpendingCandidate extends AudioDetails {
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
  restoredHistory?: boolean;
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
  focus?: { candidateId: string; found: boolean };
}
interface IssueBody {
  profileDigest: string; profileDefinitionDigest: string; selections: Array<{ candidateId: string; nodeId: string; specDigest: string }>;
  maxAttempts: number; maxEstimatedMicros: string; expiresAt: string;
}
export interface SpendingReview {
  projectId: string; profileId: string; operation: string; unitMicros: string;
  labels: string[]; providerDisplay: SpendingProviderDisplay; body: IssueBody; command: PendingCommand;
  audioDisplays?: SpendingAudioDisplay[];
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
export function isCodexSpending(display: SpendingProviderDisplay | null | undefined): display is SpendingProviderDisplay & { adapter: "codex-image" } {
  return display?.adapter === "codex-image";
}
export function spendingEstimate(display: SpendingProviderDisplay | null, estimate: string | null): string {
  if (isCodexSpending(display)) return "Uses Codex subscription quota · quota use is not estimated";
  return estimate !== null ? `${spendingMoney(estimate)} configured estimate / attempt` : "Estimate unavailable";
}
export function spendingAllowanceUsage(allowance: SpendingAllowance): string {
  if (isCodexSpending(allowance.providerDisplay)) return `${allowance.usedAttempts} / ${allowance.maxAttempts} Codex start permissions used · quota use is not measured`;
  return `${allowance.usedAttempts} / ${allowance.maxAttempts} starts used · ${spendingMoney(allowance.usedEstimatedMicros)} / ${spendingMoney(allowance.maxEstimatedMicros)} configured estimate used`;
}
export function canSelectSpending(candidate: SpendingCandidate): boolean {
  const expected = { image: ["openai-image", "codex-image"], video: ["minimax-h3", "viggle-h3"], speech: ["openai-speech"], transcription: ["openai-transcription"] }[candidate.operation];
  const audio = candidate.operation === "speech" || candidate.operation === "transcription";
  return candidate.unavailableCode !== "RESTORED_AUTHORITY_REQUIRES_NEW" && candidate.selectionCurrent && candidate.suggestedForIssue && !!expected
    && (!audio || !candidate.audioUnavailableCode && validAudioDisplay(candidate.audioDisplay) && candidate.audioDisplay.operation === candidate.operation)
    && (candidate.matchingAllowanceCount ?? 0) === 0 && !!candidate.providerDisplay
    && expected!.includes(candidate.providerDisplay.adapter)
    && (!isCodexSpending(candidate.providerDisplay) || candidate.estimatedMicros === "0"
      && candidate.providerDisplay.usage?.kind === "codex_subscription" && candidate.providerDisplay.usage.unit === "native_turn"
      && candidate.providerDisplay.usage.quotaEstimateAvailable === false)
    && candidate.providerDisplay.definitionDigest === candidate.profileDefinitionDigest && candidate.providerDisplay.id === candidate.profileId
    && candidate.providerDisplay.revision === candidate.profileRevision;
}
export function spendingWorkStatus(candidate: SpendingCandidate): string {
  if (candidate.unavailableCode === "RESTORED_AUTHORITY_REQUIRES_NEW") {
    if (candidate.workState === "completed") return "Completed · restored history";
    if (candidate.workState === "uncertain") return "Restored uncertain result · existing evidence can be recovered";
    if (candidate.workState === "in_progress") return "Restored work in progress · existing results can be recovered";
    return "Restored work · request a new take with fresh approval";
  }
  if (candidate.audioUnavailableCode) return spendingAudioSummary(candidate);
  if (candidate.unavailableCode === "NARRATION_SPEECH_STALE") return "This narration section changed. Prepare and review a fresh speech plan.";
  if (candidate.unavailableCode === "SUBMISSION_PREPARATION_OBSOLETE" || candidate.unavailableCode === "APPLICATION_INPUT_UNAVAILABLE")
    return "Recording selection changed · prepare and review the current recording before approving new spending";
  if (!candidate.providerDisplay) return "Saved model details unavailable · refresh or request new work";
  return (candidate.matchingAllowanceCount ?? 0) > 0 ? "Matching allowance recorded; remaining limits are shared."
    : canSelectSpending(candidate) ? isCodexSpending(candidate.providerDisplay) ? "Available for Codex usage review" : "Available for cost review" : candidate.workState === "uncertain" ? "Outcome uncertain · waiting for recovery"
      : candidate.workState === "completed" ? "Completed" : candidate.workState === "in_progress" ? "Already in progress" : "Not available for another attempt";
}
export function spendingAllowanceStatus(allowance: SpendingAllowance): string {
  return allowance.status === "restored_history" ? "Restored history · cannot start new work" : allowance.status.replaceAll("_", " ");
}
export function spendingModelSettings(display: SpendingProviderDisplay): string {
  if (display.adapter === "codex-image") return `Codex · ${display.settings.directorModel} · requested ${display.settings.width} × ${display.settings.height} (output size may differ)`;
  if (display.adapter === "openai-speech") return "Speech recording · WAV · normal speed";
  if (display.adapter === "openai-transcription") return "Transcription · word timestamps";
  if (display.adapter === "viggle-h3") return `Viggle · ${display.settings.quality} · ${display.settings.resolution} · ${display.settings.aspectRatio} · configured upper estimate per attempt`;
  return display.adapter === "minimax-h3" ? display.settings.resolution : `${display.settings.width} × ${display.settings.height} · ${display.settings.quality}`;
}
function validAudioDisplay(value: SpendingAudioDisplay | null | undefined): value is SpendingAudioDisplay {
  if (!value || typeof value !== "object") return false;
  return value.operation === "speech" ? typeof value.voice === "string" && /^[a-z]{1,32}$/.test(value.voice)
    && Number.isSafeInteger(value.textBytes) && value.textBytes > 0 && typeof value.instructionsPresent === "boolean"
    : value.operation === "transcription" && value.timing === "word" && (value.language === null || typeof value.language === "string" && /^[a-z]{2}$/.test(value.language));
}
function audioKey(value: SpendingAudioDisplay): string {
  return JSON.stringify(value.operation === "speech" ? [value.operation, value.voice, value.textBytes, value.instructionsPresent] : [value.operation, value.language, value.timing]);
}
export function spendingAudioSummary(details: AudioDetails): string {
  if (details.audioUnavailableCode === "AUDIO_PROFILE_UNAVAILABLE") return "Saved audio model details unavailable";
  if (details.audioUnavailableCode || !validAudioDisplay(details.audioDisplay)) return "Saved audio options are unsupported or unavailable";
  const audio = details.audioDisplay;
  return audio.operation === "speech" ? `Voice: ${audio.voice}${audio.instructionsPresent ? " · Delivery instructions included" : ""}`
    : `Language: ${audio.language === null ? "automatic detection" : audio.language} · Word timestamps`;
}
export function spendingOperationLabel(operation: string | null): string {
  return operation === "image" ? "keyframe" : operation === "speech" ? "speech recording" : operation === "transcription" ? "transcription" : operation ?? "work";
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
    ...((first.operation === "speech" || first.operation === "transcription") ? { audioDisplays: candidates.map(candidate => structuredClone(candidate.audioDisplay!)) } : {}),
    command: { path: `/api/projects/${encodeURIComponent(state.projectId)}/spending/allowances`, key, body: structuredClone(body) } };
}
export function spendingReviewCurrent(review: SpendingReview, state: SpendingState | null, now = Date.now()): boolean {
  if (!state || review.projectId !== state.projectId || Date.parse(review.body.expiresAt) <= now) return false;
  return review.body.selections.every((selected, index) => state.candidates.some(candidate => canSelectSpending(candidate)
    && candidate.candidateId === selected.candidateId && candidate.nodeId === selected.nodeId && candidate.specDigest === selected.specDigest
    && candidate.profileDigest === review.body.profileDigest && candidate.profileDefinitionDigest === review.body.profileDefinitionDigest
    && candidate.estimatedMicros === review.unitMicros && candidate.operation === review.operation
    && (!isCodexSpending(review.providerDisplay) || isCodexSpending(candidate.providerDisplay)
      && candidate.providerDisplay.model === review.providerDisplay.model
      && candidate.providerDisplay.settings.runtimeVersion === review.providerDisplay.settings.runtimeVersion
      && candidate.providerDisplay.settings.directorModel === review.providerDisplay.settings.directorModel
      && candidate.providerDisplay.settings.width === review.providerDisplay.settings.width
      && candidate.providerDisplay.settings.height === review.providerDisplay.settings.height)
    && (!(review.operation === "speech" || review.operation === "transcription") || !!review.audioDisplays?.[index]
      && !!candidate.audioDisplay && audioKey(candidate.audioDisplay) === audioKey(review.audioDisplays[index]!))));
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
