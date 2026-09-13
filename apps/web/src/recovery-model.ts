import type { PendingCommand } from "./pending-command";

export interface RecoveryState {
  state: "ordinary" | "quarantined" | "released";
  receipt: { restoreId: string; backupCreatedAt: string; restoredAt: string; generation: number } | null;
  receiptDigest: string | null; summaryDigest: string | null;
  counts: { projects: number; knownJobs: number; unknownJobs: number; nativeRequests: number; unusedAllowances: number; preparingJobs?: number };
}
export function recoveryReleaseCommand(state: RecoveryState, key: string): PendingCommand {
  if (state.state !== "quarantined" || !state.receipt || !state.receiptDigest || !state.summaryDigest)
    throw new Error("Refresh the restored installation before reviewing recovery.");
  return { path: "/api/installation/recovery/release", key, body: {
    restoreId: state.receipt.restoreId, expectedReceiptDigest: state.receiptDigest, expectedSummaryDigest: state.summaryDigest,
  } };
}
export function recoveryReviewCurrent(command: PendingCommand | null, state: RecoveryState | null): boolean {
  const body = command?.body as { restoreId?: string; expectedReceiptDigest?: string; expectedSummaryDigest?: string } | undefined;
  return !!body && state?.state === "quarantined" && body.restoreId === state.receipt?.restoreId
    && body.expectedReceiptDigest === state.receiptDigest && body.expectedSummaryDigest === state.summaryDigest;
}
