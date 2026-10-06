import { canonical, digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext, ToolContractVersion } from "@openslate/core";
import { verifySkillLock } from "@openslate/director";
import type { SkillCapabilityLock } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { createDirectorSkillLock } from "./director-capabilities.js";
import type { DirectorSkillConfiguration } from "./director-capabilities.js";

export interface DirectorToolsUpgrade {
  expectedLockId: string;
  expectedLockDigest: string;
  targetVersion: "2.0.0" | "3.0.0" | "4.0.0";
}
interface UpgradeReceipt { lockId: string; previousLockId: string; toolContract: "2.0.0" | "3.0.0" | "4.0.0" }

const upgradeTargets: Readonly<Record<string, readonly string[]>> = { "1.0.0": ["2.0.0", "3.0.0", "4.0.0"], "2.0.0": ["3.0.0", "4.0.0"], "3.0.0": ["4.0.0"], "4.0.0": [] };

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
    return { currentVersion: saved?.lock.compatibility.toolContract ?? "4.0.0", lockId: saved?.id ?? null,
      lockDigest: saved?.lock.lockDigest ?? null, availableVersion: "4.0.0" as const,
      upgradeAvailable: !!saved && ["1.0.0", "2.0.0", "3.0.0"].includes(saved.lock.compatibility.toolContract), busy: this.busy(projectId) };
  }

  /** Application maintenance at the first input of a new native turn, never a model tool. */
  currentForFreshTurn(projectId: string, actor: ActorContext, turnId: string): SkillCapabilityLock | undefined {
    const store = this.service.store;
    invariant(actor.kind === "director", "ACTOR_DENIED", "Director guidance requires an application-owned epoch");
    this.service.recovery.assertWritable(projectId, actor.requestId);
    this.service.assertActor(projectId, actor);
    const binding = store.get<{ projectId: string; requestId: string; lockId: string }>("director_epoch_lock", actor.epochId);
    if (binding) {
      invariant(binding.projectId === projectId && binding.requestId === actor.requestId, "CAPABILITY_MISMATCH", "Director epoch belongs to different work");
      const pinned = store.get<{ projectId: string; lock: SkillCapabilityLock }>("director_skill_lock", binding.lockId);
      invariant(pinned?.projectId === projectId, "CAPABILITY_MISMATCH", "Pinned director guidance is missing");
      return pinned.lock;
    }
    const saved = this.latest(projectId);
    if (!saved) return undefined;
    const fresh = () => {
      this.service.recovery.assertWritable(projectId, actor.requestId);
      this.service.recovery.assertFreshAuthority(projectId, "director_turn", turnId);
      this.service.assertActor(projectId, actor);
      const turn = store.get<{ projectId: string; requestId: string; epochId: string; runtimeId: string; state: string; dispatched: boolean; nativeThreadId: string | null; nativeTurnId: string | null }>("director_turn", turnId);
      invariant(turn?.projectId === projectId && turn.requestId === actor.requestId && turn.epochId === actor.epochId
        && turn.runtimeId === "codex-app-server" && turn.state === "running" && turn.dispatched === false && turn.nativeThreadId === null && turn.nativeTurnId === null
        && !store.get("director_epoch_lock", actor.epochId) && !store.get("native_model_start", turnId)
        && !store.db.prepare("SELECT 1 FROM entities WHERE project_id=? AND kind IN ('tool_invocation','prepared','director_context','skill_activation') AND json_extract(body,'$.epochId')=? LIMIT 1").get(projectId, actor.epochId),
        "DIRECTOR_GUIDANCE_IN_FLIGHT", "This conversation already began with its saved Director guidance. Send a new message to use the current application.");
      invariant(!this.configuring(projectId)
        && !store.db.prepare("SELECT 1 FROM entities WHERE kind='epoch' AND project_id=? AND id!=? AND json_extract(body,'$.state')!='revoked' LIMIT 1").get(projectId, actor.epochId),
        "DIRECTOR_TOOLS_BUSY", "Wait for the current conversation or setup to finish, then send a new message.");
      invariant(canonical(this.latest(projectId)) === canonical(saved), "DIRECTOR_TOOLS_STALE", "Director guidance changed while the new conversation was being prepared. Send a new message.");
    };
    fresh();
    const configuration = this.configuration(projectId), configurationDigest = digest(configuration);
    let successor: SkillCapabilityLock;
    try {
      invariant(["1.0.0", "2.0.0", "3.0.0", "4.0.0"].includes(saved.lock.compatibility.toolContract), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Unsupported Director guidance");
      const guidanceVersion = saved.lock.skills.find(skill => skill.id === "production")?.version.split(".")[0];
      const shipped = createDirectorSkillLock(configuration, saved.lock.compatibility.toolContract as ToolContractVersion, guidanceVersion);
      verifySkillLock(saved.lock, shipped.environment);
      // UUIDs differ per project. Every package, prompt and implementation binding must match the shipped predecessor.
      const content = ({ id: _id, lockDigest: _digest, ...body }: SkillCapabilityLock) => body;
      invariant(saved.id === saved.lock.id && canonical(content(saved.lock)) === canonical(content(shipped.lock)), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Customized Director guidance");
      successor = saved.lock.compatibility.toolContract === "4.0.0" && guidanceVersion === "5" ? saved.lock : createDirectorSkillLock(configuration, "4.0.0").lock;
    } catch (error) {
      throw new DomainError("DIRECTOR_GUIDANCE_UNSUPPORTED", "OpenSlate cannot safely load this project's customized or unavailable Director guidance. Saved work is retained. Restore the matching application files, then send a new message.",
        { cause: error instanceof DomainError ? error.code : "GUIDANCE_VERIFICATION_FAILED" });
    }
    fresh();
    invariant(digest(this.configuration(projectId)) === configurationDigest, "DIRECTOR_TOOLS_STALE", "Director setup changed while the new conversation was being prepared. Send a new message.");
    if (successor === saved.lock) return successor;
    const input = { requestId: actor.requestId, epochId: actor.epochId, turnId, previousLockId: saved.id,
      previousLockDigest: saved.lock.lockDigest, configurationDigest, targetVersion: "4.0.0" };
    const receipt = store.command(`application:${projectId}:director-guidance`, actor.epochId, digest(input), () => {
      fresh();
      invariant(digest(this.configuration(projectId)) === configurationDigest, "DIRECTOR_TOOLS_STALE", "Director setup changed while the new conversation was being prepared. Send a new message.");
      store.insert("director_skill_lock", successor.id, projectId, { id: successor.id, projectId, lock: successor });
      store.appendEvent(projectId, "director.lock_installed", { lockId: successor.id, lockDigest: successor.lockDigest,
        previousLockId: saved.id, source: "application_compatible_upgrade", requestId: actor.requestId, epochId: actor.epochId, turnId });
      return { lockId: successor.id };
    });
    return store.get<{ lock: SkillCapabilityLock }>("director_skill_lock", receipt.lockId)!.lock;
  }

  upgrade(projectId: string, input: DirectorToolsUpgrade, key: string) {
    this.service.recovery.assertWritable(projectId);
    invariant(input && Object.keys(input).every(field => ["expectedLockId", "expectedLockDigest", "targetVersion"].includes(field))
      && typeof input.expectedLockId === "string" && input.expectedLockId.length > 0 && input.expectedLockId.length <= 160
      && typeof input.expectedLockDigest === "string" && /^[a-f0-9]{64}$/.test(input.expectedLockDigest)
      && ["2.0.0", "3.0.0", "4.0.0"].includes(input.targetVersion), "VALIDATION_ERROR", "Choose the displayed narration tools update");
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
        && upgradeTargets[current.lock.compatibility.toolContract]?.includes(payload.targetVersion), "DIRECTOR_TOOLS_STALE", "The project's saved tools changed; reload before updating");
      invariant(!this.busy(projectId), "DIRECTOR_TOOLS_BUSY", "Wait for the current conversation and setup to finish before updating tools");
    };
    check();
    const configuration = this.configuration(projectId), configurationDigest = digest(configuration);
    // Verify and snapshot shipped packages outside the write transaction.
    const { lock } = createDirectorSkillLock(configuration, payload.targetVersion);
    const receipt = store.command(scope, key, requestDigest, (): UpgradeReceipt => {
      check();
      invariant(digest(this.configuration(projectId)) === configurationDigest, "DIRECTOR_TOOLS_STALE", "The local runtime changed while tools were verified");
      store.insert("director_skill_lock", lock.id, projectId, { id: lock.id, projectId, lock });
      store.appendEvent(projectId, "director.lock_installed", { lockId: lock.id, lockDigest: lock.lockDigest,
        previousLockId: payload.expectedLockId, source: "local_user_upgrade", principalId: "local-user" });
      return { lockId: lock.id, previousLockId: payload.expectedLockId, toolContract: payload.targetVersion };
    });
    return this.response(projectId, receipt);
  }
  private response(projectId: string, receipt: UpgradeReceipt) {
    const status = this.status(projectId);
    return { ...status, receipt, selectionMatchesCommand: status.lockId === receipt.lockId };
  }
}
