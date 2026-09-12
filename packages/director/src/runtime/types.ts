/** Application identities remain authoritative; native IDs are correlation hints only. */
export interface DirectorRunIdentity {
  projectId: string;
  requestId: string;
  epochId: string;
  turnId: string;
}

export interface DirectorSkillRef { name: string; path: string }
export interface DirectorBridgeConfig {
  endpoint: string;
  projectId: string;
  credential: string;
  /** Absolute path to OpenSlate's fixed stdio MCP entrypoint. */
  entrypoint: string;
}
export interface DirectorRunInput extends DirectorRunIdentity {
  text: string;
  /** Reconstructed application state and focused references, never native history. */
  context: string;
  skills: readonly DirectorSkillRef[];
  bridge: DirectorBridgeConfig;
  resumeThreadId?: string;
}

export interface DirectorQuestion {
  id: string;
  header: string;
  question: string;
  options: readonly { label: string; description: string }[];
}
export type DirectorRuntimeEvent = DirectorRunIdentity & (
  | { kind: "runtime_started"; nativeThreadId: string }
  | { kind: "turn_started"; nativeThreadId: string; nativeTurnId: string }
  | { kind: "assistant_message"; text: string; phase: "commentary" | "final" | "unknown" }
  | { kind: "pending_input"; nativeRequestId: string; questions: readonly DirectorQuestion[] }
  | { kind: "diagnostic"; code: string; message: string }
);
export interface DirectorStartOptions {
  signal?: AbortSignal;
  /** Backpressure is bounded; a failed consumer ends this run instead of losing events. */
  onEvent?: (event: DirectorRuntimeEvent) => void | Promise<void>;
}
export interface DirectorRunResult extends DirectorRunIdentity {
  status: "completed" | "interrupted" | "failed" | "unknown";
  text: string;
  nativeThreadId?: string;
  nativeTurnId?: string;
  error?: { code: string; message: string };
  /** True only after this adapter attempted to write turn/start. Never retry an unknown result. */
  dispatched: boolean;
}
export interface DirectorRuntime {
  readonly id: string;
  start(input: DirectorRunInput, options?: DirectorStartOptions): Promise<DirectorRunResult>;
}
