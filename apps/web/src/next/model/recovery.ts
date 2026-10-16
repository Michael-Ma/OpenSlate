import type { GenerationOverview } from "@openslate/core/public";
import type { Locale } from "../../shared/locale-preference.ts";
import type { MessageId } from "../i18n/messages.ts";
import { msg, type Msg } from "./types.ts";

/**
 * Installation recovery after a restore from backup (GET /api/installation/recovery). While the installation is
 * quarantined the studio is read-only: reads work, every write is refused until a person finishes the recovery
 * review, which releases exactly the receipt and summary they saw (POST /api/installation/recovery/release with an
 * Idempotency-Key). Pure: no React, no network, no clock except the dates passed in.
 */

export const RECOVERY_PATH = "/api/installation/recovery";
export const RELEASE_PATH = `${RECOVERY_PATH}/release`;
/** The press id of the release while it is being sent. */
export const RELEASE_PRESS = "recovery:release";
/** Where an unconfirmed release is kept, so a reload still offers Retry with the same key and body. */
export const RELEASE_STORAGE_KEY = "openslate.next.recovery-release";

export interface RecoveryCounts {
  projects: number;
  /** Jobs sent before the backup with one known task: their results can still be collected after the review. */
  knownJobs: number;
  /** Jobs whose submission is not known: they stay unresolved and may still arrive and be charged. */
  unknownJobs: number;
  /** Director turns saved in the backup: they never run again. */
  nativeRequests: number;
  unusedAllowances: number;
  /** Local preparations that never reached a provider: they stay stopped. */
  preparingJobs: number;
}

export interface RecoveryReceipt {
  restoreId: string;
  backupCreatedAt: string;
  restoredAt: string;
}

/** The server's snapshot (apps/server/src/application/installation-recovery.ts RecoverySnapshot), the parts read here. */
export interface RecoveryStatus {
  state: "ordinary" | "quarantined" | "released";
  receipt: RecoveryReceipt | null;
  receiptDigest: string | null;
  summaryDigest: string | null;
  counts: RecoveryCounts;
}

export interface ReleaseBody {
  restoreId: string;
  expectedReceiptDigest: string;
  expectedSummaryDigest: string;
}

/** A release that was sent: resent unchanged (same key, same body) until the server answers definitely. */
export interface SavedRelease {
  key: string;
  body: ReleaseBody;
}

/** The recovery part of the studio state. Installation-wide: switching films keeps it. */
export interface RecoveryState {
  /** The last status read; null until read, or on a server without the route. */
  status: RecoveryStatus | null;
  /** A release whose reply was lost. Retry resends it as it was; kept across reloads. */
  unconfirmed: SavedRelease | null;
  /** The server refused the last release because the summary changed; the review was read again. */
  stale: boolean;
  /** This window finished the review: the review explains what happens next until it is dismissed. */
  released: boolean;
}

export const NO_RECOVERY: RecoveryState = { status: null, unconfirmed: null, stale: false, released: false };

// ---- reading ------------------------------------------------------------------------------

const HASH = /^[a-f0-9]{64}$/;
const COMMAND_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const STATES = new Set(["ordinary", "quarantined", "released"]);

const count = (value: unknown): number => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);
const digest = (value: unknown): string | null => (typeof value === "string" && HASH.test(value) ? value : null);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null);

/**
 * The status as the server sent it, or null when it is not a recovery status at all. A quarantine with a damaged
 * receipt stays a quarantine (writes stay off); it only cannot be released until it is read again.
 */
export function parseRecoveryStatus(value: unknown): RecoveryStatus | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.state !== "string" || !STATES.has(raw.state)) return null;
  const counts = (raw.counts && typeof raw.counts === "object" ? raw.counts : {}) as Record<string, unknown>;
  const receiptRaw = (raw.receipt && typeof raw.receipt === "object" ? raw.receipt : null) as Record<string, unknown> | null;
  const restoreId = text(receiptRaw?.restoreId), backupCreatedAt = text(receiptRaw?.backupCreatedAt), restoredAt = text(receiptRaw?.restoredAt);
  return {
    state: raw.state as RecoveryStatus["state"],
    receipt: restoreId && backupCreatedAt ? { restoreId, backupCreatedAt, restoredAt: restoredAt ?? backupCreatedAt } : null,
    receiptDigest: digest(raw.receiptDigest),
    summaryDigest: digest(raw.summaryDigest),
    counts: {
      projects: count(counts.projects), knownJobs: count(counts.knownJobs), unknownJobs: count(counts.unknownJobs),
      nativeRequests: count(counts.nativeRequests), unusedAllowances: count(counts.unusedAllowances), preparingJobs: count(counts.preparingJobs),
    },
  };
}

// ---- the read-only flag ---------------------------------------------------------------------

/** While quarantined every write is off, with this one reason. */
export const RECOVERY_LOCK: Msg = msg("guard.recovery");

export const isQuarantined = (status: RecoveryStatus | null | undefined): boolean => status?.state === "quarantined";

/** The studio-wide read-only flag, derived from the status. */
export const recoveryReadOnly = (state: { recovery: RecoveryState }): boolean => isQuarantined(state.recovery.status);

/** The reason writes are off for the recovery review, or null. A stable value, so it can be a store selector. */
export const recoveryLock = (state: { recovery: RecoveryState }): Msg | null => (recoveryReadOnly(state) ? RECOVERY_LOCK : null);

// ---- the release ----------------------------------------------------------------------------

/** The release for exactly this receipt and summary, or null when the status cannot be released as read. */
export function releaseBody(status: RecoveryStatus | null): ReleaseBody | null {
  if (!status || status.state !== "quarantined" || !status.receipt || !status.receiptDigest || !status.summaryDigest) return null;
  return { restoreId: status.receipt.restoreId, expectedReceiptDigest: status.receiptDigest, expectedSummaryDigest: status.summaryDigest };
}

/**
 * Whether a saved, unconfirmed release still concerns the installation as it is now: the same restore, still in
 * review. Once the restore was released (by this decision or another) or a newer restore replaced it, the saved
 * decision has nothing left to settle and is dropped. A changed summary keeps it: resending it is how the person
 * finds out what the server decided (it refuses a stale summary).
 */
export function unconfirmedStillApplies(saved: SavedRelease | null, status: RecoveryStatus | null): boolean {
  if (!saved) return false;
  if (!status) return true;
  return status.state === "quarantined" && status.receipt?.restoreId === saved.body.restoreId;
}

/** A saved release from storage, or null when there is none or it is not one. */
export function parseSavedRelease(raw: string | null): SavedRelease | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { key?: unknown; body?: Record<string, unknown> };
    const body = value.body;
    if (typeof value.key !== "string" || !COMMAND_KEY.test(value.key) || !body) return null;
    const restoreId = text(body.restoreId), expectedReceiptDigest = digest(body.expectedReceiptDigest), expectedSummaryDigest = digest(body.expectedSummaryDigest);
    if (!restoreId || !expectedReceiptDigest || !expectedSummaryDigest) return null;
    return { key: value.key, body: { restoreId, expectedReceiptDigest, expectedSummaryDigest } };
  } catch {
    return null;
  }
}

/**
 * What a new read changes in the review besides the status. A summary that changed under an open review (a job
 * answered meanwhile) is flagged, so the person looks again before finishing; a review that finished elsewhere (in
 * another window, or this page's release whose answer was lost, seen through a later read or after a reload) says what
 * happens next.
 */
export function recoveryChange(before: RecoveryStatus | null, after: RecoveryStatus, unconfirmed: SavedRelease | null = null): Partial<Pick<RecoveryState, "stale" | "released">> {
  // Released after this page saw the review, or after this page's own unconfirmed decision (read again after a reload).
  const ours = before?.state === "quarantined" || (!!unconfirmed && unconfirmed.body.restoreId === after.receipt?.restoreId);
  if (after.state !== "quarantined") return { stale: false, ...(after.state === "released" && ours ? { released: true } : {}) };
  const sameRestore = before?.state === "quarantined" && before.receipt?.restoreId === after.receipt?.restoreId;
  return sameRestore && before.summaryDigest !== after.summaryDigest ? { stale: true } : {};
}

/** What the server's answer to a release means for the review. */
export type ReleaseOutcome = "released" | "already" | "stale" | "unconfirmed" | "refused";

/**
 * A 4xx is a definite answer: RECOVERY_CONFLICT means the summary (or the restore) changed and nothing was released;
 * RECOVERY_ALREADY_RELEASED means another decision finished the review. Anything else that was answered is a refusal.
 * No answer (network, timeout, 5xx) leaves the outcome unknown: the same decision is offered again.
 */
export function releaseOutcome(error: { code?: string; status?: number } | null): ReleaseOutcome {
  if (!error) return "released";
  const status = error.status ?? 0;
  if (status < 400 || status >= 500) return "unconfirmed";
  if (error.code === "RECOVERY_CONFLICT") return "stale";
  if (error.code === "RECOVERY_ALREADY_RELEASED") return "already";
  return "refused";
}

// ---- the review -----------------------------------------------------------------------------

/** What the full-width review shows: nothing, the review itself, or what happens now that it is finished. */
export type ReviewMode = "none" | "review" | "released";

export function reviewMode(recovery: RecoveryState): ReviewMode {
  if (isQuarantined(recovery.status)) return "review";
  if (recovery.released) return "released";
  return "none";
}

/** The decision area: Finish, sending, or a lost reply that only Retry can settle. */
export type DecisionPhase = "ready" | "sending" | "unconfirmed" | "unavailable";

export function decisionPhase(recovery: RecoveryState, sending: boolean): DecisionPhase {
  if (sending) return "sending";
  if (unconfirmedStillApplies(recovery.unconfirmed, recovery.status)) return "unconfirmed";
  return releaseBody(recovery.status) ? "ready" : "unavailable";
}

export interface RecoveryRow {
  key: "films" | "known" | "uncertain" | "preparing" | "requests";
  label: MessageId;
  count: number;
  /** What happens to them, when there are any. */
  note: Msg | null;
}

/**
 * The counts the review lists, each with what happens to it. Local preparations only appear when there are some
 * (as in the classic review); the rest always show, so a zero says plainly that nothing of that kind was found.
 */
export function recoveryRows(counts: RecoveryCounts): RecoveryRow[] {
  const rows: RecoveryRow[] = [
    { key: "films", label: "recovery.count.films", count: counts.projects, note: null },
    { key: "known", label: "recovery.count.known", count: counts.knownJobs, note: counts.knownJobs > 0 ? msg("recovery.note.known", { count: counts.knownJobs }) : null },
    { key: "uncertain", label: "recovery.count.uncertain", count: counts.unknownJobs, note: counts.unknownJobs > 0 ? msg("recovery.note.uncertain", { count: counts.unknownJobs }) : null },
  ];
  if (counts.preparingJobs > 0) rows.push({ key: "preparing", label: "recovery.count.preparing", count: counts.preparingJobs, note: msg("recovery.note.preparing", { count: counts.preparingJobs }) });
  rows.push({ key: "requests", label: "recovery.count.requests", count: counts.nativeRequests, note: counts.nativeRequests > 0 ? msg("recovery.note.requests", { count: counts.nativeRequests }) : null });
  return rows;
}

/** Nothing was in flight when the backup was made: the review says so instead of listing what happens to it. */
export const nothingInFlight = (counts: RecoveryCounts): boolean =>
  counts.knownJobs + counts.unknownJobs + counts.preparingJobs + counts.nativeRequests === 0;

/** When the backup was made, in the interface language ("14 Oct 2026, 18:20" / "2026年10月14日 18:20"). */
export function backupWhen(iso: string, locale: Locale, timeZone?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const zh = locale === "zh-CN";
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", {
    year: "numeric", month: zh ? "long" : "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/** The line about the backup: when it was made and that later work may be missing. */
export function backupLine(status: RecoveryStatus, locale: Locale, timeZone?: string): Msg {
  const when = status.receipt ? backupWhen(status.receipt.backupCreatedAt, locale, timeZone) : null;
  return when ? msg("recovery.backup", { when }) : msg("recovery.backup_unknown");
}

/**
 * A film stopped by the restore itself (the restore paused every film under its own authority). After the review
 * the stopped strip says why it is stopped and that Continue is up to the person.
 */
export function stoppedByRestore(overview: Pick<GenerationOverview, "stopped" | "controlAuthorityId"> | null, status: RecoveryStatus | null): boolean {
  const restoreId = status?.receipt?.restoreId;
  if (!overview?.stopped || !restoreId) return false;
  return overview.controlAuthorityId === restoreId || overview.stopped.stopId === restoreId;
}
