import { fault, identity, requireRuntime, RuntimeFault, validateInput } from "./validation.js";
import type { DirectorRunInput, DirectorRunResult, DirectorRuntime, DirectorStartOptions } from "./types.js";

export type FakeDirectorOutcome = Pick<DirectorRunResult, "status" | "text"> &
  Partial<Pick<DirectorRunResult, "error" | "nativeThreadId" | "nativeTurnId" | "dispatched">>;
export type FakeDirectorHandler = (input: DirectorRunInput, options: DirectorStartOptions) =>
  FakeDirectorOutcome | Promise<FakeDirectorOutcome>;

/**
 * Deterministic local runtime with an injectable application-tool handler. No native process or network.
 * Cancellation signals the handler; if its completion is unknown, callers must fence the epoch.
 */
export class FakeDirectorRuntime implements DirectorRuntime {
  readonly id = "fake-director";
  #handler: FakeDirectorHandler;
  #timeoutMs: number;
  constructor(handler: FakeDirectorHandler = () => ({ status: "completed", text: "Fake director completed." }),
    options: { timeoutMs?: number } = {}) {
    this.#handler = handler; this.#timeoutMs = options.timeoutMs ?? 5000;
    requireRuntime(Number.isSafeInteger(this.#timeoutMs) && this.#timeoutMs > 0 && this.#timeoutMs <= 180_000,
      "RUNTIME_CONFIG_INVALID", "Fake runtime timeout is invalid");
  }
  async start(supplied: DirectorRunInput, options: DirectorStartOptions = {}): Promise<DirectorRunResult> {
    const input = validateInput(supplied); const base = identity(input);
    if (options.signal?.aborted) return { ...base, status: "interrupted", text: "", dispatched: false };
    const controller = new AbortController();
    let rejectStop!: (error: RuntimeFault) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    const stop = (code: string, message: string) => { controller.abort(); rejectStop(new RuntimeFault(code, message)); };
    const abort = () => stop("RUNTIME_ABORTED", "Fake director was cancelled; handler completion is unknown");
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("RUNTIME_RUN_TIMEOUT", "Fake director handler exceeded its time limit"), this.#timeoutMs);
    try {
      const result = await Promise.race([Promise.resolve().then(() => this.#handler(input, {
        signal: controller.signal,
        ...(options.onEvent ? { onEvent: async event => {
          requireRuntime(Object.entries(base).every(([key, value]) => event[key as keyof typeof base] === value),
            "RUNTIME_EVENT_IDENTITY", "Fake director event identity differs from the request");
          await options.onEvent!(event);
        } } : {}),
      })), stopped]);
      requireRuntime(["completed", "interrupted", "failed", "unknown"].includes(result.status) &&
        typeof result.text === "string" && Buffer.byteLength(result.text) <= 1024 * 1024,
      "RUNTIME_PROTOCOL_INVALID", "Fake director returned an invalid outcome");
      return { ...result, ...base, dispatched: result.dispatched ?? true };
    } catch (error) {
      const problem = fault(error);
      return { ...base, status: "unknown", text: "", dispatched: true, error: { code: problem.code, message: problem.message } };
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
    }
  }
}
