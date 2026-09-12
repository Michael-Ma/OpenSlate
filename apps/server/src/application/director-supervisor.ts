import { canonical, digest, invariant, newId } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { DirectorRunInput, DirectorRunResult, DirectorRuntime, DirectorRuntimeEvent } from "@openslate/director";
import type { ProductionService } from "./service.js";
import { ToolInvocationService } from "./tool-invocations.js";
import { directorInputDigest } from "./director-input-identity.js";

export type TurnState = "queued" | "running" | "completed" | "waiting_user" | "interrupted" | "unknown" | "failed";
export interface DirectorTurn {
  id: string; projectId: string; requestId: string; runtimeId: string; state: TurnState;
  createdAt: string; updatedAt: string; owner: string | null; leaseExpiresAt: number;
  epochId: string | null; nativeThreadId: string | null; nativeTurnId: string | null;
  dispatched: boolean; errorCode: string | null;
}
interface Request { id: string; projectId: string; principalId: string; text: string; state: string; editing: boolean }
interface Epoch { id: string; projectId: string; requestId: string; principalId: string; state: string }
export interface DirectorOutput { id: string; projectId: string; requestId: string; turnId: string; text: string; phase: string }
export interface SupervisorOptions {
  mode: "fake" | "native";
  /** Local controllers may share one store while owning disjoint project sets. */
  projectFilter?: (projectId: string) => boolean;
  prepareInput?: (turn: DirectorTurn, human: ActorContext, bridge: { actor: ActorContext; token: string }, preparation?: { signal: AbortSignal }) => Promise<DirectorRunInput> | DirectorRunInput;
  now?: () => number; leaseMs?: number; owner?: string;
}

/** Durable dispatch is application-owned. Unknown turns are never automatically submitted again. */
export class DirectorSupervisor {
  readonly owner: string;
  readonly leaseMs: number;
  private readonly now: () => number;
  private readonly active = new Map<string, { turnId: string; abort: AbortController; done: Promise<void> }>();
  private closed = false;
  constructor(readonly service: ProductionService, readonly runtime: DirectorRuntime, readonly options: SupervisorOptions) {
    this.owner = options.owner ?? newId(); this.leaseMs = options.leaseMs ?? 30_000; this.now = options.now ?? Date.now;
    invariant(this.leaseMs >= 100 && this.leaseMs <= 300_000, "CONFIGURATION_ERROR", "Invalid director lease duration");
  }

  enqueue(projectId: string, human: ActorContext): DirectorTurn {
    invariant(!this.closed && human.kind === "human", "ACTOR_DENIED", "Only an active human channel can queue a director request");
    this.service.assertActor(projectId, human);
    return this.service.store.transaction(() => {
      const existing = this.turns(projectId).find(turn => turn.requestId === human.requestId);
      if (existing) return existing;
      const timestamp = new Date(this.now()).toISOString();
      const turn: DirectorTurn = { id: newId(), projectId, requestId: human.requestId, runtimeId: this.runtime.id, state: "queued",
        createdAt: timestamp, updatedAt: timestamp, owner: null, leaseExpiresAt: 0, epochId: null,
        nativeThreadId: null, nativeTurnId: null, dispatched: false, errorCode: null };
      this.service.store.insert("director_turn", turn.id, projectId, turn);
      this.service.store.appendEvent(projectId, "director.queued", { turnId: turn.id, requestId: human.requestId });
      return turn;
    });
  }

  turns(projectId: string): DirectorTurn[] { return this.service.store.list<DirectorTurn>("director_turn", projectId); }
  answerQuestion(projectId: string, principalId: string, questionId: string, text: string, key: string): ActorContext {
    return this.service.store.command(`${principalId}:${projectId}:question`, key, digest({ questionId, text }), () => {
      const question = this.service.store.get<{ id: string; projectId: string; requestId: string; state: string }>("director_question", questionId);
      invariant(question?.projectId === projectId && question.state === "pending", "QUESTION_STALE", "This question is no longer waiting for a reply");
      const original = this.service.store.get<Request & { scopeIds: string[] }>("message", question.requestId);
      invariant(original?.principalId === principalId && original.state === "active", "QUESTION_STALE", "A newer request has replaced this question");
      const actor = this.service.beginRequest(projectId, principalId, text, { scopeIds: original.scopeIds,
        editing: original.editing, ...(original.editing ? { continuationRequestId: original.id } : {}), contextDigest: digest({ questionId }), key: `question:${key}` });
      this.service.store.put("director_question", question.id, projectId, { ...question, state: "answered", answerRequestId: actor.requestId, answer: text });
      this.service.store.appendEvent(projectId, "director.question_answered", { questionId, requestId: actor.requestId });
      this.enqueue(projectId, actor);
      return actor;
    });
  }
  status(projectId: string) {
    const turns = this.turns(projectId), current = turns.find(turn => turn.state === "running") ?? turns.find(turn => turn.state === "queued") ?? turns.at(-1);
    const status = !current ? "idle" : ["running", "queued"].includes(current.state) ? "running"
      : current.state === "waiting_user" ? "waiting_user" : ["failed", "unknown"].includes(current.state) ? "error" : "idle";
    return { mode: this.options.mode, status, activeRequestId: current?.requestId ?? null, turn: current ?? null,
      message: current?.state === "unknown" ? "The previous turn ended without a confirmed result. Saved changes are retained; send a follow-up to continue." : null };
  }

  private revoke(turn: DirectorTurn) {
    if (!turn.epochId) return;
    const epoch = this.service.store.get<Epoch>("epoch", turn.epochId);
    if (epoch && epoch.state !== "revoked") this.service.store.put("epoch", epoch.id, turn.projectId, { ...epoch, state: "revoked" });
  }
  private save(turn: DirectorTurn): DirectorTurn {
    return this.service.store.put("director_turn", turn.id, turn.projectId, { ...turn, updatedAt: new Date(this.now()).toISOString() });
  }
  private terminal(turn: DirectorTurn, state: TurnState, errorCode: string | null = null) {
    this.revoke(turn);
    this.save({ ...turn, state, errorCode, leaseExpiresAt: 0 });
    this.service.store.appendEvent(turn.projectId, "director.finished", { turnId: turn.id, requestId: turn.requestId, state, errorCode });
  }

  /** Called on startup and periodically. A foreign owner retains its lease until expiry. */
  tick(): void {
    if (this.closed) return;
    for (const project of this.service.store.listProjects()) {
      if (this.options.projectFilter && !this.options.projectFilter(project.id)) continue;
      this.service.store.transaction(() => {
        const paused = this.service.store.get<{ paused: boolean }>("execution_control", project.id)?.paused;
        for (const turn of this.turns(project.id)) {
          const request = this.service.store.get<Request>("message", turn.requestId)!;
          if (turn.state === "queued" && request.state === "superseded") this.terminal(turn, "interrupted", "REQUEST_SUPERSEDED");
          if (turn.state !== "running") continue;
          const local = this.active.get(project.id);
          const epoch = turn.epochId ? this.service.store.get<Epoch>("epoch", turn.epochId) : null;
          if (turn.owner === this.owner && local?.turnId === turn.id) {
            if (paused || request.state === "superseded" || epoch?.state === "revoked") {
              this.revoke(turn); local.abort.abort();
            }
            this.save({ ...turn, leaseExpiresAt: this.now() + this.leaseMs });
          } else if (turn.leaseExpiresAt <= this.now()) {
            this.terminal(turn, "unknown", "OWNER_LOST");
            if (turn.epochId) new ToolInvocationService(this.service).reconcileEpoch(project.id, turn.epochId);
          }
        }
      });
      if (this.active.has(project.id)) continue;
      const claimed = this.service.store.transaction(() => {
        if (this.service.store.get<{ paused: boolean }>("execution_control", project.id)?.paused) return null;
        const turns = this.turns(project.id);
        if (turns.some(turn => turn.state === "running")) return null;
        const next = turns.find(turn => turn.state === "queued");
        if (!next) return null;
        if (next.runtimeId !== this.runtime.id) { this.terminal(next, "failed", "RUNTIME_MISMATCH"); return null; }
        const claimed = this.save({ ...next, state: "running", owner: this.owner, leaseExpiresAt: this.now() + this.leaseMs });
        this.service.store.appendEvent(project.id, "director.claimed", { turnId: next.id, requestId: next.requestId });
        return claimed;
      });
      if (claimed) {
        const abort = new AbortController();
        // Install the active slot before invoking any injected runtime/user code.
        const active = { turnId: claimed.id, abort, done: Promise.resolve() };
        this.active.set(project.id, active);
        active.done = Promise.resolve().then(() => this.run(claimed, abort)).finally(() => { if (this.active.get(project.id) === active) this.active.delete(project.id); });
      }
    }
  }

  private output(turn: DirectorTurn, text: string, phase: string) {
    invariant(typeof text === "string" && text.length <= 32_000, "DIRECTOR_OUTPUT_LIMIT", "Director response exceeds its limit");
    if (!text.trim()) return;
    const existing = this.service.store.list<DirectorOutput>("director_output", turn.projectId).filter(output => output.turnId === turn.id);
    invariant(existing.length < 100 && existing.reduce((total, output) => total + output.text.length, 0) + text.length <= 128_000, "DIRECTOR_OUTPUT_LIMIT", "Director turn output exceeds its limit");
    if (existing.some(output => output.text === text && output.phase === phase)) return;
    const id = newId();
    this.service.store.insert("director_output", id, turn.projectId, { id, projectId: turn.projectId, requestId: turn.requestId, turnId: turn.id, text, phase });
    this.service.store.appendEvent(turn.projectId, "director.message", { outputId: id, requestId: turn.requestId, turnId: turn.id });
  }

  private async run(claimed: DirectorTurn, abort: AbortController): Promise<void> {
    const { service } = this;
    let pending = false;
    let attempted = false;
    try {
      const request = service.store.get<Request>("message", claimed.requestId)!;
      const human: ActorContext = { kind: "human", principalId: request.principalId, requestId: request.id };
      service.assertActor(claimed.projectId, human, request.editing);
      const bridge = service.store.transaction(() => {
        const bridge = service.openEpoch(claimed.projectId, human);
        invariant(bridge.actor.kind === "director", "ACTOR_DENIED", "A director epoch is required");
        this.save({ ...claimed, epochId: bridge.actor.epochId }); return bridge;
      });
      invariant(bridge.actor.kind === "director", "ACTOR_DENIED", "A director epoch is required");
      const identity = { projectId: claimed.projectId, requestId: claimed.requestId, epochId: bridge.actor.epochId, turnId: claimed.id };
      const input = this.options.prepareInput ? await this.options.prepareInput(this.turns(claimed.projectId).find(turn => turn.id === claimed.id)!, human, bridge, { signal: abort.signal })
        : { ...identity, text: request.text, context: canonical(service.readContext(claimed.projectId, bridge.actor)), skills: [],
          bridge: { endpoint: "http://127.0.0.1:3001", projectId: claimed.projectId, credential: bridge.token, entrypoint: "" } };
      invariant(Object.entries(identity).every(([key, value]) => input[key as keyof typeof identity] === value), "RUNTIME_IDENTITY_MISMATCH", "Runtime input belongs to another request");
      if (abort.signal.aborted) throw new Error("Interrupted before dispatch");
      service.assertActor(claimed.projectId, bridge.actor);
      // Persist intent before the adapter may write turn/start. No credentials are persisted.
      service.store.transaction(() => {
        const turn = service.store.get<DirectorTurn>("director_turn", claimed.id)!;
        invariant(turn.owner === this.owner && turn.state === "running", "DIRECTOR_LEASE_LOST", "Director turn ownership changed");
        this.save({ ...turn, dispatched: true });
        service.store.appendEvent(claimed.projectId, "director.dispatch_intent", { turnId: claimed.id, requestId: claimed.requestId, contextDigest: digest(input.context), inputDigest: directorInputDigest(input) });
      });
      attempted = true;
      const onEvent = (event: DirectorRuntimeEvent) => {
        service.store.transaction(() => {
          invariant(Object.entries(identity).every(([key, value]) => event[key as keyof typeof identity] === value), "RUNTIME_IDENTITY_MISMATCH", "Runtime event belongs to another request");
          const turn = service.store.get<DirectorTurn>("director_turn", claimed.id)!;
          invariant(turn.owner === this.owner && turn.state === "running" && !abort.signal.aborted, "DIRECTOR_LEASE_LOST", "Director turn is no longer active");
          service.assertActor(claimed.projectId, bridge.actor);
          if (event.kind === "runtime_started") this.save({ ...turn, nativeThreadId: event.nativeThreadId });
          if (event.kind === "turn_started") this.save({ ...turn, nativeThreadId: event.nativeThreadId, nativeTurnId: event.nativeTurnId });
          if (event.kind === "assistant_message") this.output(turn, event.text.replaceAll(bridge.token, "[redacted]"), event.phase);
          if (event.kind === "pending_input") {
            invariant(canonical(event.questions).length <= 32_000 && event.questions.length <= 8, "DIRECTOR_OUTPUT_LIMIT", "Too many pending questions");
            pending = true;
            const id = digest({ turnId: turn.id, nativeRequestId: event.nativeRequestId });
            const questions = JSON.parse(canonical(event.questions).replaceAll(bridge.token, "[redacted]"));
            service.store.insert("director_question", id, claimed.projectId, { id, turnId: turn.id, requestId: turn.requestId, questions, state: "pending" });
            service.store.appendEvent(claimed.projectId, "director.question", { questionId: id, requestId: turn.requestId });
          }
        });
      };
      const result: DirectorRunResult = await this.runtime.start(input, { signal: abort.signal, onEvent });
      invariant(Object.entries(identity).every(([key, value]) => result[key as keyof typeof identity] === value), "RUNTIME_IDENTITY_MISMATCH", "Runtime result belongs to another request");
      service.store.transaction(() => {
        const turn = service.store.get<DirectorTurn>("director_turn", claimed.id)!;
        if (turn.state !== "running" || turn.owner !== this.owner) return;
        const stale = abort.signal.aborted || service.store.get<Epoch>("epoch", turn.epochId!)?.state === "revoked";
        if (!stale && result.status === "completed") {
          const text = result.text.replaceAll(bridge.token, "[redacted]");
          const delivered = service.store.list<DirectorOutput>("director_output", claimed.projectId).filter(output => output.turnId === turn.id);
          const finals = delivered.filter(output => output.phase === "final");
          // Native results aggregate already delivered items. Keep those items in
          // the audit without appending the same answer again as a third message.
          const assembled = (finals.length ? finals : delivered).map(output => output.text).join("\n");
          if (text !== assembled) this.output(turn, text, "final");
        }
        this.terminal({ ...turn, dispatched: result.dispatched, nativeThreadId: result.nativeThreadId ?? turn.nativeThreadId, nativeTurnId: result.nativeTurnId ?? turn.nativeTurnId },
          result.status === "unknown" ? "unknown" : stale ? "interrupted" : pending ? "waiting_user" : result.status, result.error?.code ?? null);
        new ToolInvocationService(service).reconcileEpoch(claimed.projectId, turn.epochId!);
      });
    } catch (error) {
      service.store.transaction(() => {
        const turn = service.store.get<DirectorTurn>("director_turn", claimed.id)!;
        if (turn.state !== "running" || turn.owner !== this.owner) return;
        this.terminal(turn, attempted ? "unknown" : abort.signal.aborted ? "interrupted" : "failed",
          error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "DIRECTOR_RUN_FAILED");
        if (turn.epochId) new ToolInvocationService(service).reconcileEpoch(claimed.projectId, turn.epochId);
      });
    }
  }

  async settle(): Promise<void> { await Promise.all([...this.active.values()].map(active => active.done)); }
  async close(): Promise<void> {
    this.closed = true;
    for (const [projectId, active] of this.active) {
      const turn = this.service.store.get<DirectorTurn>("director_turn", active.turnId);
      if (turn?.state === "running") this.service.store.transaction(() => this.revoke(turn));
      active.abort.abort();
    }
    await this.settle();
  }
}
