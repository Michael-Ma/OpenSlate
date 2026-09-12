import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexRuntimeLimits } from "./policy.js";
import { object, requireRuntime, RuntimeFault } from "./validation.js";

const METHODS = new Set(["initialize", "config/read", "skills/list", "mcpServerStatus/list", "thread/start", "thread/resume", "turn/start", "turn/interrupt"]);
type Pending = { resolve(value: unknown): void; reject(error: RuntimeFault): void; dispose(): void };
export interface RpcMessage { method: string; params: unknown; id?: string | number }
export function timeout<T>(value: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new RuntimeFault(code, "Director operation exceeded its time limit")), ms);
    value.then(result => { clearTimeout(timer); resolve(result); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** Private, one-run JSONL transport. It never opens a socket or retries a request. */
export class CodexTransport {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<void>;
  readonly failed: Promise<RuntimeFault>;
  #failure: RuntimeFault | undefined;
  #resolveFailure!: (error: RuntimeFault) => void;
  #resolveExit!: () => void;
  #closed = false;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #abandoned = new Set<number>();
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #buffer = "";
  #bytes = 0;
  #stderr = "";
  #stderrBytes = 0;
  #limits: CodexRuntimeLimits;
  #onMessage: (message: RpcMessage) => void;
  #secrets: readonly string[];

  constructor(options: { command: string; args: string[]; cwd: string; env: Record<string, string>; limits: CodexRuntimeLimits;
    secrets: readonly string[]; onMessage(message: RpcMessage): void }) {
    this.#limits = options.limits; this.#onMessage = options.onMessage;
    this.#secrets = options.secrets.filter(value => value.length > 0).sort((a, b) => b.length - a.length);
    this.failed = new Promise(resolve => { this.#resolveFailure = resolve; });
    this.exited = new Promise(resolve => { this.#resolveExit = resolve; });
    // A separate POSIX process group includes stdio MCP descendants in cleanup.
    this.child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: "pipe", shell: false, detached: true });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.#stderrBytes += Buffer.byteLength(chunk); this.#stderr = (this.#stderr + chunk).slice(-16_384);
      if (this.#stderrBytes > this.#limits.outputBytes) {
        this.fail(new RuntimeFault("RUNTIME_OUTPUT_LIMIT", "Native diagnostics exceeded their run limit")); this.signalGroup("SIGTERM");
      }
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    this.child.stdout.on("error", () => this.fail(new RuntimeFault("RUNTIME_TRANSPORT_FAILED", "Native output stream failed")));
    this.child.stdin.on("error", () => this.fail(new RuntimeFault("RUNTIME_TRANSPORT_FAILED", "Native input stream failed")));
    this.child.once("error", () => { this.fail(new RuntimeFault("RUNTIME_SPAWN_FAILED", "Native process could not start")); });
    this.child.once("close", () => {
      this.#closed = true; this.#resolveExit();
      this.fail(new RuntimeFault("RUNTIME_PROCESS_EXIT", "Native process exited"));
    });
  }
  get closed(): boolean { return this.#closed; }
  diagnostics(): string {
    let value = this.#stderr;
    for (const secret of this.#secrets) value = value.replaceAll(secret, "[redacted]");
    // Avoid inadvertently returning conventional bearer/header values even from a misbehaving child.
    return value.replace(/(bearer\s+|(?:api[_-]?key|token|secret|password)[=:]\s*)[^\s,;"']+/gi, "$1[redacted]").slice(-4096);
  }
  fail(error: RuntimeFault): void {
    if (this.#failure) return;
    this.#failure = error; this.#resolveFailure(error);
    for (const item of this.#pending.values()) { item.dispose(); item.reject(error); }
    this.#pending.clear();
  }
  private send(value: unknown): void {
    if (this.#failure) throw this.#failure;
    const line = JSON.stringify(value) + "\n";
    requireRuntime(Buffer.byteLength(line) <= 3 * 1024 * 1024, "RUNTIME_REQUEST_TOO_LARGE", "Native request exceeds the byte limit");
    requireRuntime(this.child.stdin.writableLength <= 3 * 1024 * 1024, "RUNTIME_BACKPRESSURE", "Native input is not draining");
    this.child.stdin.write(line);
  }
  notification(method: "initialized"): void { this.send({ method, params: {} }); }
  rejectServerRequest(id: string | number): void {
    this.send({ id, error: { code: -32601, message: "Interactive native requests are unavailable in this runtime" } });
  }
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    requireRuntime(METHODS.has(method), "RUNTIME_METHOD_DENIED", "Native method is outside the runtime contract");
    requireRuntime(!signal?.aborted, "RUNTIME_ABORTED", "Director run was cancelled");
    requireRuntime(this.#pending.size < 8, "RUNTIME_REQUEST_LIMIT", "Too many pending native requests");
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const abandon = (error: RuntimeFault) => {
        const pending = this.#pending.get(id); if (!pending) return;
        this.#pending.delete(id); this.#abandoned.add(id); pending.dispose(); reject(error);
      };
      const abort = () => abandon(new RuntimeFault("RUNTIME_ABORTED", "Director run was cancelled"));
      const timer = setTimeout(() => abandon(new RuntimeFault("RUNTIME_RPC_TIMEOUT", "Native request timed out")), this.#limits.requestTimeoutMs);
      const dispose = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
      this.#pending.set(id, { resolve, reject, dispose });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ id, method, params }); }
      catch (error) { this.#pending.delete(id); dispose(); reject(error); }
    });
  }
  private receive(chunk: Buffer): void {
    if (this.#failure) return;
    try {
      this.#bytes += chunk.length;
      requireRuntime(this.#bytes <= this.#limits.outputBytes, "RUNTIME_OUTPUT_LIMIT", "Native output exceeds its run limit");
      this.#buffer += this.#decoder.decode(chunk, { stream: true });
      requireRuntime(Buffer.byteLength(this.#buffer) <= 4 * 1024 * 1024, "RUNTIME_OUTPUT_LIMIT", "Native response line exceeds its limit");
      while (this.#buffer.includes("\n")) {
        const end = this.#buffer.indexOf("\n"); const line = this.#buffer.slice(0, end); this.#buffer = this.#buffer.slice(end + 1);
        if (!line.trim()) continue;
        const message = object(JSON.parse(line));
        if (typeof message.method === "string") {
          requireRuntime(message.id === undefined || typeof message.id === "string" || typeof message.id === "number",
            "RUNTIME_PROTOCOL_INVALID", "Invalid native request identity");
          this.#onMessage({ method: message.method, params: message.params,
            ...(message.id === undefined ? {} : { id: message.id as string | number }) });
        } else {
          requireRuntime(typeof message.id === "number", "RUNTIME_PROTOCOL_INVALID", "Invalid native response identity");
          if (this.#abandoned.delete(message.id)) continue;
          const pending = this.#pending.get(message.id);
          requireRuntime(pending, "RUNTIME_PROTOCOL_INVALID", "Unexpected or duplicate native response");
          requireRuntime(message.error !== undefined || Object.hasOwn(message, "result"), "RUNTIME_PROTOCOL_INVALID", "Native response has no result");
          this.#pending.delete(message.id); pending.dispose();
          if (message.error !== undefined) pending.reject(new RuntimeFault("RUNTIME_RPC_REJECTED", "Native runtime rejected the request"));
          else pending.resolve(message.result);
        }
      }
    } catch (error) {
      this.fail(error instanceof RuntimeFault ? error : new RuntimeFault("RUNTIME_PROTOCOL_INVALID", "Invalid native JSONL output"));
      this.signalGroup("SIGTERM");
    }
  }
  async close(): Promise<void> {
    if (!this.#closed) {
      this.child.stdin.end();
      await timeout(this.exited, this.#limits.shutdownGraceMs, "RUNTIME_SHUTDOWN_TIMEOUT").catch(() => {});
    }
    if (await this.groupExited()) return;
    this.signalGroup("SIGTERM");
    if (await this.waitGroup()) return;
    this.signalGroup("SIGKILL");
    requireRuntime(await this.waitGroup(), "RUNTIME_CLEANUP_FAILED", "Native process group cleanup was not confirmed");
  }
  private signalGroup(signal: NodeJS.Signals): void {
    if (this.child.pid !== undefined) {
      try { process.kill(-this.child.pid, signal); } catch { /* Exit is verified separately. */ }
    }
  }
  private async groupExited(): Promise<boolean> {
    if (this.child.pid === undefined) return this.#closed;
    try { process.kill(-this.child.pid, 0); return false; }
    catch (error) { return this.#closed && (error as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  private async waitGroup(): Promise<boolean> {
    const deadline = Date.now() + this.#limits.shutdownGraceMs;
    do {
      if (await this.groupExited()) return true;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    return this.groupExited();
  }
}
