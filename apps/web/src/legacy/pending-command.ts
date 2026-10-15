import { sceneContinuationFor, type SceneContinuationCache } from "./scene-continuation-cache.ts";

export interface PendingCommand { path: string; body?: unknown; file?: Blob; key: string; metadata?: unknown }
export interface PendingCommandSnapshot {
  readonly command: PendingCommand | null;
  readonly running: boolean;
  readonly progress: string | null;
  readonly error: unknown | null;
  readonly settledVersion: number;
  readonly lastSuccess: boolean;
  readonly lastWasUpload: boolean;
  readonly settledCommand: PendingCommand | null;
  readonly result: unknown;
  readonly recovered?: boolean;
  readonly localRecoveryLimit?: string | null;
}
const EMPTY: PendingCommandSnapshot = Object.freeze({ command: null, running: false, progress: null, error: null, settledVersion: 0, lastSuccess: false, lastWasUpload: false, settledCommand: null, result: null });
function freezeBody(value: unknown): unknown {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freezeBody(item); Object.freeze(value); }
  return value;
}
function capture(command: PendingCommand): PendingCommand {
  if (!command.key || !command.path.startsWith("/api/")) throw new Error("A saved request needs a path and retry identity.");
  return Object.freeze({ path: command.path, key: command.key,
    ...(command.body === undefined ? {} : { body: freezeBody(structuredClone(command.body)) }),
    ...(command.file ? { file: command.file } : {}),
    ...(command.metadata === undefined ? {} : { metadata: freezeBody(structuredClone(command.metadata)) }) });
}

function completionCommand(command: PendingCommand): PendingCommand {
  // Keep review metadata, but release potentially large uploaded files after success.
  const { file: _file, ...saved } = command; return Object.freeze(saved);
}

/** UI-memory only. Never interprets a saved request as new application authority. */
export class PendingCommandRegistry {
  private readonly states = new Map<string, PendingCommandSnapshot>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly sceneCache: SceneContinuationCache | undefined;
  constructor(sceneCache?: SceneContinuationCache) { this.sceneCache = sceneCache; }

  snapshot(projectId: string): PendingCommandSnapshot {
    let state = this.states.get(projectId);
    if (!state && this.sceneCache) {
      const saved = this.sceneCache.read(projectId);
      state = saved ? Object.freeze({ ...EMPTY, command: capture(saved.command), recovered: true,
        localRecoveryLimit: this.sceneCache.warning }) : Object.freeze({ ...EMPTY, localRecoveryLimit: this.sceneCache.warning });
      this.states.set(projectId, state);
    }
    return state ?? EMPTY;
  }
  subscribe(projectId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set(); listeners.add(listener); this.listeners.set(projectId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(projectId); };
  }
  private publish(projectId: string, state: PendingCommandSnapshot): void {
    this.states.set(projectId, Object.freeze({ ...state, localRecoveryLimit: this.sceneCache?.warning ?? null }));
    for (const listener of [...this.listeners.get(projectId) ?? []]) listener();
  }

  /** Progress belongs to the exact running request, independently of any mounted view. */
  reportProgress(projectId: string, key: string, progress: string): void {
    const state = this.snapshot(projectId);
    if (!state.running || state.command?.key !== key || state.progress === progress) return;
    this.publish(projectId, { ...state, progress });
  }

  /** Claim synchronously; retry requires the exact retained command object. No automatic dispatch on subscribe. */
  async run(projectId: string, requested: PendingCommand, send: (command: PendingCommand) => Promise<unknown>, uncertain: (error: unknown) => boolean, options: { deferSceneCheckpoint?: boolean } = {}): Promise<boolean> {
    const before = this.snapshot(projectId);
    if (before.running || before.command && before.command !== requested) return false;
    const command = before.command ?? capture(requested);
    if (this.sceneCache && !options.deferSceneCheckpoint) this.sceneCache.write(projectId, { command, flow: this.sceneCache.read(projectId)?.flow ?? null });
    this.publish(projectId, { ...before, command, running: true,
      progress: options.deferSceneCheckpoint ? "Checking saved scene request…" : null, error: null });
    try {
      const result = await send(command);
      if (!options.deferSceneCheckpoint) this.sceneCache?.write(projectId, null);
      this.publish(projectId, { command: null, running: false, progress: null, error: null, settledVersion: before.settledVersion + 1, lastSuccess: true, lastWasUpload: !!command.file, settledCommand: completionCommand(command), result: freezeBody(structuredClone(result)) });
    } catch (error) {
      const retry = uncertain(error);
      if (!retry && !options.deferSceneCheckpoint) this.sceneCache?.write(projectId, null);
      this.publish(projectId, { command: retry ? command : null, running: false, progress: null, error, settledVersion: before.settledVersion + 1, lastSuccess: false, lastWasUpload: !!command.file, settledCommand: completionCommand(command), result: null });
    }
    return true;
  }
}
const registries = new WeakMap<object, Map<string, PendingCommandRegistry>>();
export function pendingCommandsFor(api: object, namespace = "media"): PendingCommandRegistry {
  let spaces = registries.get(api);
  if (!spaces) { spaces = new Map(); registries.set(api, spaces); }
  let registry = spaces.get(namespace);
  if (!registry) { registry = new PendingCommandRegistry(namespace === "conversation-scenes" ? sceneContinuationFor(api as object & { cacheNamespace?: string }) : undefined); spaces.set(namespace, registry); }
  return registry;
}

/** A visible continuation always names a currently saved project-wide editing request. */
export function activeProjectEdit(messages: ReadonlyArray<{ id: string; state?: string; editing?: boolean; scopeIds?: string[] }>, projectId: string): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.state === "active" && message.editing === true && message.scopeIds?.includes(projectId)) return message.id;
  }
  return null;
}
