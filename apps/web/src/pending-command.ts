export interface PendingCommand { path: string; body?: unknown; file?: Blob; key: string; metadata?: unknown }
export interface PendingCommandSnapshot {
  readonly command: PendingCommand | null;
  readonly running: boolean;
  readonly error: unknown | null;
  readonly settledVersion: number;
  readonly lastSuccess: boolean;
  readonly lastWasUpload: boolean;
  readonly settledCommand: PendingCommand | null;
  readonly result: unknown;
}
const EMPTY: PendingCommandSnapshot = Object.freeze({ command: null, running: false, error: null, settledVersion: 0, lastSuccess: false, lastWasUpload: false, settledCommand: null, result: null });
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

  snapshot(projectId: string): PendingCommandSnapshot { return this.states.get(projectId) ?? EMPTY; }
  subscribe(projectId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set(); listeners.add(listener); this.listeners.set(projectId, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(projectId); };
  }
  private publish(projectId: string, state: PendingCommandSnapshot): void {
    this.states.set(projectId, Object.freeze(state));
    for (const listener of [...this.listeners.get(projectId) ?? []]) listener();
  }

  /** Claim synchronously; retry requires the exact retained command object. No automatic dispatch on subscribe. */
  async run(projectId: string, requested: PendingCommand, send: (command: PendingCommand) => Promise<unknown>, uncertain: (error: unknown) => boolean): Promise<boolean> {
    const before = this.snapshot(projectId);
    if (before.running || before.command && before.command !== requested) return false;
    const command = before.command ?? capture(requested);
    this.publish(projectId, { ...before, command, running: true, error: null });
    try {
      const result = await send(command);
      this.publish(projectId, { command: null, running: false, error: null, settledVersion: before.settledVersion + 1, lastSuccess: true, lastWasUpload: !!command.file, settledCommand: completionCommand(command), result: freezeBody(structuredClone(result)) });
    } catch (error) {
      this.publish(projectId, { command: uncertain(error) ? command : null, running: false, error, settledVersion: before.settledVersion + 1, lastSuccess: false, lastWasUpload: !!command.file, settledCommand: completionCommand(command), result: null });
    }
    return true;
  }
}
const registries = new WeakMap<object, Map<string, PendingCommandRegistry>>();
export function pendingCommandsFor(api: object, namespace = "media"): PendingCommandRegistry {
  let spaces = registries.get(api);
  if (!spaces) { spaces = new Map(); registries.set(api, spaces); }
  let registry = spaces.get(namespace);
  if (!registry) { registry = new PendingCommandRegistry(); spaces.set(namespace, registry); }
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
