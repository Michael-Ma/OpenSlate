import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const ALLOWED = new Set([
  "initialize", "thread/start", "thread/resume", "thread/read",
  "skills/list", "mcpServerStatus/list", "mcpServer/tool/call",
  "turn/interrupt", "turn/steer",
]);

export function assertNoPaidRequest(method: string, params: unknown): void {
  if (!ALLOWED.has(method)) throw new Error(`PROBE_METHOD_FORBIDDEN: ${method}`);
  const input = record(params);
  if (method === "turn/steer" &&
      (!Array.isArray(input.input) || input.input.length !== 0)) {
    throw new Error("PROBE_STEER_INPUT_FORBIDDEN");
  }
  if (method === "mcpServer/tool/call" && input.server !== "openslate_probe") {
    throw new Error("PROBE_MCP_SERVER_FORBIDDEN");
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export class RpcError extends Error {
  constructor(readonly code: number, message: string) { super(message); }
}

/** Probe-only transport: the allowlist deliberately has no turn/start method. */
export class ProbeClient {
  readonly methodsSent: string[] = [];
  readonly notifications: string[] = [];
  readonly deniedServerRequests: string[] = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = "";
  private stderr = "";
  private failure: Error | undefined;
  private readonly pending = new Map<number, {
    resolve(value: unknown): void; reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { cwd, env, stdio: "pipe" });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.receive(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-16_384);
    });
    this.child.on("error", error => this.fail(error));
    this.child.stdin.on("error", error => this.fail(error));
    this.child.on("exit", (code, signal) => {
      this.fail(new Error(`PROBE_PROCESS_EXIT: ${code ?? signal}`));
    });
  }

  async request(method: string, params: unknown, timeoutMs = 12_000): Promise<unknown> {
    assertNoPaidRequest(method, params);
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    this.methodsSent.push(method);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`PROBE_RPC_TIMEOUT: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  initialized(): void {
    this.child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  }

  diagnostics(): string { return this.stderr; }

  async close(): Promise<void> {
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    await new Promise<void>(resolve => {
      const kill = setTimeout(() => this.child.kill("SIGKILL"), 1_000);
      const stop = setTimeout(() => this.child.kill("SIGTERM"), 100);
      this.child.once("exit", () => { clearTimeout(kill); clearTimeout(stop); resolve(); });
    });
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const item of this.pending.values()) {
      clearTimeout(item.timer); item.reject(error);
    }
    this.pending.clear();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > 2_097_152) {
      this.fail(new Error("PROBE_RPC_BUFFER_LIMIT")); this.child.kill(); return;
    }
    while (this.buffer.includes("\n")) {
      const newline = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: Record<string, unknown>;
      try { message = record(JSON.parse(line)); }
      catch { this.fail(new Error("PROBE_INVALID_JSON")); this.child.kill(); return; }
      if (typeof message.method === "string") {
        if ("id" in message) {
          // Never grant native permissions, obtain real auth, or answer a model question.
          this.deniedServerRequests.push(message.method);
          this.child.stdin.write(JSON.stringify({ id: message.id,
            error: { code: -32601, message: "Unavailable in no-turn probe" } }) + "\n");
        } else this.notifications.push(message.method);
        continue;
      }
      if (typeof message.id !== "number") continue;
      const item = this.pending.get(message.id);
      if (!item) continue;
      clearTimeout(item.timer); this.pending.delete(message.id);
      if (message.error) {
        const error = record(message.error);
        item.reject(new RpcError(Number(error.code), String(error.message)));
      } else item.resolve(message.result);
    }
  }
}
