import { digest, invariant } from "@openslate/core";
import type { SkillCapabilityLock } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { createDirectorSkillLock } from "./director-capabilities.js";
import type { DirectorSkillConfiguration } from "./director-capabilities.js";

export interface DirectorToolsUpgrade {
  expectedLockId: string;
  expectedLockDigest: string;
  targetVersion: "2.0.0";
}
interface UpgradeReceipt { lockId: string; previousLockId: string; toolContract: "2.0.0" }

/** Authenticated local configuration only; never registered as a model tool. */
export class DirectorToolSettings {
  constructor(readonly service: ProductionService, readonly configuration: (projectId: string) => DirectorSkillConfiguration,
    readonly configuring: (projectId: string) => boolean = () => false) {}

  private latest(projectId: string) {
    this.service.store.getProject(projectId);
    return this.service.store.list<{ id: string; lock: SkillCapabilityLock }>("director_skill_lock", projectId).at(-1);
  }
  private busy(projectId: string): boolean {
    return this.configuring(projectId)
      || this.service.store.list<{ state: string }>("director_turn", projectId).some(turn => ["queued", "running"].includes(turn.state))
      || this.service.store.list<{ state: string }>("epoch", projectId).some(epoch => epoch.state !== "revoked");
  }
  status(projectId: string) {
    const saved = this.latest(projectId);
    return { currentVersion: saved?.lock.compatibility.toolContract ?? "2.0.0", lockId: saved?.id ?? null,
      lockDigest: saved?.lock.lockDigest ?? null, availableVersion: "2.0.0" as const,
      upgradeAvailable: saved?.lock.compatibility.toolContract === "1.0.0", busy: this.busy(projectId) };
  }

  upgrade(projectId: string, input: DirectorToolsUpgrade, key: string) {
    this.service.recovery.assertWritable(projectId);
    invariant(input && Object.keys(input).every(field => ["expectedLockId", "expectedLockDigest", "targetVersion"].includes(field))
      && typeof input.expectedLockId === "string" && input.expectedLockId.length > 0 && input.expectedLockId.length <= 160
      && typeof input.expectedLockDigest === "string" && /^[a-f0-9]{64}$/.test(input.expectedLockDigest)
      && input.targetVersion === "2.0.0", "VALIDATION_ERROR", "Choose the displayed narration tools update");
    invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Use one update command identity");
    const payload = structuredClone(input), requestDigest = digest(payload), store = this.service.store;
    const scope = `local-user:${projectId}:director-tools-upgrade`;
    // Read a completed command before accessing current package files or predecessor state.
    // A lost reply can recover the receipt even after the project's configuration has advanced.
    const previous = store.db.prepare("SELECT digest,result FROM commands WHERE actor_scope=? AND key=?").get(scope, key) as { digest: string; result: string } | undefined;
    if (previous) {
      invariant(previous.digest === requestDigest, "IDEMPOTENCY_CONFLICT", "Update command identity was used with other inputs");
      return this.response(projectId, JSON.parse(previous.result) as UpgradeReceipt);
    }
    const check = () => {
      const current = this.latest(projectId);
      invariant(current?.id === payload.expectedLockId && current.lock.lockDigest === payload.expectedLockDigest
        && current.lock.compatibility.toolContract === "1.0.0", "DIRECTOR_TOOLS_STALE", "The project's saved tools changed; reload before updating");
      invariant(!this.busy(projectId), "DIRECTOR_TOOLS_BUSY", "Wait for the current conversation and setup to finish before updating tools");
    };
    check();
    const configuration = this.configuration(projectId), configurationDigest = digest(configuration);
    // Verify and snapshot shipped packages outside the write transaction.
    const { lock } = createDirectorSkillLock(configuration, "2.0.0");
    const receipt = store.command(scope, key, requestDigest, (): UpgradeReceipt => {
      check();
      invariant(digest(this.configuration(projectId)) === configurationDigest, "DIRECTOR_TOOLS_STALE", "The local runtime changed while tools were verified");
      store.insert("director_skill_lock", lock.id, projectId, { id: lock.id, projectId, lock });
      store.appendEvent(projectId, "director.lock_installed", { lockId: lock.id, lockDigest: lock.lockDigest,
        previousLockId: payload.expectedLockId, source: "local_user_upgrade", principalId: "local-user" });
      return { lockId: lock.id, previousLockId: payload.expectedLockId, toolContract: "2.0.0" };
    });
    return this.response(projectId, receipt);
  }
  private response(projectId: string, receipt: UpgradeReceipt) {
    const status = this.status(projectId);
    return { ...status, receipt, selectionMatchesCommand: status.lockId === receipt.lockId };
  }
}
