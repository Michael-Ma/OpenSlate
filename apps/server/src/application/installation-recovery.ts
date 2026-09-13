import { canonical, digest, invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { assertRecoveryFence, assertRecoveryOrigin, assertRecoveryReleaseInput, IMPORTED_AUTHORITY_KINDS, recoveryBodyHash, recoveryFenceId } from "../persistence/recovery-records.js";
import type { ImportedAuthorityKind, InstallationRecoveryRow, RecoveryFence, RecoveryReceipt, RecoveryReleaseInput, RecoveryReleaseReceipt, VerifiedRecoveryOrigin } from "../persistence/recovery-records.js";
export type { ImportedAuthorityKind, RecoveryFence, RecoveryReceipt, RecoveryReleaseInput, RecoveryReleaseReceipt, VerifiedRecoveryOrigin } from "../persistence/recovery-records.js";

export interface RecoverySnapshot {
  state: "ordinary" | "quarantined" | "released";
  receipt: RecoveryReceipt | null; receiptDigest: string | null; summaryDigest: string | null;
  counts: { projects: number; knownJobs: number; unknownJobs: number; nativeRequests: number; unusedAllowances: number };
}
const terminal = new Set(["succeeded", "failed"]);
const fenceKey = (projectId: string, kind: ImportedAuthorityKind, id: string) => `${projectId}\0${kind}\0${id}`;
const fenceDigest = (fences: RecoveryFence[]) => digest([...fences].sort((a, b) => a.id.localeCompare(b.id)));

/** Store-backed default policy. No optional feature flag can disable restored authority fences. */
export class InstallationRecoveryGuard {
  private generation = -1;
  private imported = new Set<string>();
  constructor(readonly store: Store) {}
  private current(): InstallationRecoveryRow | undefined {
    const rows = this.store.installationRecoveries(), current = rows.at(-1), generation = current?.generation ?? 0;
    if (generation !== this.generation) {
      const imported = new Set<string>();
      for (const row of rows) {
        const fences = row.receipt.projectIds.flatMap(projectId => this.store.list<RecoveryFence>("installation_recovery_fence", projectId))
          .filter(fence => fence.restoreId === row.receipt.restoreId);
        for (const fence of fences) { assertRecoveryFence(fence); imported.add(fenceKey(fence.projectId, fence.kind, fence.recordId)); }
        invariant(fenceDigest(fences) === row.receipt.fenceDigest, "RECOVERY_INVALID", "Imported authority fences are incomplete or changed");
      }
      this.imported = imported; this.generation = generation;
    }
    return current;
  }
  isImported(projectId: string, kind: ImportedAuthorityKind, id: string): boolean {
    this.current(); return this.imported.has(fenceKey(projectId, kind, id));
  }
  isQuarantined(): boolean { const current = this.current(); return !!current && current.release === null; }
  assertWritable(projectId?: string, requestId?: string): void {
    const current = this.current();
    invariant(!current || current.release !== null, "INSTALLATION_QUARANTINED", "Review and release this restored installation before making changes");
    if (projectId && requestId) this.assertFreshAuthority(projectId, "message", requestId);
  }
  assertFreshAuthority(projectId: string, kind: ImportedAuthorityKind, id: string): void {
    invariant(!this.isImported(projectId, kind, id), "RESTORED_AUTHORITY_REQUIRES_NEW", "Saved authority cannot start new work after restoration; use a fresh request and approval");
  }
  assertFirstSubmit(projectId: string, attemptId: string): void {
    this.assertWritable(projectId); this.assertFreshAuthority(projectId, "attempt", attemptId);
    const attempt = this.store.get<{ projectId: string; candidateId: string | null; request: { externalAllowanceId?: string } }>("attempt", attemptId);
    invariant(attempt?.projectId === projectId, "RECOVERY_INVALID", "Dispatch attempt is outside this project");
    if (attempt.candidateId) {
      this.assertFreshAuthority(projectId, "candidate", attempt.candidateId);
      const candidate = this.store.get<{ grantId: string }>("candidate", attempt.candidateId);
      if (candidate) this.assertFreshAuthority(projectId, "grant", candidate.grantId);
    }
    if (attempt.request.externalAllowanceId) this.assertFreshAuthority(projectId, "external_allowance", attempt.request.externalAllowanceId);
  }
  recoveryMode(projectId: string, attemptId: string): "blocked" | "existing_results_only" | "ordinary" {
    const current = this.current();
    if (current && !current.release) return "blocked";
    return this.isImported(projectId, "attempt", attemptId) ? "existing_results_only" : "ordinary";
  }
  directorEligible(projectId: string, turnId: string, requestId: string): boolean {
    const current = this.current();
    return (!current || !!current.release) && !this.isImported(projectId, "director_turn", turnId) && !this.isImported(projectId, "message", requestId);
  }
  snapshot(): RecoverySnapshot {
    const current = this.current(), counts = { projects: 0, knownJobs: 0, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0 };
    if (!current) return { state: "ordinary", receipt: null, receiptDigest: null, summaryDigest: null, counts };
    counts.projects = current.receipt.projectIds.length;
    const imported = (projectId: string, kind: ImportedAuthorityKind, id: string) => this.imported.has(fenceKey(projectId, kind, id));
    const work: unknown[] = [];
    for (const projectId of current.receipt.projectIds) {
      const evidence = this.store.list<{ attemptId: string; outcome: { type: string; taskId?: string }; outcomeDigest: string }>("execution_evidence", projectId);
      const acceptedByAttempt = new Map<string, typeof evidence>();
      for (const row of evidence) if (row.outcome.type === "accepted" && row.outcome.taskId && row.outcomeDigest === digest(row.outcome)) {
        const entries = acceptedByAttempt.get(row.attemptId) ?? []; entries.push(row); acceptedByAttempt.set(row.attemptId, entries);
      }
      for (const attempt of this.store.list<{ id: string; phase: string; taskId: string | null; reservationId: string | null }>("attempt", projectId)) {
        if (!imported(projectId, "attempt", attempt.id) || terminal.has(attempt.phase)) continue;
        const accepted = acceptedByAttempt.get(attempt.id) ?? [];
        const taskIds = new Set(accepted.map(row => row.outcome.taskId));
        if (attempt.taskId) taskIds.add(attempt.taskId);
        const known = taskIds.size === 1;
        if (known) counts.knownJobs++; else counts.unknownJobs++;
        work.push({ projectId, attemptId: attempt.id, phase: attempt.phase, task: attempt.taskId ? digest(attempt.taskId) : null,
          accepted: accepted.map(row => row.outcomeDigest).sort(), reservation: attempt.reservationId ? this.store.get("reservation", attempt.reservationId) ?? null : null });
      }
      const turns = this.store.list<{ id: string; state: string }>("director_turn", projectId).filter(turn => imported(projectId, "director_turn", turn.id));
      counts.nativeRequests += turns.length;
      work.push({ projectId, turns: turns.map(turn => ({ id: turn.id, state: turn.state })) });
      const usage = new Map<string, number>();
      for (const row of this.store.list<{ allowanceId: string }>("external_allowance_consumption", projectId)) usage.set(row.allowanceId, (usage.get(row.allowanceId) ?? 0) + 1);
      for (const allowance of this.store.list<{ id: string; maxAttempts: number; expiresAt: string }>("external_allowance", projectId)) {
        if (!imported(projectId, "external_allowance", allowance.id)) continue;
        const used = usage.get(allowance.id) ?? 0;
        const revoked = !!this.store.get("external_allowance_revocation", allowance.id);
        if (!revoked && used < allowance.maxAttempts) counts.unusedAllowances++;
        work.push({ projectId, allowanceId: allowance.id, used, revoked, expiresAt: allowance.expiresAt });
      }
    }
    const receiptDigest = digest(current.receipt);
    return { state: current.release ? "released" : "quarantined", receipt: structuredClone(current.receipt), receiptDigest,
      summaryDigest: digest({ receiptDigest, counts, work }), counts };
  }
}

/** Verified offline restore only. No provider, runtime or application service is constructed here. */
export function installRecoveryQuarantine(store: Store, input: VerifiedRecoveryOrigin): RecoveryReceipt {
  const origin = structuredClone(input); assertRecoveryOrigin(origin);
  return store.transaction(() => {
    const rows = store.installationRecoveries(), existing = rows.find(row => row.receipt.restoreId === origin.restoreId);
    if (existing) {
      const { version: _version, generation: _generation, projectIds: _projects, fenceDigest: _fences, ...saved } = existing.receipt;
      invariant(canonical(saved) === canonical(origin), "RECOVERY_CONFLICT", "Restore identity already has another source");
      new InstallationRecoveryGuard(store).snapshot(); return existing.receipt;
    }
    const projectIds = store.listProjects().map(project => project.id).sort(), fences: RecoveryFence[] = [];
    for (const projectId of projectIds) {
      for (const kind of IMPORTED_AUTHORITY_KINDS) {
        const originals = store.db.prepare("SELECT id,body FROM entities WHERE project_id=? AND kind=? ORDER BY id").iterate(projectId, kind) as Iterable<{ id: string; body: string }>;
        for (const row of originals) {
          invariant(fences.length < 1000000, "RECOVERY_LIMIT", "Too many authority records for one restoration");
          fences.push({ id: recoveryFenceId(origin.restoreId, projectId, kind, row.id), projectId, restoreId: origin.restoreId,
            version: 1, kind, recordId: row.id, originalBodySha256: recoveryBodyHash(row.body), originalBody: kind === "director_turn" ? row.body : null });
        }
      }
    }
    invariant(fences.length <= 1000000, "RECOVERY_LIMIT", "Too many authority records for one restoration");
    const receipt: RecoveryReceipt = { ...origin, version: 1, generation: (rows.at(-1)?.generation ?? 0) + 1, projectIds, fenceDigest: fenceDigest(fences) };
    store.insertInstallationRecovery(receipt);
    for (const fence of fences) store.insert("installation_recovery_fence", fence.id, fence.projectId, fence);
    for (const projectId of projectIds) {
      store.put("execution_control", projectId, projectId, { paused: true, authorityId: origin.restoreId });
      for (const epoch of store.list<{ id: string; state: string }>("epoch", projectId)) if (epoch.state !== "revoked") store.put("epoch", epoch.id, projectId, { ...epoch, state: "revoked" });
      for (const turn of store.list<{ id: string; state: string }>("director_turn", projectId)) if (turn.state === "queued" || turn.state === "running")
        store.put("director_turn", turn.id, projectId, { ...turn, state: turn.state === "queued" ? "interrupted" : "unknown", leaseExpiresAt: 0,
          errorCode: turn.state === "queued" ? "RESTORED_REQUEST_REQUIRES_NEW" : "RESTORED_OWNER_LOST", updatedAt: origin.restoredAt });
      store.appendEvent(projectId, "installation.restored", { restoreId: origin.restoreId, generation: receipt.generation, paused: true });
    }
    new InstallationRecoveryGuard(store).snapshot(); return receipt;
  });
}

/** Authenticated local human handler only; this is not an agent tool or a project request. */
export function releaseRecovery(store: Store, input: RecoveryReleaseInput, authority: { principalId: string; commandId: string }): RecoveryReleaseReceipt {
  const selected = structuredClone(input), actor = structuredClone(authority); assertRecoveryReleaseInput(selected);
  invariant(actor && Object.keys(actor).length === 2 && [actor.principalId, actor.commandId].every(value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)),
    "RECOVERY_INVALID", "Recovery release requires a dedicated human command");
  return store.transaction(() => {
    const current = store.installationRecoveries().at(-1);
    invariant(current?.receipt.restoreId === selected.restoreId, "RECOVERY_CONFLICT", "This restoration is no longer current");
    if (current.release) {
      const saved = current.release;
      invariant(saved.commandId === actor.commandId && saved.principalId === actor.principalId && saved.expectedReceiptDigest === selected.expectedReceiptDigest
        && saved.expectedSummaryDigest === selected.expectedSummaryDigest, "RECOVERY_ALREADY_RELEASED", "This recovery already has another human release");
      return saved;
    }
    const snapshot = new InstallationRecoveryGuard(store).snapshot();
    invariant(snapshot.receiptDigest === selected.expectedReceiptDigest && snapshot.summaryDigest === selected.expectedSummaryDigest,
      "RECOVERY_CONFLICT", "Recovery review changed; inspect it again before release");
    const receipt: RecoveryReleaseReceipt = { ...selected, ...actor, version: 1, releasedAt: new Date().toISOString() };
    store.releaseInstallationRecovery(receipt);
    for (const projectId of current.receipt.projectIds) store.appendEvent(projectId, "installation.recovery_released", { restoreId: selected.restoreId });
    return receipt;
  });
}
