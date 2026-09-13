import { canonical, digest, DomainError, invariant, parseToolArguments, toolCatalog } from "@openslate/core";
import type { ActorContext, JsonValue, ToolName, ToolContractVersion } from "@openslate/core";
import type { SkillCapabilityLock } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { NarrationService } from "../narration/service.js";
import type { NarrationSnapshot, ReviseSegments } from "../narration/types.js";

export const TOOL_RESULT_MAX_BYTES = 1024 * 1024;
export interface ToolInvocation {
  id: string;
  projectId: string;
  requestId: string;
  epochId: string;
  callId: string;
  tool: ToolName;
  /** Absent on legacy V1 receipts only. An epoch's selection can never change. */
  toolContractVersion?: ToolContractVersion;
  catalogDigest?: string;
  skillLockId?: string | null;
  argumentsDigest: string;
  state: "started" | "succeeded" | "failed" | "unresolved";
  result: JsonValue | null;
  resultDigest: string | null;
  error: { code: string; message: string } | null;
  /** Minimal domain correlation; credentials and full context never belong here. */
  recovery?: { preparedId?: string; proposalDigest?: string; narrationCommand?: { key: string; digest: string } };
}

/** Full text and media descriptors stay in domain storage and paged context, never this receipt. */
function narrationReceipt(snapshot: NarrationSnapshot) {
  const { state, readiness } = snapshot;
  return { version: state.version, revisionId: state.revisionId, canonicalApplied: false,
    segments: state.entries.map(entry => ({ segmentId: entry.segmentId, segmentRevisionId: entry.segmentRevisionId })),
    readiness: { text: readiness.text, audio: readiness.audio, timing: readiness.timing,
      gapCounts: Object.fromEntries([...new Set(readiness.gaps.map(gap => gap.category))].map(category => [category, readiness.gaps.filter(gap => gap.category === category).length])) },
    next: "Read narration context; human review accepts exact script, recording and timing. No canonical state, grants or holds changed." };
}

/** Transport receipts supplement, but never replace, domain command/grant deduplication. */
export class ToolInvocationService {
  readonly narration: NarrationService;
  constructor(readonly service: ProductionService) { this.narration = new NarrationService(service); }

  private catalog(projectId: string, actor: ActorContext) {
    invariant(actor.kind === "director", "ACTOR_DENIED", "A director epoch is required");
    const binding = this.service.store.get<{ projectId: string; requestId: string; lockId: string }>("director_epoch_lock", actor.epochId);
    // Earlier tool integrations did not persist a skill activation. They retain V1 only.
    if (!binding) return { catalog: toolCatalog("1.0.0"), lockId: null };
    invariant(binding.projectId === projectId && binding.requestId === actor.requestId, "CAPABILITY_MISMATCH", "Tool epoch lock belongs to different work");
    const record = this.service.store.get<{ projectId: string; lock: SkillCapabilityLock }>("director_skill_lock", binding.lockId);
    invariant(record?.projectId === projectId && record.lock.id === binding.lockId, "CAPABILITY_MISMATCH", "Tool skill lock is missing or belongs to another project");
    const { lockDigest, ...body } = record.lock;
    invariant(digest(body) === lockDigest, "CAPABILITY_MISMATCH", "Tool skill lock content changed");
    const catalog = toolCatalog(record.lock.compatibility.toolContract);
    invariant(record.lock.bindings.some(handler => handler.kind === "handler" && handler.id === (catalog.version === "1.0.0" ? "five-tools@1" : "director-tools@2") && handler.digest === catalog.digest),
      "CAPABILITY_MISMATCH", "Tool implementation differs from its immutable lock");
    return { catalog, lockId: binding.lockId };
  }

  async invoke(projectId: string, actor: ActorContext, callId: string, tool: string, input: unknown): Promise<JsonValue> {
    this.service.recovery.assertWritable(projectId, actor.requestId);
    invariant(actor.kind === "director", "ACTOR_DENIED", "Tool transport requires a director epoch");
    this.service.assertActor(projectId, actor);
    invariant(/^[A-Za-z0-9_-]{1,160}$/.test(callId), "VALIDATION_ERROR", "Invalid tool call identity");
    const selected = this.catalog(projectId, actor);
    const parsed = parseToolArguments(tool, input, selected.catalog.version);
    const argumentHash = digest(parsed.arguments);
    const id = digest({ projectId, epochId: actor.epochId, callId });
    const store = this.service.store;
    const existing = store.transaction(() => {
      this.service.assertActor(projectId, actor);
      invariant(canonical(this.catalog(projectId, actor)) === canonical(selected), "CAPABILITY_MISMATCH", "Tool catalog changed before invocation");
      const previous = store.get<ToolInvocation>("tool_invocation", id);
      if (previous) {
        invariant(previous.argumentsDigest === argumentHash && previous.tool === parsed.name && previous.requestId === actor.requestId,
          "IDEMPOTENCY_CONFLICT", "Tool call identity was already used for different work");
        invariant((previous.toolContractVersion ?? "1.0.0") === selected.catalog.version &&
          (!previous.catalogDigest || previous.catalogDigest === selected.catalog.digest) &&
          (previous.skillLockId === undefined || previous.skillLockId === selected.lockId), "CAPABILITY_MISMATCH", "Receipt belongs to another tool contract");
        return previous;
      }
      const record: ToolInvocation = { id, projectId, requestId: actor.requestId, epochId: actor.epochId, callId,
        tool: parsed.name, toolContractVersion: selected.catalog.version, catalogDigest: selected.catalog.digest, skillLockId: selected.lockId,
        argumentsDigest: argumentHash, state: "started", result: null, resultDigest: null, error: null,
        recovery: parsed.name === "apply_change" ? { preparedId: parsed.arguments.preparedId as string }
          : parsed.name === "prepare_change" ? { proposalDigest: digest(parsed.arguments) }
          : parsed.name === "revise_narration_draft" ? { narrationCommand: { key: `director-tool:${id}`,
            digest: digest({ action: "revise", expectedVersion: parsed.arguments.expectedVersion, arguments: parsed.arguments.patch }) } } : {} };
      store.insert("tool_invocation", id, projectId, record);
      store.appendEvent(projectId, "tool.started", { invocationId: id, callId, requestId: actor.requestId, tool: parsed.name });
      return null;
    });
    if (existing) {
      if (existing.state === "succeeded") return existing.result;
      if (existing.state === "failed" && existing.error) throw new DomainError(existing.error.code, existing.error.message);
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Earlier tool work may have taken effect; reconcile application receipts before continuing");
    }

    let value: unknown;
    try {
      switch (parsed.name) {
        case "read_context": value = this.service.readContext(projectId, actor, parsed.arguments); break;
        case "prepare_change": {
          const prepared = await this.service.prepare(projectId, actor, parsed.arguments);
          // Full source, next project and compiled graph stay in the durable proposal.
          // A usable prepared ID must not be lost because these repeat megabytes of input.
          value = { id: prepared.id, preparedId: prepared.id, proposalDigest: prepared.proposalDigest,
            baseVersion: prepared.baseVersion, semanticChange: prepared.semanticChange,
            graphDigest: prepared.compiled?.graphDigest ?? null,
            impactCounts: Object.fromEntries(["reuse", "replace", "new", "retire"].map(kind => [kind, prepared.impact.filter(item => item.kind === kind).length])),
            stageCount: prepared.stages.length };
          break;
        }
        case "apply_change": value = this.service.apply(projectId, actor, parsed.arguments.preparedId as string); break;
        case "inspect_artifact": value = this.service.inspectArtifact(projectId, actor, parsed.arguments.artifactId as string); break;
        case "control_execution": value = this.service.holdRequest(projectId, actor); break;
        case "revise_narration_draft": value = narrationReceipt(this.narration.reviseSegments(projectId, actor,
          parsed.arguments.expectedVersion as number, `director-tool:${id}`, parsed.arguments.patch as unknown as ReviseSegments)); break;
      }
    } catch (error) {
      // A rejected proposal can still have created a hold. "failed" means a known error,
      // not proof that the application had no effects. Unexpected failures stay unresolved.
      const known = error instanceof DomainError;
      this.finish(id, projectId, known ? "failed" : "unresolved", null,
        known ? { code: error.code, message: error.message.slice(0, 2000) } : { code: "TOOL_CALL_UNRESOLVED", message: "Tool outcome needs application reconciliation" });
      if (known) throw error;
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Tool outcome needs application reconciliation");
    }
    try {
      const encoded = canonical(value);
      invariant(Buffer.byteLength(encoded) <= TOOL_RESULT_MAX_BYTES, "TOOL_RESULT_TOO_LARGE", "Tool result exceeds the transport receipt limit");
      const result = JSON.parse(encoded) as JsonValue;
      this.finish(id, projectId, "succeeded", result, null);
      return result;
    } catch {
      // The domain command may already have committed. Never automatically replay it.
      this.finish(id, projectId, "unresolved", null, { code: "TOOL_CALL_UNRESOLVED", message: "Result could not be recorded; reconcile domain receipts" });
      throw new DomainError("TOOL_CALL_UNRESOLVED", "Result could not be recorded; reconcile domain receipts");
    }
  }

  /** Recover only from authoritative application receipts. This never calls a tool again. */
  reconcileEpoch(projectId: string, epochId: string): void {
    const store = this.service.store;
    store.transaction(() => {
      const epoch = store.get<{ projectId: string; state: string; principalId: string; requestId: string }>("epoch", epochId);
      invariant(epoch?.projectId === projectId && epoch.state === "revoked", "ACTOR_DENIED", "Reconciliation requires a fenced epoch");
      for (const call of store.list<ToolInvocation>("tool_invocation", projectId).filter(call => call.epochId === epochId && ["started", "unresolved"].includes(call.state))) {
        if (store.get("tool_reconciliation", call.id)) continue;
        let receipt: unknown = null;
        if (call.tool === "apply_change" && call.recovery?.preparedId) {
          const prepared = store.get<{ projectId: string; requestId: string; epochId: string; proposalDigest: string }>("prepared", call.recovery.preparedId);
          if (prepared?.projectId === projectId && prepared.requestId === call.requestId && prepared.epochId === epochId) {
            const row = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?")
              .get(`${epoch.principalId}:${projectId}:apply`, call.recovery.preparedId, prepared.proposalDigest) as { result: string } | undefined;
            if (row) receipt = JSON.parse(row.result);
          }
        }
        if (call.tool === "prepare_change" && call.recovery?.proposalDigest) {
          const prepared = store.list<{ id: string; requestId: string; epochId: string; proposalDigest: string }>("prepared", projectId)
            .find(row => row.requestId === call.requestId && row.epochId === epochId && row.proposalDigest === call.recovery!.proposalDigest);
          if (prepared) receipt = { preparedId: prepared.id, proposalDigest: prepared.proposalDigest };
        }
        if (call.tool === "revise_narration_draft" && call.toolContractVersion === "2.0.0" && call.recovery?.narrationCommand) {
          const command = call.recovery.narrationCommand;
          if (command.key === `director-tool:${call.id}`) {
            const row = store.db.prepare("SELECT result FROM commands WHERE actor_scope=? AND key=? AND digest=?")
              .get(`${epoch.principalId}:${projectId}:${call.requestId}:narration`, command.key, command.digest) as { result: string } | undefined;
            if (row) {
              const snapshot = JSON.parse(row.result) as NarrationSnapshot;
              if (snapshot.state.projectId === projectId) receipt = narrationReceipt(snapshot);
            }
          }
        }
        if (call.state === "started") this.finish(call.id, projectId, "unresolved", null, { code: "TOOL_CALL_UNRESOLVED", message: "Owning turn ended before its tool result was recorded" });
        store.insert("tool_reconciliation", call.id, projectId, { id: call.id, requestId: call.requestId, epochId,
          state: receipt ? "effect_confirmed" : "needs_followup", receipt, receiptDigest: receipt ? digest(receipt) : null });
        store.appendEvent(projectId, "tool.reconciled", { invocationId: call.id, requestId: call.requestId, effectConfirmed: !!receipt });
      }
    });
  }

  private finish(id: string, projectId: string, state: ToolInvocation["state"], result: JsonValue | null, error: ToolInvocation["error"]): void {
    this.service.store.transaction(() => {
      const previous = this.service.store.get<ToolInvocation>("tool_invocation", id);
      invariant(previous && previous.state === "started", "TOOL_CALL_UNRESOLVED", "Tool record cannot be completed twice");
      this.service.store.put("tool_invocation", id, projectId, { ...previous, state, result, resultDigest: state === "succeeded" ? digest(result) : null, error });
      this.service.store.appendEvent(projectId, "tool.finished", { invocationId: id, callId: previous.callId, requestId: previous.requestId, tool: previous.tool, state });
    });
  }
}
