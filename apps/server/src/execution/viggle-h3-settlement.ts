import { randomUUID } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";
import type { ExecutionOutcome, ViggleH3ListResult, ViggleH3Provider } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import type { Attempt } from "./engine.js";
import { assertViggleH3Diagnostic, assertViggleH3Receipt, viggleH3Fields } from "./viggle-h3-receipts.js";
import type { ViggleH3ExecutionDispatch, ViggleH3ExecutionSubmit } from "./viggle-h3-receipts.js";

export const VIGGLE_SETTLEMENT_KIND = "viggle_h3_submission_settlement";
/** Two checks, each with three bounded prefixes plus the matching owned task ids. */
export const VIGGLE_SETTLEMENT_BYTES = 65536;
export interface ViggleSettlementTiming { firstMs: number; secondMs: number }
interface Check { startedAt: number; observedAt: number; pages: ViggleH3ListResult[]; ownedTaskIds: string[]; result: "clear" | "stranger" | "unreadable" | "incomplete" }
export interface ViggleSubmissionSettlement {
  id: string; version: 1; projectId: string; attemptId: string; requestDigest: string; dispatchDigest: string; submitDigest: string;
  timing: ViggleSettlementTiming; claimMs: number; nextCheckAt: number; claimId: string | null; checks: Check[];
}
const validTime = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= Number.MAX_SAFE_INTEGER - 86400000;
const validTask = (s: unknown): s is string => typeof s === "string" && /^vid_[A-Za-z0-9_-]{1,156}$/.test(s);
const check = (condition: unknown): void => invariant(condition, "VIGGLE_H3_EXECUTION_CONFLICT", "Invalid Viggle lost-submission settlement");
export function assertViggleSettlementTiming(timing: ViggleSettlementTiming): void {
  viggleH3Fields(timing, ["firstMs", "secondMs"]);
  check(validTime(timing.firstMs) && validTime(timing.secondMs) && timing.firstMs >= 1 && timing.secondMs > timing.firstMs && timing.secondMs <= 600000);
}
/** All installation submissions count, including graph films, other projects and historical siblings. */
export function ownedViggleTasks(store: Pick<Store, "db">): Set<string> {
  const rows = store.db.prepare("SELECT json_extract(body,'$.observation.taskId') taskId FROM entities WHERE kind='viggle_h3_execution_submit' AND json_extract(body,'$.observation.kind')='accepted'").all() as { taskId: unknown }[];
  return new Set(rows.map(row => row.taskId).filter(validTask));
}
function classify(pages: ViggleH3ListResult[], owned: ReadonlySet<string>, windowStart: number): Check["result"] {
  for (const page of pages) {
    if (page.kind === "unknown") return "unreadable";
    if (page.items.some(item => Date.parse(item.createdAt) >= windowStart && !owned.has(item.id))) return "stranger";
    if (!page.hasMore || page.items.some(item => Date.parse(item.createdAt) < windowStart)) return "clear";
  }
  return "incomplete";
}
export function assertViggleSettlement(attempt: Attempt, dispatch: ViggleH3ExecutionDispatch, submit: ViggleH3ExecutionSubmit,
  value: ViggleSubmissionSettlement, owned: ReadonlySet<string>): void {
  viggleH3Fields(value, ["id", "version", "projectId", "attemptId", "requestDigest", "dispatchDigest", "submitDigest", "timing", "claimMs", "nextCheckAt", "claimId", "checks"]);
  check(attempt.workKey?.startsWith("code-plan:") && value.id === attempt.id && value.version === 1 && value.attemptId === attempt.id
    && value.projectId === attempt.projectId && value.requestDigest === digest(attempt.request) && value.dispatchDigest === digest(dispatch)
    && value.submitDigest === digest(submit) && submit.observation.kind === "unknown" && submit.observation.receipt.httpStatus === null
    && !attempt.taskId && validTime(value.nextCheckAt) && Number.isSafeInteger(value.claimMs) && value.claimMs >= 301001 && value.claimMs <= 661000
    && (value.claimId === null || typeof value.claimId === "string" && /^[a-f0-9-]{36}$/.test(value.claimId))
    && Array.isArray(value.checks) && value.checks.length <= 2 && Buffer.byteLength(canonical(value)) <= VIGGLE_SETTLEMENT_BYTES);
  assertViggleSettlementTiming(value.timing);
  value.checks.forEach((entry, index) => {
    viggleH3Fields(entry, ["startedAt", "observedAt", "pages", "ownedTaskIds", "result"]);
    check(validTime(entry.startedAt) && validTime(entry.observedAt) && entry.observedAt >= entry.startedAt
      && entry.startedAt >= dispatch.createdAt + (index ? value.timing.secondMs : value.timing.firstMs)
      && (!index || value.checks[0]!.result === "clear" && entry.startedAt >= value.checks[0]!.observedAt + value.timing.secondMs - value.timing.firstMs)
      && Array.isArray(entry.pages) && entry.pages.length >= 1 && entry.pages.length <= 3
      && Array.isArray(entry.ownedTaskIds) && entry.ownedTaskIds.length <= 72 && entry.ownedTaskIds.every(id => validTask(id) && owned.has(id)));
    entry.pages.forEach((page, pageIndex) => {
      viggleH3Fields(page, page.kind === "listed" ? ["kind", "items", "hasMore", "receipt"] : ["kind", "error", "receipt"]);
      assertViggleH3Receipt(page.receipt);
      if (page.kind === "unknown") assertViggleH3Diagnostic(page.error);
      else {
        check(page.kind === "listed" && page.receipt.httpStatus === 200 && typeof page.hasMore === "boolean" && Array.isArray(page.items)
          && page.items.length <= (pageIndex + 1) * 12 && (!page.hasMore || page.items.length > 0));
        page.items.forEach((item, i) => {
          viggleH3Fields(item, ["id", "createdAt"]);
          check(validTask(item.id) && typeof item.createdAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(item.createdAt)
            && Number.isFinite(Date.parse(item.createdAt)) && new Date(item.createdAt).toISOString() === item.createdAt.replace("Z", ".000Z")
            && (!i || Date.parse(page.items[i - 1]!.createdAt) >= Date.parse(item.createdAt)));
        });
        check(new Set(page.items.map(item => item.id)).size === page.items.length);
      }
      if (pageIndex) check(classify(entry.pages.slice(0, pageIndex), new Set(entry.ownedTaskIds), dispatch.createdAt - 60000) === "incomplete");
    });
    check(entry.result === classify(entry.pages, new Set(entry.ownedTaskIds), dispatch.createdAt - 60000));
  });
}
export function assertViggleSettlementTransition(previous: ViggleSubmissionSettlement, next: ViggleSubmissionSettlement): void {
  for (const field of ["id", "version", "projectId", "attemptId", "requestDigest", "dispatchDigest", "submitDigest", "timing", "claimMs"] as const)
    check(canonical(previous[field]) === canonical(next[field]));
  check(next.checks.length >= previous.checks.length && canonical(previous.checks) === canonical(next.checks.slice(0, previous.checks.length)));
  if (settled(previous)) check(canonical(previous) === canonical(next));
}
const settled = (row: ViggleSubmissionSettlement): boolean => row.checks.length === 2 || row.checks.some(entry => entry.result !== "clear");
const outcome = (row: ViggleSubmissionSettlement): ExecutionOutcome => !settled(row)
  ? { type: "unknown", diagnostic: "H3 lost submission is awaiting account-list settlement" }
  : row.checks.length === 2 && row.checks.every(entry => entry.result === "clear")
    ? { type: "rejected", certainty: "not_accepted", failureId: "VIGGLE_H3_NO_TASK_CREATED", technical: true, retryAllowed: true }
    : { type: "failed", taskId: null, failureId: "SUBMISSION_RESPONSE_LOST", technical: true, retryAllowed: false };

/** Tick-driven, durable and read-only at the provider. No worker sleeps or repeats a create. */
export async function settleViggleSubmission(options: { store: Store; attempt: Attempt; dispatch: ViggleH3ExecutionDispatch;
  submit: ViggleH3ExecutionSubmit; timing: ViggleSettlementTiming; claimMs: number; now: () => number; transport: () => ViggleH3Provider; signal?: AbortSignal }): Promise<ExecutionOutcome> {
  const { store, attempt, dispatch, submit, timing, now, signal } = options;
  const load = () => store.get<ViggleSubmissionSettlement>(VIGGLE_SETTLEMENT_KIND, attempt.id);
  const claimed = store.transaction(() => {
    const row = load() ?? store.insert<ViggleSubmissionSettlement>(VIGGLE_SETTLEMENT_KIND, attempt.id, attempt.projectId, {
      id: attempt.id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request),
      dispatchDigest: digest(dispatch), submitDigest: digest(submit), timing, claimMs: options.claimMs,
      nextCheckAt: dispatch.createdAt + timing.firstMs, claimId: null, checks: [],
    });
    assertViggleSettlement(attempt, dispatch, submit, row, ownedViggleTasks(store));
    if (settled(row) || signal?.aborted || row.nextCheckAt > now()) return { row, claim: null };
    const claim = randomUUID(), startedAt = now();
    return { row: store.put(VIGGLE_SETTLEMENT_KIND, attempt.id, attempt.projectId, { ...row, claimId: claim, nextCheckAt: startedAt + row.claimMs }), claim, startedAt };
  });
  if (!claimed.claim) return outcome(claimed.row);
  const pages: ViggleH3ListResult[] = [], owned = new Set<string>();
  let result: Check["result"] = "incomplete";
  try {
    const transport = options.transport();
    for (let page = 1; page <= 3; page++) {
      // The evidenced endpoint accepts limit only. Expand the newest-first prefix to
      // cover up to three 12-item pages without inventing an undocumented cursor.
      const response = await transport.listVideos(page * 12, signal ? { signal } : {}); pages.push(response);
      const known = ownedViggleTasks(store);
      if (response.kind === "listed") for (const item of response.items) if (known.has(item.id)) owned.add(item.id);
      result = classify(pages, owned, dispatch.createdAt - 60000);
      if (result !== "incomplete") break;
    }
  } catch {
    if (pages.length === 3) pages.pop();
    pages.push({ kind: "unknown", error: { code: "VIGGLE_H3_LIST_UNAVAILABLE", category: "transport" }, receipt: { requestId: null, httpStatus: null } });
    result = "unreadable";
  }
  return store.transaction(() => {
    const row = load()!;
    if (row.claimId !== claimed.claim) return outcome(row); // A stale reader cannot publish over a replacement claim.
    const observedAt = now(), entry: Check = { startedAt: claimed.startedAt!, observedAt, pages, ownedTaskIds: [...owned], result };
    const next = store.put<ViggleSubmissionSettlement>(VIGGLE_SETTLEMENT_KIND, attempt.id, attempt.projectId, {
      ...row, claimId: null, checks: [...row.checks, entry], nextCheckAt: Math.max(dispatch.createdAt + row.timing.secondMs, observedAt + row.timing.secondMs - row.timing.firstMs),
    });
    return outcome(next);
  });
}
