import { canonical, digest, DomainError, invariant, parseToolArguments } from "@openslate/core";
import type { ActorContext, JsonValue, ToolName } from "@openslate/core";
import type { ProductionService } from "./service.js";

export const TOOL_RESULT_MAX_BYTES = 1024 * 1024;
export interface ToolInvocation {
  id: string;
  projectId: string;
  requestId: string;
  epochId: string;
  callId: string;
  tool: ToolName;
  argumentsDigest: string;
  state: "started" | "succeeded" | "failed" | "unresolved";
  result: JsonValue | null;
  resultDigest: string | null;
  error: { code: string; message: string } | null;
  /** Minimal domain correlation; credentials and full context never belong here. */
  recovery?: { preparedId?: string; proposalDigest?: string };
}

/** Transport receipts supplement, but never replace, domain command/grant deduplication. */
export class ToolInvocationService {
  constructor(readonly service: ProductionService) {}

  async invoke(projectId: string, actor: ActorContext, callId: string, tool: string, input: unknown): Promise<JsonValue> {
    invariant(actor.kind === "director", "ACTOR_DENIED", "Tool transport requires a director epoch");
    this.service.assertActor(projectId, actor);
    invariant(/^[A-Za-z0-9_-]{1,160}$/.test(callId), "VALIDATION_ERROR", "Invalid tool call identity");
    const parsed = parseToolArguments(tool, input);
    const argumentHash = digest(parsed.arguments);
    const id = digest({ projectId, epochId: actor.epochId, callId });
    const store = this.service.store;
    const existing = store.transaction(() => {
      this.service.assertActor(projectId, actor);
      const previous = store.get<ToolInvocation>("tool_invocation", id);
      if (previous) {
        invariant(previous.argumentsDigest === argumentHash && previous.tool === parsed.name && previous.requestId === actor.requestId,
          "IDEMPOTENCY_CONFLICT", "Tool call identity was already used for different work");
        return previous;
      }
      const record: ToolInvocation = { id, projectId, requestId: actor.requestId, epochId: actor.epochId, callId,
        tool: parsed.name, argumentsDigest: argumentHash, state: "started", result: null, resultDigest: null, error: null,
        recovery: parsed.name === "apply_change" ? { preparedId: parsed.arguments.preparedId as string }
          : parsed.name === "prepare_change" ? { proposalDigest: digest(parsed.arguments) } : {} };
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
